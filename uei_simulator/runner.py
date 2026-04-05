import time
import signal

from .common import post, utc_now, BMS_ENDPOINT, PV_ENDPOINT
from .validators import validate_bms, validate_pv


def run_scenario(scenario_instance, config: dict, endpoint: str):
    """
    Loop: call scenario_instance.step() → enrich with envelope fields → POST → print status → sleep.
    Exits cleanly on Ctrl+C or if step() raises NotImplementedError.

    Scenarios return only their telemetry fields; runner.py adds:
      - ts_utc   (always)
      - node_id  (bms_node_id or pv_node_id depending on endpoint)
      - bms_id / pv_id (depending on endpoint)
    """
    url = config["api_url"] + endpoint

    # Determine which envelope keys to inject based on endpoint
    if endpoint == BMS_ENDPOINT:
        id_fields = {"node_id": config["bms_node_id"], "bms_id": config["bms_id"]}
    elif endpoint == PV_ENDPOINT:
        id_fields = {"node_id": config["pv_node_id"], "pv_id": config["pv_id"]}
    else:
        id_fields = {"node_id": config.get("bms_node_id", "sim_node")}

    interrupted = False

    def _handle_sigint(sig, frame):
        nonlocal interrupted
        interrupted = True

    old_handler = signal.signal(signal.SIGINT, _handle_sigint)

    try:
        while not interrupted:
            try:
                payload = scenario_instance.step()
            except NotImplementedError:
                print("This scenario is not implemented yet.")
                return

            # Validate telemetry fields before enriching with envelope
            if endpoint == BMS_ENDPOINT:
                valid, errors = validate_bms(payload)
            else:
                valid, errors = validate_pv(payload)

            if not valid:
                for err in errors:
                    print(f"  [VALIDATION] {err}")
                continue

            # Inject envelope fields — scenario values take precedence if already set
            full_payload = {"ts_utc": utc_now(), **id_fields, **payload}

            post(url, full_payload)

            # One-line status: skip envelope fields, show up to 6 telemetry values
            telemetry_parts = [
                f"{k}={v}"
                for k, v in full_payload.items()
                if k not in ("ts_utc", "node_id", "bms_id", "pv_id")
            ][:6]
            print("  " + "  ".join(telemetry_parts))

            # Sleep in small increments so Ctrl+C is responsive
            elapsed = 0.0
            interval = 0.1
            period = config["period"]
            while elapsed < period and not interrupted:
                time.sleep(interval)
                elapsed += interval

    finally:
        signal.signal(signal.SIGINT, old_handler)

    print("Scenario stopped.")
