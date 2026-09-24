#!/bin/bash
# wifi_watchdog.sh - Keeps the Pi reachable and the web app alive.
# Runs every 2 minutes via nevet-watchdog.timer. NEVER reboots the Pi.
#
# Network: tells apart three situations and only acts on the one it
# can actually fix:
#   ONLINE       internet reachable (HTTP/TCP, not just ping, since
#                many networks block ping)                -> nothing to do
#   LAN_ONLY     WiFi + router fine, internet down (ISP outage, captive
#                portal)       -> log only; bouncing WiFi can't fix it and
#                                 would cut local/Tailscale access
#   LINK_DOWN    no IP or router unreachable -> reconnect, escalating:
#                reconnect device -> WiFi radio off/on -> restart
#                NetworkManager (never a reboot)
#
# Web app: checks http://127.0.0.1:8000/healthz. Two failed checks in a
# row (i.e. hung, not just busy) -> restart nevet-webapp.
#
# Also logs Pi health each run (under-voltage, temperature, memory,
# disk), which are the usual hidden causes of Pi 3B WiFi dropouts.
#
# Test without changing anything: NEVET_WATCHDOG_DRY_RUN=1 ./wifi_watchdog.sh
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
log_init "watchdog"

DATA_DIR="$HOME/camera_captures"
STATE_DIR="$DATA_DIR/.watchdog"
IFACE="${NEVET_WIFI_IFACE:-wlan0}"
WEBAPP_URL="http://127.0.0.1:8000/healthz"
DRY_RUN="${NEVET_WATCHDOG_DRY_RUN:-0}"

mkdir -p "$STATE_DIR"

# ---------- small helpers ----------
read_count() { local f="$STATE_DIR/$1"; [ -f "$f" ] && cat "$f" || echo 0; }
write_count() { echo "$2" > "$STATE_DIR/$1"; }

act() {
    # Run a corrective command, or just log it in dry-run mode.
    if [ "$DRY_RUN" = "1" ]; then
        log_msg "  [dry-run] would run: $*"
        return 0
    fi
    "$@" >/dev/null 2>&1
}

get_signal() {
    command -v nmcli >/dev/null 2>&1 || { echo "?"; return; }
    local sig
    sig=$(nmcli -t -f ACTIVE,SIGNAL dev wifi 2>/dev/null | awk -F: '$1=="yes"{print $2; exit}')
    echo "${sig:-?}"
}

has_ip() { ip -4 addr show "$IFACE" 2>/dev/null | grep -q "inet "; }

gateway_ok() {
    local gw
    gw=$(ip route 2>/dev/null | awk '/^default/ {print $3; exit}')
    [ -n "$gw" ] && ping -c1 -W3 "$gw" >/dev/null 2>&1
}

internet_ok() {
    # Any one of these succeeding means we're online. HTTP/TCP first,
    # because plenty of networks block ping while the internet works.
    if command -v curl >/dev/null 2>&1; then
        local code
        code=$(curl -s -m 6 -o /dev/null -w '%{http_code}' http://connectivitycheck.gstatic.com/generate_204 2>/dev/null)
        [ "$code" = "204" ] && return 0
    fi
    timeout 5 bash -c '</dev/tcp/1.1.1.1/443' 2>/dev/null && return 0
    ping -c1 -W3 8.8.8.8 >/dev/null 2>&1 && return 0
    return 1
}

net_state() {
    if internet_ok; then echo ONLINE
    elif has_ip && gateway_ok; then echo LAN_ONLY
    else echo LINK_DOWN
    fi
}

health_line() {
    local throttled="?" temp="?" mem="?" disk="?"
    if command -v vcgencmd >/dev/null 2>&1; then
        throttled=$(vcgencmd get_throttled 2>/dev/null | cut -d= -f2)
        temp=$(vcgencmd measure_temp 2>/dev/null | cut -d= -f2)
    fi
    mem=$(awk '/MemAvailable/ {printf "%dMB", $2/1024}' /proc/meminfo 2>/dev/null)
    disk=$(df -h "$HOME" 2>/dev/null | awk 'NR==2 {print $5}')
    local power=""
    if [[ "$throttled" =~ ^0x[0-9a-fA-F]+$ ]]; then
        local t=$((throttled))
        (( t & 0x1 )) && power=" UNDER-VOLTAGE-NOW"
        (( t & 0x10000 )) && [ -z "$power" ] && power=" under-voltage-since-boot"
    fi
    echo "throttled=${throttled:-?}${power} temp=${temp:-?} mem_free=${mem:-?} disk_used=${disk:-?}"
}

reconnect() {
    # Escalates with each consecutive LINK_DOWN check. No reboots.
    local level="$1"
    if ! command -v nmcli >/dev/null 2>&1; then
        log_msg "  reconnect: nmcli not found, restarting wpa_supplicant"
        act sudo -n systemctl restart wpa_supplicant
        return
    fi
    case "$level" in
        1|2)
            log_msg "  reconnect step 1: nmcli device reconnect $IFACE"
            act sudo -n nmcli device reconnect "$IFACE" ;;
        3|4)
            log_msg "  reconnect step 2: WiFi radio off/on"
            act sudo -n nmcli radio wifi off
            [ "$DRY_RUN" = "1" ] || sleep 3
            act sudo -n nmcli radio wifi on ;;
        *)
            # From here on, repeat the strongest step every 5th check
            # (~10 min) instead of hammering it every 2 minutes.
            if [ $(( level % 5 )) -eq 0 ]; then
                log_msg "  reconnect step 3: restarting NetworkManager"
                act sudo -n systemctl restart NetworkManager
            else
                log_msg "  reconnect: waiting before next NetworkManager restart"
                return
            fi ;;
    esac
    [ "$DRY_RUN" = "1" ] || sleep 15
}

