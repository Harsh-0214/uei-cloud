"""
algorithms/cac.py — Context-Aware Adaptive Control (CAC)

Edge-side real-time control algorithm. Runs on the Raspberry Pi alongside
telemetry collection.

Inputs  : live BMS telemetry (voltage, current, temp, soc)
          operational_profile fetched from cloud /config/{node_id}
Outputs : { action, adjusted_current_limit, thermal_directive,
            profile_source, timestamp }

The operational profile is cached locally — if the cloud is unreachable the
most recently cached profile is used. If no cache exists, conservative built-in
defaults are applied so the algorithm always produces a valid output.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Optional

try:
    import requests as _requests
except ImportError:
    _requests = None  # running without network library (rare)

# ── Built-in defaults (used when cloud unreachable and no local cache) ────────

_DEFAULTS: dict = {
    "max_charge_current":    80.0,
    "max_discharge_current": 120.0,
    "temp_warn_threshold":   45.0,    # °C — start reducing charge rate
    "temp_fault_threshold":  60.0,    # °C — emergency derate
    "soc_high_threshold":    90.0,    # % — prioritise discharge
    "soc_low_threshold":     20.0,    # % — reduce discharge
}

_CACHE_PATH   = "/tmp/uei_cac_profile.json"
_PROFILE_TTL  = 300.0   # seconds between cloud refresh attempts


class ContextAwareAdaptiveControl:
    """
    Context-Aware Adaptive Control.

    Usage::

        cac = ContextAwareAdaptiveControl(
            node_id="pi_bms_real",
            api_url="http://192.168.1.50:8000",
        )
        result = cac.compute(telemetry_data)

    The instance is stateful: it caches the last fetched profile on disk and
    rate-limits cloud refresh attempts to once per _PROFILE_TTL seconds.
    """

    def __init__(self, node_id: str, api_url: Optional[str] = None) -> None:
        self.node_id     = node_id
        self._api_url    = api_url.rstrip("/") if api_url else None
        self._profile    = dict(_DEFAULTS)
        self._last_fetch = 0.0   # monotonic timestamp of last successful fetch
        self._last_try   = 0.0   # monotonic timestamp of last attempt (success or fail)
        self._source     = "default"
        self._load_disk_cache()

    # ── Profile management ────────────────────────────────────────────────────

    def _load_disk_cache(self) -> None:
        try:
            with open(_CACHE_PATH) as fh:
                data = json.load(fh)
            if data.get("node_id") == self.node_id:
                self._profile = data["profile"]
                self._source  = "cache"
        except (FileNotFoundError, json.JSONDecodeError, KeyError):
            pass

    def _save_disk_cache(self) -> None:
        try:
            with open(_CACHE_PATH, "w") as fh:
                json.dump({"node_id": self.node_id, "profile": self._profile}, fh)
        except OSError:
            pass

    def _try_refresh_profile(self) -> None:
        """Attempt to pull the latest operational profile from the cloud API."""
        if not self._api_url or _requests is None:
            return
        now = time.monotonic()
        if now - self._last_try < _PROFILE_TTL:
            return
        self._last_try = now
        try:
            url = f"{self._api_url}/config/{self.node_id}"
            r   = _requests.get(url, timeout=3.0)
            r.raise_for_status()
            fetched = r.json()
            # Merge into profile — unknown keys are ignored
            for k in _DEFAULTS:
                if k in fetched:
                    self._profile[k] = float(fetched[k])
            self._save_disk_cache()
            self._last_fetch = now
            self._source     = "cloud"
        except Exception:
            # Cloud unreachable — keep using cached / default profile silently
            pass

    # ── Core algorithm ────────────────────────────────────────────────────────

    def compute(self, data: dict) -> dict:
        """
        Compute a CAC decision for the current telemetry reading.

        Parameters
        ----------
        data : dict
            Latest BMS fields — must include at minimum:
            soc, pack_current, temp_high, ccl, dcl, fault_active

        Returns
        -------
        dict
            action                : str  — NORMAL | TEMP_WARN_DERATE |
                                           OVERTEMP_DERATE | FAULT_DERATE |
                                           PRIORITIZE_DISCHARGE | CAP_OUTPUT
            adjusted_current_limit: float — recommended DCL override (A)
            thermal_directive     : str  — NONE | REDUCE_CHARGE_RATE | FAULT_ACTIVE
            profile_source        : str  — cloud | cache | default
            timestamp             : str  — ISO8601 UTC
        """
        self._try_refresh_profile()

        soc       = float(data.get("soc",          50.0))
        current   = float(data.get("pack_current",  0.0))
        temp_high = float(data.get("temp_high",    25.0))
        fault     = bool( data.get("fault_active", False))
        dcl       = float(data.get("dcl", self._profile["max_discharge_current"]))

        p  = self._profile
        action            = "NORMAL"
        adjusted_limit    = dcl
        thermal_directive = "NONE"

        # Rule 1 — Fault active → emergency derate to 25 %
        if fault:
            action            = "FAULT_DERATE"
            adjusted_limit    = round(dcl * 0.25, 2)
            thermal_directive = "FAULT_ACTIVE"

        # Rule 2 — Overtemperature → emergency derate to 15 %
        elif temp_high >= p["temp_fault_threshold"]:
            action            = "OVERTEMP_DERATE"
            adjusted_limit    = round(dcl * 0.15, 2)
            thermal_directive = "REDUCE_CHARGE_RATE"

        # Rule 3 — Temperature warning → soft derate to 70 %
        elif temp_high >= p["temp_warn_threshold"]:
            action            = "TEMP_WARN_DERATE"
            adjusted_limit    = round(dcl * 0.70, 2)
            thermal_directive = "REDUCE_CHARGE_RATE"

        # Rule 4 — High SOC → prioritise discharge (keep full DCL)
        if soc > p["soc_high_threshold"] and action == "NORMAL":
            action         = "PRIORITIZE_DISCHARGE"
            adjusted_limit = dcl

        # Rule 5 — Load spike detected (>85 % of DCL) → cap output
        if abs(current) > dcl * 0.85 and action == "NORMAL":
            action         = "CAP_OUTPUT"
            adjusted_limit = round(dcl * 0.85, 2)

        return {
            "action":                  action,
            "adjusted_current_limit":  round(adjusted_limit, 2),
            "thermal_directive":       thermal_directive,
            "profile_source":          self._source,
            "timestamp":               _utc_now(),
        }


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
