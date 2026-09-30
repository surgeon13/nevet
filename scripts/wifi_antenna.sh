#!/bin/bash
# wifi_antenna.sh - Make a USB WiFi antenna the Pi's main connection,
# while the built-in WiFi stays connected as a backup.
#
# Usage:
#   ./scripts/wifi_antenna.sh             show the adapters and which one carries the internet
#   sudo ./scripts/wifi_antenna.sh usb    use the USB antenna first (same WiFi network)
#   sudo ./scripts/wifi_antenna.sh undo   go back to the built-in WiFi only
#
# "usb" copies the WiFi network the Pi is on now (name + password) into
# a second NetworkManager profile, "nevet-usb", tied to the USB adapter
# (by its MAC address) with a better route metric, so internet traffic
# prefers the antenna. The built-in profile isn't touched: if the antenna
# is unplugged or fails, the built-in WiFi still carries the connection.
# Survives reboots. Run `nevet net` before and after to compare.
set -u

PROFILE="nevet-usb"
SYS_NET="${NEVET_SYS_NET:-/sys/class/net}"

is_usb() { case "$(readlink -f "$SYS_NET/$1/device" 2>/dev/null)" in */usb*) return 0 ;; esac; return 1; }

usb_iface() {
    local p
    for p in "$SYS_NET"/wl*; do
        [ -e "$p" ] && is_usb "${p##*/}" && { echo "${p##*/}"; return 0; }
    done
    return 1
}

default_dev() { ip route show default 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "dev") {print $(i + 1); exit}}'; }

unescape() { sed 's/\\\(.\)/\1/g'; }        # nmcli -g escapes ':' and '\'

show() {
    local p w kind
    echo "WiFi adapters:"
    for p in "$SYS_NET"/wl*; do
        [ -e "$p" ] || continue
        w=${p##*/}
        if is_usb "$w"; then kind="USB antenna"; else kind="built-in"; fi
        printf '  %-6s %-12s %s\n' "$w" "$kind" \
            "$(nmcli -t -f DEVICE,STATE,CONNECTION device 2>/dev/null | awk -F: -v d="$w" '$1 == d {print $2 ($3 != "" ? " (" $3 ")" : "")}')"
    done
    echo "Internet goes via: $(default_dev)"
    if nmcli -t -f NAME connection show 2>/dev/null | grep -qx "$PROFILE"; then
        echo "The '$PROFILE' profile is set up (undo: sudo $0 undo)"
    elif usb_iface >/dev/null; then
        echo "To use the USB antenna first: sudo $0 usb"
    else
        echo "No USB WiFi adapter found. Plugged in? Check: lsusb ; ip link"
    fi
}

need_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "Run with sudo: sudo $0 $1"
        exit 1
    fi
    command -v nmcli >/dev/null 2>&1 || { echo "nmcli (NetworkManager) not found - this needs Raspberry Pi OS Bookworm or newer."; exit 1; }
}

use_usb() {
    need_root usb
    local usb src mac keymgmt
    if ! usb=$(usb_iface); then
        echo "No USB WiFi adapter found. Plugged in? Check: lsusb ; ip link"
        exit 1
    fi
    # the WiFi profile in use right now (normally on the built-in wlan0)
    src=$(nmcli -t -f UUID,TYPE,NAME connection show --active 2>/dev/null \
          | awk -F: -v p="$PROFILE" '$2 == "802-11-wireless" && $3 != p {print $1; exit}')
    if [ -z "$src" ]; then
        echo "The Pi isn't connected to WiFi right now, so there's no network to copy."
        echo "Connect first (sudo nmtui), then run this again."
        exit 1
    fi
    keymgmt=$(nmcli -g 802-11-wireless-security.key-mgmt connection show "$src" 2>/dev/null | unescape)
    if [ "$keymgmt" = "wpa-eap" ]; then
        echo "This network uses enterprise login (WPA-EAP); set the antenna up with: sudo nmtui"
        exit 1
    fi
    mac=$(cat "$SYS_NET/$usb/address" 2>/dev/null)
    echo "USB antenna: $usb ($mac)"
    echo "Copying WiFi network \"$(nmcli -g 802-11-wireless.ssid connection show "$src" | unescape)\" to profile '$PROFILE'..."

    nmcli connection delete "$PROFILE" >/dev/null 2>&1
    # clone keeps the password; then tie it to the antenna and prefer it
    if ! nmcli connection clone "$src" "$PROFILE" >/dev/null; then
        echo "Couldn't copy the WiFi profile."
        exit 1
    fi
    local bind=(802-11-wireless.mac-address "$mac" connection.interface-name "")
    [ -n "$mac" ] || bind=(802-11-wireless.mac-address "" connection.interface-name "$usb")
    if ! nmcli connection modify "$PROFILE" "${bind[@]}" \
            connection.autoconnect yes connection.autoconnect-priority 10 \
            ipv4.route-metric 100 ipv6.route-metric 100 802-11-wireless.powersave 2; then
        nmcli connection delete "$PROFILE" >/dev/null 2>&1
        echo "Couldn't configure the new profile - nothing changed."
        exit 1
    fi

    echo "Connecting $usb (up to 45 s; the built-in WiFi stays connected meanwhile)..."
    if ! nmcli --wait 45 connection up "$PROFILE" ifname "$usb" >/dev/null 2>&1; then
        echo "The antenna couldn't join the network (too far? 5 GHz-only dongle on a 2.4 GHz network?)."
        echo "The profile is kept and NetworkManager keeps retrying on its own. Undo: sudo $0 undo"
        exit 1
    fi
    sleep 3
    iw dev "$usb" set power_save off 2>/dev/null
    if [ "$(default_dev)" = "$usb" ]; then
        echo "Done: internet now goes through the USB antenna ($usb); the built-in WiFi is the backup."
    else
        echo "Connected, but internet still goes via $(default_dev). Check: ip route"
    fi
    echo "Compare speeds with: nevet net"
    logger -t nevet "wifi_antenna: $PROFILE set up on $usb" 2>/dev/null
}

undo() {
    need_root undo
    if nmcli connection delete "$PROFILE" >/dev/null 2>&1; then
        echo "Removed '$PROFILE': the built-in WiFi carries the internet again."
    else
        echo "No '$PROFILE' profile to remove."
    fi
}

case "${1:-show}" in
    show|status) show ;;
    usb) use_usb ;;
    undo|builtin) undo ;;
    *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
