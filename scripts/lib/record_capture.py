#!/usr/bin/env python3
"""record_capture.py - Called by capture_photo.sh / capture_video.sh
after a successful capture to add a row to the farm database.

Never fails the capture: any error is printed and exits 0, so a
database problem can't cost you a photo.

Usage: record_capture.py <photo|video> <absolute_path> [source]
"""
import os
import socket
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "webapp"))


def is_online():
    try:
        socket.create_connection(("8.8.8.8", 53), timeout=2).close()
        return 1
    except OSError:
        return 0


def main():
    if len(sys.argv) < 3:
        print("usage: record_capture.py <photo|video> <path> [source]")
        return
    kind, abs_path = sys.argv[1], Path(sys.argv[2])
    source = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("NEVET_SOURCE", "manual")
    base = Path(os.environ.get("CAMERA_BASE_DIR", str(Path.home() / "camera_captures")))
    try:
        rel = str(abs_path.resolve().relative_to(base.resolve()))
    except ValueError:
        rel = str(abs_path)
    try:
        import farm_db
        farm_db.add_capture(
            kind=kind,
            path=rel,
            taken_at=datetime.now().isoformat(timespec="seconds"),
            size_bytes=abs_path.stat().st_size if abs_path.exists() else None,
            source=source,
            online=is_online(),
        )
    except Exception as e:  # never break a capture over the DB
        print(f"record_capture: database write skipped ({e})")


if __name__ == "__main__":
    main()
