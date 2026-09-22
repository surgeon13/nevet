#!/bin/bash
# log.sh - Shared logging helper for all Nevet shell scripts.
#
# Usage, from any script in scripts/:
#   source "$(cd "$(dirname "$0")" && pwd)/lib/log.sh"
#   log_init "capture"        # writes to logs/capture.log
#   log_msg "Something happened"
#
# All logs live under $HOME/camera_captures/logs/ — one file per
# subsystem (capture.log, watchdog.log, webapp.log), git-ignored,
# rotated weekly via config/nevet-logrotate.conf.

LOGS_DIR="$HOME/camera_captures/logs"
mkdir -p "$LOGS_DIR"

log_init() {
    LOG_FILE="$LOGS_DIR/$1.log"
}

log_msg() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "${LOG_FILE:-$LOGS_DIR/general.log}"
}
