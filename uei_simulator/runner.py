import time
import signal

from .common import post, utc_now, BMS_ENDPOINT, PV_ENDPOINT, ALGO_ENDPOINT, CARBON_ENDPOINT
from .validators import validate_bms, validate_pv

# ── Algorithm imports (graceful fallback if algorithms/ package is absent) ────

try:
    from algorithms.cac import ContextAwareAdaptiveControl
    from algorithms.rda import RiskIndexedDeratingAlgorithm
    from algorithms.carbon import CarbonCalculator
    _ALGOS_AVAILABLE = True
except ImportError:
    _ALGOS_AVAILABLE = False
    print("[warn] algorithms/ package not found — running without edge algorithms")


def run_scenario(scenario_instance, config: dict, endpoint: str):
    """
    Loop: step() → validate → POST telemetry → run algorithms → print status → sleep.
    Exits cleanly on Ctrl+C or if step() raises NotImplementedError.

    Scenarios return only telemetry fields; runner adds ts_utc + id envelope.
    Algorithm calls are non-fatal — a failed algo prints a warning and the loop continues.
    """
    url        = config["api_url"] + endpoint
    algo_url   = config["api_url"] + ALGO_ENDPOINT
    carbon_url = config["api_url"] + CARBON_ENDPOINT

    # ── Envelope keys (injected after validation) ─────────────────────────────
    if endpoint == BMS_ENDPOINT:
        id_fields = {"node_id": config["bms_node_id"], "bms_id": config["bms_id"]}
    elif endpoint == PV_ENDPOINT:
        id_fields = {"node_id": config["pv_node_id"], "pv_id": config["pv_id"]}
    else:
        id_fields = {"node_id": config.get("bms_node_id", "sim_node")}

    # ── Instantiate algorithms once (not per tick) ────────────────────────────
    cac = rda = carbon = None
    if _ALGOS_AVAILABLE:
        if endpoint == BMS_ENDPOINT:
            try:
                cac    = ContextAwareAdaptiveControl(
                             node_id=config["bms_node_id"],
                             api_url=config["api_url"])
                rda    = RiskIndexedDeratingAlgorithm(capacity_ah=100.0)
                carbon = CarbonCalculator(
                             node_id=config["bms_node_id"],
                             api_url=config["api_url"])
            except Exception as e:
                print(f"  [warn] Could not initialise BMS algorithms: {e}")
                cac = rda = carbon = None
        elif endpoint == PV_ENDPOINT:
            try:
                carbon = CarbonCalculator(
                             node_id=config["pv_node_id"],
                             api_url=config["api_url"])
            except Exception as e:
                print(f"  [warn] Could not initialise PV algorithms: {e}")
                carbon = None

    # ── Signal handler for clean Ctrl+C exit ──────────────────────────────────
    interrupted = False

    def _handle_sigint(sig, frame):
        nonlocal interrupted
        interrupted = True

    old_handler = signal.signal(signal.SIGINT, _handle_sigint)

    try:
        while not interrupted:

            # ── 1. Get next telemetry frame from scenario ─────────────────────
            try:
                payload = scenario_instance.step()
            except NotImplementedError:
                print("This scenario is not implemented yet.")
                return

            # ── 2. Validate telemetry fields (raw, no envelope) ───────────────
            if endpoint == BMS_ENDPOINT:
                valid, errors = validate_bms(payload)
            else:
                valid, errors = validate_pv(payload)

            if not valid:
                for err in errors:
                    print(f"  [VALIDATION] {err}")
                continue

            # ── 3. POST telemetry (primary path) ──────────────────────────────
            full_payload = {"ts_utc": utc_now(), **id_fields, **payload}
            post(url, full_payload)

            # ── 4. Run algorithms and POST their outputs (non-fatal) ──────────
            cac_action    = None
            rda_score     = None
            rda_level     = None
            co2_g         = None
            co2_avoided_g = None

            if endpoint == BMS_ENDPOINT and _ALGOS_AVAILABLE:

                # CAC
                if cac is not None:
                    try:
                        cac_result = cac.compute(payload)
                        post(algo_url, {
                            "ts_utc":  utc_now(),
                            "node_id": config["bms_node_id"],
                            "algo":    "CAC",
                            "output":  cac_result,
                        })
                        cac_action = cac_result.get("action")
                    except Exception as e:
                        print(f"  [warn] CAC failed: {e}")

                # RDA
                if rda is not None:
                    try:
                        rda_result = rda.compute(payload, soh_estimate=100.0)
                        post(algo_url, {
                            "ts_utc":  utc_now(),
                            "node_id": config["bms_node_id"],
                            "algo":    "RDA",
                            "output":  rda_result,
                        })
                        rda_score = rda_result.get("risk_score")
                        rda_level = rda_result.get("derating_level")
                    except Exception as e:
                        print(f"  [warn] RDA failed: {e}")

                # Carbon (BMS)
                if carbon is not None:
                    try:
                        carbon_result = carbon.compute_bms(payload, interval_s=config["period"])
                        post(carbon_url, carbon_result)
                        co2_g = carbon_result.get("co2_g")
                    except Exception as e:
                        print(f"  [warn] Carbon (BMS) failed: {e}")

            elif endpoint == PV_ENDPOINT and _ALGOS_AVAILABLE:

                # Carbon (PV)
                if carbon is not None:
                    try:
                        carbon_result = carbon.compute_pv(payload, interval_s=config["period"])
                        post(carbon_url, carbon_result)
                        co2_g         = carbon_result.get("co2_g")
                        co2_avoided_g = carbon_result.get("co2_avoided_g")
                    except Exception as e:
                        print(f"  [warn] Carbon (PV) failed: {e}")

            # ── 5. Status line ────────────────────────────────────────────────
            if endpoint == BMS_ENDPOINT and _ALGOS_AVAILABLE and cac_action is not None:
                algo_str = (
                    f"CAC:{cac_action}"
                    + (f"  RDA:{rda_score}/{rda_level}" if rda_score is not None else "")
                    + (f"  CO2:{co2_g}g"                if co2_g     is not None else "")
                )
                print(
                    f"  soc={payload['soc']}  "
                    f"pack_voltage={payload['pack_voltage']}  "
                    f"temp_high={payload['temp_high']}  "
                    f"fault={payload['fault_active']}"
                    f"  |  {algo_str}"
                )
            elif endpoint == PV_ENDPOINT and _ALGOS_AVAILABLE and co2_g is not None:
                avoided_str = f"  avoided:{co2_avoided_g}g" if co2_avoided_g is not None else ""
                print(
                    f"  invr1={payload['invr1']}  invr2={payload['invr2']}  "
                    f"ld1={payload['ld1']}  ld2={payload['ld2']}"
                    f"  |  CO2:{co2_g}g{avoided_str}"
                )
            else:
                # Fallback: telemetry-only format (no algos or algo not yet active)
                parts = [
                    f"{k}={v}"
                    for k, v in full_payload.items()
                    if k not in ("ts_utc", "node_id", "bms_id", "pv_id")
                ][:6]
                print("  " + "  ".join(parts))

            # ── 6. Sleep (small increments so Ctrl+C is responsive) ───────────
            elapsed  = 0.0
            interval = 0.1
            period   = config["period"]
            while elapsed < period and not interrupted:
                time.sleep(interval)
                elapsed += interval

    finally:
        signal.signal(signal.SIGINT, old_handler)

    print("Scenario stopped.")
