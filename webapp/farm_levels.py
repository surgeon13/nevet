"""Levels for the 3D farm's village view, like the building levels in a village game: every building and field on
the farm has a level, and it only grows from what really happens in the garden and among its people.

Each place has one measure (plants added, kilograms harvested, worm feedings, bouts in the mud arena, friends who
joined through an invite...). Level 1 comes with the first `first` of it, and every next level needs GROW times as
much as the one before (so early levels come quickly and later ones take real work), up to MAX. Everything is counted
from the records that are already there, so levels never need saving and can't be bought or faked, and the measures
only ever add up, so a level never goes back down.

levels() -> [{id, name, emoji, view ('village' or 'fields'), level, value, shown, next, pct, grows}] for the farm page
(static/js/farm3d.js draws a bubble with the level on each place).
"""
import math
from datetime import date, datetime

import farm_db

GROW = 1.6
MAX = 20

# id, name, emoji, view, what makes it grow, unit (for "12 waterings"), first level at
PLACES = [
    ("arena", "Mud arena", "🤼", "village", "every bout fought in the mud arena", "bouts", 1),
    ("stage", "Rave stage", "🎧", "village", "every party and event held", "events", 1),
    ("garden", "Garden beds", "🌱", "village", "every plant added to the garden", "plants", 1),
    ("barn", "Barn", "🧺", "village", "every kilogram harvested", "kg harvested", 0.5),
    ("worms", "Worm bins", "🪱", "village", "every time the worms are fed", "feedings", 1),
    ("pond", "Pond & pump", "💧", "village", "every watering", "waterings", 2),
    ("field", "Planting field", "🌾", "village", "every seed sown, planted or moved", "plantings", 1),
    ("greenhouse", "Greenhouse", "🪴", "village", "every new kind of plant grown", "kinds of plants", 1),
    ("windmill", "Windmill", "🌬️", "village", "every job logged in the garden", "jobs", 5),
    ("park", "Play park", "⚽", "village", "every football match in the park", "matches", 1),
    ("mother", "Mother tree", "🌳", "village", "every hero on the farm", "heroes", 1),
    ("orchard", "Orchard", "🍎", "fields", "every friend who joined through an invite", "invited", 1),
    ("market", "Market garden", "🥬", "fields", "every harvest picked", "harvests", 1),
    ("tunnels", "Polytunnels", "🍅", "fields", "every weeding, pruning, feeding of the soil and pest check", "care jobs", 1),
    ("sunflowers", "Sunflowers", "🌻", "fields", "every hero who has done garden work", "gardeners", 1),
    ("vineyard", "Vineyard", "🍇", "fields", "every connection and group between heroes", "connections", 1),
    ("hives", "Beehives", "🐝", "fields", "every day the garden is tended", "busy days", 2),
    ("pumpkins", "Pumpkin patch", "🎃", "fields", "the XP everyone earns", "XP", 50),
    ("wheat", "Wheat", "🌾", "fields", "every week the farm keeps growing", "weeks", 1),
    ("corn", "Corn", "🌽", "fields", "every time produce is given away", "gifts", 1),
    ("haybarn", "Hay barn", "🏚️", "fields", "every kilogram fed to the worms", "kg of worm food", 0.5),
]


def at(level, first):
    """How much of the measure level `level` needs (0 for level 0)."""
    return 0 if level <= 0 else first * GROW ** (level - 1)


def level_of(value, first):
    """-> (level, share of the way to the next level 0..1)."""
    if value < first:
        return 0, max(0.0, value / first)
    lv = min(MAX, int(math.floor(math.log(value / first, GROW) + 1e-9)) + 1)
    if lv >= MAX:
        return MAX, 1.0
    lo, hi = at(lv, first), at(lv + 1, first)
    return lv, max(0.0, min(1.0, (value - lo) / (hi - lo)))


