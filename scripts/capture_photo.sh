#!/bin/bash
# capture_photo.sh - Take a timestamped, incrementally numbered photo
# from the Insta360 Air (or any UVC camera on /dev/video0).
#
# Usage: ./capture_photo.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/log.sh"
log_init "capture"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

DEVICE="/dev/video0"
RESOLUTION="3008x1504"
BASE_DIR="$HOME/camera_captures"
PHOTO_DIR="$BASE_DIR/photos"
COUNTER_FILE="$BASE_DIR/.photo_counter"
LOGFILE_TMP=$(mktemp)
trap 'rm -f "$LOGFILE_TMP"' EXIT

mkdir -p "$PHOTO_DIR"
[ -f "$COUNTER_FILE" ] || echo 0 > "$COUNTER_FILE"

COUNT=$(<"$COUNTER_FILE")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"
NUM=$(printf "%04d" "$COUNT")

TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
DATE_ONLY=$(date +"%Y-%m-%d")
DISPLAY_TS=$(date +"%Y-%m-%d %H:%M:%S")
ESCAPED_TS=$(printf '%s' "$DISPLAY_TS" | sed 's/:/\\:/g')

DAY_DIR="$PHOTO_DIR/$DATE_ONLY"
mkdir -p "$DAY_DIR"

FILENAME="photo_${NUM}_${TIMESTAMP}.jpg"
FILEPATH="$DAY_DIR/$FILENAME"

echo -e "${BLUE}📸  Capturing photo #${NUM}...${NC}"
log_msg "Capturing photo #$NUM -> $FILEPATH"

capture_frame() {
    ffmpeg -y -f v4l2 -input_format mjpeg -video_size "$RESOLUTION" -i "$DEVICE" \
        -frames:v 5 -update 1 -vf "hflip,vflip" "$FILEPATH" -loglevel error >"$LOGFILE_TMP" 2>&1
}

capture_frame || true

if ! file "$FILEPATH" 2>/dev/null | grep -qi "jpeg"; then
    echo -e "${YELLOW}   frame was corrupt, retrying...${NC}"
    log_msg "Photo #$NUM: frame corrupt, retrying"
    sleep 1
    capture_frame || true
fi

if ! file "$FILEPATH" 2>/dev/null | grep -qi "jpeg"; then
    echo -e "${RED}✘  Capture failed${NC}"
    cat "$LOGFILE_TMP"
    log_msg "Photo #$NUM: FAILED - $(cat "$LOGFILE_TMP" | tr '\n' ' ')"
    exit 1
fi

FONT_PATH=""
for f in /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf \
         /usr/share/fonts/truetype/freefont/FreeSansBold.ttf; do
    [ -f "$f" ] && FONT_PATH="$f" && break
done

if [ -n "$FONT_PATH" ]; then
    TMP="${FILEPATH}.tmp.jpg"
    if ffmpeg -y -i "$FILEPATH" -vf \
        "drawtext=fontfile=${FONT_PATH}:text='${ESCAPED_TS}':x=10:y=h-th-10:fontsize=32:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=6" \
        -loglevel error "$TMP" >"$LOGFILE_TMP" 2>&1; then
        mv "$TMP" "$FILEPATH"
    else
        echo -e "${YELLOW}⚠  Timestamp overlay failed, keeping plain photo${NC}"
        log_msg "Photo #$NUM: overlay failed, kept plain photo"
    fi
else
    echo -e "${YELLOW}⚠  No font found for overlay (sudo apt install fonts-dejavu-core)${NC}"
fi

SIZE=$(stat -c%s "$FILEPATH" 2>/dev/null || echo 0)
SIZE_H=$(numfmt --to=iec --suffix=B "$SIZE" 2>/dev/null || echo "${SIZE}B")

echo -e "${GREEN}✔  Saved${NC} ${BOLD}${FILEPATH}${NC} ${YELLOW}(${SIZE_H})${NC}"
log_msg "Photo #$NUM: saved $FILEPATH ($SIZE_H)"
