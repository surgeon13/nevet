#!/bin/bash
# install.sh - One-shot installer. Installs Flask + ffmpeg deps, renders
# the systemd unit templates for this repo's actual clone path/user, and
# enables three background services:
#   nevet-webapp      - gallery + login-gated game stats, port 8000
#   nevet-timelapse   - automatic photo capture every N minutes
#   nevet-watchdog    - WiFi reconnect + health check every 5 minutes
#
# Usage: sudo ./install.sh [timelapse_interval_minutes]
set -e

if [ "$EUID" -ne 0 ]; then
    echo "Run with sudo: sudo ./install.sh [interval_minutes]"
    exit 1
fi

REPO_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
INTERVAL_MIN="${1:-5}"

echo "Repo:      $REPO_DIR"
echo "User/home: $REAL_USER / $REAL_HOME"
echo "Timelapse: every ${INTERVAL_MIN} minute(s)"
echo ""

chmod +x "$REPO_DIR"/scripts/*.sh

# ---- .env ----
if [ ! -f "$REPO_DIR/.env" ]; then
    cp "$REPO_DIR/config/.env.example" "$REPO_DIR/.env"
    chown "$REAL_USER":"$REAL_USER" "$REPO_DIR/.env"
    echo "Created $REPO_DIR/.env from the template."
    echo "  -> EDIT IT NOW (password, API key) before continuing: nano $REPO_DIR/.env"
    echo ""
fi

# ---- dependencies ----
echo "Installing dependencies..."
apt-get update -qq
apt-get install -y python3-flask ffmpeg v4l-utils fonts-dejavu-core >/dev/null 2>&1 \
    || sudo -u "$REAL_USER" pip3 install -r "$REPO_DIR/webapp/requirements.txt" --break-system-packages

# ---- render systemd unit templates for this exact repo path/user ----
render_unit() {
    sed -e "s|__USER__|${REAL_USER}|g" \
        -e "s|__HOME__|${REAL_HOME}|g" \
        -e "s|__REPO_DIR__|${REPO_DIR}|g" \
        -e "s|__INTERVAL__|${INTERVAL_MIN}|g" \
        "$1" > "$2"
}

render_unit "$REPO_DIR/systemd/nevet-webapp.service"    /etc/systemd/system/nevet-webapp.service
render_unit "$REPO_DIR/systemd/nevet-timelapse.service" /etc/systemd/system/nevet-timelapse.service
render_unit "$REPO_DIR/systemd/nevet-timelapse.timer"   /etc/systemd/system/nevet-timelapse.timer
render_unit "$REPO_DIR/systemd/nevet-watchdog.service"  /etc/systemd/system/nevet-watchdog.service
render_unit "$REPO_DIR/systemd/nevet-watchdog.timer"    /etc/systemd/system/nevet-watchdog.timer

# ---- logging: rotate the shell-generated logs weekly ----
sed -e "s|__HOME__|${REAL_HOME}|g" "$REPO_DIR/config/nevet-logrotate.conf" > /etc/logrotate.d/nevet

# ---- scoped passwordless sudo for the watchdog only ----
cat > /etc/sudoers.d/nevet-watchdog << EOF
${REAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart wpa_supplicant, /usr/sbin/dhclient -r wlan0, /usr/sbin/dhclient wlan0
EOF
chmod 440 /etc/sudoers.d/nevet-watchdog

systemctl daemon-reload
systemctl enable --now nevet-webapp.service
systemctl enable --now nevet-timelapse.timer
systemctl enable --now nevet-watchdog.timer

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "=============================================="
echo " Installed and running:"
echo "   nevet-webapp.service    -> http://${IP}:8000"
echo "   nevet-timelapse.timer   -> photo every ${INTERVAL_MIN} min"
echo "   nevet-watchdog.timer    -> WiFi/health check every 5 min"
echo "=============================================="
echo ""
echo "If you edited .env after this ran:"
echo "  sudo systemctl daemon-reload && sudo systemctl restart nevet-webapp"
