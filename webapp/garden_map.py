"""Garden map: beds, paths and points drawn on an open map, plus the
garden's plants and worm bins pinned where they grow.

Everything is stored as GeoJSON geometry (WGS84, [longitude, latitude])
in the map_features table, so the whole map exports as a standard
.geojson file that other tools (and, later, other Nevet gardens) can read.

Kinds of map items:
- area  (Polygon):    garden beds, growing areas, greenhouse, pond...
- path  (LineString): walkways, irrigation lines, fences
- point (Point):      water tap, compost, tree, tool shed, Nevet node...
- asset (Point):      one of the garden's plants / worm bins (asset_id)

Deleting is a soft delete (deleted_at), so it can be undone.
"""
import json
import math
import os
import re
from datetime import datetime

import farm_db

KINDS = {"area": "Polygon", "path": "LineString", "point": "Point", "asset": "Point"}

# id, label, default colour, icon (drawn by static/js/garden_map.js)
CATEGORIES = {
    "area": [
        {"id": "bed", "label": "Garden bed", "color": "#5f9e4f"},
        {"id": "zone", "label": "Growing area", "color": "#8fbf6a"},
        {"id": "greenhouse", "label": "Greenhouse", "color": "#6aa6b0"},
        {"id": "orchard", "label": "Orchard", "color": "#3f7d3a"},
        {"id": "herbs", "label": "Herb garden", "color": "#9bbf3b"},
        {"id": "lawn", "label": "Lawn", "color": "#b5d69a"},
        {"id": "compost", "label": "Compost area", "color": "#8d6e52"},
        {"id": "water", "label": "Pond / water", "color": "#5b9bd5"},
        {"id": "wild", "label": "Wildflowers", "color": "#c27ba0"},
        {"id": "seating", "label": "Seating / shade", "color": "#b39a7a"},
        {"id": "community", "label": "Community garden", "color": "#e69138"},
        {"id": "other", "label": "Other area", "color": "#9aa39a"},
    ],
    "path": [
        {"id": "path", "label": "Walkway", "color": "#b08d57"},
        {"id": "irrigation", "label": "Irrigation line", "color": "#3d85c6"},
        {"id": "fence", "label": "Fence / hedge", "color": "#6d5a46"},
        {"id": "other", "label": "Other line", "color": "#8a8f8a"},
    ],
    "point": [
        {"id": "tap", "label": "Water tap", "color": "#3d85c6", "icon": "drop"},
        {"id": "compost", "label": "Compost", "color": "#8d6e52", "icon": "recycle"},
        {"id": "tree", "label": "Tree", "color": "#3f7d3a", "icon": "tree"},
        {"id": "tools", "label": "Tool shed", "color": "#8a6d1f", "icon": "tools"},
        {"id": "seat", "label": "Seating", "color": "#a67c52", "icon": "bench"},
        {"id": "hive", "label": "Beehive", "color": "#d9a400", "icon": "hive"},
        {"id": "rain", "label": "Rain barrel", "color": "#5b9bd5", "icon": "barrel"},
        {"id": "gate", "label": "Gate / entrance", "color": "#6b6b6b", "icon": "gate"},
        {"id": "node", "label": "Nevet node", "color": "#4c9a5b", "icon": "antenna"},
        {"id": "note", "label": "Note", "color": "#d9534f", "icon": "pin"},
    ],
    "asset": [
        {"id": "plant", "label": "Plant", "color": "#4c9a5b", "icon": "sprout"},
        {"id": "worm_bin", "label": "Worm bin", "color": "#8d6e52", "icon": "worm"},
    ],
}
PALETTE = ["#5f9e4f", "#8fbf6a", "#3f7d3a", "#9bbf3b", "#e69138", "#d9a400",
           "#c27ba0", "#d9534f", "#5b9bd5", "#6aa6b0", "#8d6e52", "#9aa39a"]
NAME_MAX, NOTES_MAX, MAX_POINTS = 60, 500, 2000
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

