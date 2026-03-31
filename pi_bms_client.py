#!/usr/bin/env python3
"""
pi_bms_client.py — UEI BMS telemetry client (simulation OR real hardware)

Runs in two modes controlled by --mode:

  sim   Generates realistic simulated Orion Jr2 BMS data and POSTs to the
        cloud API. No hardware required. Uses the same POST logic as real mode.

  real  Reads live data from an Orion Jr2 BMS over CAN bus (SocketCAN /
        python-can) and POSTs to the cloud API.
        Requires: pip install python-can
        Requires: CAN interface up (see setup below)

CAN bus setup on the Pi (run once, or add to /etc/network/interfaces):
  sudo apt install can-utils python3-can
  sudo ip link set can0 up type can bitrate 500000

Usage:
  sim:   python3 pi_bms_client.py --mode sim  --node-id pi_bms_sim --api-url http://IP:8000
  real:  python3 pi_bms_client.py --mode real --node-id pi_bms_real --api-url http://IP:8000
"""

from __future__ import annotations

import argparse
import signal
import sys
import time
import random
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    sys.exit("Missing dependency — run: pip install requests")


# ── Shared helpers ────────────────────────────────────────────────────────────

def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


# ── Shared sender (identical for sim and real) ────────────────────────────────

def send_telemetry(url: str, payload: dict, retries: int = 3) -> bool:
    """POST one telemetry packet to the cloud API with exponential-backoff retry."""
    for attempt in range(retries):
        try:
            r = requests.post(url, json=payload, timeout=5)
            r.raise_for_status()
            return True
        except Exception as exc:
            wait = 2 ** attempt
            print(f"[WARN] POST failed (attempt {attempt + 1}/{retries}): {exc}")
            if attempt < retries - 1:
                time.sleep(wait)
    return False


# ── Simulated BMS data source ─────────────────────────────────────────────────

class SimBMS:
    """Stateful random-walk BMS simulator — no hardware required."""

    def __init__(self) -> None:
        self.soc              = 82.0
        self.pack_voltage     = 48.6
        self.pack_current     = 5.0
        self.temp_high        = 31.0
        self.temp_low         = 28.5
        self.highest_cell_v   = 3.62
        self.lowest_cell_v    = 3.58
        self.ccl              = 80.0
        self.dcl              = 120.0
        self.fault_active     = False
        self.faults_cleared_min = 27.0

    def read(self, period: float = 2.0) -> dict:
        self.soc          = clamp(self.soc          + random.uniform(-0.05,  0.02), 0, 100)
        self.pack_voltage = clamp(self.pack_voltage + random.uniform(-0.10,  0.10), 40, 60)
        self.pack_current = clamp(self.pack_current + random.uniform(-0.50,  0.50), -50, 50)
        self.temp_high    = clamp(self.temp_high    + random.uniform(-0.10,  0.20), -20, 90)
        self.temp_low     = clamp(self.temp_low     + random.uniform(-0.10,  0.20), -20, 90)
        if self.temp_low > self.temp_high:
            self.temp_low = self.temp_high - 0.5
        self.highest_cell_v = clamp(self.highest_cell_v + random.uniform(-0.01, 0.01), 2.5, 4.25)
        self.lowest_cell_v  = clamp(self.lowest_cell_v  + random.uniform(-0.01, 0.01), 2.5, 4.25)
        if self.lowest_cell_v > self.highest_cell_v:
            self.lowest_cell_v = self.highest_cell_v - 0.02
        if random.random() < 0.01:
            self.fault_active = True
        if self.fault_active and random.random() < 0.15:
            self.fault_active     = False
            self.faults_cleared_min = 0.0
        else:
            self.faults_cleared_min += period / 60.0

        return {
            "soc":                  round(self.soc,              2),
            "pack_voltage":         round(self.pack_voltage,     3),
            "pack_current":         round(self.pack_current,     3),
            "temp_high":            round(self.temp_high,        2),
            "temp_low":             round(self.temp_low,         2),
            "ccl":                  self.ccl,
            "dcl":                  self.dcl,
            "fault_active":         self.fault_active,
            "faults_cleared_min":   round(self.faults_cleared_min, 2),
            "highest_cell_v":       round(self.highest_cell_v,  3),
            "lowest_cell_v":        round(self.lowest_cell_v,   3),
        }

    def close(self) -> None:
        pass


