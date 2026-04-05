# sim_pv_api.py
# PV simulator for your VM: sends PV telemetry directly to your cloud API (/pv/telemetry),
# which then inserts into Postgres (pv_telemetry table).
#
# Usage:
#   python3 -m pip install requests
#   python3 sim_pv_api.py
#
# Verify:
#   curl "http://34.130.163.154:8000/pv/latest?node_id=pi_pv_1"
#   (or query Postgres: SELECT * FROM pv_telemetry ORDER BY ts_utc DESC LIMIT 5;)

import time
import random
from datetime import datetime, timezone
import requests

CLOUD_API = "http://34.130.163.154:8000"
ENDPOINT = "/pv/telemetry"

NODE_ID = "pi_pv_1"
PV_ID = "pv_1"

PERIOD_S = 2  # seconds between sends


def iso_utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def post_payload(payload: dict) -> dict:
    url = CLOUD_API + ENDPOINT
    r = requests.post(url, json=payload, timeout=5)
    r.raise_for_status()
    return r.json()


def main():
    print(f"[PV SIM] Sending to {CLOUD_API}{ENDPOINT}")
    print(f"[PV SIM] node_id={NODE_ID}, pv_id={PV_ID}, period={PERIOD_S}s")

    # Simulated starting values (tweak as you like)
    invr1 = 120.0
    invr2 = 118.0
    ld1, ld2, ld3, ld4 = 5.0, 4.5, 6.0, 3.8
    bv1, bv2 = 48.7, 48.6

    while True:
        try:
            # Add realistic drift/noise
            invr1 = clamp(invr1 + random.uniform(-1.0, 1.0), 0.0, 500.0)
            invr2 = clamp(invr2 + random.uniform(-1.0, 1.0), 0.0, 500.0)

            ld1 = clamp(ld1 + random.uniform(-0.4, 0.4), 0.0, 200.0)
            ld2 = clamp(ld2 + random.uniform(-0.4, 0.4), 0.0, 200.0)
            ld3 = clamp(ld3 + random.uniform(-0.4, 0.4), 0.0, 200.0)
            ld4 = clamp(ld4 + random.uniform(-0.4, 0.4), 0.0, 200.0)

            bv1 = clamp(bv1 + random.uniform(-0.05, 0.05), 40.0, 60.0)
            bv2 = clamp(bv2 + random.uniform(-0.05, 0.05), 40.0, 60.0)

            payload = {
                "ts_utc": iso_utc_now(),
                "node_id": NODE_ID,
                "pv_id": PV_ID,
                "invr1": round(invr1, 3),
                "invr2": round(invr2, 3),
                "ld1": round(ld1, 3),
                "ld2": round(ld2, 3),
                "ld3": round(ld3, 3),
                "ld4": round(ld4, 3),
                "bv1": round(bv1, 3),
                "bv2": round(bv2, 3),
            }

            resp = post_payload(payload)
            total_load = ld1 + ld2 + ld3 + ld4
            print(f"[OK] {payload['ts_utc']} invr1={payload['invr1']} invr2={payload['invr2']} load_total={total_load:.2f} bv1={payload['bv1']} -> {resp}")

        except Exception as e:
            print(f"[PV SIM] error: {e}")

        time.sleep(PERIOD_S)


if __name__ == "__main__":
    main()
