#!/usr/bin/env python3
"""
sim_bms3.py — BMS Node 3 simulator (thermal stress + fault derating)

Simulates a 14S LiFePO4 pack under high ambient heat.  Temperature creeps
upward under load; once temp_high exceeds 60 °C the BMS triggers an
overtemperature fault and slashes CCL/DCL to protect the cells.  The fault
clears slowly as the pack cools — producing the kind of fault/derate events
that the dashboard alert and log views are designed to surface.

Usage:
    python3 sim_bms3.py                                       # print only
    python3 sim_bms3.py --api-url http://localhost:8000       # POST to local stack
    python3 sim_bms3.py --api-url http://34.x.x.x:8000 --period 5
"""

from __future__ import annotations

import argparse
import random
import time
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    requests = None


NODE_ID = "bms-node-3"
BMS_ID  = "OrionJr2_003"

FAULT_TEMP  = 60.0   # °C  — overtemp fault threshold
CLEAR_TEMP  = 52.0   # °C  — fault clears once it cools below this
DERATE_CCL  =  5.0
DERATE_DCL  = 15.0
NORMAL_CCL  = 80.0
NORMAL_DCL  = 120.0


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


class ThermalStressSim:
    """
    High-ambient-temp pack.  Runs under heavy discharge load; temperature
    drifts toward the fault threshold and occasionally breaches it.
    """

    CELLS = 14

    def __init__(self, soc_start: float = 68.0):
        self.soc            = soc_start
        self.pack_voltage   = 50.4
        self.pack_current   = -24.0  # discharging
        self.temp_high      = 53.0   # already warm
        self.temp_low       = 48.0
        self.ccl            = NORMAL_CCL
        self.dcl            = NORMAL_DCL
        self.fault_active   = False
        self.faults_cleared_min = 5.0
        self.highest_cell_v = 3.62
        self.lowest_cell_v  = 3.55

    def step(self) -> dict:
        # Current: mostly discharging with occasional regenerative spikes
        self.pack_current = clamp(
            self.pack_current + random.uniform(-3.5, 3.5), -80, 30
        )

        # SOC follows current (discharge dominant)
        self.soc = clamp(self.soc - abs(self.pack_current) * 0.0004, 0.0, 100.0)
        if self.soc < 5.0:
            self.soc = 68.0   # reset for demo purposes

        # Voltage sags under high current
        sag = abs(self.pack_current) * random.uniform(0.0008, 0.002)
        self.pack_voltage = clamp(
            self.pack_voltage + (-sag if self.pack_current < 0 else sag * 0.5) + random.uniform(-0.03, 0.03),
            40.0, 58.0,
        )

        # Temperature: biased upward — heat builds faster than it dissipates
        heat = abs(self.pack_current) * random.uniform(0.004, 0.018)
        cool = random.uniform(0.0, 0.05)   # ambient cooling
        self.temp_high = clamp(self.temp_high + heat - cool + random.uniform(-0.1, 0.3), -20.0, 90.0)
        self.temp_low  = clamp(self.temp_low  + heat * 0.7 - cool + random.uniform(-0.1, 0.2), -20.0, 90.0)
        if self.temp_low > self.temp_high:
            self.temp_low = self.temp_high - 1.5

        # Overtemperature fault logic
        if self.temp_high >= FAULT_TEMP:
            self.fault_active = True
            self.ccl = DERATE_CCL
            self.dcl = DERATE_DCL
            self.faults_cleared_min = 0.0
        elif self.fault_active and self.temp_high <= CLEAR_TEMP:
            self.fault_active = False
            self.ccl = NORMAL_CCL
            self.dcl = NORMAL_DCL
        else:
            self.faults_cleared_min += 2.0 / 60.0

        # Cell voltages
        avg = self.pack_voltage / self.CELLS
        self.highest_cell_v = clamp(avg + random.uniform(0.01, 0.06), 2.5, 4.25)
        self.lowest_cell_v  = clamp(avg - random.uniform(0.01, 0.06), 2.5, 4.25)

        return {
            "ts_utc":             utc_now(),
            "node_id":            NODE_ID,
            "bms_id":             BMS_ID,
            "soc":                round(self.soc, 2),
            "pack_voltage":       round(self.pack_voltage, 3),
            "pack_current":       round(self.pack_current, 3),
            "temp_high":          round(self.temp_high, 2),
            "temp_low":           round(self.temp_low, 2),
            "ccl":                round(self.ccl, 2),
            "dcl":                round(self.dcl, 2),
            "fault_active":       bool(self.fault_active),
            "faults_cleared_min": round(self.faults_cleared_min, 2),
            "highest_cell_v":     round(self.highest_cell_v, 3),
            "lowest_cell_v":      round(self.lowest_cell_v, 3),
        }


def post(url: str, payload: dict, timeout: float) -> None:
    if requests is None:
        raise RuntimeError("requests not installed. Run: pip install requests")
    r = requests.post(url, json=payload, timeout=timeout)
    r.raise_for_status()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api-url",   default=None,   help="POST to this base URL, e.g. http://localhost:8000")
    ap.add_argument("--period",    type=float, default=2.0, help="Seconds between packets (default: 2)")
    ap.add_argument("--soc-start", type=float, default=68.0, help="Starting SOC %% (default: 68)")
    ap.add_argument("--timeout",   type=float, default=5.0)
    args = ap.parse_args()

    sim = ThermalStressSim(soc_start=args.soc_start)
    post_url = (args.api_url.rstrip("/") + "/telemetry") if args.api_url else None

    if post_url:
        print(f"[BMS-3] Sending to {post_url}  period={args.period}s  node={NODE_ID}")
    else:
        print(f"[BMS-3] Print-only mode  (pass --api-url to POST)  node={NODE_ID}")

    while True:
        pkt = sim.step()
        fault_str = "*** FAULT ***" if pkt["fault_active"] else "ok"
        status = (
            f"SOC={pkt['soc']}%  T={pkt['temp_high']:.1f}/{pkt['temp_low']:.1f}°C  "
            f"I={pkt['pack_current']:+.2f}A  CCL={pkt['ccl']}  DCL={pkt['dcl']}  {fault_str}"
        )

        if post_url:
            try:
                post(post_url, pkt, timeout=args.timeout)
                print(f"[BMS-3] {pkt['ts_utc']}  {status}")
            except Exception as e:
                print(f"[BMS-3] POST error: {e}")
        else:
            print(f"[BMS-3] {pkt['ts_utc']}  {status}")

        time.sleep(args.period)


if __name__ == "__main__":
    main()
