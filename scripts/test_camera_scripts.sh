#!/bin/bash
# test_camera_scripts.sh - Sanity-check the camera setup and validate that
# capture_photo.sh / capture_video.sh actually produce correct output.
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

PASS=0
FAIL=0

DEVICE="/dev/video0"
BASE_DIR="$HOME/camera_captures"
PHOTO_DIR="$BASE_DIR/photos"
VIDEO_DIR="$BASE_DIR/videos"

pass() { echo -e "  ${GREEN}✔${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✘${NC} $1"; FAIL=$((FAIL + 1)); }
section() { echo -e "\n${BOLD}${BLUE}== $1 ==${NC}"; }
strip_colors() { sed 's/\x1b\[[0-9;]*m//g'; }

section "1. Environment checks"

if command -v ffmpeg >/dev/null 2>&1; then
    pass "ffmpeg is installed ($(ffmpeg -version | head -n1 | awk '{print $3}'))"
else
    fail "ffmpeg is NOT installed (sudo apt install ffmpeg)"
fi

if [ -e "$DEVICE" ]; then
    pass "$DEVICE exists"
else
    fail "$DEVICE not found — is the camera plugged in? (check: v4l2-ctl --list-devices)"
fi

if [ -x "$SCRIPT_DIR/capture_photo.sh" ]; then
    pass "capture_photo.sh found and executable"
else
    fail "capture_photo.sh missing or not executable"
fi

if [ -x "$SCRIPT_DIR/capture_video.sh" ]; then
    pass "capture_video.sh found and executable"
else
    fail "capture_video.sh missing or not executable"
fi

section "2. Photo capture test"

if [ -x "$SCRIPT_DIR/capture_photo.sh" ] && [ -e "$DEVICE" ]; then
    BEFORE_COUNT=$(find "$PHOTO_DIR" -name "*.jpg" 2>/dev/null | wc -l)
    OUTPUT=$("$SCRIPT_DIR/capture_photo.sh" 2>&1)
    PHOTO_PATH=$(echo "$OUTPUT" | strip_colors | grep -oE "$PHOTO_DIR/[^ ]+\.jpg" | tail -1)

    if [ -n "$PHOTO_PATH" ] && [ -f "$PHOTO_PATH" ]; then
        pass "Photo file was created: $PHOTO_PATH"
        SIZE=$(stat -c%s "$PHOTO_PATH" 2>/dev/null || echo 0)
        if [ "$SIZE" -gt 10000 ]; then
            pass "Photo file size looks reasonable (${SIZE} bytes)"
        else
            fail "Photo file is suspiciously small (${SIZE} bytes) — may be corrupt"
        fi
        if file "$PHOTO_PATH" | grep -qi "jpeg"; then
            pass "File is a valid JPEG"
        else
            fail "File does not look like a valid JPEG"
        fi
        AFTER_COUNT=$(find "$PHOTO_DIR" -name "*.jpg" 2>/dev/null | wc -l)
        if [ "$AFTER_COUNT" -eq "$((BEFORE_COUNT + 1))" ]; then
            pass "Photo count incremented correctly ($BEFORE_COUNT -> $AFTER_COUNT)"
        else
            fail "Photo count did not increment as expected ($BEFORE_COUNT -> $AFTER_COUNT)"
        fi
    else
        fail "Photo file was not created"
        echo "$OUTPUT" | strip_colors | sed 's/^/      /'
    fi
else
    echo -e "  ${YELLOW}⏭  Skipped (missing script or device)${NC}"
fi

section "3. Video capture test (3s clip)"

if [ -x "$SCRIPT_DIR/capture_video.sh" ] && [ -e "$DEVICE" ]; then
    BEFORE_COUNT=$(find "$VIDEO_DIR" -name "*.mp4" 2>/dev/null | wc -l)
    OUTPUT=$("$SCRIPT_DIR/capture_video.sh" 3 2>&1)
    VIDEO_PATH=$(echo "$OUTPUT" | strip_colors | grep -oE "$VIDEO_DIR/[^ ]+\.mp4" | tail -1)

    if [ -n "$VIDEO_PATH" ] && [ -f "$VIDEO_PATH" ]; then
        pass "Video file was created: $VIDEO_PATH"
        SIZE=$(stat -c%s "$VIDEO_PATH" 2>/dev/null || echo 0)
        if [ "$SIZE" -gt 10000 ]; then
            pass "Video file size looks reasonable (${SIZE} bytes)"
        else
            fail "Video file is suspiciously small (${SIZE} bytes) — may be corrupt"
        fi
        if command -v ffprobe >/dev/null 2>&1; then
            DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO_PATH" 2>/dev/null)
            if [ -n "$DURATION" ]; then
                pass "Video is playable, duration: ${DURATION}s"
            else
                fail "ffprobe could not read video duration — file may be corrupt"
            fi
        fi
        AFTER_COUNT=$(find "$VIDEO_DIR" -name "*.mp4" 2>/dev/null | wc -l)
        if [ "$AFTER_COUNT" -eq "$((BEFORE_COUNT + 1))" ]; then
            pass "Video count incremented correctly ($BEFORE_COUNT -> $AFTER_COUNT)"
        else
            fail "Video count did not increment as expected ($BEFORE_COUNT -> $AFTER_COUNT)"
        fi
    else
        fail "Video file was not created"
        echo "$OUTPUT" | strip_colors | sed 's/^/      /'
    fi
else
    echo -e "  ${YELLOW}⏭  Skipped (missing script or device)${NC}"
fi

section "4. Folder structure check"

TODAY=$(date +"%Y-%m-%d")
[ -d "$PHOTO_DIR/$TODAY" ] && pass "Today's photo folder exists ($PHOTO_DIR/$TODAY)" \
                            || fail "Today's photo folder missing"
[ -d "$VIDEO_DIR/$TODAY" ] && pass "Today's video folder exists ($VIDEO_DIR/$TODAY)" \
                            || fail "Today's video folder missing"

echo ""
echo -e "${BOLD}=============================="
if [ "$FAIL" -eq 0 ]; then
    echo -e "  ${GREEN}Results: $PASS passed, $FAIL failed${NC}"
else
    echo -e "  ${RED}Results: $PASS passed, $FAIL failed${NC}"
fi
echo -e "==============================${NC}"

[ "$FAIL" -eq 0 ] && exit 0 || exit 1
