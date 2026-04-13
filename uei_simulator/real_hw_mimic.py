import random

from .bms_scenarios import BMSScenario
from .common import clamp


class RealHardwareMimic(BMSScenario):
    """
    Mimics a real LiFePO4 4S battery pack monitored by an Orion Jr 2 BMS on a
    Raspberry Pi.  The pack is at rest — no load connected — so only the BMS
    and Pi quiescent current (~0.5 A) flows.

    Cell voltages are seeded from real Orion Jr 2 readings:
        Cell 1: 3.31 V  Cell 2: 3.31 V  Cell 3: 3.28 V (weak)  Cell 4: 3.31 V
    All other fields are derived from those readings and known LiFePO4 4S
    characteristics at the flat plateau region (~75 % SOC).
    """

    def __init__(self):
        super().__init__()

        # ── Ground-truth initial state ────────────────────────────────────────
        self.soc                = 75.0
        self.pack_voltage       = 13.21
        self.pack_current       = -0.5
        self.temp_high          = 28.0
        self.temp_low           = 24.0
        self.ccl                = 40.0
        self.dcl                = 50.0
        self.fault_active       = False
        self.faults_cleared_min = 30.0
        self.highest_cell_v     = 3.31
        self.lowest_cell_v      = 3.28

        # ── Micro-event tracking ──────────────────────────────────────────────
        self._step_count        = 0
        self._next_micro_event  = random.randint(80, 120)

    # ── Step ─────────────────────────────────────────────────────────────────

    def step(self) -> dict:
        self._step_count += 1

        # ── Pack current: quiescent BMS + Pi draw ────────────────────────────
        self.pack_current = clamp(
            random.gauss(-0.5, 0.1),
            -1.5, 1.5,
        )

        # ── SOC: flat plateau, extremely slow drift ───────────────────────────
        self.soc += random.gauss(0.0, 0.01)
        self.soc  = clamp(self.soc, 0.0, 100.0)

        # ── Pack voltage: LiFePO4 plateau — very stable ───────────────────────
        self.pack_voltage = clamp(
            random.gauss(13.21, 0.008),
            8.0, 18.0,
        )

        # ── Cell voltages ─────────────────────────────────────────────────────
        self.highest_cell_v = clamp(
            random.gauss(3.31, 0.003),
            2.0, 4.5,
        )
        self.lowest_cell_v = clamp(
            random.gauss(3.28, 0.003),
            2.0, 4.5,
        )
        # Enforce highest >= lowest; maintain the characteristic ~0.03 V spread
        if self.highest_cell_v < self.lowest_cell_v:
            self.lowest_cell_v = self.highest_cell_v - 0.005

        # ── Temperatures: slow random walk with mean reversion ────────────────
        self.temp_high += (28.0 - self.temp_high) * 0.02
        self.temp_high += random.gauss(0.0, 0.05)
        self.temp_high  = clamp(self.temp_high, 26.0, 30.0)

        self.temp_low += (24.0 - self.temp_low) * 0.02
        self.temp_low += random.gauss(0.0, 0.04)
        self.temp_low  = clamp(self.temp_low, 22.0, 26.0)

        # Enforce temp_high > temp_low; push apart if they converge within 1 °C
        if self.temp_high - self.temp_low < 1.0:
            mid = (self.temp_high + self.temp_low) / 2.0
            self.temp_high = clamp(mid + 0.5, 22.0, 30.0)
            self.temp_low  = clamp(mid - 0.5, 22.0, 30.0)

        # ── CCL / DCL: stable BMS limits ──────────────────────────────────────
        self.ccl = clamp(random.gauss(40.0, 0.1), 0.0, 100.0)
        self.dcl = clamp(random.gauss(50.0, 0.1), 0.0, 120.0)

        # ── Fault state: always healthy ───────────────────────────────────────
        self.fault_active        = False
        self.faults_cleared_min += random.uniform(0.02, 0.05)
        self.faults_cleared_min  = clamp(self.faults_cleared_min, 0.0, 10000.0)

        # ── Micro-events: rare BMS artefacts for realism ─────────────────────
        if self._step_count >= self._next_micro_event:
            event = random.randint(1, 2)

            if event == 1:
                # BMS SOC micro-recalibration — internal recalc causes a tiny jump
                self.soc += random.uniform(-0.2, 0.2)
                self.soc  = clamp(self.soc, 0.0, 100.0)

            elif event == 2:
                # Cell voltage micro-rebalance — weak cell shifts briefly
                self.lowest_cell_v += random.uniform(-0.008, 0.008)
                self.lowest_cell_v  = clamp(self.lowest_cell_v, 2.0, 4.5)
                if self.highest_cell_v < self.lowest_cell_v:
                    self.lowest_cell_v = self.highest_cell_v - 0.005

            # Schedule next micro-event
            self._next_micro_event = self._step_count + random.randint(80, 120)

        # ── Final bounds enforcement + payload ───────────────────────────────
        self._clamp_all()
        return self._to_payload()
