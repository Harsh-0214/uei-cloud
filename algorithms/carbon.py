"""
algorithms/carbon.py — Carbon Emissions Calculator

Edge-side algorithm. Runs on each Pi, computes CO₂ emissions and avoided
emissions per telemetry interval and POSTs the result to the cloud API.

Inputs (BMS node):
  pack_voltage, pack_current  → instantaneous power; charging = grid/solar draw

Inputs (PV node):
  invr1, invr2  → solar inverter output (W)
  ld1-ld4       → load channels (W)

Output per interval:
  { power_kw, grid_import_kw, solar_gen_kw,
    co2_g, co2_avoided_g, carbon_intensity, interval_s }

Carbon intensity (gCO₂/kWh) is fetched from GET /carbon/config/{node_id}
and cached locally. Falls back to DEFAULT_INTENSITY when cloud is unreachable.

Regional defaults for reference:
  Global avg   ~475   UK  ~233
  US avg       ~386   EU  ~255
  Australia    ~530   Canada ~130
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
    _requests = None

DEFAULT_INTENSITY = 400.0   # gCO₂/kWh — sensible global average
_CACHE_PATH       = "/tmp/uei_carbon_config.json"
_CONFIG_TTL       = 600.0   # refresh cloud config every 10 minutes


class CarbonCalculator:
    """
    Carbon Emissions Calculator.

    Usage (BMS node)::

        cc = CarbonCalculator(node_id="pi_bms_real", api_url="http://IP:8000")
        result = cc.compute_bms(telemetry_data, interval_s=2.0)

    Usage (PV node)::

        cc = CarbonCalculator(node_id="pi_pv_real", api_url="http://IP:8000")
        result = cc.compute_pv(telemetry_data, interval_s=2.0)

    Both methods return a dict ready to POST to POST /carbon.
    """

    def __init__(
        self,
        node_id:           str,
        api_url:           Optional[str] = None,
        default_intensity: float         = DEFAULT_INTENSITY,
    ) -> None:
        self.node_id    = node_id
        self._api_url   = api_url.rstrip("/") if api_url else None
        self._intensity = default_intensity
        self._last_try  = 0.0
        self._load_cache()

    # ── Config management ─────────────────────────────────────────────────────

    def _load_cache(self) -> None:
        try:
            with open(_CACHE_PATH) as fh:
                data = json.load(fh)
            if data.get("node_id") == self.node_id:
                self._intensity = float(data["carbon_intensity"])
        except (FileNotFoundError, json.JSONDecodeError, KeyError, ValueError):
            pass

    def _save_cache(self) -> None:
        try:
            with open(_CACHE_PATH, "w") as fh:
                json.dump({"node_id": self.node_id, "carbon_intensity": self._intensity}, fh)
        except OSError:
            pass

    def _try_refresh_config(self) -> None:
        if not self._api_url or _requests is None:
            return
        now = time.monotonic()
        if now - self._last_try < _CONFIG_TTL:
            return
        self._last_try = now
        try:
            r = _requests.get(f"{self._api_url}/carbon/config/{self.node_id}", timeout=3.0)
            r.raise_for_status()
            self._intensity = float(r.json().get("carbon_intensity", DEFAULT_INTENSITY))
            self._save_cache()
        except Exception:
            pass   # keep using cached / default value

    # ── BMS computation ───────────────────────────────────────────────────────

    def compute_bms(self, data: dict, interval_s: float = 2.0) -> dict:
        """
        Compute emissions for one BMS telemetry interval.

        Charging current (pack_current > 0) means the battery is drawing
        energy from the grid or solar — this is the consumption side.
        Discharging (pack_current < 0) delivers stored energy to loads.

        Parameters
        ----------
        data       : BMS telemetry dict (pack_voltage, pack_current)
        interval_s : seconds since the previous reading

        Returns
        -------
        dict suitable for POST /carbon
        """
        self._try_refresh_config()

        voltage = float(data.get("pack_voltage", 0.0))
        current = float(data.get("pack_current", 0.0))

        total_power_kw  = abs(voltage * current) / 1000.0
        charge_power_kw = max(0.0, voltage * current) / 1000.0   # positive = drawing energy
        kwh             = charge_power_kw * interval_s / 3600.0
        co2_g           = kwh * self._intensity

        return {
            "node_id":          self.node_id,
            "interval_s":       interval_s,
            "power_kw":         round(total_power_kw,  4),
            "grid_import_kw":   round(charge_power_kw, 4),
            "solar_gen_kw":     0.0,
            "co2_g":            round(co2_g, 5),
            "co2_avoided_g":    0.0,
            "carbon_intensity": self._intensity,
            "ts_utc":           _utc_now(),
        }

    # ── PV computation ────────────────────────────────────────────────────────

    def compute_pv(self, data: dict, interval_s: float = 2.0) -> dict:
        """
        Compute emissions for one PV telemetry interval.

        Solar generation offsets load; only the shortfall (grid import)
        produces CO₂. The solar fraction that directly serves the load
        avoids emissions compared to pure-grid supply.

        Parameters
        ----------
        data       : PV telemetry dict (invr1, invr2, ld1-ld4)
        interval_s : seconds since the previous reading

        Returns
        -------
        dict suitable for POST /carbon
        """
        self._try_refresh_config()

        solar_w = float(data.get("invr1", 0.0)) + float(data.get("invr2", 0.0))
        load_w  = (float(data.get("ld1", 0.0)) + float(data.get("ld2", 0.0))
                 + float(data.get("ld3", 0.0)) + float(data.get("ld4", 0.0)))

        solar_kw        = solar_w / 1000.0
        load_kw         = load_w  / 1000.0
        grid_import_kw  = max(0.0, load_kw - solar_kw)
        solar_used_kw   = min(solar_kw, load_kw)   # solar actually serving loads

        kwh_grid  = grid_import_kw * interval_s / 3600.0
        kwh_solar = solar_used_kw  * interval_s / 3600.0

        co2_g         = kwh_grid  * self._intensity
        co2_avoided_g = kwh_solar * self._intensity

        return {
            "node_id":          self.node_id,
            "interval_s":       interval_s,
            "power_kw":         round(load_kw,         4),
            "grid_import_kw":   round(grid_import_kw,  4),
            "solar_gen_kw":     round(solar_kw,        4),
            "co2_g":            round(co2_g,           5),
            "co2_avoided_g":    round(co2_avoided_g,   5),
            "carbon_intensity": self._intensity,
            "ts_utc":           _utc_now(),
        }


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
