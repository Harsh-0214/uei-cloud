#!/usr/bin/env bash
# pi_setup.sh — Configure a Raspberry Pi to run a UEI telemetry client on boot.
#
# Supports all four Pi roles in the system:
#
#   Real BMS  (Orion Jr2 via CAN bus):
#     sudo bash pi_setup.sh --type bms --mode real --node-id pi_bms_real \
#                           --api-url http://<VM_IP>:8000
#
#   Real PV   (CSV file written by DAQ software):
#     sudo bash pi_setup.sh --type pv  --mode real --node-id pi_pv_real  \
#                           --api-url http://<VM_IP>:8000 \
#                           --csv-path /home/capstone/Capstone_solar/pv.csv
#
#   Simulated BMS:
#     sudo bash pi_setup.sh --type bms --mode sim  --node-id pi_bms_sim  \
#                           --api-url http://<VM_IP>:8000
#
#   Simulated PV:
#     sudo bash pi_setup.sh --type pv  --mode sim  --node-id pi_pv_sim   \
#                           --api-url http://<VM_IP>:8000
#
# What this script does:
#   1. Installs Python 3, pip, and required libraries
#   2. For real BMS: configures the SocketCAN interface to come up on boot
#   3. Copies the client script to /opt/uei/
#   4. Creates a systemd service that auto-starts on every boot
#   5. Starts the service immediately
#
# View logs after setup:
#   journalctl -u uei-client -f

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
TYPE=""          # bms | pv
MODE=""          # sim | real
NODE_ID=""
API_URL=""
PERIOD="2"
# BMS real-mode options
CAN_CHANNEL="can0"
CAN_BITRATE="500000"
# PV real-mode options
CSV_PATH=""

SERVICE_NAME="uei-client"
INSTALL_DIR="/opt/uei"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Argument parsing ──────────────────────────────────────────────────────────
usage() {
    grep '^#' "$0" | head -30 | sed 's/^# \{0,1\}//'
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --type)         TYPE="$2";         shift 2 ;;
        --mode)         MODE="$2";         shift 2 ;;
        --node-id)      NODE_ID="$2";      shift 2 ;;
        --api-url)      API_URL="$2";      shift 2 ;;
        --period)       PERIOD="$2";       shift 2 ;;
        --can-channel)  CAN_CHANNEL="$2";  shift 2 ;;
        --can-bitrate)  CAN_BITRATE="$2";  shift 2 ;;
        --csv-path)     CSV_PATH="$2";     shift 2 ;;
        -h|--help)      usage ;;
        *) echo "ERROR: Unknown argument: $1"; usage ;;
    esac
done

[[ -z "$TYPE"    ]] && { echo "ERROR: --type bms|pv is required";      usage; }
[[ -z "$MODE"    ]] && { echo "ERROR: --mode sim|real is required";     usage; }
[[ -z "$NODE_ID" ]] && { echo "ERROR: --node-id is required";           usage; }
[[ -z "$API_URL" ]] && { echo "ERROR: --api-url is required";           usage; }

if [[ "$TYPE" != "bms" && "$TYPE" != "pv" ]]; then
    echo "ERROR: --type must be 'bms' or 'pv'"; usage
fi
if [[ "$MODE" != "sim" && "$MODE" != "real" ]]; then
    echo "ERROR: --mode must be 'sim' or 'real'"; usage
fi
if [[ "$TYPE" == "pv" && "$MODE" == "real" && -z "$CSV_PATH" ]]; then
    echo "ERROR: --csv-path is required for --type pv --mode real"; usage
fi

# ── Derived values ────────────────────────────────────────────────────────────
if [[ "$TYPE" == "bms" ]]; then
    CLIENT_SCRIPT="pi_bms_client.py"
    EXTRA_ARGS="--can-channel ${CAN_CHANNEL} --can-bitrate ${CAN_BITRATE}"
else
    CLIENT_SCRIPT="pi_pv_client.py"
    EXTRA_ARGS=""
    [[ -n "$CSV_PATH" ]] && EXTRA_ARGS="--csv-path ${CSV_PATH}"
fi

