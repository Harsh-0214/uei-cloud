#!/usr/bin/env python3
"""
sim_bms2.py — BMS Node 2 simulator (48V pack, charge/discharge cycling)

Simulates a 14S LiFePO4 pack that starts nearly depleted (SOC ~25%) and
charges up to full before switching back to discharge — useful for seeing
SOC trends and charge-cycle behaviour in the dashboard.

Usage:
    python3 sim_bms2.py                                       # print only
    python3 sim_bms2.py --api-url http://localhost:8000       # POST to local stack
    python3 sim_bms2.py --api-url http://34.x.x.x:8000 --period 5
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


NODE_ID = "bms-node-2"
BMS_ID  = "OrionJr2_002"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


class ChargeCycleSim:
    """14S LiFePO4 pack starting depleted and charging toward full."""

    CELLS = 14

    def __init__(self, soc_start: float = 25.0):
        self.soc           = soc_start
        self.pack_voltage  = 44.2   # low – pack is nearly empty
        self.pack_current  = 20.0   # positive = charging
        self.temp_high     = 28.0
        self.temp_low      = 24.5
        self.highest_cell_v = 3.16
        self.lowest_cell_v  = 3.10
        self.ccl           = 80.0
        self.dcl           = 120.0
        self.fault_active  = False
        self.faults_cleared_min = 0.0

    def step(self) -> dict:
        # Flip direction at SOC limits
        if self.soc >= 98.0:
            self.pack_current = -18.0   # start discharging
        elif self.soc <= 18.0:
            self.pack_current = 22.0    # back to charging

        self.pack_current = clamp(
            self.pack_current + random.uniform(-1.5, 1.5), -60, 60
        )

        # SOC follows current direction
        self.soc = clamp(self.soc + self.pack_current * 0.001, 0.0, 100.0)

        # Voltage rises when charging, falls when discharging
        delta_v = 0.06 if self.pack_current > 0 else -0.04
        self.pack_voltage = clamp(
            self.pack_voltage + delta_v * random.uniform(0.5, 1.5) + random.uniform(-0.02, 0.02),
            40.0, 58.0,
        )

        # Temps warm slightly under load
        heat = abs(self.pack_current) * random.uniform(0.001, 0.008)
        self.temp_high = clamp(self.temp_high + random.uniform(-0.05, 0.1) + heat, -20.0, 90.0)
        self.temp_low  = clamp(self.temp_low  + random.uniform(-0.05, 0.08) + heat * 0.7, -20.0, 90.0)
        if self.temp_low > self.temp_high:
            self.temp_low = self.temp_high - 0.5

        # Cell voltages track pack average
        avg = self.pack_voltage / self.CELLS
        self.highest_cell_v = clamp(avg + random.uniform(0.01, 0.04), 2.5, 4.25)
        self.lowest_cell_v  = clamp(avg - random.uniform(0.01, 0.04), 2.5, 4.25)

        # Rare faults; self-clear quickly
        if random.random() < 0.005:
            self.fault_active = True
        if self.fault_active and random.random() < 0.20:
            self.fault_active = False
            self.faults_cleared_min = 0.0
        else:
            self.faults_cleared_min += 2.0 / 60.0

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
    ap.add_argument("--soc-start", type=float, default=25.0, help="Starting SOC %% (default: 25)")
    ap.add_argument("--timeout",   type=float, default=5.0)
    args = ap.parse_args()

    sim = ChargeCycleSim(soc_start=args.soc_start)
    post_url = (args.api_url.rstrip("/") + "/telemetry") if args.api_url else None

    if post_url:
        print(f"[BMS-2] Sending to {post_url}  period={args.period}s  node={NODE_ID}")
    else:
        print(f"[BMS-2] Print-only mode  (pass --api-url to POST)  node={NODE_ID}")

    while True:
        pkt = sim.step()
        direction = "CHG" if pkt["pack_current"] >= 0 else "DSC"
        status = (
            f"SOC={pkt['soc']}%  V={pkt['pack_voltage']}  "
            f"I={pkt['pack_current']:+.2f}A [{direction}]  "
            f"T={pkt['temp_high']:.1f}°C  fault={pkt['fault_active']}"
        )

        if post_url:
            try:
                post(post_url, pkt, timeout=args.timeout)
                print(f"[BMS-2] {pkt['ts_utc']}  {status}")
            except Exception as e:
                print(f"[BMS-2] POST error: {e}")
        else:
            print(f"[BMS-2] {pkt['ts_utc']}  {status}")

        time.sleep(args.period)


if __name__ == "__main__":
    main()
