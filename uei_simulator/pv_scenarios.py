import random

from .common import clamp


# ── Base class ────────────────────────────────────────────────────────────────

class PVScenario:
    """Base class for all PV simulation scenarios."""

    def __init__(self):
        # Default initial state — subclasses override these
        self.invr1 = 10.0
        self.invr2 = 9.5
        self.ld1   = 7.0
        self.ld2   = 6.5
        self.ld3   = 8.0
        self.ld4   = 5.5
        self.bv1   = 13.0
        self.bv2   = 12.9
        self._step_count = 0

    def _apply_physics(self):
        """Adjust voltage based on load vs generation balance."""
        total_pv  = self.invr1 + self.invr2
        total_load = self.ld1 + self.ld2 + self.ld3 + self.ld4
        if total_pv < 0.5:
            # No generation — voltage sags
            self.bv1 += random.uniform(-0.15, -0.05)
            self.bv2 += random.uniform(-0.15, -0.05)
        elif total_load > total_pv * 1.3:
            # Load exceeds generation — slight voltage drop
            self.bv1 += random.uniform(-0.10, -0.02)
            self.bv2 += random.uniform(-0.10, -0.02)
        else:
            # Balanced or excess generation — voltage stable/recovering
            self.bv1 += random.uniform(-0.03, 0.05)
            self.bv2 += random.uniform(-0.03, 0.05)

    def _clamp_all(self):
        """Clamp all values to valid physical ranges."""
        self.invr1 = clamp(self.invr1, 0.0, 20.0)
        self.invr2 = clamp(self.invr2, 0.0, 20.0)
        self.ld1   = clamp(self.ld1,   0.0, 25.0)
        self.ld2   = clamp(self.ld2,   0.0, 25.0)
        self.ld3   = clamp(self.ld3,   0.0, 25.0)
        self.ld4   = clamp(self.ld4,   0.0, 25.0)
        self.bv1   = clamp(self.bv1,   0.0, 18.0)
        self.bv2   = clamp(self.bv2,   0.0, 18.0)

    def _to_payload(self) -> dict:
        """Return telemetry fields only. runner.py adds ts_utc, node_id, pv_id."""
        return {
            "invr1": round(self.invr1, 3),
            "invr2": round(self.invr2, 3),
            "ld1":   round(self.ld1,   3),
            "ld2":   round(self.ld2,   3),
            "ld3":   round(self.ld3,   3),
            "ld4":   round(self.ld4,   3),
            "bv1":   round(self.bv1,   3),
            "bv2":   round(self.bv2,   3),
        }

    def step(self) -> dict:
        raise NotImplementedError


# ── 1. Normal Operation ───────────────────────────────────────────────────────

class NormalOperation(PVScenario):
    """Smooth, stable baseline — all fields drift with small random noise."""

    def __init__(self):
        super().__init__()

    def step(self) -> dict:
        self.invr1 += random.uniform(-0.5, 0.5)
        self.invr2 += random.uniform(-0.5, 0.5)
        self.ld1   += random.uniform(-0.5, 0.5)
        self.ld2   += random.uniform(-0.5, 0.5)
        self.ld3   += random.uniform(-0.5, 0.5)
        self.ld4   += random.uniform(-0.5, 0.5)
        self.bv1   += random.uniform(-0.2, 0.2)
        self.bv2   += random.uniform(-0.2, 0.2)
        self._apply_physics()
        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 2. Low PV Generation ──────────────────────────────────────────────────────

