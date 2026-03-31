#!/usr/bin/env python3
"""
run_all.py — Run all UEI simulators concurrently.

Launches 4 simulator threads against the cloud API so you can see the full
dashboard in action: three BMS nodes (mixed, charging, thermal-stress) plus
the PV inverter node.

Usage:
    python3 run_all.py                              # target http://localhost:8000
    python3 run_all.py --api-url http://IP:8000     # target deployed VM
    python3 run_all.py --period 5                   # slower cadence (5s)

Press Ctrl+C to stop all simulators cleanly.
"""

from __future__ import annotations

import argparse
import random
import signal
import sys
import threading
import time
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    sys.exit("Missing dependency — run:  pip install requests")

# ── ANSI colours ─────────────────────────────────────────────────────────────

R   = "\033[0m"         # reset
B   = "\033[1m"         # bold
CYAN    = "\033[36m"
GREEN   = "\033[32m"
YELLOW  = "\033[33m"
MAGENTA = "\033[35m"
RED     = "\033[31m"

_lock = threading.Lock()

def log(colour: str, tag: str, msg: str) -> None:
    with _lock:
        print(f"{colour}{B}[{tag}]{R} {msg}", flush=True)

# ── Shared stop event ─────────────────────────────────────────────────────────

_stop = threading.Event()

# ── Helpers ───────────────────────────────────────────────────────────────────

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def post(url: str, payload: dict, timeout: float = 5.0) -> None:
    r = requests.post(url, json=payload, timeout=timeout)
    r.raise_for_status()

# ── BMS Node 1 — pi_bms_1 — mixed discharge / charge ────────────────────────

def _run_bms1(api_url: str, period: float) -> None:
    tag = "BMS-1"
    url = f"{api_url}/telemetry"
    soc, pack_voltage, pack_current = 82.0, 48.6, 5.0
    temp_high, temp_low = 31.0, 28.5
    highest_cell_v, lowest_cell_v = 3.62, 3.58
    ccl, dcl = 80.0, 120.0
    fault_active = False
    faults_cleared_min = 27.0

    log(CYAN, tag, f"pi_bms_1  →  {url}  (mixed discharge/charge)")
    while not _stop.is_set():
        soc          = clamp(soc + random.uniform(-0.05, 0.02), 0, 100)
        pack_voltage = clamp(pack_voltage + random.uniform(-0.1, 0.1), 40, 60)
        pack_current = clamp(pack_current + random.uniform(-0.5, 0.5), -50, 50)
        temp_high    = clamp(temp_high + random.uniform(-0.1, 0.2), -20, 90)
        temp_low     = clamp(temp_low  + random.uniform(-0.1, 0.2), -20, 90)
        if temp_low > temp_high:
            temp_low = temp_high - 0.5
        highest_cell_v = clamp(highest_cell_v + random.uniform(-0.01, 0.01), 2.5, 4.25)
        lowest_cell_v  = clamp(lowest_cell_v  + random.uniform(-0.01, 0.01), 2.5, 4.25)
        if lowest_cell_v > highest_cell_v:
            lowest_cell_v = highest_cell_v - 0.02
        if random.random() < 0.01:
            fault_active = True
        if fault_active and random.random() < 0.15:
            fault_active = False
            faults_cleared_min = 0.0
        else:
            faults_cleared_min += period / 60.0

        pkt = {
            "ts_utc": utc_now(), "node_id": "pi_bms_1", "bms_id": "OrionJr2_001",
            "soc": round(soc, 2), "pack_voltage": round(pack_voltage, 3),
            "pack_current": round(pack_current, 3), "temp_high": round(temp_high, 2),
            "temp_low": round(temp_low, 2), "ccl": ccl, "dcl": dcl,
            "fault_active": fault_active,
            "faults_cleared_min": round(faults_cleared_min, 2),
            "highest_cell_v": round(highest_cell_v, 3),
            "lowest_cell_v":  round(lowest_cell_v, 3),
        }
        try:
            post(url, pkt)
            log(CYAN, tag,
                f"SOC={pkt['soc']}%  V={pkt['pack_voltage']}  "
                f"I={pkt['pack_current']:+.2f}A  fault={pkt['fault_active']}")
        except Exception as exc:
            log(CYAN, tag, f"{RED}ERROR{R} {exc}")
        _stop.wait(period)

