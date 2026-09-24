"""Farm data model, inspired by farmOS's Asset + Log + Quantity pattern
(https://github.com/farmOS/farmOS): Assets are the things you grow or
maintain, Logs are events that happen to an asset over time, and
Quantities are numeric measurements attached to a Log (never directly
to an Asset — e.g. a harvest weight belongs to the harvest *log*, not
the plant itself, since a plant may be harvested multiple times).

- growers: the people growing things.
- assets: plants (with a life_stage) and worm bins.
- logs: seeding, germination, transplant, observation, input (e.g.
  feeding worms), harvest, delivery (to a recipient), movement.
- quantities: attached to a log (harvest weight, seed count, etc.).
"""
import os
import sqlite3
from datetime import datetime
from pathlib import Path

DB_PATH = Path(os.environ.get("FARM_DB", str(Path.home() / "webapp" / "farm.db")))

ASSET_TYPES = ["plant", "worm_bin"]
PLANT_STAGES = ["seed", "germination", "seedling", "growing", "mature", "harvested", "archived"]
LOG_TYPES = ["seeding", "germination", "transplant", "observation", "input", "harvest", "delivery", "movement"]


def get_conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS growers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            joined_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_type TEXT NOT NULL,
            name TEXT NOT NULL,
            variety TEXT,
            life_stage TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            grower_id INTEGER REFERENCES growers(id),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            log_type TEXT NOT NULL,
            asset_id INTEGER REFERENCES assets(id),
            timestamp TEXT NOT NULL,
            notes TEXT,
            recipient TEXT,
            location TEXT
        );

        CREATE TABLE IF NOT EXISTS quantities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            log_id INTEGER NOT NULL REFERENCES logs(id),
            measure TEXT NOT NULL,
            value REAL NOT NULL,
            units TEXT,
            label TEXT
        );

        -- One row per photo/video the camera takes (timelapse or manual).
        -- path is relative to CAMERA_BASE_DIR, matching the /media route.
        CREATE TABLE IF NOT EXISTS captures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            taken_at TEXT NOT NULL,
            size_bytes INTEGER,
            source TEXT NOT NULL DEFAULT 'manual',
            online INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_captures_taken_at ON captures(taken_at);
    """)
    return conn


def add_grower(name):
    conn = get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO growers (name, joined_at) VALUES (?, ?)",
        (name, datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()
    row = conn.execute("SELECT id FROM growers WHERE name = ?", (name,)).fetchone()
    conn.close()
    return row["id"]


def add_asset(asset_type, name, grower_id, variety=None, life_stage=None):
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO assets (asset_type, name, variety, life_stage, status, grower_id, created_at) "
        "VALUES (?, ?, ?, ?, 'active', ?, ?)",
        (asset_type, name, variety, life_stage, grower_id, datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()
    asset_id = cur.lastrowid
    conn.close()
    return asset_id


def add_log(log_type, asset_id=None, notes=None, recipient=None, location=None, quantities=None):
    """quantities: list of dicts like {"measure": "weight", "value": 2.5, "units": "kg", "label": "tomatoes"}"""
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO logs (log_type, asset_id, timestamp, notes, recipient, location) VALUES (?, ?, ?, ?, ?, ?)",
        (log_type, asset_id, datetime.now().isoformat(timespec="seconds"), notes, recipient, location),
    )
    log_id = cur.lastrowid
    for q in (quantities or []):
        conn.execute(
            "INSERT INTO quantities (log_id, measure, value, units, label) VALUES (?, ?, ?, ?, ?)",
            (log_id, q.get("measure", "count"), q["value"], q.get("units"), q.get("label")),
        )
    # Seeding/germination/transplant/harvest logs move the plant's life stage forward automatically.
    stage_map = {"seeding": "seed", "germination": "germination", "transplant": "seedling", "harvest": "harvested"}
    if asset_id and log_type in stage_map:
        conn.execute("UPDATE assets SET life_stage = ? WHERE id = ?", (stage_map[log_type], asset_id))
    conn.commit()
    conn.close()
    return log_id


def list_growers():
    conn = get_conn()
    rows = conn.execute("""
        SELECT growers.*,
               (SELECT COUNT(*) FROM assets WHERE assets.grower_id = growers.id) AS asset_count
        FROM growers ORDER BY growers.name
    """).fetchall()
    conn.close()
    return rows


def grower_summary(grower_id):
    conn = get_conn()
    grower = conn.execute("SELECT * FROM growers WHERE id = ?", (grower_id,)).fetchone()
    if not grower:
        conn.close()
        return None, [], []
    assets = conn.execute(
        "SELECT * FROM assets WHERE grower_id = ? ORDER BY created_at DESC", (grower_id,)
    ).fetchall()
    logs = []
    asset_ids = [a["id"] for a in assets]
    if asset_ids:
        placeholders = ",".join("?" * len(asset_ids))
        logs = conn.execute(
            f"SELECT logs.*, assets.name AS asset_name FROM logs "
            f"JOIN assets ON assets.id = logs.asset_id "
            f"WHERE logs.asset_id IN ({placeholders}) ORDER BY logs.timestamp DESC LIMIT 50",
            asset_ids,
        ).fetchall()
    conn.close()
    return grower, assets, logs


def list_assets():
    conn = get_conn()
    rows = conn.execute("""
        SELECT assets.*, growers.name AS grower_name
        FROM assets LEFT JOIN growers ON growers.id = assets.grower_id
        ORDER BY assets.created_at DESC
    """).fetchall()
    conn.close()
    return rows


def asset_detail(asset_id):
    conn = get_conn()
    asset = conn.execute(
        "SELECT assets.*, growers.name AS grower_name FROM assets "
        "LEFT JOIN growers ON growers.id = assets.grower_id WHERE assets.id = ?",
        (asset_id,),
    ).fetchone()
    if not asset:
        conn.close()
        return None, [], {}
    logs = conn.execute("SELECT * FROM logs WHERE asset_id = ? ORDER BY timestamp DESC", (asset_id,)).fetchall()
    quantities = {}
    for log in logs:
        quantities[log["id"]] = conn.execute(
            "SELECT * FROM quantities WHERE log_id = ?", (log["id"],)
        ).fetchall()
    conn.close()
    return asset, logs, quantities


def dashboard_summary():
    conn = get_conn()
    counts = {}
    for stage in PLANT_STAGES:
        counts[stage] = conn.execute(
            "SELECT COUNT(*) c FROM assets WHERE asset_type='plant' AND life_stage=?", (stage,)
        ).fetchone()["c"]
    counts["worm_bins"] = conn.execute(
        "SELECT COUNT(*) c FROM assets WHERE asset_type='worm_bin'"
    ).fetchone()["c"]
    counts["deliveries"] = conn.execute(
        "SELECT COUNT(*) c FROM logs WHERE log_type='delivery'"
    ).fetchone()["c"]
    counts["growers"] = conn.execute("SELECT COUNT(*) c FROM growers").fetchone()["c"]
    conn.close()
    return counts


def add_capture(kind, path, taken_at, size_bytes=None, source="manual", online=None):
    conn = get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO captures (kind, path, taken_at, size_bytes, source, online) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (kind, path, taken_at, size_bytes, source, online),
    )
    conn.commit()
    conn.close()


def capture_summary():
    conn = get_conn()
    row = conn.execute("""
        SELECT
            COUNT(*) AS total,
            SUM(kind = 'photo') AS photos,
            SUM(kind = 'video') AS videos,
            SUM(source = 'timelapse') AS timelapse,
            SUM(online = 0) AS offline,
            MAX(taken_at) AS last_at
        FROM captures
    """).fetchone()
    conn.close()
    return {k: (row[k] or 0) if k != "last_at" else row[k] for k in row.keys()}
