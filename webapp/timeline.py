"""The farm's story, day by day, for the Time page (templates/time.html).

Everything that happened on the farm, grouped by day, with the big moments
picked out and told as a little story:

* the very first day ("Once upon a time...")
* a hero joining the farm (and who invited them: the mother tree, see invites.py)
* two heroes connecting (family, partners, friends: they both confirmed it)
* a group being formed
* a plant planted for the first time, the first harvest of a plant, a big harvest
* an event: a party, festival or gathering (events.py), with how many came
* busy days, photos taken

Each day has a title, a few story lines, the counts by action and who took
part. The page draws one blossom per day on a vine and a heart for the days
with a big moment.
"""
import json
from collections import Counter, OrderedDict, defaultdict
from datetime import date, datetime

import farm_db
import relations

MAX_DAYS = 240            # the vine shows the most recent days with something in them


def _day(ts):
    try:
        return datetime.fromisoformat(ts).date()
    except (TypeError, ValueError):
        return None


def _names(names, n=3):
    names = list(OrderedDict.fromkeys(x for x in names if x))
    if not names:
        return "someone"
    if len(names) <= n:
        return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
    return ", ".join(names[:n]) + f" and {len(names) - n} more"


def _gender(look):
    try:
        return json.loads(look or "{}").get("gender")
    except ValueError:
        return None