# ── BMS Node 2 — bms-node-2 — charging from low SOC ─────────────────────────

def _run_bms2(api_url: str, period: float) -> None:
    tag = "BMS-2"
    url = f"{api_url}/telemetry"
    soc, pack_voltage, pack_current = 25.0, 44.2, 20.0
    temp_high, temp_low = 28.0, 24.5
    highest_cell_v, lowest_cell_v = 3.16, 3.10
    ccl, dcl = 80.0, 120.0
    fault_active = False
    faults_cleared_min = 0.0
    CELLS = 14

    log(GREEN, tag, f"bms-node-2  →  {url}  (charge-cycle: low SOC → full → discharge)")
    while not _stop.is_set():
        if soc >= 98.0:
            pack_current = -18.0
        elif soc <= 18.0:
            pack_current = 22.0
        pack_current = clamp(pack_current + random.uniform(-1.5, 1.5), -60, 60)
        soc = clamp(soc + pack_current * 0.001, 0.0, 100.0)

        delta_v = 0.06 if pack_current > 0 else -0.04
        pack_voltage = clamp(
            pack_voltage + delta_v * random.uniform(0.5, 1.5) + random.uniform(-0.02, 0.02),
            40.0, 58.0,
        )
        heat = abs(pack_current) * random.uniform(0.001, 0.008)
        temp_high = clamp(temp_high + random.uniform(-0.05, 0.1) + heat, -20.0, 90.0)
        temp_low  = clamp(temp_low  + random.uniform(-0.05, 0.08) + heat * 0.7, -20.0, 90.0)
        if temp_low > temp_high:
            temp_low = temp_high - 0.5
        avg = pack_voltage / CELLS
        highest_cell_v = clamp(avg + random.uniform(0.01, 0.04), 2.5, 4.25)
        lowest_cell_v  = clamp(avg - random.uniform(0.01, 0.04), 2.5, 4.25)
        if random.random() < 0.005:
            fault_active = True
        if fault_active and random.random() < 0.20:
            fault_active = False
            faults_cleared_min = 0.0
        else:
            faults_cleared_min += period / 60.0

        pkt = {
            "ts_utc": utc_now(), "node_id": "bms-node-2", "bms_id": "OrionJr2_002",
            "soc": round(soc, 2), "pack_voltage": round(pack_voltage, 3),
            "pack_current": round(pack_current, 3), "temp_high": round(temp_high, 2),
            "temp_low": round(temp_low, 2), "ccl": ccl, "dcl": dcl,
            "fault_active": fault_active,
            "faults_cleared_min": round(faults_cleared_min, 2),
            "highest_cell_v": round(highest_cell_v, 3),
            "lowest_cell_v":  round(lowest_cell_v, 3),
        }
        try:
            post(url, pkt)
            direction = "CHG" if pack_current >= 0 else "DSC"
            log(GREEN, tag,
                f"SOC={pkt['soc']}%  V={pkt['pack_voltage']}  "
                f"I={pkt['pack_current']:+.2f}A [{direction}]  fault={pkt['fault_active']}")
        except Exception as exc:
            log(GREEN, tag, f"{RED}ERROR{R} {exc}")
        _stop.wait(period)

# ── BMS Node 3 — bms-node-3 — thermal stress + fault derating ───────────────

