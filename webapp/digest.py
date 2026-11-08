"""The weekly garden digest: what got done on the farm in a week, who helped, how much was harvested, fed to the
worms and given away, what's new, what needs a hand and what's coming up. One page for the whole farm, with last
week's numbers to compare, that families can glance at, print, or share as plain text in a chat.

Weeks start on Sunday (the Israeli week: WEEK_START). Only things anyone may see go in (no notes on actions, no
names of who produce was given to), so visitors can read it too.
"""
from datetime import date, timedelta

import activity_views as av
import events
import farm_db

WEEK_START = 6            # the weekday a week starts on (Python: Monday 0 ... Sunday 6)
DRY_DAYS = 3              # a plant that hasn't been watered for this many days needs a hand
WEIGHED = ("harvest", "feeding", "delivery")


def week_start(day):
    return day - timedelta(days=(day.weekday() - WEEK_START) % 7)


def parse_day(text):
    try:
        return date.fromisoformat(text) if text else None
    except ValueError:
        return None


def _numbers(conn, a, b):
    """Totals for the time from a to b (ISO dates; b not included)."""
    one = lambda sql, *args: conn.execute(sql, args).fetchone()[0]
    kg = {t: round(one("SELECT COALESCE(SUM(" + farm_db.log_kg_sql("l") + "), 0) FROM logs l WHERE l.log_type = ? "
                       "AND l.timestamp >= ? AND l.timestamp < ?", t, a, b), 1) for t in WEIGHED}
    return {
        "actions": one("SELECT COUNT(*) FROM logs WHERE timestamp >= ? AND timestamp < ?", a, b),
        "helpers": one("SELECT COUNT(DISTINCT grower_id) FROM logs WHERE grower_id IS NOT NULL AND timestamp >= ? AND timestamp < ?", a, b),
        "harvest_kg": kg["harvest"], "worm_kg": kg["feeding"], "given_kg": kg["delivery"],
        "new_plants": one("SELECT COUNT(*) FROM assets WHERE created_at >= ? AND created_at < ?", a, b),
        "new_heroes": one("SELECT COUNT(*) FROM growers WHERE deleted_at IS NULL AND joined_at >= ? AND joined_at < ?", a, b),
    }