# Where the map opens before an admin saves the garden's own spot.
# NEVET_MAP_CENTER="lat,lng,zoom" in .env overrides it.
DEFAULT_VIEW = {"lat": 31.6, "lng": 34.95, "zoom": 8}


def _now():
    return datetime.now().isoformat(timespec="seconds")


def category(kind, cat_id):
    return next((c for c in CATEGORIES.get(kind, []) if c["id"] == cat_id), None)


# ---------------------------------------------------------------- geometry

def _num(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError("bad number")
    return float(v)


def _position(p):
    if not isinstance(p, (list, tuple)) or len(p) < 2:
        raise ValueError("bad position")
    lng, lat = _num(p[0]), _num(p[1])
    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        raise ValueError("position outside the world")
    return [round(lng, 8), round(lat, 8)]


def clean_geometry(kind, geom):
    """Returns a clean GeoJSON geometry dict for this kind, or raises ValueError."""
    want = KINDS[kind]
    if not isinstance(geom, dict) or geom.get("type") != want:
        raise ValueError(f"needs a {want}")
    coords = geom.get("coordinates")
    if want == "Point":
        return {"type": "Point", "coordinates": _position(coords)}
    if want == "LineString":
        if not isinstance(coords, list) or not 2 <= len(coords) <= MAX_POINTS:
            raise ValueError("a line needs at least 2 points")
        return {"type": "LineString", "coordinates": [_position(p) for p in coords]}
    # Polygon: outer ring only (holes aren't used in a garden map)
    if not isinstance(coords, list) or not coords or not isinstance(coords[0], list):
        raise ValueError("bad polygon")
    ring = [_position(p) for p in coords[0]]
    if ring and ring[0] != ring[-1]:
        ring.append(list(ring[0]))
    if not 4 <= len(ring) <= MAX_POINTS:
        raise ValueError("an area needs at least 3 corners")
    return {"type": "Polygon", "coordinates": [ring]}


EARTH_R = 6378137.0


def area_m2(geom):
    """Approximate area of a Polygon in square metres (spherical excess)."""
    if not geom or geom.get("type") != "Polygon":
        return 0.0
    ring = geom["coordinates"][0]
    total = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        total += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
    return abs(total * EARTH_R * EARTH_R / 2.0)


def length_m(geom):
    if not geom or geom.get("type") != "LineString":
        return 0.0
    pts = geom["coordinates"]
    d = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        p1, p2 = math.radians(y1), math.radians(y2)
        a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(x2 - x1) / 2) ** 2
        d += 2 * 6371000.0 * math.asin(min(1.0, math.sqrt(a)))     # same radius as Leaflet's distanceTo
    return d


# ---------------------------------------------------------------- validation

def clean(data, existing=None):
    """Validates a create (existing=None) or update payload.
    Returns (fields_dict, error_message_or_None)."""
    if not isinstance(data, dict):
        return {}, "Send the map item as JSON."
    out = {}
    kind = existing["kind"] if existing else data.get("kind")
    if kind not in KINDS:
        return {}, "Unknown kind of map item."
    if not existing:
        out["kind"] = kind
    if kind == "asset":
        # a pinned plant takes its name and type from the plant itself
        data = {k: v for k, v in data.items() if k not in ("category", "name", "color")}
    elif "category" in data or not existing:
        cat = data.get("category") or (existing["category"] if existing else None)
        if not category(kind, cat):
            return {}, "Pick a type from the list."
        out["category"] = cat
    if kind != "asset" and ("name" in data or not existing):
        name = " ".join(str(data.get("name") or "").split())
        if len(name) > NAME_MAX:
            return {}, f"Names can be at most {NAME_MAX} characters."
        out["name"] = name
    if "notes" in data:
        notes = str(data.get("notes") or "").strip()
        if len(notes) > NOTES_MAX:
            return {}, f"Notes can be at most {NOTES_MAX} characters."
        out["notes"] = notes or None
    if "color" in data:
        color = data.get("color") or None
        if color and not COLOR_RE.match(str(color)):
            return {}, "Colours look like #5f9e4f."
        out["color"] = color.lower() if color else None
    if "geometry" in data or not existing:
        try:
            out["geometry"] = clean_geometry(kind, data.get("geometry"))
        except (ValueError, TypeError, KeyError) as e:
            return {}, f"That shape can't be saved ({e})."
    if kind == "asset" and not existing:
        try:
            asset_id = int(data.get("asset_id"))
        except (TypeError, ValueError):
            return {}, "Pick a plant or worm bin to pin."
        asset = farm_db.get_asset(asset_id)
        if not asset:
            return {}, "That plant or worm bin doesn't exist."
        out["asset_id"] = asset_id
        out["category"] = asset["asset_type"]
    return out, None


