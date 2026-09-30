#!/bin/bash
# install.sh - One-shot installer. Installs Flask + ffmpeg deps, renders
# the systemd unit templates for this repo's actual clone path/user, and
# enables three background services:
#   nevet-webapp      - gallery + login-gated game stats, port 8000
#   nevet-timelapse   - automatic photo capture every N minutes
#   nevet-watchdog    - WiFi reconnect + web app self-heal every 2 minutes
#   nevet-update      - checks GitHub for a new version every N minutes,
#                       pulls it and restarts the web app
#
# Usage: sudo ./install.sh [photo_interval_minutes|off] [update_interval_minutes|off]
#   e.g. sudo ./install.sh 5 15    photo every 5 min, update check every 15 min
#        sudo ./install.sh 5 off   photo every 5 min, no automatic updates
#        sudo ./install.sh off 15  no camera: timelapse off, updates every 15 min
set -e

if [ "$EUID" -ne 0 ]; then
    echo "Run with sudo: sudo ./install.sh [photo_interval_minutes|off] [update_interval_minutes|off]"
    exit 1
fi

REPO_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
INTERVAL_MIN="${1:-5}"
UPDATE_MIN="${2:-15}"

is_minutes() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 1 ] && [ "$1" -le 1440 ]; }
if [ "$INTERVAL_MIN" != "off" ] && ! is_minutes "$INTERVAL_MIN"; then
    echo "Photo interval must be minutes (1-1440) or 'off', got: $INTERVAL_MIN"; exit 1
fi
TIMER_MIN="$INTERVAL_MIN"; [ "$INTERVAL_MIN" = "off" ] && TIMER_MIN=5   # unit file needs a number
if [ "$UPDATE_MIN" != "off" ] && ! is_minutes "$UPDATE_MIN"; then
    echo "Update interval must be minutes (1-1440) or 'off', got: $UPDATE_MIN"; exit 1
fi

echo "Repo:      $REPO_DIR"
echo "User/home: $REAL_USER / $REAL_HOME"
echo "Timelapse: $([ "$INTERVAL_MIN" = off ] && echo off || echo "every ${INTERVAL_MIN} minute(s)")"
echo "Updates:   $([ "$UPDATE_MIN" = off ] && echo off || echo "check every ${UPDATE_MIN} minute(s)")"
echo ""

# Services run as $REAL_USER, so the repo must belong to them. (Running
# "git pull" as root once leaves root-owned files that break later pulls.)
chown -R "$REAL_USER":"$(id -gn "$REAL_USER")" "$REPO_DIR"

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
for f in /sys/class/net/wl*; do
    [ -e "$f" ] && command -v iw >/dev/null 2>&1 && { iw dev "${f##*/}" set power_save off 2>/dev/null || true; }
done
echo "WiFi power saving: off"

# ---- render systemd unit templates for this exact repo path/user ----
render_unit() {
    sed -e "s|__USER__|${REAL_USER}|g" \
        -e "s|__HOME__|${REAL_HOME}|g" \
        -e "s|__REPO_DIR__|${REPO_DIR}|g" \
        -e "s|__INTERVAL__|${TIMER_MIN}|g" \
        -e "s|__UPDATE_INTERVAL__|${UPDATE_MIN}|g" \
        "$1" > "$2"
}

render_unit "$REPO_DIR/systemd/nevet-webapp.service"    /etc/systemd/system/nevet-webapp.service
render_unit "$REPO_DIR/systemd/nevet-timelapse.service" /etc/systemd/system/nevet-timelapse.service
render_unit "$REPO_DIR/systemd/nevet-timelapse.timer"   /etc/systemd/system/nevet-timelapse.timer
render_unit "$REPO_DIR/systemd/nevet-watchdog.service"  /etc/systemd/system/nevet-watchdog.service
render_unit "$REPO_DIR/systemd/nevet-watchdog.timer"    /etc/systemd/system/nevet-watchdog.timer
render_unit "$REPO_DIR/systemd/nevet-update.service"    /etc/systemd/system/nevet-update.service
render_unit "$REPO_DIR/systemd/nevet-update.timer"      /etc/systemd/system/nevet-update.timer

# ---- logging: rotate the shell-generated logs weekly ----
sed -e "s|__HOME__|${REAL_HOME}|g" "$REPO_DIR/config/nevet-logrotate.conf" > /etc/logrotate.d/nevet

