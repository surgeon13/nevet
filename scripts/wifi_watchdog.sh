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
#                NetworkManager (from the 3rd failed check, then every
#                ~8 min; never a reboot)
#
# Tailscale (if installed): restarts tailscaled if it died, and logs
# when Tailscale goes online / gets logged out.
#
# Web app: checks http://127.0.0.1:8000/healthz. Two failed checks in a
# row (i.e. hung, not just busy) -> restart nevet-webapp.
#
# Also logs which adapter is in use (built-in WiFi or a USB antenna),
# its signal, link speed and router ping, plus Pi health (under-voltage,
# temperature, memory, disk), the usual hidden causes of WiFi dropouts.
#
# Test without changing anything: NEVET_WATCHDOG_DRY_RUN=1 ./wifi_watchdog.sh
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
log_init "watchdog"

DATA_DIR="$HOME/camera_captures"
STATE_DIR="$DATA_DIR/.watchdog"
SYS_NET="${NEVET_SYS_NET:-/sys/class/net}"
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

# ---------- which network adapter? ----------
# The Pi may have the built-in WiFi (wlan0) and a USB WiFi antenna
# (usually wlan1). Watch whichever one carries the internet right now;
# when nothing does, the last one that worked, then a USB antenna.
is_usb() { readlink -f "$SYS_NET/$1/device" 2>/dev/null | grep -q '/usb'; }
iface_label() {
    if is_usb "$1"; then echo "$1 (USB)"
    elif [[ "$1" == wl* ]]; then echo "$1 (built-in)"
    else echo "$1"; fi
}
wifi_ifaces() {
    local f
    for f in "$SYS_NET"/wl*; do [ -e "$f" ] && echo "${f##*/}"; done
}
default_dev() {   # adapter with the internet route: IPv4 first, else IPv6
    { ip route show default; ip -6 route show default; } 2>/dev/null \
        | awk '{for (i = 1; i < NF; i++) if ($i == "dev") {print $(i + 1); exit}}'
}
pick_iface() {
    [ -n "${NEVET_WIFI_IFACE:-}" ] && { echo "$NEVET_WIFI_IFACE"; return; }
    local dev last f first=""
    dev=$(default_dev)
    [ -n "$dev" ] && { echo "$dev"; return; }
    last=$(cat "$STATE_DIR/iface" 2>/dev/null)
    [ -n "$last" ] && [ -e "$SYS_NET/$last" ] && { echo "$last"; return; }
    for f in $(wifi_ifaces); do
        is_usb "$f" && { echo "$f"; return; }
        [ -z "$first" ] && first="$f"
    done
    echo "${first:-wlan0}"
}
IFACE=$(pick_iface)

get_signal() {
    command -v nmcli >/dev/null 2>&1 || { echo "?"; return; }
    local sig
    sig=$(nmcli -t -f DEVICE,ACTIVE,SIGNAL dev wifi 2>/dev/null | awk -F: -v d="$IFACE" '$1 == d && $2 == "yes" {print $3; exit}')
    echo "${sig:-?}"
}
get_bitrate() { iw dev "$IFACE" link 2>/dev/null | awk '/tx bitrate/ {print $3; exit}'; }
router_ms() {
    local gw
    gw=$(ip route show default dev "$IFACE" 2>/dev/null | awk '{print $3; exit}')
    [ -z "$gw" ] && gw=$(ip route 2>/dev/null | awk '/^default/ {print $3; exit}')
    [ -n "$gw" ] && ping -c1 -W2 "$gw" 2>/dev/null | grep -oE 'time=[0-9.]+' | cut -d= -f2
}
link_line() {   # "via wlan1 (USB) signal=78% rate=72.2Mb/s router=3.1ms"
    local rate ms
    rate=$(get_bitrate); ms=$(router_ms)
    echo "via $(iface_label "$IFACE") signal=$(get_signal)%${rate:+ rate=${rate}Mb/s}${ms:+ router=${ms}ms}"
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
        1)
            log_msg "  reconnect step 1: nmcli device reconnect $IFACE"
            act sudo -n nmcli device reconnect "$IFACE" ;;
        2)
            log_msg "  reconnect step 2: WiFi radio off/on"
            act sudo -n nmcli radio wifi off
            [ "$DRY_RUN" = "1" ] || sleep 3
            act sudo -n nmcli radio wifi on ;;
        *)
            # Step 3 (restart NetworkManager, what usually brings a weak
            # link back), then repeated every 4th check (~8 min) instead
            # of hammering it every 2 minutes.
            if [ $(( (level - 3) % 4 )) -eq 0 ]; then
                log_msg "  reconnect step 3: restarting NetworkManager"
                act sudo -n systemctl restart NetworkManager
            else
                log_msg "  reconnect: waiting before next NetworkManager restart"
                return
            fi ;;
    esac
    [ "$DRY_RUN" = "1" ] || sleep 15
}

# Keep WiFi power saving off on every adapter; it's a classic cause of dropouts.
powersave_off() {
    command -v iw >/dev/null 2>&1 || return
    local f
    for f in $(wifi_ifaces); do
        if iw dev "$f" get power_save 2>/dev/null | grep -qi "on"; then
            log_msg "  WiFi power save was ON on $f - turning it off"
            act sudo -n iw dev "$f" set power_save off
        fi
    done
}

# ---------- network ----------
powersave_off
STATE=$(net_state)
LINK=$(link_line)
LINK_FAILS=$(read_count link_fails)
LAN_ONLY_COUNT=$(read_count lan_only)

