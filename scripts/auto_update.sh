#!/bin/bash
# auto_update.sh - Keeps the Pi on the latest Nevet version from GitHub.
#
# Every run (via nevet-update.timer, interval set by the second
# install.sh argument, e.g. "sudo ./install.sh 5 15"):
#   1. checks GitHub for a newer version (quietly does nothing if offline)
#   2. if there is one, pulls it (fast-forward only, never merges)
#   3. restarts the web app if web app files changed
#   4. confirms the web app answers on /healthz; if it doesn't, rolls
#      back to the previous version and skips that update until a newer
#      one is published
#
# It never overwrites local edits: if tracked files were changed on the
# Pi, or the Pi has its own commits, it logs a warning and waits.
#
# Usage:
#   ./scripts/auto_update.sh           check and update if needed
#   ./scripts/auto_update.sh --check   only report whether an update exists
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
log_init "update"

BRANCH="${NEVET_UPDATE_BRANCH:-main}"
REMOTE="origin"
HEALTH_URL="${NEVET_HEALTH_URL:-http://127.0.0.1:8000/healthz}"
STATE_DIR="$HOME/camera_captures/.update"
STATUS_FILE="$STATE_DIR/status.json"
LAST_FILE="$STATE_DIR/last_state"
BAD_FILE="$STATE_DIR/bad_commit"
MODE="update"
[ "${1:-}" = "--check" ] && MODE="check"

mkdir -p "$STATE_DIR"

say() {                       # to the terminal (manual runs) and the log
    echo "$1"
    log_msg "$1"
}

# Log routine states ("up to date", "offline") only when they change, so
# the log isn't a wall of identical lines every 15 minutes.
state_changed() {
    local prev=""
    [ -f "$LAST_FILE" ] && prev=$(cat "$LAST_FILE")
    echo "$1" > "$LAST_FILE"
    [ "$prev" != "$1" ]
}

write_status() {              # status + message for anything that wants to show it
    local msg="${2//\"/\'}"
    printf '{"checked_at": "%s", "status": "%s", "version": "%s", "message": "%s"}\n' \
        "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null)" "$msg" \
        > "$STATUS_FILE"
}

web_healthy() {
    [ "$(curl -s -m 4 -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null)" = "200" ]
}

wait_healthy() {              # up to ~60s for the app to come back after a restart
    for _ in $(seq 1 30); do
        web_healthy && return 0
        sleep 2
    done
    return 1
}

restart_webapp() {
    # 9>&- : don't pass our lock to the restarted app, or it would hold
    # the lock forever and block every later update check
    if sudo -n systemctl restart nevet-webapp 9>&- 2>/dev/null; then
        return 0
    fi
    say "WARN couldn't restart nevet-webapp (no permission). Run once: sudo ./install.sh"
    return 1
}

# ---- one run at a time ----
exec 9>"$STATE_DIR/lock"
if ! flock -n 9; then
    echo "Another update check is already running."
    exit 0
fi

cd "$REPO_DIR" || exit 1
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    say "FAIL $REPO_DIR is not a git clone - auto-update needs one (git clone https://github.com/surgeon13/nevet)"
    exit 1
fi

# ---- 1. check GitHub ----
if ! FETCH_OUT=$(timeout 90 git fetch --quiet "$REMOTE" "$BRANCH" 2>&1); then
    if echo "$FETCH_OUT" | grep -qiE "permission denied|insufficient permission|unable to (create|write)"; then
        say "FAIL can't write to $REPO_DIR/.git (some files are owned by root). Fix: sudo chown -R $(id -un):$(id -gn) $REPO_DIR"
        write_status "error" "Repo files owned by another user"
    else
        state_changed "offline" && log_msg "Offline or GitHub unreachable - will try again next run"
        write_status "offline" "GitHub unreachable"
        echo "Couldn't reach GitHub, will try again next run: $(echo "$FETCH_OUT" | head -1)"
    fi
    exit 0
fi

LOCAL=$(git rev-parse HEAD)
LATEST=$(git rev-parse "$REMOTE/$BRANCH")
SHORT_LOCAL=$(git rev-parse --short "$LOCAL")
SHORT_LATEST=$(git rev-parse --short "$LATEST")