class LowPVGeneration(PVScenario):
    """Inverter output drifts down over time (simulates cloud cover)."""

    def __init__(self):
        super().__init__()
        self.bv1 = 12.8
        self.bv2 = 12.7

    def step(self) -> dict:
        # Inverters steadily lose output + normal noise
        self.invr1 -= random.uniform(0.05, 0.15)
        self.invr2 -= random.uniform(0.05, 0.15)
        self.invr1 += random.uniform(-0.5, 0.5)
        self.invr2 += random.uniform(-0.5, 0.5)
        # Once low, hold in the 2–5 A range
        self.invr1 = clamp(self.invr1, 2.0, 5.0) if self.invr1 < 5.0 else self.invr1
        self.invr2 = clamp(self.invr2, 2.0, 5.0) if self.invr2 < 5.0 else self.invr2
        # Loads stay normal
        self.ld1 += random.uniform(-0.5, 0.5)
        self.ld2 += random.uniform(-0.5, 0.5)
        self.ld3 += random.uniform(-0.5, 0.5)
        self.ld4 += random.uniform(-0.5, 0.5)
        self._apply_physics()
        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 3. Load Spike ─────────────────────────────────────────────────────────────

class LoadSpike(PVScenario):
    """Periodic high-current load spikes on ld1 and ld2."""

    def __init__(self):
        super().__init__()
        self._spike_active    = False
        self._spike_remaining = 0
        self._next_spike_in   = random.randint(15, 25)

    def step(self) -> dict:
        # Manage spike state machine
        if self._spike_active:
            self.ld1 = random.uniform(15.0, 20.0)
            self.ld2 = random.uniform(15.0, 20.0)
            self._spike_remaining -= 1
            if self._spike_remaining <= 0:
                self._spike_active  = False
                self._next_spike_in = random.randint(15, 25)
        else:
            self._next_spike_in -= 1
            if self._next_spike_in <= 0:
                self._spike_active    = True
                self._spike_remaining = random.randint(5, 8)
                self.ld1 = random.uniform(15.0, 20.0)
                self.ld2 = random.uniform(15.0, 20.0)
            else:
                self.ld1 += random.uniform(-0.5, 0.5)
                self.ld2 += random.uniform(-0.5, 0.5)

        # PV and other loads are always normal
        self.invr1 += random.uniform(-0.5, 0.5)
        self.invr2 += random.uniform(-0.5, 0.5)
        self.ld3   += random.uniform(-0.5, 0.5)
        self.ld4   += random.uniform(-0.5, 0.5)
        self._apply_physics()
        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 4. Output Instability ─────────────────────────────────────────────────────

class OutputInstability(PVScenario):
    """Inverter output oscillates wildly; loads remain stable."""

    def __init__(self):
        super().__init__()

    def step(self) -> dict:
        # Large random jumps on inverters
        self.invr1 += random.uniform(-4.0, 4.0)
        self.invr2 += random.uniform(-4.0, 4.0)
        # Normal load noise
        self.ld1 += random.uniform(-0.5, 0.5)
        self.ld2 += random.uniform(-0.5, 0.5)
        self.ld3 += random.uniform(-0.5, 0.5)
        self.ld4 += random.uniform(-0.5, 0.5)
        self._apply_physics()
        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 5. Overvoltage ────────────────────────────────────────────────────────────

class Overvoltage(PVScenario):
    """Bus voltages trend upward unchecked (simulates voltage regulator failure)."""

    def __init__(self):
        super().__init__()

    def _apply_physics(self):
        # Override: ignore load/generation balance, keep upward trend
        self.bv1 += random.uniform(0.05, 0.20)
        self.bv2 += random.uniform(0.05, 0.20)
        self.bv1 = clamp(self.bv1, 0.0, 16.0)
        self.bv2 = clamp(self.bv2, 0.0, 16.0)

    def step(self) -> dict:
        self.invr1 += random.uniform(-0.5, 0.5)
        self.invr2 += random.uniform(-0.5, 0.5)
        self.ld1   += random.uniform(-0.5, 0.5)
        self.ld2   += random.uniform(-0.5, 0.5)
        self.ld3   += random.uniform(-0.5, 0.5)
        self.ld4   += random.uniform(-0.5, 0.5)
        self._apply_physics()
        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 6. Sensor Fault ───────────────────────────────────────────────────────────

