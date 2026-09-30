#!/bin/bash
# camera.sh - shared "is a camera plugged in?" check for the capture
# scripts. Without a camera they skip quietly instead of failing, and
# the log only says so when the situation changes (unplugged / back).
#
# Needs lib/log.sh sourced first. CAMERA_DEVICE overrides /dev/video0.
CAMERA_DEVICE="${CAMERA_DEVICE:-/dev/video0}"
CAMERA_MISSING_FLAG="$HOME/camera_captures/.camera_missing"

camera_ready() {
    if [ -e "$CAMERA_DEVICE" ]; then
        if [ -f "$CAMERA_MISSING_FLAG" ]; then
            rm -f "$CAMERA_MISSING_FLAG"
            log_msg "Camera connected again ($CAMERA_DEVICE) - photos resumed"
        fi
        return 0
    fi
    if [ ! -f "$CAMERA_MISSING_FLAG" ]; then
        mkdir -p "$(dirname "$CAMERA_MISSING_FLAG")"
        touch "$CAMERA_MISSING_FLAG"
        log_msg "Camera not connected ($CAMERA_DEVICE) - photos paused until one is plugged in"
    fi
    return 1
}
