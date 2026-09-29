#!/bin/bash
# fix_orientation.sh - Flips photos/videos taken BEFORE the upside-down
# camera fix (capture_photo.sh / capture_video.sh flip new captures
# themselves), 180 degrees, in place.
#
# Safe to run more than once: every flipped file is recorded in
# ~/camera_captures/.orientation_fixed and never flipped again.
# Safe to interrupt (Ctrl+C): a file is only replaced once its flipped
# copy is complete.
#
# Usage:
#   ./fix_orientation.sh --before 2026-09-23   only files from day folders before that date
#   ./fix_orientation.sh --all                 every file not flipped yet (careful: new
#                                              captures are already upright)
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
log_init "capture"

BASE_DIR="$HOME/camera_captures"
DONE_LIST="$BASE_DIR/.orientation_fixed"
BEFORE=""
case "${1:-}" in
    --before)
        BEFORE="${2:-}"
        if ! [[ "$BEFORE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
            echo "Give a date like: $0 --before 2026-09-23"; exit 1
        fi ;;
    --all) ;;
    *)
        sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
        exit 1 ;;
esac
touch "$DONE_LIST"

# Files to flip: right type, not flipped before, and (with --before) in a
# day folder older than the cut-off date.
list_files() {   # $1 = folder, rest = find name filters
    local dir="$1"; shift
    find "$dir" -type f \( "$@" \) ! -name "*.tmp.*" 2>/dev/null | sort | while IFS= read -r f; do
        grep -qxF "$f" "$DONE_LIST" && continue
        if [ -n "$BEFORE" ]; then
            day=$(basename "$(dirname "$f")")
            [[ "$day" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || continue
            [[ "$day" < "$BEFORE" ]] || continue
        fi
        echo "$f"
    done
}

mapfile -t PHOTOS < <(list_files "$BASE_DIR/photos" -iname "*.jpg" -o -iname "*.jpeg")
mapfile -t VIDEOS < <(list_files "$BASE_DIR/videos" -iname "*.mp4")

echo "Will flip ${#PHOTOS[@]} photo(s) and ${#VIDEOS[@]} video(s) 180 degrees${BEFORE:+ (from before $BEFORE)}."
[ "${#PHOTOS[@]}" -eq 0 ] && [ "${#VIDEOS[@]}" -eq 0 ] && { echo "Nothing to do."; exit 0; }
echo "Videos are re-encoded, which is slow on a Pi 3B."
read -r -p "Continue? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Cancelled."
    exit 0
fi

flip() {   # $1 = file, rest = extra ffmpeg output options
    local f="$1"; shift
    local tmp="${f%.*}.tmp.${f##*.}"
    # -nostdin: otherwise ffmpeg reads from the terminal/stdin and can eat input
    if ffmpeg -nostdin -y -i "$f" -vf "hflip,vflip" "$@" -loglevel error "$tmp" 2>/dev/null; then
        mv "$tmp" "$f" && echo "$f" >> "$DONE_LIST"
        return 0
    fi
    rm -f "$tmp"
    echo "  failed: $f"
    return 1
}

OK=0; FAIL=0
for f in "${PHOTOS[@]}"; do
    if flip "$f"; then OK=$((OK + 1)); else FAIL=$((FAIL + 1)); fi
done
echo "Photos: $OK flipped, $FAIL failed."
log_msg "Orientation fix: $OK photos flipped, $FAIL failed${BEFORE:+ (before $BEFORE)}"

OK=0; FAIL=0
for f in "${VIDEOS[@]}"; do
    if flip "$f" -c:v libx264 -preset ultrafast -crf 23; then OK=$((OK + 1)); else FAIL=$((FAIL + 1)); fi
done
echo "Videos: $OK flipped, $FAIL failed."
log_msg "Orientation fix: $OK videos flipped, $FAIL failed${BEFORE:+ (before $BEFORE)}"
echo "Done."