# ---- scoped passwordless sudo for the watchdog + auto-update ----
# Only the exact commands they need (the updater only restarts the web app). Validated with visudo
# before installing, so a mistake here can never break sudo.
SYSTEMCTL=$(command -v systemctl)
CMDS="$SYSTEMCTL restart nevet-webapp, $SYSTEMCTL restart NetworkManager, $SYSTEMCTL restart wpa_supplicant, $SYSTEMCTL restart tailscaled"
NMCLI=$(command -v nmcli || true)
IW=$(command -v iw || true)
# every WiFi adapter: wlan0 (built-in), wlan1+ (USB antennas), plus any
# adapter present now under another name
WIFI_IFS=$( { printf 'wlan%s\n' 0 1 2 3; for f in /sys/class/net/wl*; do [ -e "$f" ] && echo "${f##*/}"; done; } | sort -u)
[ -n "$NMCLI" ] && CMDS="$CMDS, $NMCLI radio wifi off, $NMCLI radio wifi on"
for w in $WIFI_IFS; do
    [ -n "$NMCLI" ] && CMDS="$CMDS, $NMCLI device reconnect $w"
    [ -n "$IW" ] && CMDS="$CMDS, $IW dev $w set power_save off"
done
TMP_SUDOERS=$(mktemp)
echo "${REAL_USER} ALL=(root) NOPASSWD: ${CMDS}" > "$TMP_SUDOERS"
if visudo -cf "$TMP_SUDOERS" >/dev/null 2>&1; then
    install -m 440 "$TMP_SUDOERS" /etc/sudoers.d/nevet-watchdog
    echo "Watchdog permissions: OK"
else
    echo "WARNING: watchdog sudo rules failed validation - not installed (sudo is untouched)."
fi
rm -f "$TMP_SUDOERS"

# ---- `nevet` command: coloured status summary in the terminal ----
chmod +x "$REPO_DIR/scripts/nevet_status.py"
ln -sf "$REPO_DIR/scripts/nevet_status.py" /usr/local/bin/nevet

systemctl daemon-reload
systemctl enable nevet-webapp.service
systemctl restart nevet-webapp.service
if [ "$INTERVAL_MIN" = "off" ]; then
    systemctl disable --now nevet-timelapse.timer 2>/dev/null || true
else
    systemctl enable nevet-timelapse.timer
    systemctl restart nevet-timelapse.timer    # picks up a changed interval
fi
systemctl enable --now nevet-watchdog.timer
if [ "$UPDATE_MIN" = "off" ]; then
    systemctl disable --now nevet-update.timer 2>/dev/null || true
else
    systemctl enable nevet-update.timer
    systemctl restart nevet-update.timer    # picks up a changed interval
fi

# ---- Tailscale (remote access from outside the home network), if installed ----
if command -v tailscale >/dev/null 2>&1; then
    systemctl enable --now tailscaled >/dev/null 2>&1 || true
    TS_IP=$(timeout 5 tailscale ip -4 2>/dev/null | head -1 || true)
    if [ -n "$TS_IP" ] && timeout 5 tailscale status >/dev/null 2>&1; then
        TS_LINE="http://${TS_IP}:8000 from anywhere (devices on your Tailscale)"
    else
        TS_LINE="installed but not logged in - run: sudo tailscale up"
    fi
else
    TS_LINE="not installed - see README, \"Open Nevet from outside\""
fi

IP=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -m1 -E '^[0-9]+\.' || true)
echo ""
echo "=============================================="
echo " Installed and running:"
echo "   nevet-webapp.service    -> http://${IP}:8000"
if [ "$INTERVAL_MIN" = "off" ]; then
echo "   nevet-timelapse.timer   -> off (no camera)"
else
echo "   nevet-timelapse.timer   -> photo every ${INTERVAL_MIN} min (skips while no camera is plugged in)"
fi
echo "   nevet-watchdog.timer    -> WiFi + web app health check every 2 min"
if [ "$UPDATE_MIN" = "off" ]; then
echo "   nevet-update.timer      -> off (update by hand: ./scripts/auto_update.sh)"
else
echo "   nevet-update.timer      -> check GitHub for updates every ${UPDATE_MIN} min"
fi
echo "   Tailscale               -> ${TS_LINE}"
echo ""
echo " Status in the terminal:  nevet     (live view: nevet -w)"
echo " Remote access check:     nevet ts    Network test: nevet net"
echo "=============================================="
echo ""
echo "If you edited .env after this ran:"
echo "  sudo systemctl daemon-reload && sudo systemctl restart nevet-webapp"
