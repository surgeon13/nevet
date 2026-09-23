#!/bin/bash
# fix_orientation.sh - One-time batch fix: flips EXISTING photos and
# videos 180 degrees in place, for footage captured before the camera
# mount orientation was corrected in capture_photo.sh / capture_video.sh.
#
# Safe to interrupt (Ctrl+C) — each file is only replaced after its
# flipped version finishes successfully, so nothing is half-written.
#
# Usage: ./fix_orientation.sh
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
log_init "capture"

BASE_DIR="$HOME/camera_captures"
PHOTO_DIR="$BASE_DIR/photos"
VIDEO_DIR="$BASE_DIR/videos"

PHOTO_COUNT=$(find "$PHOTO_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" \) 2>/dev/null | wc -l)
VIDEO_COUNT=$(find "$VIDEO_DIR" -type f -iname "*.mp4" 2>/dev/null | wc -l)

echo "This will flip $PHOTO_COUNT photo(s) and $VIDEO_COUNT video(s) 180 degrees, in place."
echo "Videos are re-encoded (slower than photos) — this may take a while on a Pi 3B."
read -p "Continue? [y/N] " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Cancelled."
    exit 0
fi

PHOTO_OK=0
PHOTO_FAIL=0
echo ""
echo "Flipping photos..."
while IFS= read -r f; do
    tmp="${f}.tmp.jpg"
    if ffmpeg -y -i "$f" -vf "hflip,vflip" -loglevel error "$tmp" 2>/dev/null; then
        mv "$tmp" "$f"
        PHOTO_OK=$((PHOTO_OK + 1))
    else
        rm -f "$tmp"
        PHOTO_FAIL=$((PHOTO_FAIL + 1))
        echo "  failed: $f"
    fi
done < <(find "$PHOTO_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" \))
echo "Photos: $PHOTO_OK fixed, $PHOTO_FAIL failed."
log_msg "Batch orientation fix: $PHOTO_OK photos fixed, $PHOTO_FAIL failed"

VIDEO_OK=0
VIDEO_FAIL=0
echo ""
echo "Flipping videos (re-encoding, slower)..."
while IFS= read -r f; do
    tmp="${f}.tmp.mp4"
    if ffmpeg -y -i "$f" -vf "hflip,vflip" -c:v libx264 -preset ultrafast -crf 23 -loglevel error "$tmp" 2>/dev/null; then
        mv "$tmp" "$f"
        VIDEO_OK=$((VIDEO_OK + 1))
    else
        rm -f "$tmp"
        VIDEO_FAIL=$((VIDEO_FAIL + 1))
        echo "  failed: $f"
    fi
done < <(find "$VIDEO_DIR" -type f -iname "*.mp4")
echo "Videos: $VIDEO_OK fixed, $VIDEO_FAIL failed."
log_msg "Batch orientation fix: $VIDEO_OK videos fixed, $VIDEO_FAIL failed"

echo ""
echo "Done."