# ── Real BMS data source (Orion Jr2 via SocketCAN) ────────────────────────────

class RealBMS:
    """
    Reads live Orion Jr2 BMS data from CAN bus using python-can (SocketCAN).

    Orion Jr2 CAN message layout (500 kbps, standard 11-bit IDs):

      0x6B0  Pack summary — broadcast every ~100 ms by the BMS
        bytes 0-1  Pack current   signed int16, ×0.1 A   (positive = charging)
        bytes 2-3  Pack voltage   uint16,       ×0.1 V
        byte  4    Pack SOC       uint8,        0-100 %
        bytes 5-6  CCL            uint16,       ×1 A
        byte  7    Relay/DTC      bit 0 = fault active

      0x6B1  Cell / temperature extremes — broadcast every ~100 ms
        bytes 0-1  Highest cell V  uint16, ×0.0001 V
        bytes 2-3  Lowest  cell V  uint16, ×0.0001 V
        byte  4    High temp       uint8,  raw − 40 °C
        byte  5    Low  temp       uint8,  raw − 40 °C
        bytes 6-7  DCL             uint16, ×1 A

    Hardware wiring (MCP2515 SPI CAN module or Pi CAN HAT):
      Pi SPI0 → MCP2515 → CAN transceiver → BMS CAN-H / CAN-L
      sudo ip link set can0 up type can bitrate 500000
    """

    CAN_ID_PACK_SUMMARY  = 0x6B0
    CAN_ID_CELL_EXTREMES = 0x6B1

    def __init__(self, channel: str = "can0", bitrate: int = 500000) -> None:
        try:
            import can as _can
        except ImportError:
            sys.exit("Missing dependency — run: pip install python-can")
        self._can = _can
        self.bus  = _can.interface.Bus(channel=channel, bustype="socketcan", bitrate=bitrate)
        self._s: dict = {
            "soc": 0.0, "pack_voltage": 0.0, "pack_current": 0.0,
            "temp_high": 0.0, "temp_low": 0.0,
            "ccl": 0.0, "dcl": 0.0,
            "fault_active": False, "faults_cleared_min": 0.0,
            "highest_cell_v": 0.0, "lowest_cell_v": 0.0,
        }
        self._fault_cleared_min = 0.0
        print(f"[BMS] CAN bus opened: channel={channel}  bitrate={bitrate}")

    def _decode_pack_summary(self, data: bytes) -> None:
        raw_i  = int.from_bytes(data[0:2], "big", signed=True)
        raw_v  = int.from_bytes(data[2:4], "big", signed=False)
        soc    = data[4]
        ccl    = int.from_bytes(data[5:7], "big", signed=False)
        fault  = bool(data[7] & 0x01)

        self._s["pack_current"] = round(raw_i * 0.1, 3)
        self._s["pack_voltage"] = round(raw_v * 0.1, 3)
        self._s["soc"]          = float(soc)
        self._s["ccl"]          = float(ccl)
        self._s["fault_active"] = fault
        if fault:
            self._fault_cleared_min = 0.0
        else:
            self._fault_cleared_min += 1.0 / 60.0
        self._s["faults_cleared_min"] = round(self._fault_cleared_min, 2)

    def _decode_cell_extremes(self, data: bytes) -> None:
        raw_hv = int.from_bytes(data[0:2], "big", signed=False)
        raw_lv = int.from_bytes(data[2:4], "big", signed=False)
        t_hi   = data[4] - 40
        t_lo   = data[5] - 40
        dcl    = int.from_bytes(data[6:8], "big", signed=False)

        self._s["highest_cell_v"] = round(raw_hv * 0.0001, 4)
        self._s["lowest_cell_v"]  = round(raw_lv * 0.0001, 4)
        self._s["temp_high"]      = float(t_hi)
        self._s["temp_low"]       = float(t_lo)
        self._s["dcl"]            = float(dcl)

    def read(self, timeout: float = 1.0) -> dict:
        """
        Drain CAN frames for up to `timeout` seconds, decode any Orion Jr2
        messages seen, then return the latest composite state.
        """
        deadline = time.monotonic() + timeout
        received: set[str] = set()

        while time.monotonic() < deadline and len(received) < 2:
            remaining = max(0.0, deadline - time.monotonic())
            msg = self.bus.recv(timeout=remaining)
            if msg is None:
                break
            if msg.arbitration_id == self.CAN_ID_PACK_SUMMARY and len(msg.data) >= 8:
                self._decode_pack_summary(msg.data)
                received.add("summary")
            elif msg.arbitration_id == self.CAN_ID_CELL_EXTREMES and len(msg.data) >= 8:
                self._decode_cell_extremes(msg.data)
                received.add("extremes")

        return dict(self._s)

    def close(self) -> None:
        self.bus.shutdown()
        print("[BMS] CAN bus closed.")


