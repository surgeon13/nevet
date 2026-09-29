"""Shared view helpers for activity pages: action icons, human-friendly
times and stage names, and the data bundles the dashboard / profile use.
"""
from datetime import date, datetime, timedelta

import farm_db

# Simple line icons (24x24, drawn with currentColor) - no emoji, so they
# render the same on the Pi's browser as on phones.
ICON_PATHS = {
    "drop": '<path d="M12 3c3.6 4.3 6 7.6 6 10.6a6 6 0 0 1-12 0C6 10.6 8.4 7.3 12 3z"/>',
    "scissors": '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M8.2 7.6 20 18M8.2 16.4 20 6"/>',
    "flask": '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3M7.4 15h9.2"/>',
    "leaf": '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15zM5 19l8.5-8.5"/>',
    "bug": '<rect x="8" y="7" width="8" height="13" rx="4"/><path d="M4 11h4M16 11h4M4 16h4M16 16h4M9.5 4l1.5 3M14.5 4 13 7"/>',
    "worm": '<path d="M3 15c2-4.5 4-4.5 6 0s4 4.5 6 0 3.5-4 5.5-1.5"/><circle cx="20.5" cy="12.5" r=".6" fill="currentColor"/>',
    "basket": '<path d="M3 10h18l-2.2 10H5.2zM8 10l4-6 4 6M9 14v3M15 14v3"/>',
    "sparkle": '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.3 6.3l2.4 2.4M15.3 15.3l2.4 2.4M6.3 17.7l2.4-2.4M15.3 8.7l2.4-2.4"/>',
    "pot": '<path d="M5 13h14l-1.6 7H6.6zM12 13V5M12 8c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4zM12 10c2.5 0 4-1.5 4-4-2.5 0-4 1.5-4 4z"/>',
    "eye": '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    "gift": '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M12 8C10.5 4.5 7 4 7 6.5S12 8 12 8s5-.5 5-1.5S13.5 4.5 12 8"/>',
    "sprout": '<path d="M12 21v-9M12 12c0-4-3-6.5-7-6.5 0 4 3 6.5 7 6.5zM12 10c0-3 2.2-5 6-5 0 3-2.2 5-6 5zM7 21h10"/>',
    "seed": '<ellipse cx="12" cy="13" rx="5" ry="7.5"/><path d="M12 6c.6 5 0 9.5-2.5 13.5"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
}

STAGE_LABELS = {"seed": "seed", "germination": "sprouting", "seedling": "seedling", "growing": "growing",
                "mature": "mature", "harvested": "harvested", "archived": "archived"}
AMOUNT_UNITS = ["g", "kg", "pieces", "bunches"]


def action_meta(log_type):
    return farm_db.ACTION_BY_ID.get(log_type) or {
        "id": log_type, "label": (log_type or "action").replace("_", " ").capitalize(),
        "verb": (log_type or "did something to").replace("_", " "), "icon": "leaf"}


def stage_label(stage):
    return STAGE_LABELS.get(stage, stage or "")


def when(ts):
    """'today 09:12', 'yesterday 18:30', 'Mon 21 Sep 10:00', or with year if older."""
    try:
        t = datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return ts or ""
    days = (date.today() - t.date()).days
    hm = t.strftime("%H:%M")
    if days == 0:
        return f"today {hm}"
    if days == 1:
        return f"yesterday {hm}"
    if t.year == date.today().year:
        return f"{t.strftime('%a')} {t.day} {t.strftime('%b')} {hm}"
    return f"{t.day} {t.strftime('%b %Y')}"


def day_label(d):
    days = (date.today() - d).days
    if days == 0:
        return "Today"
    if days == 1:
        return "Yesterday"
    return f"{d.strftime('%A')} {d.day} {d.strftime('%B')}" + (f" {d.year}" if d.year != date.today().year else "")


def nice_max(n):
    """Round an axis maximum up to 1, 2 or 5 x 10^k."""
    if n <= 0:
        return 1
    k = 1
    while True:
        for m in (1, 2, 5):
            if m * k >= n:
                return m * k
        k *= 10


def activity_bundle(grower_id=None):
    week_start = (date.today() - timedelta(days=6)).isoformat()
    totals = farm_db.activity_totals(grower_id)
    daily = farm_db.daily_activity(grower_id, 14)
    top = nice_max(max((n for _, n in daily), default=0))
    return {
        "total": sum(n for _, n in totals),
        "week": farm_db.activity_count(grower_id, since=week_start),
        "totals": totals,
        "totals_max": max((n for _, n in totals), default=0),
        "daily": [{"date": d, "n": n, "pct": round(100 * n / top, 1),
                   "tip": f"{d.strftime('%a')} {d.day} {d.strftime('%b')}"} for d, n in daily],
        "daily_top": top,
        "recent": farm_db.recent_activity(grower_id, limit=6),
        "growing": farm_db.plants(grower_id, current=True),
        "before": farm_db.plants(grower_id, current=False),
        "harvests": dict(totals).get("harvest", 0),
    }


def group_by_day(items):
    groups = []
    for it in items:
        try:
            d = datetime.fromisoformat(it["timestamp"]).date()
        except (TypeError, ValueError):
            d = None
        if not groups or groups[-1][0] != d:
            groups.append((d, []))
        groups[-1][1].append(it)
    return [(day_label(d) if d else "Unknown date", rows) for d, rows in groups]


def register(app):
    app.jinja_env.globals.update(ICON_PATHS=ICON_PATHS, action_meta=action_meta, stage_label=stage_label)
    app.jinja_env.filters["when"] = when
