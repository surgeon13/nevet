#!/bin/bash
# health_report.sh - One-screen summary of why the Pi might be dropping
# offline. Run it and paste the output when asking for help.
#
# Usage: ./scripts/health_report.sh
LOG="$HOME/camera_captures/logs/watchdog.log"

echo "===== NEVET HEALTH REPORT  $(date '+%Y-%m-%d %H:%M') ====="
echo "Uptime:        $(uptime -p 2>/dev/null)"

echo ""
echo "--- Power (most common cause of Pi 3B WiFi drops) ---"
if command -v vcgencmd >/dev/null 2>&1; then
    T=$(vcgencmd get_throttled | cut -d= -f2)
    echo "throttled=$T"
    t=$((T))
    (( t == 0 )) && echo "  OK: no power or heat problems since boot"
    (( t & 0x1 ))     && echo "  PROBLEM: under-voltage RIGHT NOW (weak power supply or cable)"
    (( t & 0x10000 )) && echo "  PROBLEM: under-voltage happened since boot (weak power supply or cable)"
    (( t & 0x4 ))     && echo "  CPU is throttled right now"
    (( t & 0x8 ))     && echo "  Soft temperature limit active right now"
    (( t & 0x80000 )) && echo "  Soft temperature limit reached since boot"
    echo "Temperature:   $(vcgencmd measure_temp | cut -d= -f2)"
else
    echo "vcgencmd not available"
fi

echo ""
echo "--- WiFi ---"
command -v nmcli >/dev/null 2>&1 || echo "nmcli not available"
for f in /sys/class/net/wl*; do          # built-in (wlan0) and USB antennas (wlan1...)
    [ -e "$f" ] || continue
    w=${f##*/}
    case "$(readlink -f "$f/device")" in */usb*) kind="USB antenna" ;; *) kind="built-in" ;; esac
    echo "$w ($kind):"
    echo "  State:       $(nmcli -t -f DEVICE,STATE,CONNECTION device 2>/dev/null | awk -F: -v d="$w" '$1==d{print $2" "$3}')"
    echo "  Signal:      $(nmcli -t -f DEVICE,ACTIVE,SIGNAL dev wifi 2>/dev/null | awk -F: -v d="$w" '$1==d && $2=="yes"{print $3"%"; exit}')"
    echo "  Link rate:   $(iw dev "$w" link 2>/dev/null | awk -F': ' '/tx bitrate/{print $2}')"
    echo "  Power save:  $(iw dev "$w" get power_save 2>/dev/null | awk -F': ' '{print $2}')  (should be off)"
done
echo "Internet via:  $(ip route show default 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1); exit}}')  (IPv6: $(ip -6 route show default 2>/dev/null | awk '{for(i=1;i<NF;i++) if($i=="dev"){print $(i+1); exit}}'))"
echo "IP address:    $(hostname -I 2>/dev/null)"

echo ""
echo "--- Tailscale (access from outside) ---"
if command -v tailscale >/dev/null 2>&1; then
    echo "Service:       $(systemctl is-active tailscaled 2>/dev/null)"
    timeout 6 tailscale status 2>&1 | head -8
else
    echo "not installed"
fi

echo ""
echo "--- Last 24h from watchdog log ---"
if [ -f "$LOG" ]; then
    SINCE=$(date -d '24 hours ago' '+%Y-%m-%d %H:%M')
    RECENT=$(awk -v s="$SINCE" 'substr($0,1,16) >= s' "$LOG")
    echo "Checks OK:            $(echo "$RECENT" | grep -c 'OK  online')"
    echo "WiFi link down:       $(echo "$RECENT" | grep -c 'FAIL WiFi link down')"
    echo "Internet down only:   $(echo "$RECENT" | grep -c 'WARN WiFi+router OK')"
    echo "Web app not answering:$(echo "$RECENT" | grep -c 'FAIL web app')"
    echo "Web app restarts:     $(echo "$RECENT" | grep -c 'restarting nevet-webapp')"
    echo "Under-voltage seen:   $(echo "$RECENT" | grep -ci 'under-voltage')"
    echo ""
    echo "Last 5 problems:"
    grep -E 'FAIL|WARN' "$LOG" | tail -5
else
    echo "No watchdog log yet at $LOG"
fi

echo ""
echo "--- Reboots / crashes ---"
echo "Recent boots:"
journalctl --list-boots 2>/dev/null | tail -5
echo "Web app crashes (last 24h): $(journalctl -u nevet-webapp --since '24 hours ago' 2>/dev/null | grep -ciE 'failed|traceback|killed')"
echo "Out-of-memory kills (this boot): $(journalctl -k -b 2>/dev/null | grep -ci 'out of memory')"

echo ""
echo "--- Resources ---"
free -h | awk 'NR<=3'
df -h "$HOME" | awk 'NR<=2'

echo ""
echo "--- Services ---"
for s in nevet-webapp.service nevet-timelapse.timer nevet-watchdog.timer tailscaled.service; do
    printf "%-26s %s\n" "$s" "$(systemctl is-active $s 2>/dev/null)"
done
echo "Web app /healthz: $(curl -s -m 5 http://127.0.0.1:8000/healthz 2>/dev/null || echo 'NO RESPONSE')"
echo "=========================================="
