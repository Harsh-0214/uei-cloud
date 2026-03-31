"""
algorithms/rda.py — Risk-Indexed Derating Algorithm (RDA)

Edge-side real-time safety layer. Runs on the Raspberry Pi.
Operates entirely independently of cloud connectivity.

Inputs  : rolling window of live BMS telemetry readings
          (pack_voltage, pack_current, temp_high, soc)
          optional soh_estimate from the most recent RHF forecast

Outputs : { risk_score, derating_level, derating_factor,
            alert_flag, subscores, timestamp }

Derating schedule
-----------------
  risk_score  > 75   →  CRITICAL  — cap to 60 % rated power
  risk_score 50–75   →  WARNING   — cap to 85 % rated power
  risk_score  < 50   →  NORMAL    — 100 % (no derating)

Risk score (0–100) is a weighted sum of five sub-scores:

  Sub-score              Weight  What it measures
  ─────────────────────────────────────────────────────────────────────
  voltage_fluctuation     0.20   Peak-to-peak V swing over the window
  peak_c_rate             0.25   Highest |I|/capacity ratio seen
  soh_trend               0.25   Degradation risk from low SoH
  temp_spike              0.20   Maximum temperature in window
  high_soc_dwell          0.10   Fraction of readings above 90 % SoC
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from typing import Deque

# ── Weights (must sum to 1.0) ─────────────────────────────────────────────────

_WEIGHTS: dict[str, float] = {
    "voltage_fluctuation": 0.20,
    "peak_c_rate":         0.25,
    "soh_trend":           0.25,
    "temp_spike":          0.20,
    "high_soc_dwell":      0.10,
}

_WINDOW            = 30     # readings kept in rolling history  (≈60 s at 2 s period)
_DEFAULT_CAPACITY  = 100.0  # nominal Ah — overridable at init
_SOH_RISK_FLOOR    = 70.0   # SoH below this starts adding risk


class RiskIndexedDeratingAlgorithm:
    """
    Risk-Indexed Derating Algorithm (RDA).

    Usage::

        rda = RiskIndexedDeratingAlgorithm(capacity_ah=100.0)
        result = rda.compute(telemetry_data, soh_estimate=96.5)

    The instance is stateful: it maintains a rolling history of readings.
    Call compute() once per telemetry loop iteration.
    """

    def __init__(
        self,
        window:      int   = _WINDOW,
        capacity_ah: float = _DEFAULT_CAPACITY,
    ) -> None:
        """
        Parameters
        ----------
        window      : number of recent readings to keep (rolling buffer size)
        capacity_ah : nominal battery capacity in Ah used to compute C-rate
        """
        self._window   = window
        self._capacity = capacity_ah if capacity_ah > 0 else _DEFAULT_CAPACITY

        self._voltages: Deque[float] = deque(maxlen=window)
        self._currents: Deque[float] = deque(maxlen=window)
        self._temps:    Deque[float] = deque(maxlen=window)
        self._socs:     Deque[float] = deque(maxlen=window)

    # ── Sub-score helpers (each returns 0–100) ────────────────────────────────

    def _score_voltage_fluctuation(self) -> float:
        """Peak-to-peak voltage swing — 0 V → 0, ≥2 V swing → 100."""
        if len(self._voltages) < 2:
            return 0.0
        swing = max(self._voltages) - min(self._voltages)
        return min(swing / 2.0 * 100.0, 100.0)

    def _score_peak_c_rate(self) -> float:
        """Highest absolute C-rate seen — 0 C → 0, ≥2 C → 100."""
        if not self._currents:
            return 0.0
        peak_c = max(abs(c) for c in self._currents) / self._capacity
        return min(peak_c / 2.0 * 100.0, 100.0)

    def _score_soh_trend(self, soh: float) -> float:
        """
        Translate SoH into a risk score.
        SoH = 100 → score 0 (healthy).
        SoH = _SOH_RISK_FLOOR → score 100 (near end-of-life).
        """
        span = 100.0 - _SOH_RISK_FLOOR
        return min(max((100.0 - soh) / span * 100.0, 0.0), 100.0)

    def _score_temp_spike(self) -> float:
        """
        Highest temperature in the window.
        ≤40 °C → 0, ≥65 °C → 100.
        """
        if not self._temps:
            return 0.0
        return min(max((max(self._temps) - 40.0) / 25.0 * 100.0, 0.0), 100.0)

    def _score_high_soc_dwell(self) -> float:
        """
        Fraction of recent readings where SoC > 90 %.
        0 % dwell → 0, 100 % dwell → 100.
        """
        if not self._socs:
            return 0.0
        return sum(1 for s in self._socs if s > 90.0) / len(self._socs) * 100.0

    # ── Main compute ──────────────────────────────────────────────────────────

    def compute(self, data: dict, soh_estimate: float = 100.0) -> dict:
        """
        Ingest one telemetry reading and return the current risk assessment.

        Parameters
        ----------
        data         : dict — latest BMS telemetry (pack_voltage, pack_current,
                               temp_high, soc)
        soh_estimate : float — current state-of-health % (from RHF or default)

        Returns
        -------
        dict
            risk_score      : float  — 0–100
            derating_level  : str    — NORMAL | WARNING | CRITICAL
            derating_factor : float  — 1.0 | 0.85 | 0.60
            alert_flag      : bool   — True when derating_level != NORMAL
            subscores       : dict   — individual component scores
            timestamp       : str    — ISO8601 UTC
        """
        # Update rolling history
        self._voltages.append(float(data.get("pack_voltage", 48.0)))
        self._currents.append(float(data.get("pack_current",  0.0)))
        self._temps.append(   float(data.get("temp_high",    25.0)))
        self._socs.append(    float(data.get("soc",          50.0)))

        # Compute sub-scores
        subscores = {
            "voltage_fluctuation": round(self._score_voltage_fluctuation(), 1),
            "peak_c_rate":         round(self._score_peak_c_rate(),         1),
            "soh_trend":           round(self._score_soh_trend(soh_estimate), 1),
            "temp_spike":          round(self._score_temp_spike(),           1),
            "high_soc_dwell":      round(self._score_high_soc_dwell(),       1),
        }

        # Weighted aggregate
        risk_score = round(sum(_WEIGHTS[k] * v for k, v in subscores.items()), 1)

        if risk_score > 75.0:
            derating_level  = "CRITICAL"
            derating_factor = 0.60
        elif risk_score >= 50.0:
            derating_level  = "WARNING"
            derating_factor = 0.85
        else:
            derating_level  = "NORMAL"
            derating_factor = 1.00

        return {
            "risk_score":      risk_score,
            "derating_level":  derating_level,
            "derating_factor": derating_factor,
            "alert_flag":      derating_level != "NORMAL",
            "subscores":       subscores,
            "timestamp":       _utc_now(),
        }


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
