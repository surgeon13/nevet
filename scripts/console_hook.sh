#!/bin/bash
# console_hook.sh - Nevet on the Pi's own screen, with no admin rights needed.
#
# The Pi logs in by itself on its screen (tty1). This puts a few lines at
# the end of that user's login profile so the login there starts
# scripts/nevet_console.sh (the shop window: the farm's news, the QR code
# and the links to open Nevet) instead of leaving a bare prompt.
# SSH logins and other terminals are never touched.
#
#   console_hook.sh on       add the lines and show it now
#   console_hook.sh off      give the screen back to the prompt
#   console_hook.sh status   is it on?
#   console_hook.sh auto     what the updater and the watchdog run: make sure the lines are there (unless it was
#                            turned off) and, the first time, swap the idle prompt on tty1 for the shop window
#
# (`nevet console on|off|status` runs this.) The systemd services nevet-show / nevet-screen, when someone turned them
# on, take tty1 over themselves; then this stays out of the way.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$REPO_DIR/scripts/nevet_console.sh"
OFF_FLAG="$HOME/.nevet-console-off"
STATE="$HOME/.nevet-console-hook"          # the hook's version this Pi has seen (so the first swap happens once)
VERSION=1
BEGIN="# >>> nevet console >>>"
END="# <<< nevet console <<<"

profile() {                                 # the file a login shell reads (bash reads the first of these that exists)
    for f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
        [ -f "$f" ] && { echo "$f"; return; }
    done
    echo "$HOME/.profile"
}

block() {
    cat <<EOF
$BEGIN
# Nevet's shop window on the Pi's own screen (tty1): the farm's news, the QR code and the links to open Nevet.
# Added by Nevet (scripts/console_hook.sh). Turn it off: nevet console off. SSH logins are never touched.
if [ "\$(tty 2>/dev/null)" = "/dev/tty1" ] && [ -z "\${NEVET_CONSOLE:-}" ] && [ ! -e "\$HOME/.nevet-console-off" ] && [ -x "$RUNNER" ]; then
    exec "$RUNNER"
fi
$END
EOF
}

has_block() { grep -qF "$BEGIN" "$1" 2>/dev/null; }
current_block() { sed -n "/^$BEGIN\$/,/^$END\$/p" "$1" 2>/dev/null; }

write_block() {                             # add it, or bring it up to date (the repo may have moved)
    local f; f=$(profile)
    if has_block "$f"; then
        [ "$(current_block "$f")" = "$(block)" ] && return 1
        remove_block "$f"
    fi
    [ -f "$f" ] && [ -n "$(tail -c1 "$f" 2>/dev/null)" ] && echo >> "$f"
    block >> "$f"
    return 0
}

remove_block() {
    local f="$1" tmp
    has_block "$f" || return 0
    tmp=$(mktemp) || return 1
    sed "/^$BEGIN\$/,/^$END\$/d" "$f" > "$tmp" && cat "$tmp" > "$f"
    rm -f "$tmp"
}

tty1_owner_service() {                      # a Nevet service already drawing on tty1?
    for u in nevet-show.service nevet-screen.service; do
        [ "$(systemctl is-active "$u" 2>/dev/null)" = "active" ] && { echo "$u"; return 0; }
    done
    return 1
}

RUNNER_RE="^(/usr)?/bin/bash ${RUNNER}\$"                                   # (exactly the runner, nothing that just mentions it)
SHOW_RE="^python3 ${REPO_DIR}/scripts/nevet_status\.py show -w --kiosk\$"
runner_running() { pgrep -u "$(id -u)" -f "$RUNNER_RE" >/dev/null 2>&1; }

# The shell the Pi logged in by itself on tty1, if it's ours and just sits at the prompt (nothing running in it)
idle_tty1_shell() {
    local pid
    for pid in $(ps -t tty1 -o pid= -o uid= -o comm= 2>/dev/null | awk -v u="$(id -u)" '$2 == u && $3 ~ /^-?(ba|da|z)?sh$/ {print $1}'); do
        [ -z "$(pgrep -P "$pid" 2>/dev/null)" ] && { echo "$pid"; return 0; }
    done
    return 1
}

swap_now() {                                # log in again on tty1 (the Pi does it by itself), now with the shop window
    local pid
    runner_running && return 0
    pid=$(idle_tty1_shell) || return 1
    kill -HUP "$pid" 2>/dev/null
}

case "${1:-status}" in
    on)
        rm -f "$OFF_FLAG"
        write_block && echo "Added Nevet's shop window to $(profile) (only the Pi's own screen, tty1, uses it)."
        echo "$VERSION" > "$STATE"
        if svc=$(tty1_owner_service); then
            echo "Note: $svc is drawing on the screen already (sudo systemctl disable --now $svc to use this instead)."
        elif swap_now; then
            echo "The Pi's screen shows Nevet now."
        elif runner_running; then
            echo "The Pi's screen shows Nevet."
        else
            echo "It starts the next time the Pi logs in on its screen (after a reboot, or log out there)."
            echo "The Pi needs to log in by itself on its screen: sudo raspi-config > System Options > Boot / Auto Login > Console Autologin."
        fi
        ;;
    off)
        touch "$OFF_FLAG"
        pkill -u "$(id -u)" -f "$RUNNER_RE" 2>/dev/null
        pkill -u "$(id -u)" -f "$SHOW_RE" 2>/dev/null
        echo "The Pi's screen goes back to the prompt. (nevet console on brings Nevet back.)"
        ;;
    auto)
        [ -e "$OFF_FLAG" ] && exit 0                     # someone turned it off: leave it off
        [ "${NEVET_CONSOLE_AUTO:-1}" = "0" ] && exit 0
        write_block && logger -t nevet "console: shop window added to $(profile) for the Pi's screen" 2>/dev/null
        if [ "$(cat "$STATE" 2>/dev/null)" != "$VERSION" ]; then
            tty1_owner_service >/dev/null || swap_now
            echo "$VERSION" > "$STATE"
        fi
        exit 0
        ;;
    status)
        f=$(profile)
        if [ -e "$OFF_FLAG" ]; then echo "Nevet on the Pi's screen: off (nevet console on turns it on)"
        elif has_block "$f"; then echo "Nevet on the Pi's screen: on ($f)"
        else echo "Nevet on the Pi's screen: not set up yet (nevet console on)"; fi
        runner_running && echo "Showing now." || echo "Not showing right now."
        svc=$(tty1_owner_service) && echo "($svc is drawing on the screen.)"
        ;;
    *)
        echo "usage: $0 on|off|status|auto" >&2
        exit 2
        ;;
esac
