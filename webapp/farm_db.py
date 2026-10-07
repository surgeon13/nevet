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

# Everything a player can log. "for" limits which kind of asset an action
# makes sense on (plant / worm_bin / any). "new_plant" actions are logged
# by the Add-a-plant form; "legacy" ones exist in older data only.
ACTIONS = [
    {"id": "watering",     "label": "Watering",      "verb": "watered",               "icon": "drop",     "for": "any"},
    {"id": "pruning",      "label": "Pruning",       "verb": "pruned",                "icon": "scissors", "for": "plant"},
    {"id": "fertilizing",  "label": "Fertilizing",   "verb": "fertilized",            "icon": "flask",    "for": "any"},
    {"id": "weeding",      "label": "Weeding",       "verb": "weeded around",         "icon": "leaf",     "for": "plant"},
    {"id": "pest_control", "label": "Pest control",  "verb": "treated pests on",      "icon": "bug",      "for": "plant"},
    {"id": "feeding",      "label": "Feeding worms", "verb": "fed",                   "icon": "worm",     "for": "worm_bin"},
    {"id": "harvest",      "label": "Harvest",       "verb": "harvested",             "icon": "basket",   "for": "any", "amount": True},
    {"id": "germination",  "label": "Sprouted",      "verb": "saw sprouts on",        "icon": "sparkle",  "for": "plant"},
    {"id": "transplant",   "label": "Transplant",    "verb": "transplanted",          "icon": "pot",      "for": "plant"},
    {"id": "observation",  "label": "Check-up",      "verb": "checked on",            "icon": "eye",      "for": "any"},
    {"id": "delivery",     "label": "Gave away",     "verb": "gave away produce from", "icon": "gift",    "for": "any", "amount": True, "recipient": True},
    {"id": "planting",     "label": "Planting",      "verb": "planted",               "icon": "sprout",   "new_plant": True},
    {"id": "seeding",      "label": "Sowing seeds",  "verb": "sowed",                 "icon": "seed",     "new_plant": True},
    {"id": "setup",        "label": "New worm bin",  "verb": "set up",                "icon": "worm",     "new_plant": True},
    {"id": "input",        "label": "Inputs",        "verb": "added inputs to",       "icon": "flask",    "legacy": True},
    {"id": "movement",     "label": "Moved",         "verb": "moved",                 "icon": "pot",      "legacy": True},
]
ACTION_BY_ID = {a["id"]: a for a in ACTIONS}
LOG_TYPES = [a["id"] for a in ACTIONS]
ACTIVE_STAGES_SQL = "(assets.life_stage IS NULL OR assets.life_stage NOT IN ('harvested', 'archived'))"
# Actions that move a plant forward automatically (never backwards).
AUTO_STAGE = {"seeding": "seed", "germination": "germination", "planting": "seedling", "transplant": "seedling"}


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

        -- How much data the web app sent/received, per day, kind of
        -- request and how the visitor connected (see traffic.py).
        -- Garden map (garden_map.py): beds, paths, points and plant pins
        -- as GeoJSON geometry. created_by/updated_by are growers.id.
        CREATE TABLE IF NOT EXISTS map_features (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            category TEXT,
            name TEXT NOT NULL DEFAULT '',
            notes TEXT,
            color TEXT,
            geometry TEXT NOT NULL,
            asset_id INTEGER,
            created_by INTEGER,
            created_at TEXT NOT NULL,
            updated_by INTEGER,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_map_features_asset ON map_features(asset_id);

        -- Small key/value settings (e.g. the garden's map view).
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS web_traffic (
            day TEXT NOT NULL,
            kind TEXT NOT NULL,
            via TEXT NOT NULL,
            requests INTEGER NOT NULL DEFAULT 0,
            bytes_in INTEGER NOT NULL DEFAULT 0,
            bytes_out INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (day, kind, via)
        );
    """)
    # Hero avatars (added later): older databases get the new columns
    # in place, existing growers keep all their data.
    # Accounts (added later): a grower with a password_hash is a player
    # who can log in; growers without one are "unclaimed" heroes.
    # Who did each action (added later). Older logs are credited to the
    # owner of the plant they were logged on.
    log_cols = {r[1] for r in conn.execute("PRAGMA table_info(logs)")}
    if "grower_id" not in log_cols:
        conn.execute("ALTER TABLE logs ADD COLUMN grower_id INTEGER REFERENCES growers(id)")
        conn.execute("UPDATE logs SET grower_id = (SELECT grower_id FROM assets WHERE assets.id = logs.asset_id) "
                     "WHERE grower_id IS NULL")
        conn.commit()
    conn.execute("CREATE INDEX IF NOT EXISTS idx_logs_grower ON logs(grower_id, timestamp)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(timestamp)")

    cols = {r[1] for r in conn.execute("PRAGMA table_info(growers)")}
    # Recycle bin (added later): deleted heroes keep their row with
    # deleted_at set until an admin restores or permanently deletes them.
    for col, decl in (("hero_class", "TEXT"), ("appearance", "TEXT"), ("password_hash", "TEXT"),
                      ("is_admin", "INTEGER NOT NULL DEFAULT 0"), ("last_login", "TEXT"),
                      ("deleted_at", "TEXT"), ("deleted_by", "TEXT")):
        if col not in cols:
            conn.execute(f"ALTER TABLE growers ADD COLUMN {col} {decl}")
    # 3D plant models (added later): the species a grower picked for a
    # plant (plants.py); empty means "detect it from the name".
    asset_cols = {r[1] for r in conn.execute("PRAGMA table_info(assets)")}
    if "species" not in asset_cols:
        conn.execute("ALTER TABLE assets ADD COLUMN species TEXT")
    # People's connections (added later): relationships and groups, see relations.py.
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS relationships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            a_id INTEGER NOT NULL REFERENCES growers(id) ON DELETE CASCADE,
            b_id INTEGER NOT NULL REFERENCES growers(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            note TEXT,
            created_by INTEGER,
            created_at TEXT NOT NULL,
            UNIQUE (a_id, b_id, kind)
        );
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'household',
            note TEXT,
            created_by INTEGER,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS group_members (
            group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            grower_id INTEGER NOT NULL REFERENCES growers(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'member',
            PRIMARY KEY (group_id, grower_id)
        );
        CREATE INDEX IF NOT EXISTS idx_rel_b ON relationships(b_id);
        CREATE INDEX IF NOT EXISTS idx_gm_grower ON group_members(grower_id);
    """)
    return conn


# ---------------------------------------------------------------------
# Relationships and groups (see relations.py)
# ---------------------------------------------------------------------

def _now():
    return datetime.now().isoformat(timespec="seconds")


def add_relationship(a_id, b_id, kind, note=None, by=None):
    """A is the <kind> of B. Returns False when it already exists (either
    direction for symmetric kinds) or the two are the same hero."""
    import relations
    if a_id == b_id or not relations.valid_kind(kind):
        return False
    symmetric = relations.KIND[kind][3]
    conn = get_conn()
    pairs = [(a_id, b_id)] + ([(b_id, a_id)] if symmetric else [])
    for x, y in pairs:
        if conn.execute("SELECT 1 FROM relationships WHERE a_id=? AND b_id=? AND kind=?", (x, y, kind)).fetchone():
            conn.close()
            return False
    conn.execute("INSERT INTO relationships (a_id, b_id, kind, note, created_by, created_at) VALUES (?,?,?,?,?,?)",
                 (a_id, b_id, kind, note, by, _now()))
    conn.commit()
    conn.close()
    return True


def relationships_of(grower_id):
    """Rows for a hero, normalised to the hero's point of view: other_id,
    other_name, other_appearance gender, kind, i_am_a, note."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT r.id, r.kind, r.note, r.a_id, r.b_id,
               o.id AS other_id, o.name AS other_name, o.appearance AS other_look,
               o.deleted_at AS other_deleted
        FROM relationships r
        JOIN growers o ON o.id = CASE WHEN r.a_id = ? THEN r.b_id ELSE r.a_id END
        WHERE (r.a_id = ? OR r.b_id = ?) AND o.deleted_at IS NULL
        ORDER BY r.id""", (grower_id, grower_id, grower_id)).fetchall()
    conn.close()
    return [dict(r, i_am_a=(r["a_id"] == grower_id)) for r in rows]