def story(max_days=MAX_DAYS):
    conn = farm_db.get_conn()
    q = lambda sql, *a: conn.execute(sql, a).fetchall()
    tables = {r[0] for r in q("SELECT name FROM sqlite_master WHERE type='table'")}
    days = defaultdict(lambda: {"counts": Counter(), "who": [], "moments": [], "lines": [], "kg": 0.0, "photos": 0})

    logs = q("""SELECT logs.id, logs.log_type, logs.timestamp, logs.recipient, logs.asset_id, assets.name AS plant,
                       growers.name AS who,
                       (SELECT SUM(CASE WHEN units = 'kg' THEN value * 1000 WHEN units = 'g' THEN value ELSE 0 END)
                          FROM quantities WHERE quantities.log_id = logs.id) AS grams
                FROM logs LEFT JOIN assets ON assets.id = logs.asset_id
                LEFT JOIN growers ON growers.id = logs.grower_id
                ORDER BY logs.timestamp, logs.id""")
    first_planted, first_harvest = set(), set()
    for r in logs:
        d = _day(r["timestamp"])
        if not d:
            continue
        day = days[d]
        day["counts"][r["log_type"]] += 1
        if r["who"]:
            day["who"].append(r["who"])
        base = (r["plant"] or "").rstrip("0123456789 ").strip()       # "Olive 3" -> "Olive"
        if r["log_type"] in ("planting", "seeding") and base and base.lower() not in first_planted:
            first_planted.add(base.lower())
            day["firsts"] = day.get("firsts", []) + [(r["who"], base, r["log_type"])]
        if r["log_type"] == "harvest":
            g = r["grams"] or 0
            day["kg"] += g / 1000.0
            if base and base.lower() not in first_harvest:
                first_harvest.add(base.lower())
                day["moments"].append({"kind": "harvest", "text": f"The first {base.lower()} harvest" + (f" ({g / 1000:.1f} kg)" if g >= 100 else "") + f", picked by {r['who'] or 'someone'}."})
            elif g >= 2000:
                day["moments"].append({"kind": "harvest", "text": f"A big harvest: {g / 1000:.1f} kg of {base.lower() or 'produce'} by {r['who'] or 'someone'}."})
        if r["log_type"] == "delivery" and r["recipient"]:
            day["lines"].append(f"{r['who'] or 'Someone'} shared produce from the {base.lower() or 'garden'} with {r['recipient']}.")

    gcols = {c[1] for c in q("PRAGMA table_info(growers)")}
    by_sql = ", i.name AS by_name FROM growers g LEFT JOIN growers i ON i.id = g.invited_by AND i.deleted_at IS NULL" if "invited_by" in gcols else ", NULL AS by_name FROM growers g"
    for r in q(f"SELECT g.name, g.joined_at{by_sql} WHERE g.deleted_at IS NULL ORDER BY g.joined_at"):
        d = _day(r["joined_at"])
        if d:
            days[d]["moments"].append({"kind": "hero", "text": f"{r['name']} joined the farm.", "name": r["name"], "by": r["by_name"]})

    if "relationships" in tables:
        cols = {c[1] for c in q("PRAGMA table_info(relationships)")}
        accepted = "WHERE r.status = 'accepted'" if "status" in cols else ""
        for r in q(f"""SELECT r.kind, r.created_at, a.name AS a_name, b.name AS b_name, a.appearance AS a_look, b.appearance AS b_look
                       FROM relationships r JOIN growers a ON a.id = r.a_id JOIN growers b ON b.id = r.b_id {accepted}"""):
            d = _day(r["created_at"])
            if not d:
                continue
            k = relations.KIND.get(r["kind"])
            if k and k[3]:            # spouse, partner, sibling, friend...: the same word both ways
                word = relations.label(r["kind"], None, True).lower()
                text = f"{r['a_name']} and {r['b_name']} are {word}s." if r["kind"] not in ("other",) else f"{r['a_name']} and {r['b_name']} are connected."
            else:
                text = f"{r['a_name']} is {r['b_name']}'s {relations.label(r['kind'], _gender(r['a_look']), True).lower()}."
            days[d]["moments"].append({"kind": "love", "text": text})

    if "groups" in tables:
        for r in q("SELECT name, kind, created_at FROM groups"):
            d = _day(r["created_at"])
            if d:
                days[d]["moments"].append({"kind": "group", "text": f"{r['name']} came together ({relations.GROUP_KIND.get(r['kind'], 'group').lower()})."})

    if "events" in tables:                               # parties, festivals and gatherings that took place
        import events as events_mod
        now = datetime.now()
        for ev in events_mod.list_events():
            if ev["status"] == "cancelled" or ev["start"] > now:
                continue
            fb = q("SELECT AVG(rating) AS r, COUNT(*) AS n FROM event_feedback WHERE event_id = ?", ev["id"])[0]
            bits = [f"{ev['attended']} came" if ev["attended"] else (f"{ev['going']} said they'd come" if ev["going"] else "")]
            if fb["n"]:
                bits.append(f"rated {fb['r']:.1f}★")
            text = f"{ev['kind_info']['emoji']} {ev['title']}" + (": " + ", ".join(b for b in bits if b) if any(bits) else "") + "."
            days[ev["start"].date()]["moments"].append({"kind": "event", "text": text, "title": ev["title"]})
            days[ev["start"].date()]["event_title"] = f"{ev['kind_info']['emoji']} {ev['title']}"

    if "captures" in tables:
        for r in q("SELECT substr(taken_at, 1, 10) AS d, COUNT(*) AS n FROM captures WHERE kind = 'photo' GROUP BY 1"):
            d = _day(r["d"])
            if d:
                days[d]["photos"] = r["n"]
    conn.close()

    ordered = sorted(d for d in days if d)
    if not ordered:
        import invites
        return {"days": [], "first": None, "today": date.today().isoformat(), "tree": invites.tree(), "counts": invites.counts()}
    very_first = ordered[0]
    ordered = ordered[-max_days:]
    out = []
    busiest = max((sum(days[d]["counts"].values()) for d in ordered), default=0)
    for i, d in enumerate(ordered):
        day = days[d]
        n = sum(day["counts"].values())
        lines, moments = [], []
        joined = [m for m in day["moments"] if m["kind"] == "hero"]
        if len(joined) == 1:                             # who invited them: the mother tree grows a branch
            j = joined[0]
            moments.append({"kind": "hero", "text": f"{j['name']} joined the farm" + (f", invited by {j['by']}." if j.get("by") else ".")})
        elif joined:                                     # many heroes on one day: one line, then who invited whom
            moments.append({"kind": "hero", "text": f"{_names([j['name'] for j in joined], 4)} joined the farm."})
            inv = OrderedDict()
            for j in joined:
                if j.get("by"):
                    inv.setdefault(j["by"], []).append(j["name"])
            for by, names in list(inv.items())[:3]:
                moments.append({"kind": "invite", "text": f"{by} invited {_names(names, 3)}."})
        moments += [m for m in day["moments"] if m["kind"] != "hero"]
        for who, plant, how in day.get("firsts", []):
            moments.append({"kind": "plant", "text": f"{who or 'Someone'} {'sowed' if how == 'seeding' else 'planted'} the farm's first {plant.lower()}."})
        if d == very_first:
            title = "Once upon a time…"
            lines.append("This is where the Nevet story begins.")
        elif day.get("event_title"):
            title = day["event_title"]
        elif any(m["kind"] == "love" for m in moments):
            title = "A day of love"
        elif any(m["kind"] == "hero" for m in moments):
            title = "A new branch on the tree" if any(j.get("by") for j in joined) else "A new hero"
        elif any(m["kind"] == "harvest" for m in moments):
            title = "Harvest day"
        elif any(m["kind"] == "group" for m in moments):
            title = "Together"
        elif any(m["kind"] == "plant" for m in moments):
            title = "Something new grows"
        elif n and n == busiest and n >= 5:
            title = "The busiest day"
        else:
            title = None
        lines += [m["text"] for m in moments]
        if n:
            parts = []
            for t, c in day["counts"].most_common(4):
                label = (farm_db.ACTION_BY_ID.get(t) or {}).get("label", t.replace("_", " ")).lower()
                parts.append(label + (f" ×{c}" if c > 1 else ""))
            lines.append(f"{_names(day['who'])}: " + ", ".join(parts) + (f", {day['kg']:.1f} kg picked" if day["kg"] >= 0.1 else "") + ".")
        if day["lines"]:
            lines += day["lines"][:2]
        if day["photos"]:
            lines.append(f"The camera took {day['photos']} photo{'s' if day['photos'] != 1 else ''}.")
        out.append({
            "date": d.isoformat(), "weekday": d.strftime("%a"), "label": d.strftime("%-d %b %Y"),
            "title": title, "lines": lines[:8], "n": n, "counts": dict(day["counts"].most_common(6)),
            "who": list(OrderedDict.fromkeys(day["who"]))[:8], "kg": round(day["kg"], 2),
            "moments": [m["kind"] for m in moments], "heart": bool(moments) or d == very_first,
            "chapter": d == very_first,
        })
    import invites                                   # the mother tree: who invited whom, and their connections
    return {"days": out, "first": very_first.isoformat(), "today": date.today().isoformat(),
            "total_days": len(days), "shown": len(out), "tree": invites.tree(), "counts": invites.counts()}
