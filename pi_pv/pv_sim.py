"""
pv_sim.py — PV inverter + load data simulator for Raspberry Pi.

Generates realistic PV telemetry (2 inverters, 4 load channels, 2 battery
voltages) and writes each reading directly to the cloud PostgreSQL
pv_telemetry table.  Every reading is also appended to pv_data.txt as a
human-readable log.

Usage:
    python3 pv_sim.py                  # runs with default settings
    python3 pv_sim.py --period 5       # one reading every 5 seconds
    python3 pv_sim.py --node pi_pv_1   # override node id

Press Ctrl+C to stop.
"""

from __future__ import annotations

import argparse
import os
import random
import signal
import sys
import time
from datetime import datetime, timezone

try:
    import psycopg2
except ImportError:
    sys.exit("Missing dependency — run:  pip install psycopg2-binary")

from db_connect import get_conn

# ── Output log file ───────────────────────────────────────────────────────────

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pv_data.txt")

# ── Helpers ───────────────────────────────────────────────────────────────────

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def append_log(line: str) -> None:
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

# ── DB insert ─────────────────────────────────────────────────────────────────

INSERT_SQL = """
INSERT INTO pv_telemetry (ts_utc, node_id, pv_id, invr1, invr2, ld1, ld2, ld3, ld4, bv1, bv2)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
"""

def insert_row(conn: psycopg2.extensions.connection, row: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(INSERT_SQL, (
            row["ts_utc"], row["node_id"], row["pv_id"],
            row["invr1"], row["invr2"],
            row["ld1"],   row["ld2"],   row["ld3"],   row["ld4"],
            row["bv1"],   row["bv2"],
        ))
    conn.commit()

# ── Simulation state ──────────────────────────────────────────────────────────

def run(node_id: str, pv_id: str, period: float) -> None:
    invr1, invr2 = 120.0, 118.0
    ld1, ld2, ld3, ld4 = 5.0, 4.5, 6.0, 3.8
    bv1, bv2 = 48.7, 48.6

    print(f"[pv_sim] node={node_id}  pv_id={pv_id}  period={period}s")
    print(f"[pv_sim] Logging to {LOG_FILE}")

    # Write header to log file if it is new / empty
    if not os.path.exists(LOG_FILE) or os.path.getsize(LOG_FILE) == 0:
        append_log("ts_utc,node_id,pv_id,invr1,invr2,ld1,ld2,ld3,ld4,bv1,bv2")

    conn = get_conn()
    print(f"[pv_sim] DB connected")

    stop = False
    def _shutdown(sig, frame):
        nonlocal stop
        stop = True
        print("\n[pv_sim] Shutting down…")

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    while not stop:
        invr1 = clamp(invr1 + random.uniform(-1.0, 1.0), 0.0, 500.0)
        invr2 = clamp(invr2 + random.uniform(-1.0, 1.0), 0.0, 500.0)
        ld1   = clamp(ld1   + random.uniform(-0.4, 0.4), 0.0, 200.0)
        ld2   = clamp(ld2   + random.uniform(-0.4, 0.4), 0.0, 200.0)
        ld3   = clamp(ld3   + random.uniform(-0.4, 0.4), 0.0, 200.0)
        ld4   = clamp(ld4   + random.uniform(-0.4, 0.4), 0.0, 200.0)
        bv1   = clamp(bv1   + random.uniform(-0.05, 0.05), 40.0, 60.0)
        bv2   = clamp(bv2   + random.uniform(-0.05, 0.05), 40.0, 60.0)

        ts   = utc_now()
        row  = {
            "ts_utc":  ts,
            "node_id": node_id,
            "pv_id":   pv_id,
            "invr1":   round(invr1, 3),
            "invr2":   round(invr2, 3),
            "ld1":     round(ld1, 3),
            "ld2":     round(ld2, 3),
            "ld3":     round(ld3, 3),
            "ld4":     round(ld4, 3),
            "bv1":     round(bv1, 3),
            "bv2":     round(bv2, 3),
        }

        total_load = ld1 + ld2 + ld3 + ld4

        # ── Write to DB ───────────────────────────────────────────────────────
        try:
            insert_row(conn, row)
            db_status = "OK"
        except Exception as exc:
            db_status = f"DB ERROR: {exc}"
            # Attempt reconnect on next loop
            try:
                conn.close()
            except Exception:
                pass
            try:
                conn = get_conn()
            except Exception:
                pass

        # ── Write to text log ─────────────────────────────────────────────────
        csv_line = (
            f"{ts},{node_id},{pv_id},"
            f"{row['invr1']},{row['invr2']},"
            f"{row['ld1']},{row['ld2']},{row['ld3']},{row['ld4']},"
            f"{row['bv1']},{row['bv2']}"
        )
        append_log(csv_line)

        # ── Console ───────────────────────────────────────────────────────────
        print(
            f"[{ts}]  invr1={row['invr1']:7.3f}  invr2={row['invr2']:7.3f}  "
            f"load={total_load:6.2f}  bv1={row['bv1']:.3f}  bv2={row['bv2']:.3f}"
            f"  [{db_status}]"
        )

        time.sleep(period)

    conn.close()
    print("[pv_sim] Stopped.")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--node",   default="pi_pv_1", help="node_id reported to the DB")
    ap.add_argument("--pv-id",  default="pv_1",    help="pv_id reported to the DB")
    ap.add_argument("--period", type=float, default=2.0,
                    help="Seconds between readings (default: 2)")
    args = ap.parse_args()
    run(args.node, args.pv_id, args.period)


if __name__ == "__main__":
    main()
