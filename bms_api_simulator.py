import time
import random
from datetime import datetime, timezone
import requests

# =========================
# CONFIG
# =========================

CLOUD_API = "http://34.130.78.82:8000"
ENDPOINT = "/telemetry"

NODE_ID = "pi_bms_1"
BMS_ID = "orionjr2_1"

PERIOD_S = 2  # seconds between sends


# =========================
# HELPERS
# =========================

def iso_utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def post_to_cloud(payload):
    url = CLOUD_API + ENDPOINT
    r = requests.post(url, json=payload, timeout=5)
    r.raise_for_status()
    return r.json()


# =========================
# MAIN SIMULATION LOOP
# =========================

def main():
    print(f"[BMS SIM] Sending to {CLOUD_API}{ENDPOINT}")

    # Initial state
    soc = 82.0
    pack_voltage = 48.6
    pack_current = 5.0
    temp_high = 31.0
    temp_low = 28.5
    highest_cell_v = 3.62
    lowest_cell_v = 3.58
    ccl = 80.0
    dcl = 120.0
    fault_active = False
    faults_cleared_min = 27.0

    while True:
        try:
            # Simulate realistic drift
            soc = clamp(soc + random.uniform(-0.05, 0.02), 0, 100)
            pack_voltage = clamp(pack_voltage + random.uniform(-0.1, 0.1), 40, 60)
            pack_current = clamp(pack_current + random.uniform(-0.5, 0.5), -50, 50)

            temp_high = clamp(temp_high + random.uniform(-0.1, 0.2), -20, 90)
            temp_low = clamp(temp_low + random.uniform(-0.1, 0.2), -20, 90)
            if temp_low > temp_high:
                temp_low = temp_high - 0.5

            highest_cell_v = clamp(highest_cell_v + random.uniform(-0.01, 0.01), 2.5, 4.25)
            lowest_cell_v = clamp(lowest_cell_v + random.uniform(-0.01, 0.01), 2.5, 4.25)
            if lowest_cell_v > highest_cell_v:
                lowest_cell_v = highest_cell_v - 0.02

            # Random fault event
            if random.random() < 0.01:
                fault_active = True
            if fault_active and random.random() < 0.15:
                fault_active = False
                faults_cleared_min = 0
            else:
                faults_cleared_min += PERIOD_S / 60.0

            payload = {
                "ts_utc": iso_utc_now(),
                "node_id": NODE_ID,
                "bms_id": BMS_ID,
                "soc": round(soc, 2),
                "pack_voltage": round(pack_voltage, 3),
                "pack_current": round(pack_current, 3),
                "temp_high": round(temp_high, 2),
                "temp_low": round(temp_low, 2),
                "ccl": ccl,
                "dcl": dcl,
                "fault_active": fault_active,
                "faults_cleared_min": round(faults_cleared_min, 2),
                "highest_cell_v": round(highest_cell_v, 3),
                "lowest_cell_v": round(lowest_cell_v, 3),
            }

            response = post_to_cloud(payload)

            print(f"[OK] {payload['ts_utc']} SOC={payload['soc']} V={payload['pack_voltage']} I={payload['pack_current']} Fault={payload['fault_active']}")

        except Exception as e:
            print(f"[ERROR] {e}")

        time.sleep(PERIOD_S)


if __name__ == "__main__":
    main()
