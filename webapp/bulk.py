"""Adding many plants at once from a typed list.

    olive X 5
    mint x3
    5 basil
    bishops crown pepper - 3

One line per plant (commas and semicolons also separate). The count can
come before or after the name ("x", "×", "*", "-", ":" or just a space).
Each line becomes `count` separate plants, so every tree or pot has its own
history (and later its own QR code): "Olive 1" ... "Olive 5", numbered on
from any olives already there. The species (3D model) is detected from the
name like on the single "Add a plant" page, and can be changed per line in
the preview before anything is saved.
"""
import math
import random
import re

import farm_db
import plants

MAX_PER_LINE = 50
MAX_TOTAL = 200
NAME_MAX = 40

_COUNT_FIRST = re.compile(r"^(\d{1,3})\s*(?:[x×*]\s*)?\s+(.+)$", re.I)
_COUNT_LAST = re.compile(r"^(.+?)\s*(?:[x×*]|-|:)\s*(\d{1,3})$", re.I)
_COUNT_SPACE = re.compile(r"^(.+?)\s+(\d{1,3})$")


def _clean_name(text):
    text = " ".join(text.strip(" \t-–•*·.").split())[:NAME_MAX]
    return text[:1].upper() + text[1:] if text else ""


def parse(text):
    """Returns (rows, problems): rows = [{"name", "count", "species", "variety"}]
    in the order typed, duplicate names merged; problems = lines it couldn't use."""
    rows, index, problems = [], {}, []
    for raw in re.split(r"[\n;,]+", text or ""):
        line = raw.strip().lstrip("-•*·").strip()
        if not line:
            continue
        m = _COUNT_FIRST.match(line)
        if m:
            count, name = int(m.group(1)), m.group(2)
        else:
            m = _COUNT_LAST.match(line) or _COUNT_SPACE.match(line)
            count, name = (int(m.group(2)), m.group(1)) if m else (1, line)
        name = _clean_name(name)
        if len(re.sub(r"[\W\d_]", "", name)) < 2:          # "x 4" or "-- 3" is not a plant
            problems.append(raw.strip())
            continue
        if count < 1:
            problems.append(raw.strip())
            continue
        count = min(count, MAX_PER_LINE)
        key = name.lower()
        if key in index:
            rows[index[key]]["count"] = min(MAX_PER_LINE, rows[index[key]]["count"] + count)
        else:
            index[key] = len(rows)
            rows.append({"name": name, "count": count, "species": plants.detect(name) or "generic", "variety": ""})
    return rows, problems


def names_for(base, count, existing):
    """Names for `count` new plants called `base`, numbered after any already there."""
    if count == 1 and base.lower() not in existing:
        return [base]
    pat = re.compile(r"^" + re.escape(base.lower()) + r"(?: (\d+))?$")
    used = [int(m.group(1) or 1) for n in existing for m in [pat.match(n)] if m]
    start = max(used) + 1 if used else 1
    return [f"{base} {start + i}"[:NAME_MAX] for i in range(count)]


def existing_names():
    conn = farm_db.get_conn()
    names = {r[0].lower() for r in conn.execute("SELECT name FROM assets")}
    conn.close()
    return names


# ---------------------------------------------------------------- placing them on the garden map

def _inside(pt, ring):
    x, y, hit = pt[0], pt[1], False
    for i in range(len(ring) - 1):
        (x1, y1), (x2, y2) = ring[i][:2], ring[i + 1][:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            hit = not hit
    return hit


def spread_points(polygon, n, taken=()):
    """n [lng, lat] points spread evenly inside a GeoJSON polygon, away from
    the points already `taken` there (farthest-point sampling on a grid)."""
    ring = polygon["coordinates"][0]
    xs, ys = [p[0] for p in ring], [p[1] for p in ring]
    k = math.cos(math.radians(sum(ys) / len(ys)))          # a degree of longitude is shorter
    grid = 24
    cands = []
    for i in range(grid):
        for j in range(grid):
            p = [min(xs) + (i + 0.5) / grid * (max(xs) - min(xs)), min(ys) + (j + 0.5) / grid * (max(ys) - min(ys))]
            if _inside(p, ring):
                cands.append(p)
    if not cands:                                          # a sliver: use its centre
        cands = [[sum(xs[:-1]) / (len(xs) - 1), sum(ys[:-1]) / (len(ys) - 1)]]
    d2 = lambda a, b: ((a[0] - b[0]) * k) ** 2 + (a[1] - b[1]) ** 2
    chosen, fixed = [], [list(t) for t in taken if _inside(t, ring)]
    rnd = random.Random(len(cands) * 31 + n)
    for _ in range(n):
        ref = fixed + chosen
        if not ref:
            best = min(cands, key=lambda c: d2(c, [sum(xs) / len(xs), sum(ys) / len(ys)]))
        else:
            best = max(cands, key=lambda c: (min(d2(c, r) for r in ref), rnd.random()))
        chosen.append(best)
    return [[round(p[0], 7), round(p[1], 7)] for p in chosen]
