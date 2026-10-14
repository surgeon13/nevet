"""Today at the farm: what was logged today, and what needs doing.

Shown on the dashboard as a card, and as a pop-up the first time someone
opens Nevet after logging in (and on the first visit of each new day).

To-dos come from the farm's own data, nothing has to be entered by hand:

* plants not watered for THIRSTY_DAYS or more (a whole-garden watering
  counts for every plant; a new plant counts from when it was added)
* worm bins not fed for HUNGRY_DAYS or more
* plants marked "mature": ready to harvest
* seeds sown SEED_CHECK_DAYS or more ago that haven't been seen sprouting
* connections waiting for you to confirm
"""
from datetime import date, datetime
from urllib.parse import urlencode

import farm_db

THIRSTY_DAYS = 3
HUNGRY_DAYS = 7
SEED_CHECK_DAYS = 14
LIST_MAX = 4          # names shown per to-do before "and N more"


def _days_since(ts, now):
    try:
        return max(0.0, (now - datetime.fromisoformat(ts)).total_seconds() / 86400.0)
    except (TypeError, ValueError):
        return 0.0


def _names(rows, extra=None):
    shown = [r["name"] + (f" ({extra(r)})" if extra else "") for r in rows[:LIST_MAX]]
    more = len(rows) - LIST_MAX
    return ", ".join(shown) + (f" and {more} more" if more > 0 else "")


def _log_link(action, rows):
    return "/log?" + urlencode([("action", action)] + [("asset", r["id"]) for r in rows])


def todays_actions(day=None):
    """Today's logs grouped by who and what: one line per (hero, action)."""
    day = (day or date.today()).isoformat()
    rows = farm_db.recent_activity(since=day, limit=2000)
    groups, index = [], {}
    for r in rows:                                     # newest first
        if not (r["timestamp"] or "").startswith(day):
            continue
        key = (r["grower_id"], r["log_type"])
        if key not in index:
            index[key] = len(groups)
            meta = farm_db.ACTION_BY_ID.get(r["log_type"]) or {}
            groups.append({"who": r["grower_name"] or "Someone", "grower_id": r["grower_id"], "action": r["log_type"],
                           "verb": meta.get("verb", (r["log_type"] or "logged").replace("_", " ")),
                           "count": 0, "plants": [], "whole": False, "first": r["timestamp"], "last": r["timestamp"]})
        gr = groups[index[key]]
        gr["count"] += 1
        gr["first"] = r["timestamp"]                   # rows come newest first
        if r["asset_id"] is None:
            gr["whole"] = True
        elif r["asset_name"] and r["asset_name"] not in gr["plants"]:
            gr["plants"].append(r["asset_name"])
    for gr in groups:
        n = len(gr["plants"])
        what = ", ".join(gr["plants"][:LIST_MAX]) + (f" and {n - LIST_MAX} more" if n > LIST_MAX else "")
        if gr["whole"]:
            what = "the whole garden" + (f" + {what}" if what else "")
        gr["what"] = what or "something"
        gr["time"] = gr["first"][11:16]
    return groups, len([r for r in rows if (r["timestamp"] or "").startswith(day)])


def todos(user_id=None, now=None):
    now = now or datetime.now()
    nums = farm_db.farm_numbers()["assets"]
    current = farm_db.plants(None, current=True)
    plants_ = [p for p in current if p["asset_type"] == "plant"]
    bins = [p for p in current if p["asset_type"] == "worm_bin"]
    out = []

    thirsty = sorted([p for p in plants_ if nums.get(p["id"], {}).get("dry", 0) >= THIRSTY_DAYS],
                     key=lambda p: -nums[p["id"]]["dry"])
    if thirsty:
        out.append({"kind": "water", "icon": "drop", "level": "warn" if len(thirsty) < 5 else "bad",
                    "text": f"Water {len(thirsty)} plant{'s' if len(thirsty) != 1 else ''}",
                    "detail": "Not watered for 3+ days: " + _names(thirsty, lambda p: f"{int(nums[p['id']]['dry'])} d"),
                    "href": _log_link("watering", thirsty), "button": "Log watering"})

    last_fed = farm_db.last_logs("feeding")
    hungry = [b for b in bins if _days_since(last_fed.get(b["id"]) or b["created_at"], now) >= HUNGRY_DAYS]
    if hungry:
        out.append({"kind": "feed", "icon": "worm", "level": "warn",
                    "text": f"Feed the worms ({len(hungry)} bin{'s' if len(hungry) != 1 else ''})",
                    "detail": f"Not fed for {HUNGRY_DAYS}+ days: " + _names(hungry, lambda b: "never" if not last_fed.get(b["id"]) else f"{int(_days_since(last_fed[b['id']], now))} d"),
                    "href": _log_link("feeding", hungry), "button": "Log feeding"})

    ripe = [p for p in plants_ if p["life_stage"] == "mature"]
    if ripe:
        out.append({"kind": "harvest", "icon": "basket", "level": "ok",
                    "text": f"Ready to harvest: {len(ripe)} plant{'s' if len(ripe) != 1 else ''}",
                    "detail": _names(ripe), "href": _log_link("harvest", ripe), "button": "Log a harvest"})

    seeds = [p for p in plants_ if p["life_stage"] == "seed" and _days_since(p["created_at"], now) >= SEED_CHECK_DAYS]
    if seeds:
        out.append({"kind": "seeds", "icon": "sprout", "level": "ok",
                    "text": f"Check {len(seeds)} seed tray{'s' if len(seeds) != 1 else ''} for sprouts",
                    "detail": f"Sown {SEED_CHECK_DAYS}+ days ago, no sprouts logged: " + _names(seeds),
                    "href": _log_link("germination", seeds), "button": "Log sprouts"})

    if user_id:
        n = farm_db.pending_for(user_id)
        if n:
            out.append({"kind": "connections", "icon": "heart", "level": "ok",
                        "text": f"{n} connection{'s' if n != 1 else ''} waiting for you to confirm",
                        "detail": "Someone added you as family or a friend.",
                        "href": f"/growers/{user_id}#connections", "button": "Review"})
    return out


def report(user_id=None):
    groups, total = todays_actions()
    return {"date": date.today(), "groups": groups, "total": total,
            "heroes": len({g["grower_id"] for g in groups}), "todos": todos(user_id)}
