#!/usr/bin/env python3
"""
pi_pv_client.py — UEI PV system telemetry client (simulation OR real hardware)

Runs in two modes controlled by --mode:

  sim   Generates realistic simulated PV inverter/load/battery data and POSTs
        to the cloud API. No hardware required.

  real  Reads live data from a CSV file that your DAQ software overwrites each
        interval (e.g. the Capstone Solar acquisition script).

        Expected CSV format (11 columns, header optional):
          Hr,Min,Sec,Invr1,Invr2,Ld1,Ld2,Ld3,Ld4,BV1,BV2
        The first three columns (Hr/Min/Sec) are ignored; columns 4-11 are
        converted from raw analog counts to engineering units:
          Invr1/2  → ampCalc1  (inverter output current, A)
          Ld1-4    → ampCalc2  (load current, A)
          BV1/2    → vltCalc   (battery voltage, V)

Usage:
  sim:   python3 pi_pv_client.py --mode sim  --node-id pi_pv_sim  --api-url http://IP:8000
  real:  python3 pi_pv_client.py --mode real --node-id pi_pv_real --api-url http://IP:8000 \\
                                  --csv-path /home/capstone/Capstone_solar/pv.csv
"""

from __future__ import annotations

import argparse
import os
import signal
import sys
import time
import random
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    sys.exit("Missing dependency — run: pip install requests")

# ── Load Carbon algorithm (graceful fallback if algorithms/ not present) ───────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from algorithms.carbon import CarbonCalculator
    _CARBON_AVAILABLE = True
except ImportError:
    _CARBON_AVAILABLE = False
    print("[WARN] algorithms/ not found — Carbon disabled")


# ── Shared helpers ────────────────────────────────────────────────────────────

def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


# ── Shared sender ─────────────────────────────────────────────────────────────

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


# ── Real PV data source (CSV file written by DAQ software) ───────────────────

def _safe_float(s: str, default: float = 0.0) -> float:
    try:
        return float(s.strip())
    except ValueError:
        return default

def _amp_calc1(raw: float) -> float:
    """Inverter output current conversion (analog → A)."""
    return max(0.0, round((raw - 505.625) / 9.6724285104567, 2))

def _amp_calc2(raw: float) -> float:
    """Load channel current conversion (analog → A)."""
    return max(0.0, round((raw - 507) / 25.7362355953905, 2))

def _vlt_calc(raw: float) -> float:
    """Battery voltage conversion (analog → V)."""
    return max(0.0, round(raw / 56.15546218, 3))


class RealPV:
    """
    Reads live PV data from a CSV file that the DAQ software overwrites each
    interval.  Parses the last non-empty line each call so it always gets the
    most recent sample even if the file grows rather than being fully replaced.

    Expected format (11 columns):
      Hr,Min,Sec,Invr1,Invr2,Ld1,Ld2,Ld3,Ld4,BV1,BV2

    Columns 0-2 (Hr/Min/Sec) are ignored; columns 3-10 are converted.
    """

    def __init__(self, csv_path: str) -> None:
        if not os.path.exists(csv_path):
            sys.exit(f"[PV] ERROR: CSV file not found: {csv_path}")
        self.csv_path = csv_path
        print(f"[PV] Real mode: reading from {csv_path}")

    def read(self) -> dict:
        with open(self.csv_path, "r") as f:
            lines = [ln.strip() for ln in f if ln.strip()]

        if not lines:
            raise ValueError("CSV file is empty")

        last = lines[-1]
        parts = [p.strip() for p in last.split(",")]

        if len(parts) < 11:
            raise ValueError(f"Expected ≥11 columns, got {len(parts)}: {last!r}")

        # Raw analog counts (columns 3-10, skip Hr/Min/Sec)
        raw = [_safe_float(p) for p in parts[3:11]]
        invr1_r, invr2_r, ld1_r, ld2_r, ld3_r, ld4_r, bv1_r, bv2_r = raw

        return {
            "invr1": _amp_calc1(invr1_r),
            "invr2": _amp_calc1(invr2_r),
            "ld1":   _amp_calc2(ld1_r),
            "ld2":   _amp_calc2(ld2_r),
            "ld3":   _amp_calc2(ld3_r),
            "ld4":   _amp_calc2(ld4_r),
            "bv1":   _vlt_calc(bv1_r),
            "bv2":   _vlt_calc(bv2_r),
        }

    def close(self) -> None:
        pass


# ── Main loop (shared for both modes) ────────────────────────────────────────

def run(args: argparse.Namespace) -> None:
    api_base = args.api_url.rstrip("/")
    url      = f"{api_base}/pv/telemetry"

    if args.mode == "sim":
        source: SimPV | RealPV = SimPV()
        print(f"[PV] Mode: SIMULATION   node={args.node_id}  pv={args.pv_id}  →  {url}")
    else:
        if not args.csv_path:
            sys.exit("--csv-path is required in real mode (e.g. --csv-path /home/capstone/Capstone_solar/pv.csv)")
        source = RealPV(csv_path=args.csv_path)
        print(f"[PV] Mode: REAL HARDWARE  node={args.node_id}  pv={args.pv_id}  →  {url}")

    # ── Initialise Carbon algorithm ───────────────────────────────────────────
    carbon = None
    if _CARBON_AVAILABLE:
        carbon = CarbonCalculator(node_id=args.node_id, api_url=api_base)
        print(f"[PV] Carbon algorithm active")
    else:
        print(f"[PV] Running without Carbon algorithm (algorithms/ not found)")

    running = True

    def _shutdown(sig, frame) -> None:  # noqa: ANN001
        nonlocal running
        print("\n[PV] Shutting down…")
        running = False

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    while running:
        t0 = time.monotonic()

        try:
            data = source.read()
        except Exception as exc:
            print(f"[WARN] Read error: {exc}")
            time.sleep(args.period)
            continue

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
              f"invr1={payload['invr1']}A  invr2={payload['invr2']}A  "
              f"load={total_load:.2f}A  bv1={payload['bv1']}V")

        # ── Carbon — emissions calculator ─────────────────────────────────────
        if carbon is not None:
            carbon_result = carbon.compute_pv(data, interval_s=args.period)
            send_telemetry(f"{api_base}/carbon", carbon_result, retries=1)

        elapsed    = time.monotonic() - t0
        sleep_time = max(0.0, args.period - elapsed)
        time.sleep(sleep_time)

    source.close()


def main() -> None:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--mode",      choices=["sim", "real"], required=True,
                    help="'sim' for simulation, 'real' for CSV file hardware")
    ap.add_argument("--node-id",   required=True,
                    help="Unique node identifier registered in the dashboard")
    ap.add_argument("--api-url",   required=True,
                    help="Cloud API base URL, e.g. http://1.2.3.4:8000")
    ap.add_argument("--pv-id",     default=None,
                    help="PV system label (default: pv_<node-id>)")
    ap.add_argument("--period",    type=float, default=3.0,
                    help="Seconds between packets (default: 3, matching DAQ interval)")
    ap.add_argument("--csv-path",  default=None,
                    help="Path to the CSV file written by your DAQ software, real mode only "
                         "(e.g. /home/capstone/Capstone_solar/pv.csv)")
    args = ap.parse_args()

    if args.pv_id is None:
        args.pv_id = f"pv_{args.node_id}"

    run(args)


if __name__ == "__main__":
    main()