if [ "$LOCAL" = "$LATEST" ]; then
    state_changed "uptodate:$LOCAL" && log_msg "Up to date ($SHORT_LOCAL)"
    write_status "up_to_date" "Running the latest version"
    echo "Up to date ($SHORT_LOCAL)."
    exit 0
fi

if ! git merge-base --is-ancestor "$LOCAL" "$LATEST"; then
    state_changed "diverged:$LOCAL:$LATEST" && \
        say "WARN this Pi has commits that aren't on GitHub (history diverged) - not auto-updating. Check with: git status"
    write_status "blocked" "Local commits differ from GitHub"
    exit 0
fi

COUNT=$(git rev-list --count "$LOCAL..$LATEST")
SUMMARY=$(git log --format='  %h %s' "$LOCAL..$LATEST" | head -8)

if [ "$MODE" = "check" ]; then
    echo "Update available: $SHORT_LOCAL -> $SHORT_LATEST ($COUNT new commit(s)):"
    echo "$SUMMARY"
    [ "$(cat "$BAD_FILE" 2>/dev/null)" = "$LATEST" ] && echo "(This version failed its health check here before and is being skipped.)"
    exit 0
fi

if [ "$(cat "$BAD_FILE" 2>/dev/null)" = "$LATEST" ]; then
    state_changed "skip:$LATEST" && \
        say "Skipping $SHORT_LATEST: it broke the web app last time. Waiting for a newer version."
    write_status "skipped" "Version $SHORT_LATEST failed its health check"
    exit 0
fi

# ---- never overwrite edits made on the Pi (file-mode-only changes don't count) ----
if [ -n "$(git -c core.fileMode=false status --porcelain --untracked-files=no)" ]; then
    state_changed "dirty:$LATEST" && \
        say "WARN files in $REPO_DIR were edited on the Pi - not updating so nothing gets overwritten. See: git status"
    write_status "blocked" "Local file edits"
    exit 0
fi

# ---- 2. pull ----
WAS_HEALTHY=0
web_healthy && WAS_HEALTHY=1
CHANGED=$(git diff --name-only "$LOCAL" "$LATEST")

if ! git merge --ff-only --quiet "$LATEST" 2>/dev/null; then
    say "FAIL couldn't apply update $SHORT_LATEST (fast-forward failed) - left unchanged"
    write_status "error" "Update could not be applied"
    exit 1
fi
say "Updated $SHORT_LOCAL -> $SHORT_LATEST ($COUNT commit(s)):"
echo "$SUMMARY" | while IFS= read -r line; do log_msg "$line"; done

if echo "$CHANGED" | grep -v '^config/\.env\.example$' | grep -qE '^(systemd/|install\.sh|config/|webapp/requirements\.txt)'; then
    say "NOTE this update changes system setup (services/dependencies). Run once on the Pi: sudo ./install.sh"
fi

# ---- 3. restart the web app if it changed ----
if ! echo "$CHANGED" | grep -q '^webapp/'; then
    log_msg "No web app changes - no restart needed"
    write_status "updated" "Updated to $SHORT_LATEST"
    rm -f "$BAD_FILE"
    exit 0
fi

restart_webapp || { write_status "updated" "Updated to $SHORT_LATEST, restart needed"; exit 0; }

# ---- 4. health check, roll back if the new version doesn't come up ----
if wait_healthy; then
    say "OK web app restarted and healthy on $SHORT_LATEST"
    write_status "updated" "Updated to $SHORT_LATEST"
    rm -f "$BAD_FILE"
    exit 0
fi

if [ "$WAS_HEALTHY" -ne 1 ]; then
    say "WARN web app isn't answering after the update, but it wasn't answering before either - not rolling back"
    write_status "updated" "Updated to $SHORT_LATEST, web app not responding"
    exit 0
fi

say "FAIL web app didn't come back after updating to $SHORT_LATEST - rolling back to $SHORT_LOCAL"
git reset --hard --quiet "$LOCAL"      # safe: we checked there were no local edits above
echo "$LATEST" > "$BAD_FILE"
restart_webapp
if wait_healthy; then
    say "OK rolled back to $SHORT_LOCAL, web app healthy. Version $SHORT_LATEST will be skipped until a newer one is published."
else
    say "FAIL rolled back to $SHORT_LOCAL but the web app still isn't answering - check: journalctl -u nevet-webapp -n 50"
fi
write_status "rolled_back" "Version $SHORT_LATEST broke the web app, rolled back"
exit 0