def measures(conn=None):
    """{place id: value} from the records (each one on its own, so a missing table only leaves that one at 0)."""
    own = conn is None
    conn = conn or farm_db.get_conn()
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    now = datetime.now().isoformat(timespec="seconds")
    out = {}

    def one(key, sql, *args, need=()):
        if any(t not in tables for t in need):
            out[key] = 0
            return
        try:
            out[key] = conn.execute(sql, args).fetchone()[0] or 0
        except Exception:                               # (an old database: that place stays at level 0)
            out[key] = 0

    def kg(log_type):
        return ("""SELECT COALESCE(SUM(CASE WHEN q.units = 'kg' THEN q.value WHEN q.units = 'g' THEN q.value / 1000.0 ELSE 0 END), 0)
                   FROM quantities q JOIN logs l ON l.id = q.log_id WHERE l.log_type = '%s'""" % log_type)
    one("arena", "SELECT COUNT(*) FROM game_matches WHERE game = 'arena' AND COALESCE(style, '') != 'ceremony' AND ends_at <= ?", now, need=("game_matches",))
    one("park", "SELECT COUNT(*) FROM game_matches WHERE game = 'football' AND ends_at <= ?", now, need=("game_matches",))
    one("stage", "SELECT COUNT(*) FROM events WHERE deleted_at IS NULL AND COALESCE(status, '') != 'cancelled' AND starts_at <= ?", now, need=("events",))
    one("garden", "SELECT COUNT(*) FROM assets WHERE asset_type = 'plant'")
    one("barn", kg("harvest"), need=("quantities",))
    one("haybarn", kg("feeding"), need=("quantities",))
    one("worms", "SELECT COUNT(*) FROM logs WHERE log_type = 'feeding'")
    one("pond", "SELECT COUNT(*) FROM logs WHERE log_type = 'watering'")
    one("field", "SELECT COUNT(*) FROM logs WHERE log_type IN ('seeding', 'planting', 'transplant', 'germination')")
    one("greenhouse", "SELECT COUNT(DISTINCT COALESCE(NULLIF(species, ''), LOWER(name))) FROM assets WHERE asset_type = 'plant'")
    one("windmill", "SELECT COUNT(*) FROM logs")
    one("mother", "SELECT COUNT(*) FROM growers WHERE deleted_at IS NULL")
    one("orchard", "SELECT COUNT(*) FROM growers WHERE deleted_at IS NULL AND invited_by IS NOT NULL")
    one("market", "SELECT COUNT(*) FROM logs WHERE log_type = 'harvest'")
    one("tunnels", "SELECT COUNT(*) FROM logs WHERE log_type IN ('weeding', 'pruning', 'fertilizing', 'pest_control')")
    one("sunflowers", "SELECT COUNT(DISTINCT grower_id) FROM logs WHERE grower_id IS NOT NULL")
    one("vineyard", "SELECT (SELECT COUNT(*) FROM relationships WHERE status = 'accepted') + (SELECT COUNT(*) FROM groups)", need=("relationships", "groups"))
    one("hives", "SELECT COUNT(DISTINCT substr(timestamp, 1, 10)) FROM logs")
    one("corn", "SELECT COUNT(*) FROM logs WHERE log_type = 'delivery'")
    try:
        first = conn.execute("SELECT MIN(substr(timestamp, 1, 10)) FROM logs").fetchone()[0]
        out["wheat"] = (date.today() - date.fromisoformat(first)).days // 7 + 1 if first else 0
    except Exception:
        out["wheat"] = 0
    try:
        out["pumpkins"] = sum(farm_db.xp_by_grower("", conn).values())
    except Exception:
        out["pumpkins"] = 0
    if own:
        conn.close()
    return out


ONE = {"heroes": "hero", "matches": "match", "kinds of plants": "kind of plant"}


def _shown(value, unit):
    v = round(value, 1) if isinstance(value, float) and value % 1 else int(value)
    if v == 1:
        unit = ONE.get(unit, unit[:-1] if unit.endswith("s") else unit)
    return f"{v:g} {unit}" if isinstance(v, float) else f"{v} {unit}"


def levels(conn=None):
    m = measures(conn)
    out = []
    for pid, name, emoji, view, grows, unit, first in PLACES:
        value = m.get(pid, 0) or 0
        lv, pct = level_of(value, first)
        nxt = None if lv >= MAX else at(lv + 1, first)
        if nxt is not None:                            # (a count's next level is a whole number of them)
            nxt = round(nxt, 1) if first < 1 else int(math.ceil(nxt - 1e-9))
            lo = at(lv, first) if first < 1 else math.ceil(at(lv, first) - 1e-9)
            pct = max(0.0, min(1.0, (value - lo) / ((nxt - lo) or 1)))
        out.append({"id": pid, "name": name, "emoji": emoji, "view": view, "level": lv, "value": value,
                    "shown": _shown(value, unit), "next": nxt, "next_shown": _shown(nxt, unit) if nxt is not None else None,
                    "pct": round(pct, 3), "grows": grows})
    return out
