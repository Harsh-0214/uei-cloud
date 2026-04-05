#!/usr/bin/env python3
"""
rhf_job.py — Rolling Health Forecast cloud job runner

Reads 30 days of telemetry from PostgreSQL, runs the RHF algorithm for each
active BMS node, and writes results to the soh_forecast table.

Usage
-----
  # Inside the running API container (recommended):
  docker exec uei-cloud-api python rhf_job.py

  # Or directly on the host (requires Python 3.11+ and psycopg2):
  python3 rhf_job.py [options]

Options
-------
  --db-host    DATABASE_HOST     (default: postgres)
  --db-port    DATABASE_PORT     (default: 5432)
  --db-name    DATABASE_NAME     (default: uei)
  --db-user    DATABASE_USER     (default: uei)
  --db-pass    DATABASE_PASS     (default: uei_password)
  --node-id    NODE_ID           run for one node only (default: all nodes)
  --days       LOOKBACK_DAYS     telemetry window in days (default: 30)
  --dry-run                      compute but do not write to DB

Scheduling
----------
  To run daily via cron (from the host):
    0 3 * * * docker exec uei-cloud-api python rhf_job.py >> /var/log/rhf.log 2>&1
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

# Add repo root to path so algorithms/ is importable when this script runs
# inside the API container (where /app == repo root) or directly from the repo.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from algorithms.rhf import RollingHealthForecast


def _db_connect(args: argparse.Namespace):
    return psycopg2.connect(
        host=args.db_host,
        port=args.db_port,
        dbname=args.db_name,
        user=args.db_user,
        password=args.db_pass,
    )


def _load_telemetry(conn, node_id: str, days: int) -> list[dict]:
    """Fetch the last `days` days of telemetry for one node, sorted oldest-first."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(
            """
            SELECT ts_utc, soc, temp_high, pack_current, pack_voltage
            FROM   telemetry
            WHERE  node_id = %s
              AND  ts_utc  >= NOW() AT TIME ZONE 'UTC' - INTERVAL %s
            ORDER  BY ts_utc ASC
            """,
            (node_id, f"{days} days"),
        )
        return [dict(r) for r in cur.fetchall()]


def _last_soh(conn, node_id: str) -> float | None:
    """Return the most recently stored SoH for a node, or None if none exists."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT current_soh FROM soh_forecast WHERE node_id = %s ORDER BY computed_at DESC LIMIT 1",
            (node_id,),
        )
        row = cur.fetchone()
    return float(row[0]) if row else None


def _active_bms_nodes(conn, days: int) -> list[tuple[str, str]]:
    """Return (node_id, bms_id) pairs that have sent telemetry in the last `days` days."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT node_id, bms_id
            FROM   telemetry
            WHERE  ts_utc >= NOW() AT TIME ZONE 'UTC' - INTERVAL %s
            ORDER  BY node_id
            """,
            (f"{days} days",),
        )
        return cur.fetchall()


def _write_forecast(conn, result: dict, dry_run: bool) -> None:
    if dry_run:
        return
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO soh_forecast
              (node_id, bms_id, current_soh, forecast_30d, forecast_60d,
               forecast_90d, stress_summary)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                result["node_id"],
                result["bms_id"],
                result["current_soh"],
                result["forecast_30d"],
                result["forecast_60d"],
                result["forecast_90d"],
                __import__("json").dumps(result["daily_stress_summary"]),
            ),
        )


def run(args: argparse.Namespace) -> None:
    started = datetime.now(timezone.utc)
    print(f"[RHF] Job started at {started.isoformat()}Z")
    if args.dry_run:
        print("[RHF] DRY RUN — no changes will be written to the database")

    conn = _db_connect(args)
    conn.autocommit = False
    rhf  = RollingHealthForecast()

    try:
        if args.node_id:
            # Single node — derive bms_id from latest telemetry row
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT bms_id FROM telemetry WHERE node_id = %s ORDER BY ts_utc DESC LIMIT 1",
                    (args.node_id,),
                )
                row = cur.fetchone()
            if not row:
                print(f"[RHF] No telemetry found for node '{args.node_id}'. Exiting.")
                return
            nodes = [(args.node_id, row[0])]
        else:
            nodes = _active_bms_nodes(conn, args.days)

        if not nodes:
            print(f"[RHF] No active BMS nodes found in the last {args.days} days.")
            return

        print(f"[RHF] Processing {len(nodes)} node(s) with a {args.days}-day window…\n")

        for node_id, bms_id in nodes:
            rows         = _load_telemetry(conn, node_id, args.days)
            previous_soh = _last_soh(conn, node_id)
            result       = rhf.forecast(node_id, bms_id, rows, previous_soh)

            print(
                f"  [{node_id}]  rows={len(rows):5d}  "
                f"SoH={result['current_soh']:5.2f}%  "
                f"→30d={result['forecast_30d']:5.2f}%  "
                f"→60d={result['forecast_60d']:5.2f}%  "
                f"→90d={result['forecast_90d']:5.2f}%  "
                f"days={result['daily_stress_summary'].get('days_analyzed', 0)}"
            )

            _write_forecast(conn, result, args.dry_run)

        if not args.dry_run:
            conn.commit()
            print(f"\n[RHF] Results written to soh_forecast table.")
        else:
            print(f"\n[RHF] Dry run complete — nothing written.")

    except Exception as exc:
        conn.rollback()
        print(f"[RHF] ERROR: {exc}", file=sys.stderr)
        raise
    finally:
        conn.close()

    elapsed = (datetime.now(timezone.utc) - started).total_seconds()
    print(f"[RHF] Done in {elapsed:.1f}s")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db-host", default=os.environ.get("DB_HOST", "postgres"))
    ap.add_argument("--db-port", type=int, default=int(os.environ.get("DB_PORT", "5432")))
    ap.add_argument("--db-name", default=os.environ.get("DB_NAME", "uei"))
    ap.add_argument("--db-user", default=os.environ.get("DB_USER", "uei"))
    ap.add_argument("--db-pass", default=os.environ.get("DB_PASS", "uei_password"))
    ap.add_argument("--node-id", default=None, help="Run for one node only")
    ap.add_argument("--days",    type=int, default=30, help="Telemetry lookback window in days")
    ap.add_argument("--dry-run", action="store_true", help="Compute but do not write to DB")
    args = ap.parse_args()
    run(args)


if __name__ == "__main__":
    main()