def week(day=None, today=None):
    """The digest for the week that has `day` in it (default: this week)."""
    today = today or date.today()
    start = week_start(day or today)
    end, prev = start + timedelta(days=7), start - timedelta(days=7)
    a, b = start.isoformat(), end.isoformat()
    conn = farm_db.get_conn()
    now, before = _numbers(conn, a, b), _numbers(conn, prev.isoformat(), a)
    jobs = [{"id": r["log_type"], "label": av.action_meta(r["log_type"])["label"], "icon": av.action_meta(r["log_type"])["icon"],
             "count": r["n"], "kg": round(r["kg"] or 0, 1)}
            for r in conn.execute("SELECT l.log_type, COUNT(*) AS n, SUM(" + farm_db.log_kg_sql("l") + ") AS kg FROM logs l "
                                  "WHERE l.timestamp >= ? AND l.timestamp < ? GROUP BY l.log_type ORDER BY n DESC", (a, b))]
    xp = farm_db.xp_by_grower(a, conn, until=b)
    helpers = []
    for r in conn.execute("""SELECT g.id, g.name, g.hero_class, g.appearance, COUNT(l.id) AS n,
                                    COUNT(DISTINCT substr(l.timestamp, 1, 10)) AS days,
                                    SUM(CASE WHEN l.log_type = 'harvest' THEN """ + farm_db.log_kg_sql("l") + """ ELSE 0 END) AS picked,
                                    SUM(CASE WHEN l.log_type = 'feeding' THEN """ + farm_db.log_kg_sql("l") + """ ELSE 0 END) AS fed
                             FROM logs l JOIN growers g ON g.id = l.grower_id
                             WHERE g.deleted_at IS NULL AND l.timestamp >= ? AND l.timestamp < ?
                             GROUP BY g.id""", (a, b)):
        helpers.append({"id": r["id"], "name": r["name"], "row": r, "actions": r["n"], "days": r["days"], "xp": xp.get(r["id"], 0),
                        "picked": round(r["picked"] or 0, 1), "fed": round(r["fed"] or 0, 1)})
    helpers.sort(key=lambda h: (-h["xp"], -h["actions"], h["name"].lower()))
    busiest = conn.execute("SELECT substr(timestamp, 1, 10) AS d, COUNT(*) AS n FROM logs WHERE timestamp >= ? AND timestamp < ? "
                           "GROUP BY d ORDER BY n DESC, d LIMIT 1", (a, b)).fetchone()
    biggest = conn.execute("SELECT l.id, g.name AS hero, a.name AS plant, " + farm_db.log_kg_sql("l") + " AS kg FROM logs l "
                           "LEFT JOIN growers g ON g.id = l.grower_id LEFT JOIN assets a ON a.id = l.asset_id "
                           "WHERE l.log_type = 'harvest' AND l.timestamp >= ? AND l.timestamp < ? ORDER BY kg DESC LIMIT 1", (a, b)).fetchone()
    loved = conn.execute("SELECT a.id, a.name, COUNT(*) AS n FROM logs l JOIN assets a ON a.id = l.asset_id "
                         "WHERE l.timestamp >= ? AND l.timestamp < ? GROUP BY a.id ORDER BY n DESC LIMIT 1", (a, b)).fetchone()
    newcomers = [dict(r) for r in conn.execute("SELECT id, name FROM growers WHERE deleted_at IS NULL AND joined_at >= ? AND joined_at < ? "
                                               "ORDER BY joined_at", (a, b))]
    planted = [dict(r) for r in conn.execute("SELECT a.id, a.name, a.asset_type, g.name AS hero FROM assets a LEFT JOIN growers g ON g.id = a.grower_id "
                                             "WHERE a.created_at >= ? AND a.created_at < ? ORDER BY a.created_at", (a, b))]
    conn.close()
    current = start <= today < end
    thirsty = []
    if current:                                         # (only this week: what needs a hand right now)
        dry = farm_db.farm_numbers()["assets"]
        for p in farm_db.plants(current=True):
            d = dry.get(p["id"], {}).get("dry", 0)
            if p["asset_type"] == "plant" and d >= DRY_DAYS:
                thirsty.append({"id": p["id"], "name": p["name"], "days": int(d)})
        thirsty.sort(key=lambda p: -p["days"])
    evs = [e for e in events.list_events() if e["status"] != "cancelled" and start <= e["start"].date() < end]
    nxt = [e for e in events.list_events() if e["status"] != "cancelled" and end <= e["start"].date() < end + timedelta(days=7)] if current else []
    def delta(k):
        return {"now": now[k], "before": before[k], "up": now[k] > before[k], "down": now[k] < before[k],
                "diff": round(now[k] - before[k], 1)}
    return {
        "start": start, "end": end - timedelta(days=1), "prev": prev, "next": end if end <= today else None, "current": current,
        "label": f"{start:%a %-d %b} – {end - timedelta(days=1):%a %-d %b %Y}",
        "numbers": {k: delta(k) for k in now}, "jobs": jobs, "helpers": helpers,
        "busiest": {"day": date.fromisoformat(busiest["d"]), "n": busiest["n"]} if busiest else None,
        "biggest": dict(biggest) if biggest and biggest["kg"] else None, "loved": dict(loved) if loved else None,
        "newcomers": newcomers, "planted": planted, "thirsty": thirsty[:8], "events": evs, "next_events": nxt,
        "empty": now["actions"] == 0 and not newcomers and not planted and not evs,
    }


def _kg(v):
    return f"{v:g} kg"


def text(d, url=""):
    """The digest as plain text, to paste into a chat."""
    n = d["numbers"]
    lines = [f"🌱 The week on the farm · {d['label']}", ""]
    if d["empty"]:
        lines.append("A quiet week: nothing logged yet.")
    else:
        lines.append(f"✅ {n['actions']['now']} jobs done by {n['helpers']['now']} helper{'s' if n['helpers']['now'] != 1 else ''}")
        for k, emoji, what in [("harvest_kg", "🧺", "harvested"), ("worm_kg", "🪱", "fed to the worms"), ("given_kg", "🎁", "given away")]:
            if n[k]["now"]:
                lines.append(f"{emoji} {_kg(n[k]['now'])} {what}")
        if n["new_plants"]["now"]:
            lines.append(f"🌿 {n['new_plants']['now']} new plant{'s' if n['new_plants']['now'] != 1 else ''}")
        if d["helpers"]:
            lines += ["", "🙌 Thank you: " + ", ".join(h["name"] for h in d["helpers"][:12]) + (" and more" if len(d["helpers"]) > 12 else "")]
        if d["newcomers"]:
            lines.append("👋 Welcome: " + ", ".join(h["name"] for h in d["newcomers"]))
        if d["biggest"]:
            b = d["biggest"]
            lines.append(f"🏆 Biggest harvest: {_kg(round(b['kg'], 1))} of {b['plant'] or 'produce'} by {b['hero'] or 'someone'}")
    if d["thirsty"]:
        lines += ["", "💧 Needs a hand: " + ", ".join(f"{p['name']} ({p['days']} days dry)" for p in d["thirsty"][:5])]
    if d["next_events"]:
        lines += ["", "📅 Coming up: " + "; ".join(f"{e['kind_info']['emoji']} {e['title']} ({e['start']:%a %-d %b %H:%M})" for e in d["next_events"])]
    if url:
        lines += ["", url]
    return "\n".join(lines)