def _run_bms3(api_url: str, period: float) -> None:
    tag = "BMS-3"
    url = f"{api_url}/telemetry"
    soc, pack_voltage, pack_current = 68.0, 50.4, -24.0
    temp_high, temp_low = 53.0, 48.0
    ccl, dcl = 80.0, 120.0
    fault_active = False
    faults_cleared_min = 5.0
    highest_cell_v, lowest_cell_v = 3.62, 3.55
    CELLS = 14
    FAULT_TEMP, CLEAR_TEMP = 60.0, 52.0
    DERATE_CCL, DERATE_DCL = 5.0, 15.0

    log(YELLOW, tag, f"bms-node-3  →  {url}  (thermal stress — watch for FAULT events)")
    while not _stop.is_set():
        pack_current = clamp(pack_current + random.uniform(-3.5, 3.5), -80, 30)
        soc = clamp(soc - abs(pack_current) * 0.0004, 0.0, 100.0)
        if soc < 5.0:
            soc = 68.0

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

        if temp_high >= FAULT_TEMP:
            fault_active = True
            ccl, dcl = DERATE_CCL, DERATE_DCL
            faults_cleared_min = 0.0
        elif fault_active and temp_high <= CLEAR_TEMP:
            fault_active = False
            ccl, dcl = 80.0, 120.0
        else:
            faults_cleared_min += period / 60.0

        avg = pack_voltage / CELLS
        highest_cell_v = clamp(avg + random.uniform(0.01, 0.06), 2.5, 4.25)
        lowest_cell_v  = clamp(avg - random.uniform(0.01, 0.06), 2.5, 4.25)

        pkt = {
            "ts_utc": utc_now(), "node_id": "bms-node-3", "bms_id": "OrionJr2_003",
            "soc": round(soc, 2), "pack_voltage": round(pack_voltage, 3),
            "pack_current": round(pack_current, 3), "temp_high": round(temp_high, 2),
            "temp_low": round(temp_low, 2), "ccl": round(ccl, 2), "dcl": round(dcl, 2),
            "fault_active": fault_active,
            "faults_cleared_min": round(faults_cleared_min, 2),
            "highest_cell_v": round(highest_cell_v, 3),
            "lowest_cell_v":  round(lowest_cell_v, 3),
        }
        try:
            post(url, pkt)
            fault_str = f"{RED}*** FAULT ***{R}" if fault_active else "ok"
            log(YELLOW, tag,
                f"SOC={pkt['soc']}%  T={pkt['temp_high']:.1f}/{pkt['temp_low']:.1f}°C  "
                f"I={pkt['pack_current']:+.2f}A  CCL={pkt['ccl']}  DCL={pkt['dcl']}  {fault_str}")
        except Exception as exc:
            log(YELLOW, tag, f"{RED}ERROR{R} {exc}")
        _stop.wait(period)

# ── PV Node 1 — pi_pv_1 — solar inverter + loads ────────────────────────────

def _run_pv1(api_url: str, period: float) -> None:
    tag = "PV-1 "
    url = f"{api_url}/pv/telemetry"
    invr1, invr2 = 120.0, 118.0
    ld1, ld2, ld3, ld4 = 5.0, 4.5, 6.0, 3.8
    bv1, bv2 = 48.7, 48.6

    log(MAGENTA, tag, f"pi_pv_1  →  {url}  (solar inverter + loads)")
    while not _stop.is_set():
        invr1 = clamp(invr1 + random.uniform(-1.0, 1.0), 0.0, 500.0)
        invr2 = clamp(invr2 + random.uniform(-1.0, 1.0), 0.0, 500.0)
        ld1   = clamp(ld1 + random.uniform(-0.4, 0.4), 0.0, 200.0)
        ld2   = clamp(ld2 + random.uniform(-0.4, 0.4), 0.0, 200.0)
        ld3   = clamp(ld3 + random.uniform(-0.4, 0.4), 0.0, 200.0)
        ld4   = clamp(ld4 + random.uniform(-0.4, 0.4), 0.0, 200.0)
        bv1   = clamp(bv1 + random.uniform(-0.05, 0.05), 40.0, 60.0)
        bv2   = clamp(bv2 + random.uniform(-0.05, 0.05), 40.0, 60.0)

        pkt = {
            "ts_utc": utc_now(), "node_id": "pi_pv_1", "pv_id": "pv_1",
            "invr1": round(invr1, 3), "invr2": round(invr2, 3),
            "ld1": round(ld1, 3), "ld2": round(ld2, 3),
            "ld3": round(ld3, 3), "ld4": round(ld4, 3),
            "bv1": round(bv1, 3), "bv2": round(bv2, 3),
        }
        try:
            post(url, pkt)
            total_load = ld1 + ld2 + ld3 + ld4
            log(MAGENTA, tag,
                f"invr1={pkt['invr1']}  invr2={pkt['invr2']}  "
                f"load={total_load:.2f}  bv1={pkt['bv1']}")
        except Exception as exc:
            log(MAGENTA, tag, f"{RED}ERROR{R} {exc}")
        _stop.wait(period)

