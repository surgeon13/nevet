#!/bin/bash
# wifi_watchdog.sh - Checks WiFi connectivity and camera script/service
# health. Logs EVERY check (pass or fail) with latency and signal
# strength, and tries to reconnect automatically. It NEVER reboots the
# Pi: timelapse capture and the local database don't need internet, so
# the Pi keeps working offline and the watchdog just keeps retrying.
#
# Meant to be run periodically via the nevet-watchdog.timer systemd timer.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
log_init "watchdog"

DATA_DIR="$HOME/camera_captures"
STATE_FILE="$DATA_DIR/.watchdog_fail_count"
PING_TARGET="8.8.8.8"
GATEWAY=$(ip route | awk '/default/ {print $3; exit}')

mkdir -p "$DATA_DIR"

get_signal() {
    command -v nmcli >/dev/null 2>&1 || { echo "?"; return; }
    local sig
    sig=$(nmcli -t -f ACTIVE,SIGNAL dev wifi 2>/dev/null | awk -F: '$1=="yes"{print $2; exit}')
    echo "${sig:-?}"
}

ping_check() {
    # Sets PING_OK (0/1) and LATENCY (ms or "?") for the given target.
    local target="$1"
    local out
    out=$(ping -c1 -W3 "$target" 2>&1)
    if [ $? -eq 0 ]; then
        PING_OK=0
        LATENCY=$(echo "$out" | grep -oE 'time=[0-9.]+' | cut -d= -f2)
        [ -z "$LATENCY" ] && LATENCY="?"
    else
        PING_OK=1
        LATENCY="?"
    fi
}

try_reconnect() {
    log_msg "  attempting WiFi reconnect"
    if command -v nmcli >/dev/null 2>&1; then
        CONN=$(nmcli -t -f NAME,TYPE connection show --active | grep wireless | head -1 | cut -d: -f1)
        [ -z "$CONN" ] && CONN=$(nmcli -t -f NAME,TYPE connection show | grep wireless | head -1 | cut -d: -f1)
        if [ -n "$CONN" ]; then
            nmcli connection down "$CONN" >/dev/null 2>&1
            sleep 2
            nmcli connection up "$CONN" >/dev/null 2>&1
        else
            nmcli radio wifi off; sleep 2; nmcli radio wifi on
        fi
    else
        sudo systemctl restart wpa_supplicant 2>/dev/null
        sudo dhclient -r wlan0 2>/dev/null
        sudo dhclient wlan0 2>/dev/null
    fi
    sleep 10
}

check_scripts() {
    local ok=1
    [ -x "$SCRIPT_DIR/capture_photo.sh" ] || { log_msg "  capture_photo.sh missing/not executable"; ok=0; }
    [ -x "$SCRIPT_DIR/capture_video.sh" ] || { log_msg "  capture_video.sh missing/not executable"; ok=0; }
    [ -e "/dev/video0" ] || { log_msg "  camera device /dev/video0 missing"; ok=0; }
    systemctl is-active --quiet nevet-webapp.service 2>/dev/null || { log_msg "  nevet-webapp.service not active"; ok=0; }
    systemctl is-active --quiet nevet-timelapse.timer 2>/dev/null || { log_msg "  nevet-timelapse.timer not active"; ok=0; }
    return $((1 - ok))
}

FAIL_COUNT=0
[ -f "$STATE_FILE" ] && FAIL_COUNT=$(<"$STATE_FILE")

SIGNAL=$(get_signal)
ping_check "$PING_TARGET"

if [ "$PING_OK" -eq 0 ]; then
    log_msg "OK  latency=${LATENCY}ms signal=${SIGNAL}%"
    [ "$FAIL_COUNT" -ne 0 ] && log_msg "WiFi recovered after $FAIL_COUNT failed check(s)"
    FAIL_COUNT=0
else
    log_msg "FAIL no response from $PING_TARGET (signal=${SIGNAL}%)"
    try_reconnect

    SIGNAL=$(get_signal)
    ping_check "$PING_TARGET"
    if [ "$PING_OK" -eq 0 ]; then
        log_msg "OK  reconnected, latency=${LATENCY}ms signal=${SIGNAL}%"
        FAIL_COUNT=0
    else
        FAIL_COUNT=$((FAIL_COUNT + 1))
        log_msg "FAIL still down after reconnect attempt (consecutive fails: $FAIL_COUNT, signal=${SIGNAL}%) - capture continues offline"
    fi
fi
echo "$FAIL_COUNT" > "$STATE_FILE"

if ! check_scripts; then
    log_msg "One or more camera scripts/services unhealthy (see lines above)"
fi
