import random

from .common import clamp


# ── Base class ────────────────────────────────────────────────────────────────

class BMSScenario:
    """Base class for all BMS simulation scenarios."""

    def __init__(self):
        # Default initial state — subclasses override these
        self.soc               = 70.0
        self.pack_voltage      = 13.2
        self.pack_current      = -5.0
        self.temp_high         = 30.0
        self.temp_low          = 26.0
        self.ccl               = 40.0
        self.dcl               = 50.0
        self.fault_active      = False
        self.faults_cleared_min = 10.0
        self.highest_cell_v    = 3.34
        self.lowest_cell_v     = 3.30
        self._step_count       = 0

    def _apply_physics(self):
        """Update derived values based on current electrical and thermal state."""
        # SOC changes proportionally to current (negative = discharge)
        self.soc += self.pack_current * 0.003

        # Pack voltage: sag under discharge, rise under charge
        if self.pack_current < 0:
            self.pack_voltage += random.uniform(-0.04, 0.01)
        else:
            self.pack_voltage += random.uniform(-0.01, 0.04)

        # Temperature: rises with current magnitude, cools slowly toward ambient
        heat = abs(self.pack_current) * random.uniform(0.005, 0.015)
        self.temp_high += heat - random.uniform(0.01, 0.04)
        self.temp_low  += heat - random.uniform(0.01, 0.04)

        # temp_low must always be below temp_high
        if self.temp_low >= self.temp_high:
            self.temp_low = self.temp_high - random.uniform(0.5, 2.0)

        # Cell voltages track pack_voltage / 4 with a small spread
        cell_mid = self.pack_voltage / 4.0
        spread   = random.uniform(0.02, 0.06)
        self.highest_cell_v = cell_mid + spread / 2
        self.lowest_cell_v  = cell_mid - spread / 2

        # Low SOC reduces discharge limit
        if self.soc < 20.0:
            self.dcl = self.dcl * (self.soc / 20.0)

        # High temperature reduces both limits
        if self.temp_high > 45.0:
            factor = max(0.2, 1.0 - (self.temp_high - 45.0) * 0.04)
            self.ccl = self.ccl * factor
            self.dcl = self.dcl * factor

        # Fault lock: severely restrict limits when fault is active
        if self.fault_active:
            self.ccl = min(self.ccl, 10.0)
            self.dcl = min(self.dcl, 10.0)
            self.faults_cleared_min = 0.0
        else:
            # Tick up time-since-fault counter (each step ≈ period seconds / 60)
            self.faults_cleared_min += random.uniform(0.01, 0.05)

    def _clamp_all(self):
        """Clamp every field to its valid physical range."""
        self.soc               = clamp(self.soc,               0.0,  100.0)
        self.pack_voltage      = clamp(self.pack_voltage,      11.0,  14.6)
        self.pack_current      = clamp(self.pack_current,      -50.0,  30.0)
        self.temp_high         = clamp(self.temp_high,          20.0,  65.0)
        self.temp_low          = clamp(self.temp_low,           15.0,  55.0)
        self.ccl               = clamp(self.ccl,                0.0,  50.0)
        self.dcl               = clamp(self.dcl,                0.0,  60.0)
        self.faults_cleared_min = clamp(self.faults_cleared_min, 0.0, 9999.0)
        self.highest_cell_v    = clamp(self.highest_cell_v,     2.8,   3.65)
        self.lowest_cell_v     = clamp(self.lowest_cell_v,      2.5,   3.6)
        # Cell ordering invariant
        if self.lowest_cell_v > self.highest_cell_v:
            self.lowest_cell_v = self.highest_cell_v - 0.01

    def _to_payload(self) -> dict:
        """Return telemetry fields only. runner.py adds ts_utc, node_id, bms_id."""
        return {
            "soc":                round(self.soc,                2),
            "pack_voltage":       round(self.pack_voltage,       3),
            "pack_current":       round(self.pack_current,       3),
            "temp_high":          round(self.temp_high,          2),
            "temp_low":           round(self.temp_low,           2),
            "ccl":                round(self.ccl,                1),
            "dcl":                round(self.dcl,                1),
            "fault_active":       bool(self.fault_active),
            "faults_cleared_min": round(self.faults_cleared_min, 2),
            "highest_cell_v":     round(self.highest_cell_v,     3),
            "lowest_cell_v":      round(self.lowest_cell_v,      3),
        }

    def step(self) -> dict:
        raise NotImplementedError


# ── 1. Normal Operation ───────────────────────────────────────────────────────