# ---------------------------------------------------------------- storage

_SELECT = """
    SELECT f.*, cg.name AS created_by_name, ug.name AS updated_by_name,
           a.name AS asset_name, a.asset_type AS asset_type, a.variety AS asset_variety,
           a.life_stage AS asset_stage, ag.name AS asset_owner
    FROM map_features f
    LEFT JOIN growers cg ON cg.id = f.created_by
    LEFT JOIN growers ug ON ug.id = f.updated_by
    LEFT JOIN assets a ON a.id = f.asset_id
    LEFT JOIN growers ag ON ag.id = a.grower_id
"""


def list_features():
    conn = farm_db.get_conn()
    rows = conn.execute(_SELECT + " WHERE f.deleted_at IS NULL ORDER BY f.kind = 'area' DESC, f.id").fetchall()
    conn.close()
    return rows


def get_feature(feature_id, include_deleted=False):
    conn = farm_db.get_conn()
    row = conn.execute(_SELECT + " WHERE f.id = ?" + ("" if include_deleted else " AND f.deleted_at IS NULL"),
                       (feature_id,)).fetchone()
    conn.close()
    return row


def asset_pinned(asset_id):
    conn = farm_db.get_conn()
    row = conn.execute("SELECT 1 FROM map_features WHERE asset_id = ? AND deleted_at IS NULL", (asset_id,)).fetchone()
    conn.close()
    return bool(row)


def recently_deleted(limit=10):
    conn = farm_db.get_conn()
    rows = conn.execute(_SELECT + " WHERE f.deleted_at IS NOT NULL ORDER BY f.deleted_at DESC, f.id DESC LIMIT ?",
                        (limit,)).fetchall()
    conn.close()
    return rows


def create_feature(fields, user_id):
    conn = farm_db.get_conn()
    if fields["kind"] == "asset":
        # a plant has one pin: placing it again just moves the pin
        pin = conn.execute("SELECT id FROM map_features WHERE asset_id = ? AND deleted_at IS NULL",
                           (fields["asset_id"],)).fetchone()
        if pin:
            conn.execute("UPDATE map_features SET geometry = ?, updated_by = ?, updated_at = ? WHERE id = ?",
                         (json.dumps(fields["geometry"]), user_id, _now(), pin["id"]))
            conn.commit()
            conn.close()
            return pin["id"]
    cur = conn.execute(
        "INSERT INTO map_features (kind, category, name, notes, color, geometry, asset_id, created_by, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (fields["kind"], fields.get("category"), fields.get("name") or "", fields.get("notes"),
         fields.get("color"), json.dumps(fields["geometry"]), fields.get("asset_id"), user_id, _now()))
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return new_id


def update_feature(feature_id, fields, user_id):
    sets, args = [], []
    for key in ("category", "name", "notes", "color", "geometry"):
        if key in fields:
            sets.append(f"{key} = ?")
            args.append(json.dumps(fields[key]) if key == "geometry" else fields[key])
    if not sets:
        return
    sets += ["updated_by = ?", "updated_at = ?"]
    args += [user_id, _now(), feature_id]
    conn = farm_db.get_conn()
    conn.execute(f"UPDATE map_features SET {', '.join(sets)} WHERE id = ? AND deleted_at IS NULL", args)
    conn.commit()
    conn.close()