case "$STATE" in
    ONLINE)
        NO_V4=$(read_count no_ipv4)
        if has_ip; then
            log_msg "OK  online $LINK $(health_line)"
            [ "$NO_V4" -ne 0 ] && log_msg "IPv4 address back on $IFACE after $NO_V4 check(s)"
            NO_V4=0
        else
            # Online over IPv6 only: the WiFi's DHCP didn't give an IPv4
            # address (common with a weak signal). GitHub updates and the
            # home-network address need IPv4, so ask for a new lease: at
            # the 2nd check, then every ~10 min, later every ~30 min.
            NO_V4=$((NO_V4 + 1))
            log_msg "OK  online (IPv6 only, no IPv4 address) $LINK $(health_line)"
            if [ "$NO_V4" -eq 2 ] || { [ "$NO_V4" -le 12 ] && [ $(( (NO_V4 - 2) % 5 )) -eq 0 ]; } || \
               { [ "$NO_V4" -gt 12 ] && [ $(( (NO_V4 - 12) % 15 )) -eq 0 ]; }; then
                log_msg "WARN no IPv4 address for $NO_V4 checks - reconnecting $IFACE to get one"
                command -v nmcli >/dev/null 2>&1 && act sudo -n nmcli device reconnect "$IFACE"
            fi
        fi
        write_count no_ipv4 "$NO_V4"
        echo "$IFACE" > "$STATE_DIR/iface"
        [ "$LINK_FAILS" -ne 0 ] && log_msg "WiFi recovered after $LINK_FAILS failed check(s)"
        [ "$LAN_ONLY_COUNT" -ne 0 ] && log_msg "Internet back after $LAN_ONLY_COUNT check(s) of LAN-only"
        LINK_FAILS=0; LAN_ONLY_COUNT=0
        ;;
    LAN_ONLY)
        LAN_ONLY_COUNT=$((LAN_ONLY_COUNT + 1)); LINK_FAILS=0
        log_msg "WARN WiFi+router OK but no internet (check #$LAN_ONLY_COUNT: ISP outage or captive portal) - not touching WiFi, local access still works. $LINK $(health_line)"
        ;;
    LINK_DOWN)
        LINK_FAILS=$((LINK_FAILS + 1)); LAN_ONLY_COUNT=0
        log_msg "FAIL WiFi link down (no IP or router unreachable, consecutive: $LINK_FAILS) $LINK $(health_line)"
        reconnect "$LINK_FAILS"
        if [ "$DRY_RUN" != "1" ]; then
            STATE=$(net_state)
            if [ "$STATE" != "LINK_DOWN" ]; then
                IFACE=$(pick_iface)
                log_msg "OK  link restored ($STATE) $(link_line)"
                LINK_FAILS=0
            else
                log_msg "     still down - capture continues offline, will retry next check"
            fi
        fi
        ;;
esac
write_count link_fails "$LINK_FAILS"
write_count lan_only "$LAN_ONLY_COUNT"

# ---------- Tailscale (remote access) ----------
tailscale_check() {
    command -v tailscale >/dev/null 2>&1 || return 0
    local state prev
    if systemctl is-active --quiet tailscaled 2>/dev/null; then
        state=$(timeout 6 tailscale status --json 2>/dev/null | grep -m1 -o '"BackendState": *"[A-Za-z]*"' | grep -o '[A-Za-z]*"$' | tr -d '"')
        state="${state:-no-answer}"
    else
        state="stopped"
        if [ "$(systemctl is-enabled tailscaled 2>/dev/null)" = "enabled" ]; then
            log_msg "WARN tailscaled isn't running - restarting it"
            act sudo -n systemctl restart tailscaled
        fi
    fi
    prev=$(cat "$STATE_DIR/tailscale" 2>/dev/null)
    echo "$state" > "$STATE_DIR/tailscale"
    [ "$state" = "$prev" ] && return 0
    case "$state" in
        Running) log_msg "Tailscale online ($(timeout 4 tailscale ip -4 2>/dev/null | head -1))" ;;
        NeedsLogin) log_msg "WARN Tailscale is logged out - remote access is off. Fix: sudo tailscale up" ;;
        NeedsMachineAuth) log_msg "WARN Tailscale waits for approval of this Pi in the admin console" ;;
        Stopped) log_msg "WARN Tailscale is switched off (tailscale down). Fix: sudo tailscale up" ;;
        stopped) log_msg "WARN tailscaled service isn't running" ;;
        *) log_msg "WARN Tailscale state: $state" ;;
    esac
}
tailscale_check

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
CAM="${CAMERA_DEVICE:-/dev/video0}"
CAM_NOW=0; [ -e "$CAM" ] && CAM_NOW=1
if [ -f "$STATE_DIR/camera" ] && [ "$(cat "$STATE_DIR/camera")" != "$CAM_NOW" ]; then
    if [ "$CAM_NOW" = 1 ]; then log_msg "Camera connected ($CAM)"; else log_msg "Camera disconnected ($CAM) - photos paused"; fi
fi
echo "$CAM_NOW" > "$STATE_DIR/camera"
# Timelapse may be switched off on purpose (no camera): only complain when
# it's enabled but not running.
if [ "$(systemctl is-enabled nevet-timelapse.timer 2>/dev/null)" = "enabled" ] && \
   ! systemctl is-active --quiet nevet-timelapse.timer 2>/dev/null; then
    log_msg "WARN nevet-timelapse.timer is enabled but not running"
fi

exit 0