class NormalOperation(BMSScenario):
    """Stable baseline — light discharge with small noise on all fields."""

    def __init__(self):
        super().__init__()
        self.pack_current      = -3.0
        self.faults_cleared_min = 15.0

    def step(self) -> dict:
        # Current drifts mildly in a shallow discharge range
        self.pack_current  += random.uniform(-1.0, 1.0)
        self.pack_current   = clamp(self.pack_current, -5.0, 5.0)
        self.pack_voltage  += random.uniform(-0.05, 0.05)
        self.temp_high     += random.uniform(-0.3, 0.3)
        self.temp_low      += random.uniform(-0.3, 0.3)
        self._apply_physics()
        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 2. Low Battery ────────────────────────────────────────────────────────────

class LowBattery(BMSScenario):
    """SOC drains steadily; voltage sags, dcl tightens, cell gap widens."""

    def __init__(self):
        super().__init__()
        self.soc              = 18.0
        self.pack_voltage     = 12.2
        self.pack_current     = -15.0
        self.temp_high        = 32.0
        self.temp_low         = 28.0
        self.ccl              = 15.0
        self.dcl              = 15.0
        self.faults_cleared_min = 5.0
        self.highest_cell_v   = 3.10
        self.lowest_cell_v    = 2.95

    def step(self) -> dict:
        # Heavy discharge — stays in -10 to -25 A
        self.pack_current += random.uniform(-1.0, 1.0)
        self.pack_current  = clamp(self.pack_current, -25.0, -10.0)

        self._apply_physics()

        # Widen cell gap at low SOC
        spread = random.uniform(0.05, 0.15)
        cell_mid = self.pack_voltage / 4.0
        self.highest_cell_v = cell_mid + spread / 2
        self.lowest_cell_v  = cell_mid - spread / 2

        self._clamp_all()
        self._step_count += 1

        # Reset for continuous demo when empty
        if self.soc < 5.0:
            self.soc          = 18.0
            self.pack_voltage = 12.2
            self.pack_current = -15.0

        return self._to_payload()


# ── 3. High Temperature ───────────────────────────────────────────────────────

class HighTemperature(BMSScenario):
    """Temperature climbs; BMS raises fault and throttles current limits."""

    def __init__(self):
        super().__init__()
        self.soc            = 55.0
        self.pack_voltage   = 12.8
        self.pack_current   = -15.0
        self.temp_high      = 46.0
        self.temp_low       = 38.0
        self.ccl            = 15.0
        self.dcl            = 25.0
        self.fault_active   = True
        self.faults_cleared_min = 0.0
        self.highest_cell_v = 3.24
        self.lowest_cell_v  = 3.20

    def step(self) -> dict:
        # Temperature climbs unless already at the ceiling
        if self.temp_high < 55.0:
            self.temp_high += random.uniform(0.1, 0.5)
        else:
            # Oscillate in the 55–60 range
            self.temp_high += random.uniform(-0.5, 0.5)

        self.temp_low += random.uniform(-0.2, 0.2)

        # Fault persists while hot
        self.fault_active = self.temp_high > 45.0

        # Throttle limits under heat
        if self.temp_high > 45.0:
            self.ccl = clamp(self.ccl + random.uniform(-0.5, 0.5), 5.0, 15.0)
            self.dcl = clamp(self.dcl + random.uniform(-0.5, 0.5), 10.0, 25.0)

        # Current limited by reduced dcl
        self.pack_current += random.uniform(-1.0, 1.0)
        self.pack_current  = clamp(self.pack_current, -self.dcl, 0.0)

        self.pack_voltage += random.uniform(-0.05, 0.05)
        self._apply_physics()
        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 4. High Discharge Stress ──────────────────────────────────────────────────

class HighDischargeStress(BMSScenario):
    """Sustained heavy discharge — voltage sags, temperature climbs, SOC drains fast."""

    def __init__(self):
        super().__init__()
        self.soc              = 55.0
        self.pack_voltage     = 12.4
        self.pack_current     = -35.0
        self.temp_high        = 36.0
        self.temp_low         = 30.0
        self.ccl              = 25.0
        self.dcl              = 25.0
        self.faults_cleared_min = 8.0
        self.highest_cell_v   = 3.18
        self.lowest_cell_v    = 3.05

    def step(self) -> dict:
        # Heavy, noisy discharge
        self.pack_current += random.uniform(-1.0, 1.0)
        self.pack_current  = clamp(self.pack_current, -50.0, -25.0)

        self._apply_physics()

        # Probabilistic fault trigger under sustained thermal stress
        if self.temp_high > 50.0 and not self.fault_active:
            self.fault_active = random.random() < 0.05  # 5% per step above 50°C

        self._clamp_all()
        self._step_count += 1

        # Reset for continuous demo
        if self.soc < 10.0:
            self.soc          = 55.0
            self.pack_voltage = 12.4
            self.pack_current = -35.0
            self.fault_active = False

        return self._to_payload()