def get_relationship(rel_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM relationships WHERE id = ?", (rel_id,)).fetchone()
    conn.close()
    return row


def remove_relationship(rel_id):
    conn = get_conn()
    conn.execute("DELETE FROM relationships WHERE id = ?", (rel_id,))
    conn.commit()
    conn.close()


def add_group(name, kind, creator_id, note=None):
    conn = get_conn()
    cur = conn.execute("INSERT INTO groups (name, kind, note, created_by, created_at) VALUES (?,?,?,?,?)",
                       (name, kind, note, creator_id, _now()))
    gid = cur.lastrowid
    conn.execute("INSERT INTO group_members (group_id, grower_id, role) VALUES (?,?, 'coordinator')", (gid, creator_id))
    conn.commit()
    conn.close()
    return gid


def get_group(group_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
    conn.close()
    return row


def list_groups(grower_id=None):
    """All groups with member counts, or just the ones a hero is in (with their role)."""
    conn = get_conn()
    sql = ("SELECT groups.*, (SELECT COUNT(*) FROM group_members m JOIN growers g ON g.id = m.grower_id "
           "WHERE m.group_id = groups.id AND g.deleted_at IS NULL) AS member_count")
    if grower_id is None:
        rows = conn.execute(sql + " FROM groups ORDER BY name COLLATE NOCASE").fetchall()
    else:
        rows = conn.execute(sql + ", gm.role AS my_role FROM groups JOIN group_members gm ON gm.group_id = groups.id "
                            "WHERE gm.grower_id = ? ORDER BY name COLLATE NOCASE", (grower_id,)).fetchall()
    conn.close()
    return rows


def group_members(group_id):
    conn = get_conn()
    rows = conn.execute("""
        SELECT growers.id, growers.name, growers.appearance, growers.hero_class, gm.role
        FROM group_members gm JOIN growers ON growers.id = gm.grower_id
        WHERE gm.group_id = ? AND growers.deleted_at IS NULL
        ORDER BY (gm.role = 'coordinator') DESC, growers.name COLLATE NOCASE""", (group_id,)).fetchall()
    conn.close()
    return rows


def group_role(group_id, grower_id):
    conn = get_conn()
    row = conn.execute("SELECT role FROM group_members WHERE group_id=? AND grower_id=?", (group_id, grower_id)).fetchone()
    conn.close()
    return row["role"] if row else None


def set_group_member(group_id, grower_id, role):
    conn = get_conn()
    conn.execute("INSERT INTO group_members (group_id, grower_id, role) VALUES (?,?,?) "
                 "ON CONFLICT(group_id, grower_id) DO UPDATE SET role = excluded.role", (group_id, grower_id, role))
    conn.commit()
    conn.close()


def remove_group_member(group_id, grower_id):
    """Removes a member; a group left without any coordinator promotes its longest-standing member."""
    conn = get_conn()
    conn.execute("DELETE FROM group_members WHERE group_id=? AND grower_id=?", (group_id, grower_id))
    left = conn.execute("SELECT grower_id, role FROM group_members WHERE group_id=? ORDER BY rowid", (group_id,)).fetchall()
    if left and not any(r["role"] == "coordinator" for r in left):
        conn.execute("UPDATE group_members SET role='coordinator' WHERE group_id=? AND grower_id=?",
                     (group_id, left[0]["grower_id"]))
    if not left:
        conn.execute("DELETE FROM groups WHERE id = ?", (group_id,))
    conn.commit()
    conn.close()


def delete_group(group_id):
    conn = get_conn()
    conn.execute("DELETE FROM groups WHERE id = ?", (group_id,))
    conn.commit()
    conn.close()


def add_asset(asset_type, name, grower_id, variety=None, life_stage=None, species=None):
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO assets (asset_type, name, variety, life_stage, status, grower_id, created_at, species) "
        "VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
        (asset_type, name, variety, life_stage, grower_id, datetime.now().isoformat(timespec="seconds"), species),
    )
    conn.commit()
    asset_id = cur.lastrowid
    conn.close()
    return asset_id


def set_species(asset_id, species):
    """Pick the 3D model species for a plant (None: detect it from the name again)."""
    conn = get_conn()
    conn.execute("UPDATE assets SET species = ? WHERE id = ?", (species or None, asset_id))
    conn.commit()
    conn.close()


def add_log(log_type, asset_id=None, notes=None, recipient=None, location=None, quantities=None,
            grower_id=None, new_stage=None):
    """Records an action. grower_id = the player who did it.
    quantities: list of dicts like {"measure": "weight", "value": 2.5, "units": "kg", "label": "tomatoes"}
    new_stage: set the plant's growth stage explicitly (e.g. "harvested" for a final harvest);
    otherwise some actions move a plant forward automatically, never backwards."""
    conn = get_conn()
    if grower_id is None and asset_id:
        # nobody given: credit the plant's owner (same rule as for old logs)
        owner = conn.execute("SELECT grower_id FROM assets WHERE id = ?", (asset_id,)).fetchone()
        grower_id = owner["grower_id"] if owner else None
    cur = conn.execute(
        "INSERT INTO logs (log_type, asset_id, timestamp, notes, recipient, location, grower_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (log_type, asset_id, datetime.now().isoformat(timespec="seconds"), notes, recipient, location, grower_id),
    )
    log_id = cur.lastrowid
    for q in (quantities or []):
        conn.execute(
            "INSERT INTO quantities (log_id, measure, value, units, label) VALUES (?, ?, ?, ?, ?)",
            (log_id, q.get("measure", "count"), q["value"], q.get("units"), q.get("label")),
        )
    if asset_id:
        asset = conn.execute("SELECT asset_type, life_stage FROM assets WHERE id = ?", (asset_id,)).fetchone()
        if asset and asset["asset_type"] == "plant":
            target = new_stage if new_stage in PLANT_STAGES else None
            if not target and log_type in AUTO_STAGE:
                auto = AUTO_STAGE[log_type]
                current = asset["life_stage"]
                if current not in PLANT_STAGES or PLANT_STAGES.index(auto) > PLANT_STAGES.index(current):
                    target = auto
            if target:
                conn.execute("UPDATE assets SET life_stage = ? WHERE id = ?", (target, asset_id))
    conn.commit()
    conn.close()
    return log_id


def list_growers():
    conn = get_conn()
    rows = conn.execute("""
        SELECT growers.*,
               (SELECT COUNT(*) FROM assets WHERE assets.grower_id = growers.id) AS asset_count,
               (SELECT COUNT(*) FROM logs WHERE logs.grower_id = growers.id) AS log_count,
               (SELECT COUNT(*) FROM logs WHERE logs.grower_id = growers.id
                 AND logs.log_type = 'harvest') AS harvest_count
        FROM growers WHERE growers.deleted_at IS NULL ORDER BY growers.name COLLATE NOCASE
    """).fetchall()
    conn.close()
    return rows


def grower_counts(grower_id):
    conn = get_conn()
    row = conn.execute("""
        SELECT
          (SELECT COUNT(*) FROM assets WHERE grower_id = :g) AS asset_count,
          (SELECT COUNT(*) FROM logs WHERE grower_id = :g) AS log_count,
          (SELECT COUNT(*) FROM logs WHERE grower_id = :g AND log_type = 'harvest') AS harvest_count
    """, {"g": grower_id}).fetchone()
    conn.close()
    return dict(row)


def hero_name_taken(name, exclude_id=None):
    conn = get_conn()
    row = conn.execute(
        "SELECT id FROM growers WHERE lower(name) = lower(?) AND id != ?",
        (name, exclude_id or -1),
    ).fetchone()
    conn.close()
    return row is not None


def create_hero(name, hero_class, appearance_json, password_hash=None, is_admin=False):
    """Creates a hero (and, with a password_hash, a player account).
    Raises ValueError if the name is taken."""
    if hero_name_taken(name):
        raise ValueError("taken")
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO growers (name, joined_at, hero_class, appearance, password_hash, is_admin) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (name, datetime.now().isoformat(timespec="seconds"), hero_class, appearance_json,
         password_hash, 1 if is_admin else 0),
    )
    conn.commit()
    gid = cur.lastrowid
    conn.close()
    return gid


