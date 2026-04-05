import argparse
from .common import (
    DEFAULT_API_URL,
    DEFAULT_BMS_NODE_ID,
    DEFAULT_BMS_ID,
    DEFAULT_PV_NODE_ID,
    DEFAULT_PV_ID,
    DEFAULT_PERIOD,
)
from .menu import main


def _parse_args():
    parser = argparse.ArgumentParser(description="UEI Unified Simulator")
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--bms-node-id", default=DEFAULT_BMS_NODE_ID)
    parser.add_argument("--bms-id", default=DEFAULT_BMS_ID)
    parser.add_argument("--pv-node-id", default=DEFAULT_PV_NODE_ID)
    parser.add_argument("--pv-id", default=DEFAULT_PV_ID)
    parser.add_argument("--period", type=float, default=DEFAULT_PERIOD)
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    config = {
        "api_url": args.api_url,
        "bms_node_id": args.bms_node_id,
        "bms_id": args.bms_id,
        "pv_node_id": args.pv_node_id,
        "pv_id": args.pv_id,
        "period": args.period,
    }
    main(config)