echo ""
echo "=== UEI Pi Client Setup ==="
echo "  Type      : $TYPE ($MODE)"
echo "  Node ID   : $NODE_ID"
echo "  API URL   : $API_URL"
echo "  Period    : ${PERIOD}s"
[[ "$TYPE" == "bms" && "$MODE" == "real" ]] && echo "  CAN       : ${CAN_CHANNEL} @ ${CAN_BITRATE} bps"
[[ "$TYPE" == "pv"  && "$MODE" == "real" ]] && echo "  CSV path  : ${CSV_PATH}"
echo ""

# ── 1. Install Python and dependencies ───────────────────────────────────────
echo "[1/5] Installing Python 3 and base dependencies..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip

pip3 install -q requests

if [[ "$TYPE" == "bms" && "$MODE" == "real" ]]; then
    echo "      Installing python-can for CAN bus support..."
    apt-get install -y -qq can-utils python3-can
    pip3 install -q python-can
fi

# No extra deps needed for real PV (CSV file read uses stdlib only)

# ── 2. Configure CAN bus (real BMS only) ─────────────────────────────────────
if [[ "$TYPE" == "bms" && "$MODE" == "real" ]]; then
    echo "[2/5] Configuring SocketCAN interface ${CAN_CHANNEL}..."

    # Bring up CAN interface now
    ip link set "${CAN_CHANNEL}" down 2>/dev/null || true
    ip link set "${CAN_CHANNEL}" up type can bitrate "${CAN_BITRATE}" || {
        echo "      WARNING: Could not configure ${CAN_CHANNEL}."
        echo "      Make sure your CAN HAT/module is installed and the Pi has been rebooted."
    }

    # Persist across reboots via systemd-networkd override
    NETDEV_FILE="/etc/systemd/network/80-can.network"
    cat > "$NETDEV_FILE" <<NETEOF
[Match]
Name=${CAN_CHANNEL}

[CAN]
BitRate=${CAN_BITRATE}
NETEOF
    systemctl enable systemd-networkd 2>/dev/null || true
    echo "      CAN network config written to ${NETDEV_FILE}"
else
    echo "[2/5] Skipping CAN setup (not needed for ${TYPE}/${MODE})."
fi

# ── 3. Install client script ──────────────────────────────────────────────────
echo "[3/5] Installing ${CLIENT_SCRIPT} and algorithms/ to ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
cp "${SCRIPT_DIR}/${CLIENT_SCRIPT}" "${INSTALL_DIR}/${CLIENT_SCRIPT}"
chmod +x "${INSTALL_DIR}/${CLIENT_SCRIPT}"

# Copy the shared algorithms package so CAC and RDA are available on the Pi
if [[ -d "${SCRIPT_DIR}/algorithms" ]]; then
    cp -r "${SCRIPT_DIR}/algorithms" "${INSTALL_DIR}/algorithms"
    echo "      algorithms/ installed (CAC + RDA active)"
else
    echo "      WARNING: algorithms/ not found — CAC and RDA will be disabled on this Pi"
fi

# ── 4. Create systemd service ─────────────────────────────────────────────────
echo "[4/5] Creating systemd service: ${SERVICE_NAME}..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=UEI ${TYPE^^} Client (${NODE_ID}, ${MODE} mode)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 ${INSTALL_DIR}/${CLIENT_SCRIPT} \
    --mode ${MODE} \
    --node-id ${NODE_ID} \
    --api-url ${API_URL} \
    --period ${PERIOD} \
    ${EXTRA_ARGS}
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
User=root

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"

# ── 5. Start the service ──────────────────────────────────────────────────────
echo "[5/5] Starting ${SERVICE_NAME}..."
systemctl restart "${SERVICE_NAME}"
sleep 2
systemctl status "${SERVICE_NAME}" --no-pager || true

echo ""
echo "Done!"
echo ""
echo "  Pi '${NODE_ID}' (${TYPE}, ${MODE}) is sending telemetry to ${API_URL}"
echo ""
echo "Useful commands:"
echo "  journalctl -u ${SERVICE_NAME} -f          # live logs"
echo "  systemctl status ${SERVICE_NAME}           # service status"
echo "  systemctl restart ${SERVICE_NAME}          # restart"
echo "  systemctl stop ${SERVICE_NAME}             # stop"
echo "  systemctl disable ${SERVICE_NAME}          # disable auto-start"
