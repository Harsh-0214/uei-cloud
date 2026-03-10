# pi_bms_cloudconnect.py
import time
from datetime import datetime, timezone
import requests

CLOUD_API = "http://34.130.78.82:8000"
ENDPOINT = "/telemetry"

NODE_ID = "pi_bms_1"
BMS_ID = "orionjr2_1"
PERIOD_S = 5


def iso_utc_now() -> str:
    # Example: 2026-02-12T19:05:00Z
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_bms() -> dict:
    """
    Replace the values below with real Orion Jr2 readings.
    Keep keys EXACTLY the same to avoid FastAPI 422 validation errors.
    """
    return {
        "ts_utc": iso_utc_now(),
        "node_id": NODE_ID,
        "bms_id": BMS_ID,

        "soc": 82.1,
        "pack_voltage": 48.6,
        "pack_current": 5.2,

        "temp_high": 31.4,
        "temp_low": 28.9,

        "ccl": 80.0,
        "dcl": 120.0,

        "fault_active": False,
        "faults_cleared_min": 27.0,

        "highest_cell_v": 3.62,
        "lowest_cell_v": 3.58
    }


def post_json(path: str, payload: dict) -> dict:
    url = CLOUD_API + path
    r = requests.post(url, json=payload, timeout=5)
    r.raise_for_status()
    return r.json()


def main():
    while True:
        try:
            pkt = read_bms()
            resp = post_json(ENDPOINT, pkt)
            print(f"[BMS] sent ok: {resp}")
        except Exception as e:
            print(f"[BMS] send error: {e}")
        time.sleep(PERIOD_S)


if __name__ == "__main__":
    main()
