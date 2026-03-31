"""
algorithms/rhf.py — Rolling Health Forecast (RHF)

Cloud-side scheduled algorithm. Reads 30 days of telemetry from PostgreSQL,
computes per-day stress scores, estimates current State-of-Health (SoH), and
forecasts SoH at 30 / 60 / 90 days using linear regression over daily deltas.

Invoked by rhf_job.py:
    python3 rhf_job.py [--db-host <host>] [--node-id <id>]

Algorithm outline
-----------------
1. Load the last 30 days of telemetry for each BMS node.
2. Group rows by UTC date.
3. For each day, compute a stress score:
     base_daily_loss = 0.005 %SoH      (≈ 1.8 %/year at rest)
     multipliers applied for:
       • avg temp > 35 / 45 / 55 °C
       • high-SoC dwell (> 20 % of readings above 90 % SoC)
       • deep cycling  (daily DoD > 70 %)
4. Sum daily losses → total_degradation over the window.
5. Anchor on the previous stored SoH (or 100 % if first run).
6. Fit OLS linear regression to the array of daily losses.
7. Extrapolate the trend to produce 30 / 60 / 90-day forecasts.

Output per node
---------------
{ node_id, bms_id, current_soh,
  forecast_30d, forecast_60d, forecast_90d,
  daily_stress_summary, computed_at }
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

# ── Degradation model constants ───────────────────────────────────────────────

_BASE_LOSS_PER_DAY  = 0.005   # % SoH / day at rest (no stress)
_INITIAL_SOH        = 100.0   # assumed for first-run nodes

# Temperature stress tiers — checked highest-first; first match wins
_TEMP_TIERS = [
    (55.0, 3.0),   # avg_temp_high > 55 °C → 3× degradation
    (45.0, 2.0),   # avg_temp_high > 45 °C → 2×
    (35.0, 1.5),   # avg_temp_high > 35 °C → 1.5×
]
_HIGH_SOC_THRESHOLD   = 90.0  # SoC % considered "high"
_HIGH_SOC_DWELL_FRAC  = 0.20  # fraction of day at high SoC that triggers penalty
_HIGH_SOC_MULT        = 1.30  # +30 % degradation
_DEEP_CYCLE_DOD       = 70.0  # daily DoD % considered deep cycling
_DEEP_CYCLE_MULT      = 1.25  # +25 % degradation


# ── OLS linear regression (stdlib-only) ──────────────────────────────────────

def _ols(x: list[float], y: list[float]) -> tuple[float, float]:
    """Return (slope, intercept) for ordinary least-squares regression."""
    n = len(x)
    if n < 2:
        return 0.0, (y[0] if y else _BASE_LOSS_PER_DAY)
    sx   = sum(x)
    sy   = sum(y)
    sxy  = sum(xi * yi for xi, yi in zip(x, y))
    sx2  = sum(xi * xi for xi in x)
    denom = n * sx2 - sx * sx
    if abs(denom) < 1e-12:
        return 0.0, sy / n
    slope     = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    return slope, intercept


# ── Per-day stress computation ────────────────────────────────────────────────

def _day_stress(rows: list[dict]) -> dict:
    """
    Compute stress metrics and daily SoH loss for one day's telemetry rows.

    Parameters
    ----------
    rows : list of dicts with at least temp_high, soc fields

    Returns
    -------
    dict with avg_temp_high, max_temp_high, dod,
         high_soc_dwell_frac, soh_delta
    """
    if not rows:
        return {
            "avg_temp_high": 25.0, "max_temp_high": 25.0,
            "dod": 0.0, "high_soc_dwell_frac": 0.0,
            "soh_delta": _BASE_LOSS_PER_DAY,
        }

    temps = [r["temp_high"] for r in rows if r.get("temp_high") is not None]
    socs  = [r["soc"]       for r in rows if r.get("soc")       is not None]

    avg_temp = sum(temps) / len(temps) if temps else 25.0
    max_temp = max(temps)              if temps else 25.0
    dod      = (max(socs) - min(socs)) if len(socs) >= 2 else 0.0
    high_soc_dwell = (
        sum(1 for s in socs if s > _HIGH_SOC_THRESHOLD) / len(socs)
        if socs else 0.0
    )

    # Build stress multiplier
    stress = 1.0
    for threshold, mult in _TEMP_TIERS:
        if avg_temp >= threshold:
            stress *= mult
            break
    if high_soc_dwell > _HIGH_SOC_DWELL_FRAC:
        stress *= _HIGH_SOC_MULT
    if dod > _DEEP_CYCLE_DOD:
        stress *= _DEEP_CYCLE_MULT

    return {
        "avg_temp_high":      round(avg_temp,        2),
        "max_temp_high":      round(max_temp,        2),
        "dod":                round(dod,             2),
        "high_soc_dwell_frac": round(high_soc_dwell, 3),
        "soh_delta":          round(_BASE_LOSS_PER_DAY * stress, 5),
    }


# ── Main forecast class ───────────────────────────────────────────────────────

class RollingHealthForecast:
    """
    Rolling Health Forecast (RHF).

    Usage::

        rhf = RollingHealthForecast()
        result = rhf.forecast(
            node_id      = "pi_bms_real",
            bms_id       = "OrionJr2_001",
            rows         = telemetry_rows,   # sorted ts_utc ASC
            previous_soh = 97.5,             # last stored SoH, or None
        )
    """

    def forecast(
        self,
        node_id:      str,
        bms_id:       str,
        rows:         list[dict],
        previous_soh: Optional[float] = None,
    ) -> dict:
        """
        Estimate current SoH and forecast 30 / 60 / 90 days out.

        Parameters
        ----------
        node_id      : node identifier
        bms_id       : BMS hardware identifier
        rows         : telemetry dicts (fields: ts_utc, soc, temp_high)
        previous_soh : last known SoH from DB; None → assume 100 %

        Returns
        -------
        dict with node_id, bms_id, current_soh, forecast_30d, forecast_60d,
             forecast_90d, daily_stress_summary, computed_at
        """
        anchor = previous_soh if previous_soh is not None else _INITIAL_SOH

        if not rows:
            return self._empty(node_id, bms_id, anchor)

        # ── Group by UTC date ─────────────────────────────────────────────────
        by_day: dict[str, list] = defaultdict(list)
        for r in rows:
            ts = r.get("ts_utc")
            if ts is None:
                continue
            day = ts.date().isoformat() if hasattr(ts, "date") else str(ts)[:10]
            by_day[day].append(r)

        days = sorted(by_day.keys())
        if not days:
            return self._empty(node_id, bms_id, anchor)

        # ── Daily stress scores ───────────────────────────────────────────────
        stresses   = [_day_stress(by_day[d]) for d in days]
        deltas     = [s["soh_delta"] for s in stresses]
        total_loss = sum(deltas)

        current_soh = round(max(anchor - total_loss, 0.0), 2)

        # ── OLS linear regression → extrapolate trend ─────────────────────────
        x = list(range(len(deltas)))
        slope, intercept = _ols(x, deltas)

        def _forecast(n_days: int) -> float:
            """Project SoH n_days ahead using the fitted trend."""
            future = [
                max(intercept + slope * (len(x) + i), 0.0)
                for i in range(n_days)
            ]
            return round(max(current_soh - sum(future), 0.0), 2)

        n = len(stresses)
        summary = {
            "days_analyzed":      n,
            "avg_daily_soh_loss": round(total_loss / n, 5),
            "avg_temp_high":      round(sum(s["avg_temp_high"] for s in stresses) / n, 2),
            "max_temp_high":      round(max(s["max_temp_high"] for s in stresses), 2),
            "avg_dod":            round(sum(s["dod"] for s in stresses) / n, 2),
            "trend_slope":        round(slope, 6),   # positive = accelerating degradation
        }

        return {
            "node_id":              node_id,
            "bms_id":               bms_id,
            "current_soh":          current_soh,
            "forecast_30d":         _forecast(30),
            "forecast_60d":         _forecast(60),
            "forecast_90d":         _forecast(90),
            "daily_stress_summary": summary,
            "computed_at":          _utc_now(),
        }

    # ── Fallback when there is no telemetry to analyse ────────────────────────

    def _empty(self, node_id: str, bms_id: str, soh: float) -> dict:
        return {
            "node_id":              node_id,
            "bms_id":               bms_id,
            "current_soh":          round(soh, 2),
            "forecast_30d":         round(max(soh - 30 * _BASE_LOSS_PER_DAY, 0.0), 2),
            "forecast_60d":         round(max(soh - 60 * _BASE_LOSS_PER_DAY, 0.0), 2),
            "forecast_90d":         round(max(soh - 90 * _BASE_LOSS_PER_DAY, 0.0), 2),
            "daily_stress_summary": {"days_analyzed": 0},
            "computed_at":          _utc_now(),
        }


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