# ── Main loop (shared for both modes) ────────────────────────────────────────

def run(args: argparse.Namespace) -> None:
    url = f"{args.api_url.rstrip('/')}/telemetry"

    if args.mode == "sim":
        source: SimBMS | RealBMS = SimBMS()
        print(f"[BMS] Mode: SIMULATION   node={args.node_id}  bms={args.bms_id}  →  {url}")
    else:
        source = RealBMS(channel=args.can_channel, bitrate=args.can_bitrate)
        print(f"[BMS] Mode: REAL HARDWARE  node={args.node_id}  bms={args.bms_id}  "
              f"can={args.can_channel}  →  {url}")

    running = True

    def _shutdown(sig, frame) -> None:  # noqa: ANN001
        nonlocal running
        print("\n[BMS] Shutting down…")
        running = False

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    while running:
        t0   = time.monotonic()
        data = source.read(period=args.period) if args.mode == "sim" else source.read()

        payload = {
            "ts_utc":  utc_now(),
            "node_id": args.node_id,
            "bms_id":  args.bms_id,
            **data,
        }

        ok = send_telemetry(url, payload)
        tag = "OK  " if ok else "FAIL"
        print(f"[{tag}] {payload['ts_utc']}  SOC={payload['soc']}%  "
              f"V={payload['pack_voltage']}  I={payload['pack_current']:+.2f}A  "
              f"fault={payload['fault_active']}")

        elapsed    = time.monotonic() - t0
        sleep_time = max(0.0, args.period - elapsed)
        time.sleep(sleep_time)

    source.close()


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--mode",        choices=["sim", "real"], required=True,
                    help="'sim' for simulation, 'real' for Orion Jr2 CAN bus")
    ap.add_argument("--node-id",     required=True,
                    help="Unique node identifier registered in the dashboard")
    ap.add_argument("--api-url",     required=True,
                    help="Cloud API base URL, e.g. http://1.2.3.4:8000")
    ap.add_argument("--bms-id",      default=None,
                    help="BMS hardware label (default: OrionJr2_<node-id>)")
    ap.add_argument("--period",      type=float, default=2.0,
                    help="Seconds between packets (default: 2)")
    ap.add_argument("--can-channel", default="can0",
                    help="SocketCAN interface name, real mode only (default: can0)")
    ap.add_argument("--can-bitrate", type=int, default=500000,
                    help="CAN bus bitrate in bps, real mode only (default: 500000)")
    args = ap.parse_args()

    if args.bms_id is None:
        args.bms_id = f"OrionJr2_{args.node_id}"

    run(args)


if __name__ == "__main__":
    main()
