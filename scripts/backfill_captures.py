#!/usr/bin/env python3
"""backfill_captures.py - One-time: add every existing photo/video in
~/camera_captures to the captures table. Safe to run repeatedly;
files already recorded are skipped.

Usage: python3 scripts/backfill_captures.py
"""
import os
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "webapp"))
import farm_db  # noqa: E402

base = Path(os.environ.get("CAMERA_BASE_DIR", str(Path.home() / "camera_captures")))
added = 0
for kind, folder, exts in (("photo", "photos", {".jpg", ".jpeg"}), ("video", "videos", {".mp4"})):
    for f in sorted((base / folder).rglob("*")):
        if f.suffix.lower() in exts and not f.name.startswith("."):
            st = f.stat()
            farm_db.add_capture(
                kind=kind,
                path=str(f.relative_to(base)),
                taken_at=datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
                size_bytes=st.st_size,
                source="backfill",
            )
            added += 1
print(f"Scanned {added} files. Summary: {farm_db.capture_summary()}")
