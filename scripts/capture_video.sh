#!/bin/bash
# capture_video.sh - Record a timestamped, incrementally numbered video clip
# from the Insta360 Air (or any UVC camera on /dev/video0).
#
# Usage: ./capture_video.sh [duration_seconds]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
log_init "capture"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

DEVICE="/dev/video0"
RESOLUTION="1920x960"
FRAMERATE=30
BASE_DIR="$HOME/camera_captures"
VIDEO_DIR="$BASE_DIR/videos"
COUNTER_FILE="$BASE_DIR/.video_counter"
DURATION="${1:-10}"
LOGFILE_TMP=$(mktemp)
trap 'rm -f "$LOGFILE_TMP"' EXIT

mkdir -p "$VIDEO_DIR"
[ -f "$COUNTER_FILE" ] || echo 0 > "$COUNTER_FILE"

COUNT=$(<"$COUNTER_FILE")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"
NUM=$(printf "%04d" "$COUNT")

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
DATE_ONLY=$(date +"%Y-%m-%d")
CREATION_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

DAY_DIR="$VIDEO_DIR/$DATE_ONLY"
mkdir -p "$DAY_DIR"

FILENAME="video_${NUM}_${TIMESTAMP}.mp4"
FILEPATH="$DAY_DIR/$FILENAME"
RAW_TMP="$DAY_DIR/.raw_${NUM}.mp4"

echo -e "${BLUE}🎥  Recording video #${NUM} for ${DURATION}s...${NC}"
log_msg "Recording video #$NUM for ${DURATION}s -> $FILEPATH"

# Record fast via stream copy (no re-encoding, keeps the Pi 3B's CPU
# free during capture). The camera is mounted upside down, so a
# second pass below flips the recorded file 180 degrees; that pass
# isn't time-critical since capture has already finished by then.
if ! ffmpeg -y -f v4l2 -input_format h264 -video_size "$RESOLUTION" -framerate "$FRAMERATE" \
    -i "$DEVICE" -c:v copy -t "$DURATION" \
    "$RAW_TMP" -loglevel error >"$LOGFILE_TMP" 2>&1; then
    echo -e "${RED}✘  Recording failed${NC}"
    cat "$LOGFILE_TMP"
    log_msg "Video #$NUM: FAILED - $(cat "$LOGFILE_TMP" | tr '\n' ' ')"
    rm -f "$RAW_TMP"
    exit 1
fi

echo -e "${BLUE}   correcting orientation...${NC}"

if ffmpeg -y -i "$RAW_TMP" -vf "hflip,vflip" -c:v libx264 -preset ultrafast -crf 23 \
    -metadata creation_time="$CREATION_TIME" \
    "$FILEPATH" -loglevel error >"$LOGFILE_TMP" 2>&1; then
    rm -f "$RAW_TMP"
    SIZE=$(stat -c%s "$FILEPATH" 2>/dev/null || echo 0)
    SIZE_H=$(numfmt --to=iec --suffix=B "$SIZE" 2>/dev/null || echo "${SIZE}B")
    echo -e "${GREEN}✔  Saved${NC} ${BOLD}${FILEPATH}${NC} ${YELLOW}(${SIZE_H})${NC}"
    log_msg "Video #$NUM: saved $FILEPATH ($SIZE_H)"
else
    # Orientation fix failed for some reason — keep the raw (upside
    # down) footage rather than losing the recording entirely.
    mv "$RAW_TMP" "$FILEPATH"
    SIZE=$(stat -c%s "$FILEPATH" 2>/dev/null || echo 0)
    SIZE_H=$(numfmt --to=iec --suffix=B "$SIZE" 2>/dev/null || echo "${SIZE}B")
    echo -e "${YELLOW}⚠  Orientation fix failed, saved upside-down as a fallback${NC} ${FILEPATH} ${YELLOW}(${SIZE_H})${NC}"
    log_msg "Video #$NUM: orientation fix failed, saved raw (upside-down) $FILEPATH ($SIZE_H)"
fi
