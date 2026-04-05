import sys

from .common import clear_screen, BMS_ENDPOINT, PV_ENDPOINT

# ── Display names shown in the menus ──────────────────────────────────────────

_BMS_SCENARIO_NAMES = {
    1: "Normal Operation",
    2: "Low Battery",
    3: "High Temperature",
    4: "High Discharge Stress",
    5: "Cell Imbalance",
    6: "Degradation",
    7: "Fault Active",
    8: "Fault Recovery",
}

_PV_SCENARIO_NAMES = {
    1: "Normal Operation",
    2: "Low PV Generation",
    3: "Load Spike",
    4: "Output Instability",
    5: "Overvoltage",
    6: "Sensor Fault",
    7: "Gradual Degradation",
    8: "All-Zero Disconnect",
}

# ── Class name mapping (for import by index) ──────────────────────────────────

_BMS_CLASS_NAMES = {
    1: "NormalOperation",
    2: "LowBattery",
    3: "HighTemperature",
    4: "HighDischargeStress",
    5: "CellImbalance",
    6: "Degradation",
    7: "FaultActive",
    8: "FaultRecovery",
}

_PV_CLASS_NAMES = {
    1: "NormalOperation",
    2: "LowPVGeneration",
    3: "LoadSpike",
    4: "OutputInstability",
    5: "Overvoltage",
    6: "SensorFault",
    7: "GradualDegradation",
    8: "AllZeroDisconnect",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _print_header(title: str, config: dict):
    print("=" * 60)
    print(f"              {title}")
    print("=" * 60)
    print(f"  API:  {config['api_url']}")
    print(f"  BMS Node: {config['bms_node_id']}  |  PV Node: {config['pv_node_id']}  |  Period: {config['period']}s")
    print("=" * 60)


def _run_or_placeholder(scenario_class, config: dict, endpoint: str, label: str):
    """Instantiate and run a scenario, falling back to a placeholder on error."""
    try:
        from .runner import run_scenario
        clear_screen()
        print(f"Starting scenario: {label}...")
        print("  Press Ctrl+C to stop and return to the menu.\n")
        instance = scenario_class()
        run_scenario(instance, config, endpoint)
    except NotImplementedError:
        print("This scenario is not implemented yet.")
    except ImportError:
        print("[placeholder] Scenario not implemented yet.")
    input("\nPress Enter to continue...")

# ── Submenus ──────────────────────────────────────────────────────────────────

def bms_menu(config: dict):
    from .bms_scenarios import BMS_SCENARIOS

    while True:
        clear_screen()
        print("=" * 60)
        print(f"              BMS Simulator — {config['bms_node_id']}")
        print("=" * 60)
        print()
        for idx, name in _BMS_SCENARIO_NAMES.items():
            print(f"  [{idx}]  {name}")
        print()
        print("  [0]  Back")
        print()
        choice = input("  Select scenario: ").strip()

        if choice == "0":
            return

        try:
            idx = int(choice)
        except ValueError:
            continue  # redraw

        if idx not in _BMS_SCENARIO_NAMES:
            continue  # redraw

        scenario_class = BMS_SCENARIOS[idx]
        _run_or_placeholder(scenario_class, config, BMS_ENDPOINT, _BMS_SCENARIO_NAMES[idx])


def pv_menu(config: dict):
    from .pv_scenarios import PV_SCENARIOS

    while True:
        clear_screen()
        print("=" * 60)
        print(f"              PV Simulator — {config['pv_node_id']}")
        print("=" * 60)
        print()
        for idx, name in _PV_SCENARIO_NAMES.items():
            print(f"  [{idx}]  {name}")
        print()
        print("  [0]  Back")
        print()
        choice = input("  Select scenario: ").strip()

        if choice == "0":
            return

        try:
            idx = int(choice)
        except ValueError:
            continue  # redraw

        if idx not in _PV_SCENARIO_NAMES:
            continue  # redraw

        scenario_class = PV_SCENARIOS[idx]
        _run_or_placeholder(scenario_class, config, PV_ENDPOINT, _PV_SCENARIO_NAMES[idx])

# ── Main menu ─────────────────────────────────────────────────────────────────

def main(config: dict):
    while True:
        clear_screen()
        _print_header("UEI Unified Simulator", config)
        print()
        print("  [1]  BMS Simulator")
        print("  [2]  PV Simulator")
        print("  [0]  Exit")
        print()
        choice = input("  Select: ").strip()

        if choice == "1":
            bms_menu(config)
        elif choice == "2":
            pv_menu(config)
        elif choice == "0":
            print("Goodbye.")
            sys.exit(0)
        # any other input: redraw
