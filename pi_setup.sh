#!/usr/bin/env bash
# pi_setup.sh — Configure a Raspberry Pi to run a UEI BMS simulator and send
#               data to the cloud dashboard on every boot.
#
# Usage:
#   sudo bash pi_setup.sh --node-id pi_bms_4 --api-url http://<VM_IP>:8000
#   sudo bash pi_setup.sh --node-id pi_bms_5 --api-url http://<VM_IP>:8000
#
# What this script does:
#   1. Installs Python 3 and the `requests` library (if not present)
#   2. Copies simulator.py to /opt/uei/simulator.py
#   3. Creates a systemd service that auto-starts the simulator on boot
#   4. Starts the service immediately
#
# After running, the Pi will POST BMS telemetry to the cloud API every 2 seconds.
# View logs:  journalctl -u uei-simulator -f

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
NODE_ID=""
API_URL=""
HZ="0.5"          # 1 packet every 2 seconds
BMS_ID=""

# ── Argument parsing ──────────────────────────────────────────────────────────
usage() {
    echo "Usage: sudo bash pi_setup.sh --node-id <NODE_ID> --api-url <URL> [--hz <HZ>] [--bms-id <BMS_ID>]"
    echo ""
    echo "  --node-id   Unique node identifier, e.g. pi_bms_4 (required)"
    echo "  --api-url   Cloud API base URL, e.g. http://1.2.3.4:8000 (required)"
    echo "  --hz        Packets per second (default: 0.5 = 1 packet every 2s)"
    echo "  --bms-id    BMS hardware ID label (default: OrionJr2_<NODE_ID>)"
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --node-id) NODE_ID="$2"; shift 2 ;;
        --api-url) API_URL="$2"; shift 2 ;;
        --hz)      HZ="$2";      shift 2 ;;
        --bms-id)  BMS_ID="$2";  shift 2 ;;
        *) echo "Unknown argument: $1"; usage ;;
    esac
done

[[ -z "$NODE_ID" ]] && { echo "ERROR: --node-id is required"; usage; }
[[ -z "$API_URL" ]] && { echo "ERROR: --api-url is required"; usage; }
[[ -z "$BMS_ID"  ]] && BMS_ID="OrionJr2_${NODE_ID}"

TELEMETRY_URL="${API_URL%/}/telemetry"
INSTALL_DIR="/opt/uei"
SERVICE_NAME="uei-simulator"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "=== UEI Pi Simulator Setup ==="
echo "  Node ID   : $NODE_ID"
echo "  BMS ID    : $BMS_ID"
echo "  API URL   : $TELEMETRY_URL"
echo "  Rate      : ${HZ} Hz"
echo ""

# ── 1. Install dependencies ───────────────────────────────────────────────────
echo "[1/4] Installing Python 3 and requests..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-requests

# ── 2. Copy simulator ─────────────────────────────────────────────────────────
echo "[2/4] Installing simulator to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/simulator.py" "$INSTALL_DIR/simulator.py"
chmod +x "$INSTALL_DIR/simulator.py"

# ── 3. Write systemd service ──────────────────────────────────────────────────
echo "[3/4] Creating systemd service: $SERVICE_NAME..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=UEI BMS Simulator ($NODE_ID)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 $INSTALL_DIR/simulator.py \
    --node-id $NODE_ID \
    --bms-id $BMS_ID \
    --post-url $TELEMETRY_URL \
    --hz $HZ
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# ── 4. Start the service ──────────────────────────────────────────────────────
echo "[4/4] Starting $SERVICE_NAME..."
systemctl restart "$SERVICE_NAME"
sleep 2
systemctl status "$SERVICE_NAME" --no-pager || true

echo ""
echo "Done! Pi '$NODE_ID' is now sending telemetry to $TELEMETRY_URL"
echo ""
echo "Useful commands:"
echo "  journalctl -u $SERVICE_NAME -f        # live logs"
echo "  systemctl status $SERVICE_NAME         # service status"
echo "  systemctl stop $SERVICE_NAME           # stop"
echo "  systemctl disable $SERVICE_NAME        # disable auto-start"