# ── BMS Sim Pi — pi_bms_sim — mirrors what the sim-mode Pi runs ──────────────

def _run_bms_sim(api_url: str, period: float) -> None:
    tag = "BMS-S"
    url = f"{api_url}/telemetry"
    soc, pack_voltage, pack_current = 10.0, 42.0, 30.0
    temp_high, temp_low = 26.0, 23.0
    highest_cell_v, lowest_cell_v = 3.01, 2.95
    ccl, dcl = 80.0, 120.0
    fault_active = False
    faults_cleared_min = 0.0
    CELLS = 14

    log(CYAN, tag, f"pi_bms_sim  →  {url}  (sim Pi: deep discharge recovery)")
    while not _stop.is_set():
        if soc >= 99.0:
            pack_current = -15.0
        elif soc <= 5.0:
            pack_current = 28.0
        pack_current = clamp(pack_current + random.uniform(-1.0, 1.0), -60, 60)
        soc = clamp(soc + pack_current * 0.0008, 0.0, 100.0)

        delta_v = 0.05 if pack_current > 0 else -0.03
        pack_voltage = clamp(
            pack_voltage + delta_v * random.uniform(0.5, 1.5) + random.uniform(-0.02, 0.02),
            40.0, 58.0,
        )
        heat = abs(pack_current) * random.uniform(0.001, 0.006)
        temp_high = clamp(temp_high + random.uniform(-0.05, 0.1) + heat, -20.0, 90.0)
        temp_low  = clamp(temp_low  + random.uniform(-0.05, 0.08) + heat * 0.7, -20.0, 90.0)
        if temp_low > temp_high:
            temp_low = temp_high - 0.5
        avg = pack_voltage / CELLS
        highest_cell_v = clamp(avg + random.uniform(0.01, 0.04), 2.5, 4.25)
        lowest_cell_v  = clamp(avg - random.uniform(0.01, 0.04), 2.5, 4.25)
        if random.random() < 0.003:
            fault_active = True
        if fault_active and random.random() < 0.25:
            fault_active = False
            faults_cleared_min = 0.0
        else:
            faults_cleared_min += period / 60.0

        pkt = {
            "ts_utc": utc_now(), "node_id": "pi_bms_sim", "bms_id": "OrionJr2_sim",
            "soc": round(soc, 2), "pack_voltage": round(pack_voltage, 3),
            "pack_current": round(pack_current, 3), "temp_high": round(temp_high, 2),
            "temp_low": round(temp_low, 2), "ccl": ccl, "dcl": dcl,
            "fault_active": fault_active,
            "faults_cleared_min": round(faults_cleared_min, 2),
            "highest_cell_v": round(highest_cell_v, 3),
            "lowest_cell_v":  round(lowest_cell_v, 3),
        }
        try:
            post(url, pkt)
            direction = "CHG" if pack_current >= 0 else "DSC"
            log(CYAN, tag,
                f"SOC={pkt['soc']}%  V={pkt['pack_voltage']}  "
                f"I={pkt['pack_current']:+.2f}A [{direction}]  fault={pkt['fault_active']}")
        except Exception as exc:
            log(CYAN, tag, f"{RED}ERROR{R} {exc}")
        _stop.wait(period)


# ── PV Sim Pi — pi_pv_sim — mirrors what the sim-mode Pi runs ────────────────

