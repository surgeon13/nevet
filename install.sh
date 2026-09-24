#!/bin/bash
# install.sh - One-shot installer. Installs Flask + ffmpeg deps, renders
# the systemd unit templates for this repo's actual clone path/user, and
# enables three background services:
#   nevet-webapp      - gallery + login-gated game stats, port 8000
#   nevet-timelapse   - automatic photo capture every N minutes
#   nevet-watchdog    - WiFi reconnect + web app self-heal every 2 minutes
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
# Never fatal: if the Pi is offline, the rest of the install (services,
# watchdog, WiFi settings) still gets applied with what's already there.
echo "Installing dependencies..."
if apt-get update -qq 2>/dev/null && \
   apt-get install -y python3-flask python3-waitress ffmpeg v4l-utils fonts-dejavu-core curl iw >/dev/null 2>&1; then
    echo "  dependencies OK"
elif sudo -u "$REAL_USER" pip3 install -r "$REPO_DIR/webapp/requirements.txt" --break-system-packages >/dev/null 2>&1; then
    echo "  dependencies OK (via pip)"
else
    echo "  WARNING: couldn't install/update dependencies (offline?). Continuing with what's installed;"
    echo "           re-run this installer later when online."
fi

# ---- WiFi power saving OFF (classic cause of Pi 3B dropouts) ----
mkdir -p /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/nevet-wifi-powersave.conf << 'EOF'
# Written by nevet install.sh: WiFi power saving causes dropouts on Pi 3B.
[connection]
wifi.powersave = 2
EOF
# apply right now without dropping the connection (the file above
# makes it permanent from the next reconnect/boot)
command -v iw >/dev/null 2>&1 && iw dev wlan0 set power_save off 2>/dev/null || true
echo "WiFi power saving: off"

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
# Only the exact commands the watchdog needs. Validated with visudo
# before installing, so a mistake here can never break sudo.
SYSTEMCTL=$(command -v systemctl)
CMDS="$SYSTEMCTL restart nevet-webapp, $SYSTEMCTL restart NetworkManager, $SYSTEMCTL restart wpa_supplicant"
NMCLI=$(command -v nmcli || true)
IW=$(command -v iw || true)
[ -n "$NMCLI" ] && CMDS="$CMDS, $NMCLI device reconnect wlan0, $NMCLI radio wifi off, $NMCLI radio wifi on"
[ -n "$IW" ] && CMDS="$CMDS, $IW dev wlan0 set power_save off"
TMP_SUDOERS=$(mktemp)
echo "${REAL_USER} ALL=(root) NOPASSWD: ${CMDS}" > "$TMP_SUDOERS"
if visudo -cf "$TMP_SUDOERS" >/dev/null 2>&1; then
    install -m 440 "$TMP_SUDOERS" /etc/sudoers.d/nevet-watchdog
    echo "Watchdog permissions: OK"
else
    echo "WARNING: watchdog sudo rules failed validation - not installed (sudo is untouched)."
fi
rm -f "$TMP_SUDOERS"

systemctl daemon-reload
systemctl enable nevet-webapp.service
systemctl restart nevet-webapp.service
systemctl enable --now nevet-timelapse.timer
systemctl enable --now nevet-watchdog.timer

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "=============================================="
echo " Installed and running:"
echo "   nevet-webapp.service    -> http://${IP}:8000"
echo "   nevet-timelapse.timer   -> photo every ${INTERVAL_MIN} min"
echo "   nevet-watchdog.timer    -> WiFi + web app health check every 2 min"
echo "=============================================="
echo ""
echo "If you edited .env after this ran:"
echo "  sudo systemctl daemon-reload && sudo systemctl restart nevet-webapp"
