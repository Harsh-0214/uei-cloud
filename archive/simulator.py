#!/usr/bin/env python3
"""
simulator.py — UEI / Orion Jr2-style telemetry simulator

What it does:
- Generates realistic-ish battery telemetry (SOC, voltage, current, temps, CCL/DCL, faults, cell volts)
- Either prints JSON lines to stdout OR POSTs them to your cloud API endpoint (/telemetry)

Typical usage:
- Print only:
    python3 simulator.py --hz 1
- Post to cloud API:
    python3 simulator.py --post-url http://YOUR_VM_IP:8000/telemetry --hz 1
"""

from __future__ import annotations

import argparse
import json
import random
import time
from datetime import datetime, timezone
from typing import Dict, Any, Optional

try:
    import requests  # only needed if using --post-url
except ImportError:
    requests = None


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class OrionJr2Sim:
    """
    Lightweight stateful simulator.
    - pack_current < 0 => discharging (common convention)
    - pack_current > 0 => charging
    """
    def __init__(self, soc_start: float = 80.0):
        self.soc = soc_start
        self.pack_voltage = 13.2
        self.pack_current = -8.0  # start discharging
        self.temp_high = 33.0
        self.temp_low = 29.0
        self.ccl = 25.0
        self.dcl = 60.0
        self.fault_active = False
        self.faults_cleared_min = 27.0
        self.highest_cell_v = 3.35
        self.lowest_cell_v = 3.30

    def step(self) -> Dict[str, Any]:
        # Random-walk current
        self.pack_current += random.uniform(-2.0, 2.0)
        self.pack_current = max(min(self.pack_current, 80.0), -80.0)

        # Voltage responds to load (simple sag model)
        sag = abs(self.pack_current) * random.uniform(0.0006, 0.0014)
        if self.pack_current < 0:  # discharging -> sag
            self.pack_voltage -= sag
        else:  # charging -> slight rise
            self.pack_voltage += sag * 0.7

        self.pack_voltage = max(min(self.pack_voltage, 14.4), 10.8)

        # SOC update (very rough coulomb counting proxy)
        # Negative current (discharge) decreases SOC; positive increases SOC
        self.soc += (self.pack_current * 0.0006)
        self.soc = max(min(self.soc, 100.0), 0.0)

        # Temps drift based on current magnitude
        heat = abs(self.pack_current) * random.uniform(0.001, 0.01)
        self.temp_high += random.uniform(-0.05, 0.05) + heat
        self.temp_low += random.uniform(-0.05, 0.05) + heat * 0.6
        self.temp_high = max(min(self.temp_high, 90.0), -20.0)
        self.temp_low = max(min(self.temp_low, 90.0), -20.0)

        # Cell voltages (4-series assumption)
        avg_cell = self.pack_voltage / 4.0
        self.highest_cell_v = avg_cell + random.uniform(0.01, 0.03)
        self.lowest_cell_v = avg_cell - random.uniform(0.01, 0.03)

        # Simple fault + derate behavior (overtemp)
        if self.temp_high >= 60.0:
            self.fault_active = True
            self.dcl = 15.0
            self.ccl = 5.0
            self.faults_cleared_min = 0.0
        else:
            # clear fault
            self.fault_active = False
            self.dcl = 60.0
            self.ccl = 25.0
            self.faults_cleared_min += 0.1

        return {
            "ts_utc": utc_iso(),
            "soc": round(self.soc, 2),
            "pack_voltage": round(self.pack_voltage, 3),
            "pack_current": round(self.pack_current, 3),
            "temp_high": round(self.temp_high, 2),
            "temp_low": round(self.temp_low, 2),
            "ccl": round(self.ccl, 2),
            "dcl": round(self.dcl, 2),
            "fault_active": bool(self.fault_active),
            "faults_cleared_min": round(self.faults_cleared_min, 2),
            "highest_cell_v": round(self.highest_cell_v, 3),
            "lowest_cell_v": round(self.lowest_cell_v, 3),
        }


def post_packet(url: str, pkt: Dict[str, Any], timeout: float) -> None:
    if requests is None:
        raise RuntimeError("requests is not installed. Install it or run without --post-url.")
    r = requests.post(url, json=pkt, timeout=timeout)
    if not (200 <= r.status_code < 300):
        raise RuntimeError(f"POST failed {r.status_code}: {r.text}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--node-id", default="bms-node-1")
    ap.add_argument("--bms-id", default="OrionJr2_001")
    ap.add_argument("--hz", type=float, default=1.0, help="messages per second (e.g., 1.0)")
    ap.add_argument("--post-url", default=None, help="e.g., http://VM_IP:8000/telemetry")
    ap.add_argument("--timeout", type=float, default=3.0)
    ap.add_argument("--soc-start", type=float, default=80.0)
    args = ap.parse_args()

    sim = OrionJr2Sim(soc_start=args.soc_start)
    period = 1.0 / max(args.hz, 0.1)

    while True:
        pkt = sim.step()
        pkt["node_id"] = args.node_id
        pkt["bms_id"] = args.bms_id

        if args.post_url:
            try:
                post_packet(args.post_url, pkt, timeout=args.timeout)
                print(f"{pkt['ts_utc']} POST ok node_id={pkt['node_id']}")
            except Exception as e:
                print(f"{pkt['ts_utc']} POST fail: {e}")
        else:
            print(json.dumps(pkt))

        time.sleep(period)


if __name__ == "__main__":
    main()

