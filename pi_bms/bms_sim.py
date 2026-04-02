"""
bms_sim.py — BMS data simulator for Raspberry Pi.

Generates BMS telemetry and writes directly to the cloud PostgreSQL
telemetry table.  Every reading is also appended to bms_data.txt.

    node_id = bms_1
    bms_id  = bms_1

Usage:
    python3 bms_sim.py              # 2-second interval (default)
    python3 bms_sim.py --period 5   # one reading every 5 seconds

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

# ── Fixed identifiers ─────────────────────────────────────────────────────────

NODE_ID = "bms_1"
BMS_ID  = "bms_1"

# ── Output log file ───────────────────────────────────────────────────────────

LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bms_data.txt")

# ── Helpers ───────────────────────────────────────────────────────────────────

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def append_log(line: str) -> None:
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

# ── DB insert ─────────────────────────────────────────────────────────────────
# Columns match telemetry exactly (all double precision):
#   soc, pack_voltage, pack_current, temp_high, temp_low,
#   ccl, dcl, faults_cleared_min, highest_cell_v, lowest_cell_v
#   fault_active → boolean

INSERT_SQL = """
INSERT INTO telemetry (
    ts_utc, node_id, bms_id,
    soc, pack_voltage, pack_current,
    temp_high, temp_low,
    ccl, dcl,
    fault_active, faults_cleared_min,
    highest_cell_v, lowest_cell_v
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
"""

def insert_row(conn: psycopg2.extensions.connection, row: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(INSERT_SQL, (
            row["ts_utc"],            row["node_id"],           row["bms_id"],
            row["soc"],               row["pack_voltage"],       row["pack_current"],
            row["temp_high"],         row["temp_low"],
            row["ccl"],               row["dcl"],
            row["fault_active"],      row["faults_cleared_min"],
            row["highest_cell_v"],    row["lowest_cell_v"],
        ))
    conn.commit()

# ── Simulation ────────────────────────────────────────────────────────────────

CELLS      = 14
FAULT_TEMP = 60.0   # °C — triggers fault + CCL/DCL derating
CLEAR_TEMP = 52.0   # °C — fault clears below this

def run(period: float) -> None:
    soc, pack_voltage, pack_current = 68.0, 50.4, -24.0
    temp_high, temp_low = 53.0, 48.0
    ccl, dcl = 80.0, 120.0
    fault_active = False
    faults_cleared_min = 5.0
    highest_cell_v, lowest_cell_v = 3.62, 3.55

    print(f"[bms_sim] node_id={NODE_ID}  bms_id={BMS_ID}  period={period}s")
    print(f"[bms_sim] Logging to {LOG_FILE}")

    if not os.path.exists(LOG_FILE) or os.path.getsize(LOG_FILE) == 0:
        append_log(
            "ts_utc,node_id,bms_id,"
            "soc,pack_voltage,pack_current,"
            "temp_high,temp_low,"
            "ccl,dcl,"
            "fault_active,faults_cleared_min,"
            "highest_cell_v,lowest_cell_v"
        )

    conn = get_conn()
    print("[bms_sim] DB connected")

    stop = False

    def _shutdown(sig, frame):
        nonlocal stop
        stop = True
        print("\n[bms_sim] Shutting down…")

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    while not stop:
        # ── Physics ───────────────────────────────────────────────────────────
        pack_current = clamp(pack_current + random.uniform(-3.5, 3.5), -80, 30)
        soc = clamp(soc - abs(pack_current) * 0.0004, 0.0, 100.0)
        if soc < 5.0:
            soc = 68.0  # reset for continuous demo

        sag = abs(pack_current) * random.uniform(0.0008, 0.002)
        pack_voltage = clamp(
            pack_voltage + (-sag if pack_current < 0 else sag * 0.5) + random.uniform(-0.03, 0.03),
            40.0, 58.0,
        )
        heat = abs(pack_current) * random.uniform(0.004, 0.018)
        cool = random.uniform(0.0, 0.05)
        temp_high = clamp(temp_high + heat - cool + random.uniform(-0.1, 0.3), -20.0, 90.0)
        temp_low  = clamp(temp_low  + heat * 0.7 - cool + random.uniform(-0.1, 0.2), -20.0, 90.0)
        if temp_low > temp_high:
            temp_low = temp_high - 1.5

        # ── Fault / derating ─────────────────────────────────────────────────
        if temp_high >= FAULT_TEMP:
            fault_active = True
            ccl, dcl = 5.0, 15.0
            faults_cleared_min = 0.0
        elif fault_active and temp_high <= CLEAR_TEMP:
            fault_active = False
            ccl, dcl = 80.0, 120.0
        else:
            faults_cleared_min += period / 60.0

        avg = pack_voltage / CELLS
        highest_cell_v = clamp(avg + random.uniform(0.01, 0.06), 2.5, 4.25)
        lowest_cell_v  = clamp(avg - random.uniform(0.01, 0.06), 2.5, 4.25)

        ts  = utc_now()
        row = {
            "ts_utc":             ts,
            "node_id":            NODE_ID,
            "bms_id":             BMS_ID,
            "soc":                round(soc,               2),
            "pack_voltage":       round(pack_voltage,      3),
            "pack_current":       round(pack_current,      3),
            "temp_high":          round(temp_high,         2),
            "temp_low":           round(temp_low,          2),
            "ccl":                round(ccl,               2),
            "dcl":                round(dcl,               2),
            "fault_active":       fault_active,
            "faults_cleared_min": round(faults_cleared_min, 2),
            "highest_cell_v":     round(highest_cell_v,   3),
            "lowest_cell_v":      round(lowest_cell_v,    3),
        }

        try:
            insert_row(conn, row)
            db_status = "OK"
        except Exception as exc:
            db_status = f"DB ERROR: {exc}"
            try:
                conn.close()
            except Exception:
                pass
            try:
                conn = get_conn()
            except Exception:
                pass

        append_log(
            f"{ts},{NODE_ID},{BMS_ID},"
            f"{row['soc']},{row['pack_voltage']},{row['pack_current']},"
            f"{row['temp_high']},{row['temp_low']},"
            f"{row['ccl']},{row['dcl']},"
            f"{row['fault_active']},{row['faults_cleared_min']},"
            f"{row['highest_cell_v']},{row['lowest_cell_v']}"
        )

        fault_str = "*** FAULT ***" if fault_active else "ok"
        print(
            f"[{ts}]  SOC={row['soc']:6.2f}%  "
            f"V={row['pack_voltage']:6.3f}  I={row['pack_current']:+7.3f}A  "
            f"T={row['temp_high']:.1f}/{row['temp_low']:.1f}°C  "
            f"CCL={row['ccl']}  DCL={row['dcl']}  {fault_str}"
            f"  [{db_status}]"
        )

        time.sleep(period)

    conn.close()
    print("[bms_sim] Stopped.")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--period", type=float, default=2.0,
                    help="Seconds between readings (default: 2)")
    args = ap.parse_args()
    run(args.period)


if __name__ == "__main__":
    main()