# ── 5. Cell Imbalance ─────────────────────────────────────────────────────────

class CellImbalance(BMSScenario):
    """Large, sustained gap between highest and lowest cell voltage — fault latched."""

    def __init__(self):
        super().__init__()
        self.soc              = 60.0
        self.pack_voltage     = 13.0
        self.pack_current     = -8.0
        self.temp_high        = 30.0
        self.temp_low         = 26.0
        self.ccl              = 30.0
        self.dcl              = 35.0
        self.fault_active     = True
        self.faults_cleared_min = 0.0
        self.highest_cell_v   = 3.58
        self.lowest_cell_v    = 2.95

    def _apply_physics(self):
        """Override base — maintain imbalanced cell spread independently of pack_voltage."""
        # SOC and voltage evolve normally
        self.soc          += self.pack_current * 0.003
        self.pack_voltage += random.uniform(-0.04, 0.01) if self.pack_current < 0 else random.uniform(-0.01, 0.04)

        # Thermal
        heat = abs(self.pack_current) * random.uniform(0.005, 0.015)
        self.temp_high += heat - random.uniform(0.01, 0.04)
        self.temp_low  += heat - random.uniform(0.01, 0.04)
        if self.temp_low >= self.temp_high:
            self.temp_low = self.temp_high - random.uniform(0.5, 2.0)

        # Cell voltages: imbalanced, independent of pack_voltage/4
        self.highest_cell_v += random.uniform(-0.02, 0.02)
        self.highest_cell_v  = clamp(self.highest_cell_v, 3.50, 3.65)
        self.lowest_cell_v  += random.uniform(-0.02, 0.02)
        self.lowest_cell_v   = clamp(self.lowest_cell_v,  2.90, 3.10)

        # Fault stays latched due to imbalance
        self.fault_active = True
        self.faults_cleared_min = 0.0

        # Slightly reduced limits due to fault
        if self.fault_active:
            self.ccl = min(self.ccl, 30.0)
            self.dcl = min(self.dcl, 35.0)
            self.faults_cleared_min = 0.0

    def step(self) -> dict:
        self.pack_current += random.uniform(-1.0, 1.0)
        self.pack_current  = clamp(self.pack_current, -12.0, -4.0)
        self._apply_physics()
        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 6. Degradation ────────────────────────────────────────────────────────────

class Degradation(BMSScenario):
    """Very slow capacity and limit decay — simulates aging over hundreds of steps."""

    def __init__(self):
        super().__init__()
        self.soc              = 65.0
        self.pack_voltage     = 13.0
        self.pack_current     = -6.0
        self.temp_high        = 28.0
        self.temp_low         = 24.0
        self.ccl              = 38.0
        self.dcl              = 48.0
        self.faults_cleared_min = 30.0
        self.highest_cell_v   = 3.30
        self.lowest_cell_v    = 3.26
        # Track the slowly widening cell gap
        self._cell_spread = 0.04

    def step(self) -> dict:
        self.pack_current += random.uniform(-1.0, 1.0)
        self.pack_current  = clamp(self.pack_current, -10.0, -2.0)

        # Slow capacity degradation — limits decline over ~400 steps
        self.ccl -= random.uniform(0.01, 0.04)
        self.dcl -= random.uniform(0.01, 0.04)

        # Widen cell gap slowly (internal resistance growing)
        self._cell_spread = clamp(self._cell_spread + random.uniform(0.0002, 0.001), 0.04, 0.12)

        # Internal resistance causes slight temp rise over time
        self.temp_high += random.uniform(0.0, 0.02)

        self._apply_physics()

        # Override cell voltages with the degradation-specific spread
        cell_mid = self.pack_voltage / 4.0
        self.highest_cell_v = cell_mid + self._cell_spread / 2
        self.lowest_cell_v  = cell_mid - self._cell_spread / 2

        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 7. Fault Active ───────────────────────────────────────────────────────────