class SensorFault(PVScenario):
    """Random fields periodically replaced with out-of-range garbage values."""

    _CURRENT_FIELDS = ("invr1", "invr2", "ld1", "ld2", "ld3", "ld4")
    _VOLTAGE_FIELDS = ("bv1", "bv2")
    _ALL_FIELDS     = _CURRENT_FIELDS + _VOLTAGE_FIELDS

    def __init__(self):
        super().__init__()
        self._next_fault_in = random.randint(3, 6)

    def step(self) -> dict:
        self._next_fault_in -= 1

        if self._next_fault_in <= 0:
            # Fault step: corrupt 1–3 random fields (skip physics — values are nonsensical)
            num_faults = random.randint(1, 3)
            for field in random.sample(self._ALL_FIELDS, num_faults):
                if field in self._VOLTAGE_FIELDS:
                    setattr(self, field, random.uniform(8.0, 18.0))
                else:
                    setattr(self, field, random.uniform(0.0, 30.0))
            self._next_fault_in = random.randint(3, 6)
        else:
            # Normal step
            self.invr1 += random.uniform(-0.5, 0.5)
            self.invr2 += random.uniform(-0.5, 0.5)
            self.ld1   += random.uniform(-0.5, 0.5)
            self.ld2   += random.uniform(-0.5, 0.5)
            self.ld3   += random.uniform(-0.5, 0.5)
            self.ld4   += random.uniform(-0.5, 0.5)
            self.bv1   += random.uniform(-0.2, 0.2)
            self.bv2   += random.uniform(-0.2, 0.2)
            self._apply_physics()

        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 7. Gradual Degradation ────────────────────────────────────────────────────

class GradualDegradation(PVScenario):
    """Inverter output decreases very slowly over hundreds of steps (dust/aging)."""

    def __init__(self):
        super().__init__()
        self.invr1 = 12.0
        self.invr2 = 11.5

    def step(self) -> dict:
        # Very slow decline — ~200+ steps to drop from 12A to 6A
        self.invr1 -= random.uniform(0.01, 0.04)
        self.invr2 -= random.uniform(0.01, 0.04)
        # Loads stable with normal noise
        self.ld1 += random.uniform(-0.5, 0.5)
        self.ld2 += random.uniform(-0.5, 0.5)
        self.ld3 += random.uniform(-0.5, 0.5)
        self.ld4 += random.uniform(-0.5, 0.5)
        self._apply_physics()
        self._clamp_all()
        self._step_count += 1
        return self._to_payload()


# ── 8. All-Zero Disconnect ────────────────────────────────────────────────────

class AllZeroDisconnect(PVScenario):
    """Normal for 5 steps, then instant complete shutdown — all zeros forever."""

    def __init__(self):
        super().__init__()
        self._disconnected = False

    def step(self) -> dict:
        self._step_count += 1

        if self._step_count > 5:
            # Hard disconnect — zero everything, no noise
            self._disconnected = True
            self.invr1 = self.invr2 = 0.0
            self.ld1   = self.ld2   = self.ld3 = self.ld4 = 0.0
            self.bv1   = self.bv2   = 0.0
            return self._to_payload()

        # First 5 steps: normal operation
        self.invr1 += random.uniform(-0.5, 0.5)
        self.invr2 += random.uniform(-0.5, 0.5)
        self.ld1   += random.uniform(-0.5, 0.5)
        self.ld2   += random.uniform(-0.5, 0.5)
        self.ld3   += random.uniform(-0.5, 0.5)
        self.ld4   += random.uniform(-0.5, 0.5)
        self.bv1   += random.uniform(-0.2, 0.2)
        self.bv2   += random.uniform(-0.2, 0.2)
        self._apply_physics()
        self._clamp_all()
        return self._to_payload()


# ── Scenario registry ─────────────────────────────────────────────────────────

PV_SCENARIOS = {
    1: NormalOperation,
    2: LowPVGeneration,
    3: LoadSpike,
    4: OutputInstability,
    5: Overvoltage,
    6: SensorFault,
    7: GradualDegradation,
    8: AllZeroDisconnect,
}
