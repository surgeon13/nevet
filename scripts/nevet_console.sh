#!/bin/bash
# nevet_console.sh - Nevet's shop window on the Pi's own screen (tty1).
#
# Started by the login on tty1 (the Pi logs in by itself there): see
# scripts/console_hook.sh, which puts a few lines into the login profile.
# It shows what's happening on the farm, the QR code to join and every
# link to open Nevet (internet, the garden's WiFi, Tailscale), page by
# page on a small display, and keeps it fresh. The screen never goes
# blank.
#
#   Ctrl+C       a normal shell (type `exit` and the shop window is back)
#   nevet console off / on / status    (or touch ~/.nevet-console-off)
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export NEVET_CONSOLE=1                 # (the login hook doesn't start a second one, and a shell from here stays a shell)
export TERM="${TERM:-linux}" PYTHONIOENCODING=utf-8
export LANG="${LANG:-C.UTF-8}"
case "${LANG}" in *UTF-8*|*utf8*) ;; *) export LANG=C.UTF-8 ;; esac
export CAMERA_BASE_DIR="${CAMERA_BASE_DIR:-$HOME/camera_captures}"

# the web app's settings (FARM_DB, NEVET_JOIN_URL...), so the screen agrees with it
if [ -f "$REPO_DIR/.env" ]; then
    while IFS= read -r line; do
        case "$line" in ''|\#*) continue ;; esac
        key="${line%%=*}"; val="${line#*=}"
        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
        [ -z "${!key:-}" ] && export "$key=$val"
    done < "$REPO_DIR/.env"
fi

restore() { printf '\033[?25h\033[0m'; }
to_shell() {
    restore
    printf '\n\nShop window stopped.\nType exit to bring it back.\n\n'
    exec bash --login
}
trap to_shell INT
trap restore EXIT

printf '\033[9;0]\033[14;0]' 2>/dev/null      # the console never blanks or powers down the screen
setterm --blank 0 --powerdown 0 >/dev/null 2>&1 || true
while true; do
    [ -e "$HOME/.nevet-console-off" ] && exec bash --login
    printf '\033[?25l'                       # (no blinking cursor)
    python3 "$REPO_DIR/scripts/nevet_status.py" show -w --kiosk
    rc=$?
    [ "$rc" -eq 130 ] && to_shell
    sleep 5                                  # (if it ever stops, it comes back by itself)
done
