#!/usr/bin/env python3
"""Helper for logging game stats (XP, time, compost, credits, plant growth)
into the SQLite database shared with the web app.

Usage as a library, from your game code:
    from game_stats import log_stat
    log_stat(xp=120, compost=3.5, credits=50)

Usage as a CLI (quick manual test):
    ./game_stats.py --xp 120 --compost 3.5 --credits 50
"""
import os
import argparse
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(os.environ.get("STATS_DB", str(Path.home() / "webapp" / "game_stats.db")))


def _get_conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS stats_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            xp INTEGER,
            time_played INTEGER,
            compost REAL,
            credits INTEGER,
            plant_growth REAL,
            extra TEXT
        )
    """)
    return conn


def log_stat(xp=None, time_played=None, compost=None, credits=None, plant_growth=None, extra=None):
    """Insert one stats snapshot. Pass only the fields you have; the rest
    are stored as NULL for that row (the web app shows the latest row's
    values, and the history table shows the trend over time)."""
    conn = _get_conn()
    conn.execute(
        "INSERT INTO stats_log (timestamp, xp, time_played, compost, credits, plant_growth, extra) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (datetime.now().isoformat(timespec="seconds"), xp, time_played, compost, credits, plant_growth, str(extra or "")),
    )
    conn.commit()
    conn.close()


def latest():
    conn = _get_conn()
    row = conn.execute("SELECT * FROM stats_log ORDER BY id DESC LIMIT 1").fetchone()
    conn.close()
    return row


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--xp", type=int)
    p.add_argument("--time-played", type=int)
    p.add_argument("--compost", type=float)
    p.add_argument("--credits", type=int)
    p.add_argument("--plant-growth", type=float)
    args = p.parse_args()
    log_stat(xp=args.xp, time_played=args.time_played, compost=args.compost,
              credits=args.credits, plant_growth=args.plant_growth)
    print("Logged.")
