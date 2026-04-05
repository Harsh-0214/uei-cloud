"""
Telemetry payload validation for BMS and PV scenarios.
Returns (is_valid, errors) — never raises. Ranges are intentionally generous;
this catches physically impossible garbage, not edge cases.
"""

# ── BMS ───────────────────────────────────────────────────────────────────────

_BMS_REQUIRED = (
    "soc", "pack_voltage", "pack_current", "temp_high", "temp_low",
    "ccl", "dcl", "fault_active", "faults_cleared_min",
    "highest_cell_v", "lowest_cell_v",
)

_BMS_RANGES = {
    "soc":                (0.0,    100.0),
    "pack_voltage":       (8.0,    18.0),
    "pack_current":       (-80.0,  50.0),
    "temp_high":          (-40.0,  85.0),
    "temp_low":           (-40.0,  85.0),
    "ccl":                (0.0,    100.0),
    "dcl":                (0.0,    120.0),
    "faults_cleared_min": (0.0,    10000.0),
    "highest_cell_v":     (2.0,    4.5),
    "lowest_cell_v":      (2.0,    4.5),
}


def validate_bms(payload: dict) -> tuple:
    """
    Validate a BMS telemetry payload (telemetry fields only — no ts_utc/node_id/bms_id).
    Returns (is_valid: bool, errors: list[str]).
    """
    errors = []

    # ── Required keys ─────────────────────────────────────────────────────────
    for key in _BMS_REQUIRED:
        if key not in payload:
            errors.append(f"missing key: {key}")

    if errors:
        # Can't do type/range checks with missing keys
        return False, errors

    # ── Type checks ───────────────────────────────────────────────────────────
    if not isinstance(payload["fault_active"], bool):
        errors.append(
            f"fault_active must be bool, got {type(payload['fault_active']).__name__}"
        )

    for key in _BMS_RANGES:
        val = payload[key]
        if not isinstance(val, (int, float)):
            errors.append(
                f"{key} must be int or float, got {type(val).__name__}"
            )

    # ── Range checks ──────────────────────────────────────────────────────────
    for key, (lo, hi) in _BMS_RANGES.items():
        val = payload[key]
        if isinstance(val, (int, float)) and not (lo <= val <= hi):
            errors.append(f"{key}={val} out of range [{lo}, {hi}]")

    # ── Physics cross-checks ──────────────────────────────────────────────────
    temp_high = payload["temp_high"]
    temp_low  = payload["temp_low"]
    if isinstance(temp_high, (int, float)) and isinstance(temp_low, (int, float)):
        if temp_high < temp_low:
            errors.append(f"temp_high ({temp_high}) < temp_low ({temp_low})")

    highest_cell = payload["highest_cell_v"]
    lowest_cell  = payload["lowest_cell_v"]
    if isinstance(highest_cell, (int, float)) and isinstance(lowest_cell, (int, float)):
        if highest_cell < lowest_cell:
            errors.append(
                f"highest_cell_v ({highest_cell}) < lowest_cell_v ({lowest_cell})"
            )

    pack_v = payload["pack_voltage"]
    if isinstance(pack_v, (int, float)) and isinstance(highest_cell, (int, float)) and isinstance(lowest_cell, (int, float)):
        avg_cell = (highest_cell + lowest_cell) / 2.0
        expected_pack = avg_cell * 4.0
        if abs(pack_v - expected_pack) > 3.0:
            errors.append(
                f"pack_voltage ({pack_v}) inconsistent with 4× avg cell voltage "
                f"({expected_pack:.3f}, tolerance ±3.0V)"
            )

    return len(errors) == 0, errors


# ── PV ────────────────────────────────────────────────────────────────────────

_PV_REQUIRED = ("invr1", "invr2", "ld1", "ld2", "ld3", "ld4", "bv1", "bv2")

_PV_RANGES = {
    "invr1": (-5.0, 50.0),
    "invr2": (-5.0, 50.0),
    "ld1":   (-5.0, 50.0),
    "ld2":   (-5.0, 50.0),
    "ld3":   (-5.0, 50.0),
    "ld4":   (-5.0, 50.0),
    "bv1":   (0.0,  20.0),
    "bv2":   (0.0,  20.0),
}


def validate_pv(payload: dict) -> tuple:
    """
    Validate a PV telemetry payload (telemetry fields only — no ts_utc/node_id/pv_id).
    Returns (is_valid: bool, errors: list[str]).
    """
    errors = []

    # ── Required keys ─────────────────────────────────────────────────────────
    for key in _PV_REQUIRED:
        if key not in payload:
            errors.append(f"missing key: {key}")

    if errors:
        return False, errors

    # ── Type checks ───────────────────────────────────────────────────────────
    for key in _PV_RANGES:
        val = payload[key]
        if not isinstance(val, (int, float)):
            errors.append(
                f"{key} must be int or float, got {type(val).__name__}"
            )

    # ── Range checks ──────────────────────────────────────────────────────────
    for key, (lo, hi) in _PV_RANGES.items():
        val = payload[key]
        if isinstance(val, (int, float)) and not (lo <= val <= hi):
            errors.append(f"{key}={val} out of range [{lo}, {hi}]")

    return len(errors) == 0, errors
