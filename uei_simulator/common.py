import os
import time
from datetime import datetime, timezone

# ── Defaults ──────────────────────────────────────────────────────────────────

DEFAULT_API_URL      = "http://34.130.163.154:8000"
DEFAULT_PERIOD       = 2.0

DEFAULT_BMS_NODE_ID  = "sim_bms"
DEFAULT_BMS_ID       = "OrionJr2_sim"
DEFAULT_PV_NODE_ID   = "sim_pv"
DEFAULT_PV_ID        = "pv_sim"

# ── Endpoint paths ─────────────────────────────────────────────────────────────

BMS_ENDPOINT    = "/telemetry"
PV_ENDPOINT     = "/pv/telemetry"
ALGO_ENDPOINT   = "/algo"
CARBON_ENDPOINT = "/carbon"

# ── Helpers ───────────────────────────────────────────────────────────────────

def utc_now() -> str:
    """Return the current UTC time as an ISO 8601 string ending in 'Z'."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def clear_screen():
    os.system("cls" if os.name == "nt" else "clear")


def post(url: str, payload: dict, retries: int = 3) -> bool:
    """POST JSON payload with exponential backoff. Returns True on success."""
    import requests  # imported here so requests is only needed when actually posting

    for attempt in range(retries):
        try:
            resp = requests.post(url, json=payload, timeout=5)
            resp.raise_for_status()
            return True
        except Exception as exc:
            wait = 2 ** attempt
            print(f"  [warn] POST {url} failed (attempt {attempt + 1}/{retries}): {exc}. Retrying in {wait}s...")
            time.sleep(wait)

    print(f"  [error] POST {url} failed after {retries} attempts.")
    return False