def _run_pv_sim(api_url: str, period: float) -> None:
    tag = "PV-S "
    url = f"{api_url}/pv/telemetry"
    invr1, invr2 = 95.0, 88.0
    ld1, ld2, ld3, ld4 = 8.0, 6.2, 9.1, 5.5
    bv1, bv2 = 50.1, 49.8

    log(GREEN, tag, f"pi_pv_sim  →  {url}  (sim Pi: solar inverter + loads)")
    while not _stop.is_set():
        invr1 = clamp(invr1 + random.uniform(-1.0, 1.0), 0.0, 500.0)
        invr2 = clamp(invr2 + random.uniform(-1.0, 1.0), 0.0, 500.0)
        ld1   = clamp(ld1   + random.uniform(-0.4, 0.4), 0.0, 200.0)
        ld2   = clamp(ld2   + random.uniform(-0.4, 0.4), 0.0, 200.0)
        ld3   = clamp(ld3   + random.uniform(-0.4, 0.4), 0.0, 200.0)
        ld4   = clamp(ld4   + random.uniform(-0.4, 0.4), 0.0, 200.0)
        bv1   = clamp(bv1   + random.uniform(-0.05, 0.05), 40.0, 60.0)
        bv2   = clamp(bv2   + random.uniform(-0.05, 0.05), 40.0, 60.0)

        pkt = {
            "ts_utc": utc_now(), "node_id": "pi_pv_sim", "pv_id": "pv_sim",
            "invr1": round(invr1, 3), "invr2": round(invr2, 3),
            "ld1": round(ld1, 3), "ld2": round(ld2, 3),
            "ld3": round(ld3, 3), "ld4": round(ld4, 3),
            "bv1": round(bv1, 3), "bv2": round(bv2, 3),
        }
        try:
            post(url, pkt)
            total_load = ld1 + ld2 + ld3 + ld4
            log(GREEN, tag,
                f"invr1={pkt['invr1']}  invr2={pkt['invr2']}  "
                f"load={total_load:.2f}  bv1={pkt['bv1']}")
        except Exception as exc:
            log(GREEN, tag, f"{RED}ERROR{R} {exc}")
        _stop.wait(period)


# ── Main ─────────────────────────────────────────────────────────────────────

_SIMS = [
    ("BMS-1",  _run_bms1,   CYAN),
    ("BMS-2",  _run_bms2,   GREEN),
    ("BMS-3",  _run_bms3,   YELLOW),
    ("PV-1",   _run_pv1,    MAGENTA),
    ("BMS-S",  _run_bms_sim, CYAN),
    ("PV-S",   _run_pv_sim,  GREEN),
]


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--api-url", default="http://localhost:8000",
        help="Base URL of the cloud API (default: http://localhost:8000)",
    )
    ap.add_argument(
        "--period", type=float, default=2.0,
        help="Seconds between packets per simulator (default: 2)",
    )
    args = ap.parse_args()
    api_url = args.api_url.rstrip("/")

    print(f"\n{B}UEI Simulator Suite{R}  →  {B}{api_url}{R}  (period={args.period}s)\n")
    print(f"  {CYAN}{B}BMS-1{R}  pi_bms_1    — mixed discharge / charge  (legacy)")
    print(f"  {GREEN}{B}BMS-2{R}  bms-node-2  — charging cycle: low SOC → full → discharge  (legacy)")
    print(f"  {YELLOW}{B}BMS-3{R}  bms-node-3  — thermal stress, overtemp faults + CCL/DCL derating  (legacy)")
    print(f"  {MAGENTA}{B}PV-1 {R}  pi_pv_1     — solar inverter output + load channels  (legacy)")
    print(f"  {CYAN}{B}BMS-S{R}  pi_bms_sim  — sim Pi: deep discharge recovery")
    print(f"  {GREEN}{B}PV-S {R}  pi_pv_sim   — sim Pi: solar inverter + loads")
    print(f"\nPress {B}Ctrl+C{R} to stop.\n")

    threads = []
    for _name, fn, _colour in _SIMS:
        t = threading.Thread(target=fn, args=(api_url, args.period), daemon=True)
        t.start()
        threads.append(t)
        time.sleep(0.1)   # stagger starts slightly so output isn't a wall of text

    def _shutdown(sig, frame):  # noqa: ANN001
        print(f"\n{B}Shutting down…{R}")
        _stop.set()

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    _stop.wait()
    for t in threads:
        t.join(timeout=3)
    print("All simulators stopped.")


if __name__ == "__main__":
    main()