def update_hero(grower_id, name, hero_class, appearance_json):
    if hero_name_taken(name, exclude_id=grower_id):
        raise ValueError("taken")
    conn = get_conn()
    conn.execute(
        "UPDATE growers SET name = ?, hero_class = ?, appearance = ? WHERE id = ?",
        (name, hero_class, appearance_json, grower_id),
    )
    conn.commit()
    conn.close()


def get_grower(grower_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM growers WHERE id = ?", (grower_id,)).fetchone()
    conn.close()
    return row


def get_asset(asset_id):
    conn = get_conn()
    row = conn.execute(
        "SELECT assets.*, growers.name AS grower_name FROM assets "
        "LEFT JOIN growers ON growers.id = assets.grower_id WHERE assets.id = ?", (asset_id,)).fetchone()
    conn.close()
    return row


def list_assets():
    conn = get_conn()
    rows = conn.execute("""
        SELECT assets.*, growers.name AS grower_name
        FROM assets LEFT JOIN growers ON growers.id = assets.grower_id
        ORDER BY assets.created_at DESC
    """).fetchall()
    conn.close()
    return rows


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
    counts["growers"] = conn.execute("SELECT COUNT(*) c FROM growers WHERE deleted_at IS NULL").fetchone()["c"]
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


# ---------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------

def find_grower_by_name(name, include_deleted=False):
    conn = get_conn()
    row = conn.execute("SELECT * FROM growers WHERE lower(name) = lower(?)"
                       + ("" if include_deleted else " AND deleted_at IS NULL"), (name,)).fetchone()
    conn.close()
    return row


def account_count():
    conn = get_conn()
    n = conn.execute("SELECT COUNT(*) FROM growers WHERE password_hash IS NOT NULL AND deleted_at IS NULL").fetchone()[0]
    conn.close()
    return n


def admin_count():
    conn = get_conn()
    n = conn.execute("SELECT COUNT(*) FROM growers WHERE is_admin = 1 AND password_hash IS NOT NULL "
                     "AND deleted_at IS NULL").fetchone()[0]
    conn.close()
    return n


# ---------------------------------------------------------------------
# Recycle bin: deleting a hero only hides it; an admin can restore it
# or delete it for good. Its actions and plants stay in the history.
# ---------------------------------------------------------------------

def delete_hero(grower_id, by_name):
    conn = get_conn()
    conn.execute("UPDATE growers SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL",
                 (datetime.now().isoformat(timespec="seconds"), by_name, grower_id))
    conn.commit()
    conn.close()


def restore_hero(grower_id):
    conn = get_conn()
    conn.execute("UPDATE growers SET deleted_at = NULL, deleted_by = NULL WHERE id = ?", (grower_id,))
    conn.commit()
    conn.close()


def purge_hero(grower_id):
    """Deletes a hero in the bin for good. Its logged actions and plants
    stay, credited to nobody."""
    conn = get_conn()
    if conn.execute("SELECT 1 FROM growers WHERE id = ? AND deleted_at IS NOT NULL", (grower_id,)).fetchone():
        conn.execute("UPDATE assets SET grower_id = NULL WHERE grower_id = ?", (grower_id,))
        conn.execute("UPDATE logs SET grower_id = NULL WHERE grower_id = ?", (grower_id,))
        conn.execute("UPDATE map_features SET created_by = NULL WHERE created_by = ?", (grower_id,))
        conn.execute("UPDATE map_features SET updated_by = NULL WHERE updated_by = ?", (grower_id,))
        conn.execute("DELETE FROM relationships WHERE a_id = ? OR b_id = ?", (grower_id, grower_id))
        conn.execute("DELETE FROM group_members WHERE grower_id = ?", (grower_id,))
        conn.execute("DELETE FROM growers WHERE id = ?", (grower_id,))
        conn.commit()
    conn.close()


def deleted_heroes():
    conn = get_conn()
    rows = conn.execute("""
        SELECT growers.*,
               (SELECT COUNT(*) FROM assets WHERE assets.grower_id = growers.id) AS asset_count,
               (SELECT COUNT(*) FROM logs WHERE logs.grower_id = growers.id) AS log_count,
               (SELECT COUNT(*) FROM logs WHERE logs.grower_id = growers.id
                 AND logs.log_type = 'harvest') AS harvest_count
        FROM growers WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC""").fetchall()
    conn.close()
    return rows


def set_password(grower_id, password_hash):
    conn = get_conn()
    conn.execute("UPDATE growers SET password_hash = ? WHERE id = ?", (password_hash, grower_id))
    conn.commit()
    conn.close()


def set_admin(grower_id, is_admin):
    conn = get_conn()
    conn.execute("UPDATE growers SET is_admin = ? WHERE id = ?", (1 if is_admin else 0, grower_id))
    conn.commit()
    conn.close()


def touch_login(grower_id):
    conn = get_conn()
    conn.execute("UPDATE growers SET last_login = ? WHERE id = ?",
                 (datetime.now().isoformat(timespec="seconds"), grower_id))
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------
# Activity: who did what, per player and for the whole garden.
# grower_id=None means everyone.
# ---------------------------------------------------------------------

def _who(grower_id, col="logs.grower_id"):
    return (f" AND {col} = ?", [grower_id]) if grower_id else ("", [])


def activity_totals(grower_id=None):
    """[(log_type, count)] most frequent first."""
    where, args = _who(grower_id)
    conn = get_conn()
    rows = conn.execute(f"SELECT log_type, COUNT(*) AS n FROM logs WHERE 1=1{where} "
                        f"GROUP BY log_type ORDER BY n DESC, log_type", args).fetchall()
    conn.close()
    return [(r["log_type"], r["n"]) for r in rows]


def activity_count(grower_id=None, since=None):
    where, args = _who(grower_id)
    if since:
        where += " AND logs.timestamp >= ?"
        args.append(since)
    conn = get_conn()
    n = conn.execute(f"SELECT COUNT(*) FROM logs WHERE 1=1{where}", args).fetchone()[0]
    conn.close()
    return n


def daily_activity(grower_id=None, days=14):
    """[(date, count)] for the last `days` days including today, zeros filled in."""
    from datetime import date, timedelta
    start = date.today() - timedelta(days=days - 1)
    where, args = _who(grower_id)
    conn = get_conn()
    rows = conn.execute(f"SELECT substr(timestamp, 1, 10) AS d, COUNT(*) AS n FROM logs "
                        f"WHERE timestamp >= ?{where} GROUP BY d", [start.isoformat()] + args).fetchall()
    conn.close()
    got = {r["d"]: r["n"] for r in rows}
    return [(start + timedelta(days=i), got.get((start + timedelta(days=i)).isoformat(), 0)) for i in range(days)]


def recent_activity(grower_id=None, log_type=None, asset_id=None, since=None, limit=50, offset=0):
    where, args = _who(grower_id)
    if log_type:
        where += " AND logs.log_type = ?"; args.append(log_type)
    if asset_id:
        where += " AND logs.asset_id = ?"; args.append(asset_id)
    if since:
        where += " AND logs.timestamp >= ?"; args.append(since)
    conn = get_conn()
    rows = conn.execute(f"""
        SELECT logs.*, assets.name AS asset_name, assets.asset_type AS asset_type,
               growers.name AS grower_name,
               (SELECT group_concat(trim(printf('%g', q.value) || ' ' || coalesce(q.units, '')), ', ')
                  FROM quantities q WHERE q.log_id = logs.id) AS amount
        FROM logs
        LEFT JOIN assets ON assets.id = logs.asset_id
        LEFT JOIN growers ON growers.id = logs.grower_id
        WHERE 1=1{where}
        ORDER BY logs.timestamp DESC, logs.id DESC
        LIMIT ? OFFSET ?""", args + [limit, offset]).fetchall()
    conn.close()
    return rows


def plants(grower_id=None, current=True):
    """Plants and worm bins; current=True: growing now, False: grown before
    (harvested or archived)."""
    where, args = _who(grower_id, "assets.grower_id")
    state = ACTIVE_STAGES_SQL if current else f"NOT {ACTIVE_STAGES_SQL}"
    conn = get_conn()
    rows = conn.execute(f"""
        SELECT assets.*, growers.name AS grower_name,
               (SELECT MAX(timestamp) FROM logs WHERE logs.asset_id = assets.id) AS last_action
        FROM assets LEFT JOIN growers ON growers.id = assets.grower_id
        WHERE {state}{where}
        ORDER BY assets.asset_type = 'worm_bin', assets.name COLLATE NOCASE""", args).fetchall()
    conn.close()
    return rows


def farm_numbers():
    """Live numbers for the farm: per asset, days since it was last watered
    (a whole-garden watering counts for every plant; never watered counts
    from when it was added) and feedings this month; and this week's totals
    for the farm's chalkboard."""
    from datetime import date, timedelta
    today = date.today()
    week = (today - timedelta(days=6)).isoformat()
    month = today.replace(day=1).isoformat()
    conn = get_conn()
    garden_watered = conn.execute("SELECT MAX(timestamp) FROM logs WHERE log_type = 'watering' AND asset_id IS NULL").fetchone()[0]
    rows = conn.execute("""
        SELECT assets.id, assets.created_at,
               (SELECT MAX(timestamp) FROM logs WHERE logs.asset_id = assets.id AND log_type = 'watering') AS watered,
               (SELECT COUNT(*) FROM logs WHERE logs.asset_id = assets.id AND log_type = 'feeding' AND timestamp >= ?) AS fed
        FROM assets""", (month,)).fetchall()
    one = lambda sql, *a: conn.execute(sql, a).fetchone()[0]
    grams = one("""SELECT COALESCE(SUM(CASE WHEN q.units = 'kg' THEN q.value * 1000 ELSE q.value END), 0)
                   FROM quantities q JOIN logs ON logs.id = q.log_id
                   WHERE logs.log_type = 'harvest' AND logs.timestamp >= ? AND q.units IN ('g', 'kg')""", week)
    numbers = {
        "week": {
            "actions": one("SELECT COUNT(*) FROM logs WHERE timestamp >= ?", week),
            "harvests": one("SELECT COUNT(*) FROM logs WHERE log_type = 'harvest' AND timestamp >= ?", week),
            "kg": round(grams / 1000.0, 1),
            "waterings": one("SELECT COUNT(*) FROM logs WHERE log_type = 'watering' AND timestamp >= ?", week),
            "feedings": one("SELECT COUNT(*) FROM logs WHERE log_type = 'feeding' AND timestamp >= ?", week),
            "growing": one(f"SELECT COUNT(*) FROM assets WHERE {ACTIVE_STAGES_SQL}"),
            "heroes": one("SELECT COUNT(DISTINCT grower_id) FROM logs WHERE timestamp >= ? AND grower_id IS NOT NULL", week),
        },
        "month_feedings": one("SELECT COUNT(*) FROM logs WHERE log_type = 'feeding' AND timestamp >= ?", month),
        "assets": {},
    }
    conn.close()
    now = datetime.now()
    for r in rows:
        last = max([t for t in (r["watered"], garden_watered) if t] or [r["created_at"]])
        try:
            dry = max(0.0, (now - datetime.fromisoformat(last)).total_seconds() / 86400.0)
        except (TypeError, ValueError):
            dry = 0.0
        numbers["assets"][r["id"]] = {"dry": round(dry, 1), "fed": r["fed"]}
    return numbers


def player_activity():
    """Per player: total actions, actions this week, favourite action, last action."""
    from datetime import date, timedelta
    week = (date.today() - timedelta(days=6)).isoformat()
    conn = get_conn()
    rows = conn.execute("""
        SELECT growers.id, growers.name,
               COUNT(logs.id) AS total,
               SUM(CASE WHEN logs.timestamp >= ? THEN 1 ELSE 0 END) AS week,
               MAX(logs.timestamp) AS last_action,
               (SELECT log_type FROM logs l2 WHERE l2.grower_id = growers.id
                 GROUP BY log_type ORDER BY COUNT(*) DESC LIMIT 1) AS favourite,
               (SELECT COUNT(*) FROM assets WHERE assets.grower_id = growers.id
                 AND (assets.life_stage IS NULL OR assets.life_stage NOT IN ('harvested', 'archived'))) AS growing
        FROM growers LEFT JOIN logs ON logs.grower_id = growers.id
        WHERE growers.deleted_at IS NULL
        GROUP BY growers.id
        HAVING total > 0 OR growing > 0
        ORDER BY total DESC, growers.name COLLATE NOCASE""", (week,)).fetchall()
    conn.close()
    return rows


def list_players():
    """Heroes that can log in, most recently active first (for the login picker)."""
    conn = get_conn()
    rows = conn.execute("""SELECT * FROM growers WHERE password_hash IS NOT NULL AND deleted_at IS NULL
                           ORDER BY last_login IS NULL, last_login DESC, name COLLATE NOCASE""").fetchall()
    unclaimed = conn.execute("SELECT * FROM growers WHERE password_hash IS NULL AND deleted_at IS NULL "
                             "ORDER BY name COLLATE NOCASE").fetchall()
    conn.close()
    return rows, unclaimed


def assets_by_ids(ids):
    if not ids:
        return []
    conn = get_conn()
    rows = conn.execute(f"SELECT * FROM assets WHERE id IN ({','.join('?' * len(ids))})", list(ids)).fetchall()
    conn.close()
    return rows
