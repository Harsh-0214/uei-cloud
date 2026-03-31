#!/usr/bin/env python3
"""
pi_pv_client.py — UEI PV system telemetry client (simulation OR real hardware)

Runs in two modes controlled by --mode:

  sim   Generates realistic simulated PV inverter/load/battery data and POSTs
        to the cloud API. No hardware required. Same POST logic as real mode.

  real  Reads live data from a PV inverter and load monitors via Modbus TCP
        and POSTs to the cloud API.
        Requires: pip install pymodbus

        Configure the Modbus register addresses in MODBUS_REGISTERS below to
        match your specific inverter model (SMA, Fronius, Growatt, Victron, etc.)

Usage:
  sim:   python3 pi_pv_client.py --mode sim  --node-id pi_pv_sim --api-url http://IP:8000
  real:  python3 pi_pv_client.py --mode real --node-id pi_pv_real --api-url http://IP:8000
                                  --modbus-host 192.168.1.100 --modbus-port 502
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


# ── Simulated PV data source ──────────────────────────────────────────────────

class SimPV:
    """Stateful random-walk PV inverter / load simulator — no hardware required."""

    def __init__(self) -> None:
        self.invr1 = 120.0
        self.invr2 = 118.0
        self.ld1   = 5.0
        self.ld2   = 4.5
        self.ld3   = 6.0
        self.ld4   = 3.8
        self.bv1   = 48.7
        self.bv2   = 48.6

    def read(self) -> dict:
        self.invr1 = clamp(self.invr1 + random.uniform(-1.0,  1.0),  0.0, 500.0)
        self.invr2 = clamp(self.invr2 + random.uniform(-1.0,  1.0),  0.0, 500.0)
        self.ld1   = clamp(self.ld1   + random.uniform(-0.4,  0.4),  0.0, 200.0)
        self.ld2   = clamp(self.ld2   + random.uniform(-0.4,  0.4),  0.0, 200.0)
        self.ld3   = clamp(self.ld3   + random.uniform(-0.4,  0.4),  0.0, 200.0)
        self.ld4   = clamp(self.ld4   + random.uniform(-0.4,  0.4),  0.0, 200.0)
        self.bv1   = clamp(self.bv1   + random.uniform(-0.05, 0.05), 40.0, 60.0)
        self.bv2   = clamp(self.bv2   + random.uniform(-0.05, 0.05), 40.0, 60.0)

        return {
            "invr1": round(self.invr1, 3),
            "invr2": round(self.invr2, 3),
            "ld1":   round(self.ld1,   3),
            "ld2":   round(self.ld2,   3),
            "ld3":   round(self.ld3,   3),
            "ld4":   round(self.ld4,   3),
            "bv1":   round(self.bv1,   3),
            "bv2":   round(self.bv2,   3),
        }

    def close(self) -> None:
        pass


# ── Real PV data source (Modbus TCP) ─────────────────────────────────────────

# ┌─────────────────────────────────────────────────────────────────────────────┐
# │  CONFIGURE THESE REGISTER ADDRESSES TO MATCH YOUR INVERTER / ENERGY METER  │
# │                                                                             │
# │  Common examples:                                                           │
# │    SMA SunnyBoy:  AC power total = 30775 (int32, ×0.1 W)                  │
# │    Fronius Symo:  AC power       = 40083 (int16, ×1 W)                    │
# │    Growatt SPH:   AC power       = 35 (uint16, ×0.1 W)                    │
# │    Victron MPPT:  PV power       = 789  (uint16, ×1 W)                    │
# │                                                                             │
# │  All registers are read as 16-bit unsigned holding registers (FC3) unless  │
# │  SIGNED is True.  Scale divides the raw integer to get engineering units.  │
# └─────────────────────────────────────────────────────────────────────────────┘
MODBUS_REGISTERS = {
    #  field    register  scale   signed   description
    "invr1": (  40001,    0.1,    False),  # Inverter 1 AC output power (W)
    "invr2": (  40002,    0.1,    False),  # Inverter 2 AC output power (W)
    "ld1":   (  40010,    0.1,    False),  # Load channel 1 power (W)
    "ld2":   (  40011,    0.1,    False),  # Load channel 2 power (W)
    "ld3":   (  40012,    0.1,    False),  # Load channel 3 power (W)
    "ld4":   (  40013,    0.1,    False),  # Load channel 4 power (W)
    "bv1":   (  40020,    0.01,   False),  # Battery bank 1 voltage (V)
    "bv2":   (  40021,    0.01,   False),  # Battery bank 2 voltage (V)
}

MODBUS_UNIT_ID = 1  # Modbus slave/unit ID (usually 1)


class RealPV:
    """
    Reads PV inverter and load data over Modbus TCP using pymodbus.

    Supported hardware (configure MODBUS_REGISTERS above):
      - Any Modbus TCP capable solar inverter (SMA, Fronius, Growatt, Victron…)
      - Energy meters with Modbus TCP interface
      - Modbus TCP gateway connected to RS-485 devices

    Installation:
      pip install pymodbus

    Network:
      The Pi must be on the same LAN as the inverter, or connected via
      a Modbus TCP gateway.  Most inverters expose port 502 by default.
    """

    def __init__(self, host: str, port: int = 502, unit_id: int = MODBUS_UNIT_ID) -> None:
        try:
            from pymodbus.client import ModbusTcpClient as _Client
        except ImportError:
            sys.exit("Missing dependency — run: pip install pymodbus")
        self._Client = _Client
        self.host    = host
        self.port    = port
        self.unit_id = unit_id
        self.client  = _Client(host=host, port=port)
        if not self.client.connect():
            sys.exit(f"[PV] ERROR: Could not connect to Modbus TCP at {host}:{port}")
        print(f"[PV] Modbus TCP connected: {host}:{port}  unit={unit_id}")

    def _read_register(self, address: int, scale: float, signed: bool) -> float:
        result = self.client.read_holding_registers(address, count=1, slave=self.unit_id)
        if result.isError():
            raise RuntimeError(f"Modbus read error at register {address}: {result}")
        raw = result.registers[0]
        if signed and raw > 32767:
            raw -= 65536
        return raw * scale

    def read(self) -> dict:
        data: dict[str, float] = {}
        for field, (addr, scale, signed) in MODBUS_REGISTERS.items():
            try:
                data[field] = round(self._read_register(addr, scale, signed), 3)
            except Exception as exc:
                print(f"[WARN] Could not read {field} (reg {addr}): {exc}")
                data[field] = 0.0
        return data

    def close(self) -> None:
        self.client.close()
        print("[PV] Modbus TCP connection closed.")


# ── Main loop (shared for both modes) ────────────────────────────────────────

def run(args: argparse.Namespace) -> None:
    url = f"{args.api_url.rstrip('/')}/pv/telemetry"

    if args.mode == "sim":
        source: SimPV | RealPV = SimPV()
        print(f"[PV] Mode: SIMULATION   node={args.node_id}  pv={args.pv_id}  →  {url}")
    else:
        if not args.modbus_host:
            sys.exit("--modbus-host is required in real mode (e.g. --modbus-host 192.168.1.100)")
        source = RealPV(host=args.modbus_host, port=args.modbus_port)
        print(f"[PV] Mode: REAL HARDWARE  node={args.node_id}  pv={args.pv_id}  "
              f"modbus={args.modbus_host}:{args.modbus_port}  →  {url}")

    running = True

    def _shutdown(sig, frame) -> None:  # noqa: ANN001
        nonlocal running
        print("\n[PV] Shutting down…")
        running = False

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    while running:
        t0   = time.monotonic()
        data = source.read()

        payload = {
            "ts_utc":  utc_now(),
            "node_id": args.node_id,
            "pv_id":   args.pv_id,
            **data,
        }

        ok  = send_telemetry(url, payload)
        tag = "OK  " if ok else "FAIL"
        total_load = data.get("ld1", 0) + data.get("ld2", 0) + data.get("ld3", 0) + data.get("ld4", 0)
        print(f"[{tag}] {payload['ts_utc']}  "
              f"invr1={payload['invr1']}W  invr2={payload['invr2']}W  "
              f"load={total_load:.1f}W  bv1={payload['bv1']}V")

        elapsed    = time.monotonic() - t0
        sleep_time = max(0.0, args.period - elapsed)
        time.sleep(sleep_time)

    source.close()


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--mode",         choices=["sim", "real"], required=True,
                    help="'sim' for simulation, 'real' for Modbus TCP hardware")
    ap.add_argument("--node-id",      required=True,
                    help="Unique node identifier registered in the dashboard")
    ap.add_argument("--api-url",      required=True,
                    help="Cloud API base URL, e.g. http://1.2.3.4:8000")
    ap.add_argument("--pv-id",        default=None,
                    help="PV system label (default: pv_<node-id>)")
    ap.add_argument("--period",       type=float, default=2.0,
                    help="Seconds between packets (default: 2)")
    ap.add_argument("--modbus-host",  default=None,
                    help="Modbus TCP host IP, real mode only (e.g. 192.168.1.100)")
    ap.add_argument("--modbus-port",  type=int, default=502,
                    help="Modbus TCP port, real mode only (default: 502)")
    args = ap.parse_args()

    if args.pv_id is None:
        args.pv_id = f"pv_{args.node_id}"

    run(args)


if __name__ == "__main__":
    main()