# Keep WiFi power saving off; it's a classic cause of Pi 3B dropouts.
powersave_off() {
    command -v iw >/dev/null 2>&1 || return
    if iw dev "$IFACE" get power_save 2>/dev/null | grep -qi "on"; then
        log_msg "  WiFi power save was ON - turning it off"
        act sudo -n iw dev "$IFACE" set power_save off
    fi
}

# ---------- network ----------
powersave_off
SIGNAL=$(get_signal)
STATE=$(net_state)
LINK_FAILS=$(read_count link_fails)
LAN_ONLY_COUNT=$(read_count lan_only)

case "$STATE" in
    ONLINE)
        log_msg "OK  online signal=${SIGNAL}% $(health_line)"
        [ "$LINK_FAILS" -ne 0 ] && log_msg "WiFi recovered after $LINK_FAILS failed check(s)"
        [ "$LAN_ONLY_COUNT" -ne 0 ] && log_msg "Internet back after $LAN_ONLY_COUNT check(s) of LAN-only"
        LINK_FAILS=0; LAN_ONLY_COUNT=0
        ;;
    LAN_ONLY)
        LAN_ONLY_COUNT=$((LAN_ONLY_COUNT + 1)); LINK_FAILS=0
        log_msg "WARN WiFi+router OK but no internet (check #$LAN_ONLY_COUNT: ISP outage or captive portal) - not touching WiFi, local access still works. signal=${SIGNAL}% $(health_line)"
        ;;
    LINK_DOWN)
        LINK_FAILS=$((LINK_FAILS + 1)); LAN_ONLY_COUNT=0
        log_msg "FAIL WiFi link down (no IP or router unreachable, consecutive: $LINK_FAILS) signal=${SIGNAL}% $(health_line)"
        reconnect "$LINK_FAILS"
        if [ "$DRY_RUN" != "1" ]; then
            STATE=$(net_state)
            if [ "$STATE" != "LINK_DOWN" ]; then
                log_msg "OK  link restored ($STATE) signal=$(get_signal)%"
                LINK_FAILS=0
            else
                log_msg "     still down - capture continues offline, will retry next check"
            fi
        fi
        ;;
esac
write_count link_fails "$LINK_FAILS"
write_count lan_only "$LAN_ONLY_COUNT"

# ---------- web app ----------
WEB_FAILS=$(read_count web_fails)
if curl -s -m 8 -o /dev/null -w '%{http_code}' "$WEBAPP_URL" 2>/dev/null | grep -q "^200$"; then
    [ "$WEB_FAILS" -ne 0 ] && log_msg "Web app responding again"
    WEB_FAILS=0
else
    WEB_FAILS=$((WEB_FAILS + 1))
    log_msg "FAIL web app not responding on $WEBAPP_URL (consecutive: $WEB_FAILS)"
    if [ "$WEB_FAILS" -ge 2 ]; then
        log_msg "  restarting nevet-webapp"
        act sudo -n systemctl restart nevet-webapp
        WEB_FAILS=0
    fi
fi
write_count web_fails "$WEB_FAILS"

# ---------- camera + services ----------
[ -e "/dev/video0" ] || log_msg "WARN camera /dev/video0 missing (unplugged or USB power issue)"
systemctl is-active --quiet nevet-timelapse.timer 2>/dev/null || log_msg "WARN nevet-timelapse.timer not active"

exit 0
