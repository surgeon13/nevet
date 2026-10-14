#!/bin/bash
# update_extras.sh - Keeps Nevet's companion repos up to date.
#
# Reads config/extra_repos.conf ("name url [branch]" per line). Each repo
# is a read-only copy in $NEVET_EXTRAS_DIR/<name> (default ~/nevet-extras):
# cloned the first time, then moved to the newest commit of its branch.
# Local edits are never overwritten: a repo with edits is left alone with
# a warning. Quietly does nothing when offline. Called by auto_update.sh on
# every check; safe to run by hand:
#
#   ./scripts/update_extras.sh           update all
#   ./scripts/update_extras.sh --check   only report what would change
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
log_init "update"

CONF="${NEVET_EXTRAS_CONF:-$REPO_DIR/config/extra_repos.conf}"
EXTRAS_DIR="${NEVET_EXTRAS_DIR:-$HOME/nevet-extras}"
STATE_DIR="$HOME/camera_captures/.update"
STATUS_FILE="$STATE_DIR/extras.json"
MODE="update"
[ "${1:-}" = "--check" ] && MODE="check"

[ -f "$CONF" ] || exit 0
mkdir -p "$EXTRAS_DIR" "$STATE_DIR"

say() { echo "$1"; log_msg "extras: $1"; }

# log routine states only when they change (same idea as auto_update.sh)
state_changed() {
    local f="$STATE_DIR/extra_$1.state" prev=""
    [ -f "$f" ] && prev=$(cat "$f")
    echo "$2" > "$f"
    [ "$prev" != "$2" ]
}

STATUS_ROWS=()
status_row() {                # name status version message
    STATUS_ROWS+=("$(printf '"%s": {"status": "%s", "version": "%s", "message": "%s"}' "$1" "$2" "$3" "${4//\"/\'}")")
}

update_one() {
    local name="$1" url="$2" branch="$3" dir="$EXTRAS_DIR/$1"
    case "$name" in *[!a-z0-9_-]*|"") say "WARN skipping '$name': names are lowercase letters, digits, - and _"; return ;; esac

    if [ ! -d "$dir/.git" ]; then
        if [ "$MODE" = "check" ]; then echo "$name: not downloaded yet (will clone $url)"; return; fi
        if [ -e "$dir" ] && [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
            say "WARN $dir exists but isn't a git clone - leaving it alone"
            status_row "$name" "blocked" "" "Folder exists but is not a clone"; return
        fi
        if timeout 180 git clone --quiet --depth 1 --branch "$branch" "$url" "$dir" 2>/dev/null; then
            say "Downloaded $name ($(git -C "$dir" rev-parse --short HEAD)) from $url"
            status_row "$name" "updated" "$(git -C "$dir" rev-parse --short HEAD)" "Downloaded"
        else
            rm -rf "$dir"
            state_changed "$name" "offline" && log_msg "extras: couldn't download $name yet (offline?)"
            status_row "$name" "offline" "" "Not downloaded yet"
        fi
        return
    fi

    local before; before=$(git -C "$dir" rev-parse HEAD)
    if ! timeout 90 git -C "$dir" fetch --quiet --depth 1 origin "$branch" 2>/dev/null; then
        state_changed "$name" "offline" && log_msg "extras: $name - GitHub unreachable"
        status_row "$name" "offline" "$(git -C "$dir" rev-parse --short HEAD)" "GitHub unreachable"; return
    fi
    local latest; latest=$(git -C "$dir" rev-parse FETCH_HEAD)
    if [ "$before" = "$latest" ]; then
        state_changed "$name" "uptodate:$before" && log_msg "extras: $name up to date ($(git -C "$dir" rev-parse --short HEAD))"
        status_row "$name" "up_to_date" "$(git -C "$dir" rev-parse --short HEAD)" "Latest version"; return
    fi
    if [ "$MODE" = "check" ]; then
        echo "$name: update available $(git -C "$dir" rev-parse --short "$before") -> $(git -C "$dir" rev-parse --short "$latest")"; return
    fi
    if [ -n "$(git -C "$dir" -c core.fileMode=false status --porcelain --untracked-files=no)" ]; then
        state_changed "$name" "dirty:$latest" && say "WARN $name has local edits in $dir - not updating it"
        status_row "$name" "blocked" "$(git -C "$dir" rev-parse --short HEAD)" "Local edits"; return
    fi
    # a shallow read-only copy: jump straight to the new commit
    git -C "$dir" checkout --quiet -B "$branch" "$latest" && git -C "$dir" reset --quiet --hard "$latest"
    say "Updated $name $(git -C "$dir" rev-parse --short "$before") -> $(git -C "$dir" rev-parse --short HEAD)"
    status_row "$name" "updated" "$(git -C "$dir" rev-parse --short HEAD)" "Updated"
}

while read -r name url branch _; do
    case "$name" in ''|'#'*) continue ;; esac
    [ -n "${url:-}" ] || continue
    update_one "$name" "$url" "${branch:-main}"
done < "$CONF"

if [ "$MODE" = "update" ]; then
    { printf '{"checked_at": "%s"' "$(date '+%Y-%m-%d %H:%M:%S')"
      for r in "${STATUS_ROWS[@]+"${STATUS_ROWS[@]}"}"; do printf ', %s' "$r"; done
      printf '}\n'; } > "$STATUS_FILE"
fi
exit 0
