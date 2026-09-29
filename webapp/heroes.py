"""Hero (grower avatar) helpers: catalog loading, validation, defaults
and level/XP maths.

The catalog lives in static/assets/heroes/catalog.json so the browser
(3D renderer) and the server (validation) read the exact same list of
looks and gear. Edit that file to add options; it's re-read
automatically when it changes, no restart needed.
"""
import hashlib
import json
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parent / "static" / "assets" / "heroes" / "catalog.json"
NAME_MIN, NAME_MAX = 1, 20
NAME_EXTRA_CHARS = set(" _-'.")

_cache = {"mtime": None, "data": None}


def catalog():
    mtime = CATALOG_PATH.stat().st_mtime
    if _cache["mtime"] != mtime:
        with CATALOG_PATH.open(encoding="utf-8") as f:
            _cache["data"] = json.load(f)
        _cache["mtime"] = mtime
    return _cache["data"]


def categories():
    c = catalog()
    return c["looks"] + c["gear"]


def class_by_id(class_id):
    for c in catalog()["classes"]:
        if c["id"] == class_id:
            return c
    return catalog()["classes"][0]


def _pick(options, byte):
    return options[byte % len(options)]["id"]


def default_appearance(name, hero_class=None):
    """A stable, name-based look, so existing growers each get their own
    distinct hero instead of identical clones."""
    digest = hashlib.sha256((name or "hero").lower().encode("utf-8")).digest()
    c = catalog()
    cls = class_by_id(hero_class) if hero_class else c["classes"][digest[0] % len(c["classes"])]
    looks = {cat["id"]: cat for cat in c["looks"]}
    base_skins = [o for o in looks["skin"]["options"] if o.get("rarity") is None]
    base_hair = [o for o in looks["hairColor"]["options"] if o.get("rarity") is None]
    appearance = {
        "skin": _pick(base_skins, digest[1]),
        "hair": _pick(looks["hair"]["options"][:5], digest[2]),
        "hairColor": _pick(base_hair, digest[3]),
        "eyes": _pick(looks["eyes"]["options"], digest[4]),
        "eyeColor": _pick(looks["eyeColor"]["options"], digest[5]),
        "mouth": _pick(looks["mouth"]["options"], digest[6]),
    }
    appearance.update(cls["preset"])
    return cls["id"], appearance


def normalize(appearance, name="", hero_class=None):
    """Keep only known categories with valid option ids; fill any gaps
    from the name-based default."""
    _, fallback = default_appearance(name, hero_class)
    clean = {}
    appearance = appearance if isinstance(appearance, dict) else {}
    for cat in categories():
        valid = {o["id"] for o in cat["options"]}
        value = appearance.get(cat["id"])
        clean[cat["id"]] = value if value in valid else fallback[cat["id"]]
    return clean


def normalize_class(class_id):
    return class_by_id(class_id)["id"]


def from_json(text, name="", hero_class=None):
    try:
        data = json.loads(text) if text else {}
    except (TypeError, ValueError):
        data = {}
    return normalize(data, name, hero_class)


def from_form(form, name="", hero_class=None):
    return normalize({cat["id"]: form.get("a_" + cat["id"]) for cat in categories()}, name, hero_class)


def hero_for_row(row):
    """Class id + full appearance for a growers table row (old rows
    without hero data get their name-based default)."""
    keys = row.keys()
    stored_class = row["hero_class"] if "hero_class" in keys else None
    stored_look = row["appearance"] if "appearance" in keys else None
    if stored_class and stored_look:
        return normalize_class(stored_class), from_json(stored_look, row["name"], stored_class)
    return default_appearance(row["name"])


def validate_name(raw):
    """Returns (clean_name, error_message_or_None)."""
    name = " ".join((raw or "").split())
    if len(name) < NAME_MIN:
        return name, "Give your hero a name."
    if len(name) > NAME_MAX:
        return name, f"Hero names can be at most {NAME_MAX} characters."
    if not all(ch.isalnum() or ch in NAME_EXTRA_CHARS for ch in name):
        return name, "Use letters, numbers, spaces, - or _ only."
    return name, None


def progress(asset_count=0, log_count=0, harvest_count=0):
    """XP from real farm activity: every logged action counts, harvests
    count extra, each plant/bin you look after adds a little.
    Level n starts at 20*(n-1)^2 XP: 0, 20, 80, 180, 320, 500, ..."""
    xp = 10 * (log_count or 0) + 15 * (harvest_count or 0) + 5 * (asset_count or 0)
    level = 1
    while 20 * level * level <= xp:
        level += 1
    start, nxt = 20 * (level - 1) ** 2, 20 * level * level
    return {
        "xp": xp,
        "level": level,
        "next_xp": nxt,
        "pct": int(round(100 * (xp - start) / (nxt - start))),
    }
