"""Plant species for the 3D plant models.

The catalog (static/assets/plants/catalog.json) lists every species Nevet
can draw: a model archetype plus a few parameters, with English and Hebrew
keywords. A plant's species is either picked by the grower (assets.species)
or detected from its name and variety, with the same rule as
static/js/plants3d.js detect():

    the name decides; the variety refines it when it points at a species in
    the same group ("Tomato" + variety "Cherry" -> cherry_tomato, but
    "Basil" + variety "Lemon" stays basil).
"""
import json
import os
import re
import threading

CATALOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "assets", "plants", "catalog.json")
STAGES = ("seed", "germination", "seedling", "growing", "mature", "harvested", "archived")

_lock = threading.Lock()
_cache = {"mtime": None, "data": None, "by_id": {}}


def catalog():
    """The whole catalog, re-read when the file changes."""
    try:
        mtime = os.path.getmtime(CATALOG_PATH)
    except OSError:
        return {"version": 1, "species": []}
    with _lock:
        if _cache["mtime"] != mtime:
            with open(CATALOG_PATH, encoding="utf-8") as f:
                data = json.load(f)
            _cache.update(mtime=mtime, data=data, by_id={s["id"]: s for s in data.get("species", [])})
        return _cache["data"]


def species(species_id):
    catalog()
    return _cache["by_id"].get(species_id)


def valid(species_id):
    return bool(species_id) and species(species_id) is not None


def _norm(text):
    text = (text or "").lower()
    text = re.sub(r"[׳’‘`´]", "'", text)
    return " ".join(text.split())


def _best(text):
    text = _norm(text)
    if not text:
        return None
    best, length = None, 0
    for s in catalog().get("species", []):
        for k in s.get("keywords", []):
            k = _norm(k)
            if k and len(k) > length and k in text:
                best, length = s, len(k)
    return best


def detect(name, variety=None, asset_type="plant"):
    """Species id for a plant's name (and variety), or None if nothing matches."""
    if asset_type == "worm_bin":
        return "compost_worms" if valid("compost_worms") else None
    n, v = _best(name), _best(variety)
    s = v if (v and (not n or v.get("group") == n.get("group"))) else (n or v)
    return s["id"] if s else None


def species_for(asset):
    """The species to draw for an asset row/dict: the grower's pick, else detected, else 'generic'."""
    picked = asset["species"] if "species" in asset.keys() else None
    if valid(picked):
        return picked
    return detect(asset["name"], asset["variety"], asset["asset_type"]) or "generic"


def groups():
    """[(group name, [species...])] in catalog order, for a <select> with optgroups."""
    out, index = [], {}
    for s in catalog().get("species", []):
        g = s.get("group") or "Other"
        if g not in index:
            index[g] = len(out)
            out.append((g, []))
        out[index[g]][1].append(s)
    return out


def subset(ids):
    """A smaller catalog with just these species (plus 'generic'), to embed in a page."""
    want = set(ids) | {"generic"}
    return {"version": catalog().get("version", 1),
            "species": [s for s in catalog().get("species", []) if s["id"] in want]}


def model_stage(stage, asset_type="plant"):
    """Growth stage to draw: worm bins are always 'mature'; unknown -> 'growing'."""
    if asset_type == "worm_bin":
        return "mature"
    return stage if stage in STAGES else "growing"