def delete_feature(feature_id, user_id):
    conn = farm_db.get_conn()
    cur = conn.execute("UPDATE map_features SET deleted_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
                       (_now(), user_id, feature_id))
    conn.commit()
    conn.close()
    return cur.rowcount > 0


def restore_feature(feature_id, user_id):
    """Brings a deleted map item back. A plant pin only comes back if the
    plant hasn't been pinned somewhere else since."""
    conn = farm_db.get_conn()
    row = conn.execute("SELECT * FROM map_features WHERE id = ? AND deleted_at IS NOT NULL", (feature_id,)).fetchone()
    ok = False
    if row:
        clash = row["asset_id"] and conn.execute(
            "SELECT 1 FROM map_features WHERE asset_id = ? AND deleted_at IS NULL", (row["asset_id"],)).fetchone()
        if not clash:
            conn.execute("UPDATE map_features SET deleted_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?",
                         (user_id, _now(), feature_id))
            conn.commit()
            ok = True
    conn.close()
    return ok


# ---------------------------------------------------------------- home view

def default_view():
    raw = os.environ.get("NEVET_MAP_CENTER", "")
    try:
        lat, lng, zoom = (float(x) for x in raw.split(","))
        if -90 <= lat <= 90 and -180 <= lng <= 180 and 1 <= zoom <= 22:
            return {"lat": lat, "lng": lng, "zoom": int(zoom)}
    except ValueError:
        pass
    return dict(DEFAULT_VIEW)


def get_home():
    """The garden's saved map view, or None until an admin saves one."""
    conn = farm_db.get_conn()
    row = conn.execute("SELECT value FROM app_settings WHERE key = 'map_home'").fetchone()
    conn.close()
    if not row:
        return None
    try:
        v = json.loads(row["value"])
        return {"lat": float(v["lat"]), "lng": float(v["lng"]), "zoom": int(v["zoom"])}
    except (ValueError, KeyError, TypeError):
        return None


def set_home(lat, lng, zoom):
    lat, lng, zoom = _num(lat), _num(lng), int(_num(zoom))
    if not (-90 <= lat <= 90 and -180 <= lng <= 180 and 1 <= zoom <= 22):
        raise ValueError("outside the map")
    conn = farm_db.get_conn()
    conn.execute("INSERT INTO app_settings (key, value) VALUES ('map_home', ?) "
                 "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                 (json.dumps({"lat": round(lat, 7), "lng": round(lng, 7), "zoom": zoom}),))
    conn.commit()
    conn.close()


# ---------------------------------------------------------------- output

def feature_dict(row):
    """One map item as a GeoJSON Feature."""
    geom = json.loads(row["geometry"])
    kind = row["kind"]
    props = {
        "id": row["id"], "kind": kind, "category": row["category"], "name": row["name"] or "",
        "notes": row["notes"] or "", "color": row["color"],
        "created_by": row["created_by_name"], "created_at": row["created_at"],
        "updated_by": row["updated_by_name"], "updated_at": row["updated_at"],
    }
    if kind == "area":
        props["area_m2"] = round(area_m2(geom), 1)
    elif kind == "path":
        props["length_m"] = round(length_m(geom), 1)
    if kind == "asset":
        props.update(asset_id=row["asset_id"], name=row["asset_name"] or "", category=row["asset_type"],
                     variety=row["asset_variety"] or "", stage=row["asset_stage"] or "",
                     owner=row["asset_owner"] or "")
    cat = category(kind, props["category"])
    props["category_label"] = cat["label"] if cat else ""
    if not props["color"] and cat:
        props["color"] = cat["color"]
    return {"type": "Feature", "id": row["id"], "geometry": geom, "properties": props}


def feature_collection(rows=None, garden_name="Nevet garden"):
    rows = list_features() if rows is None else rows
    return {"type": "FeatureCollection", "name": garden_name,
            "features": [feature_dict(r) for r in rows]}