class FaultActive(BMSScenario):
    """Battery permanently in protection lockout — near-zero current, limits clamped low."""

    def __init__(self):
        super().__init__()
        self.soc              = 45.0
        self.pack_voltage     = 12.6
        self.pack_current     = -1.0
        self.temp_high        = 42.0
        self.temp_low         = 36.0
        self.ccl              = 5.0
        self.dcl              = 5.0
        self.fault_active     = True
        self.faults_cleared_min = 0.0
        self.highest_cell_v   = 3.22
        self.lowest_cell_v    = 3.10

    def step(self) -> dict:
        # Battery is protection-limited — tiny noise, no meaningful drift
        self.pack_current += random.uniform(-0.3, 0.3)
        self.pack_current  = clamp(self.pack_current, -2.0, 0.5)
        self.pack_voltage += random.uniform(-0.02, 0.02)
        self.temp_high    += random.uniform(-0.1, 0.1)
        self.temp_low     += random.uniform(-0.1, 0.1)

        # Fault and limits are permanently locked
        self.fault_active       = True
        self.faults_cleared_min = 0.0
        self.ccl = clamp(self.ccl + random.uniform(-0.5, 0.5), 0.0, 10.0)
        self.dcl = clamp(self.dcl + random.uniform(-0.5, 0.5), 0.0, 10.0)

        self._apply_physics()
        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 8. Fault Recovery ─────────────────────────────────────────────────────────

class FaultRecovery(BMSScenario):
    """Two-phase recovery: fault clears as temperature drops, limits gradually restore."""

    # Step threshold for phase transition (overridden by temp condition)
    _PHASE_2_STEP = 20

    def __init__(self):
        super().__init__()
        self.soc              = 45.0
        self.pack_voltage     = 12.6
        self.pack_current     = -1.0
        self.temp_high        = 48.0
        self.temp_low         = 40.0
        self.ccl              = 5.0
        self.dcl              = 8.0
        self.fault_active     = True
        self.faults_cleared_min = 0.0
        self.highest_cell_v   = 3.22
        self.lowest_cell_v    = 3.10
        self._phase           = 1
        self._cell_spread     = 0.12  # starts wider, narrows toward normal

    def step(self) -> dict:
        self._step_count += 1

        if self._phase == 1:
            # ── Phase 1: fault active, cooling down ───────────────────────
            self.temp_high -= random.uniform(0.3, 0.8)
            self.temp_low  -= random.uniform(0.2, 0.6)
            self.pack_current += random.uniform(-0.2, 0.2)
            self.pack_current  = clamp(self.pack_current, -2.0, 0.5)
            self.fault_active        = True
            self.faults_cleared_min  = 0.0

            # Transition to Phase 2 once cool enough
            if self.temp_high < 38.0 or self._step_count >= self._PHASE_2_STEP:
                self._phase = 2
                self.fault_active = False

        else:
            # ── Phase 2: fault cleared, gradual restoration ───────────────
            self.fault_active = False

            # Limits climb back toward normal
            self.ccl = clamp(self.ccl + random.uniform(0.5, 1.5), 0.0, 40.0)
            self.dcl = clamp(self.dcl + random.uniform(0.5, 1.5), 0.0, 50.0)

            # Temperature continues cooling toward 28–32 °C
            if self.temp_high > 32.0:
                self.temp_high -= random.uniform(0.1, 0.4)
            else:
                self.temp_high += random.uniform(-0.2, 0.2)

            self.temp_low -= random.uniform(0.05, 0.2)

            # Current returns toward normal light discharge
            target = random.uniform(-8.0, -3.0)
            self.pack_current += (target - self.pack_current) * 0.1
            self.pack_current += random.uniform(-0.3, 0.3)

            # Cell spread narrows slowly toward normal
            self._cell_spread = max(0.04, self._cell_spread - random.uniform(0.002, 0.006))

        self.pack_voltage += random.uniform(-0.05, 0.05)
        self._apply_physics()

        # Override cell voltages with scenario-specific spread
        cell_mid = self.pack_voltage / 4.0
        self.highest_cell_v = cell_mid + self._cell_spread / 2
        self.lowest_cell_v  = cell_mid - self._cell_spread / 2

        self._clamp_all()
        return self._to_payload()


# ── Scenario registry ─────────────────────────────────────────────────────────

from .real_hw_mimic import RealHardwareMimic

BMS_SCENARIOS = {
    1: NormalOperation,
    2: LowBattery,
    3: HighTemperature,
    4: HighDischargeStress,
    5: CellImbalance,
    6: Degradation,
    7: FaultActive,
    8: FaultRecovery,
    9: RealHardwareMimic,
}
