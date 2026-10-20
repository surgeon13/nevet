"""Events on the farm: parties, festivals, gatherings, workshops, volunteer days.

Each event has a time and place, and gathers data as it goes:

- before: who's coming (Going / Maybe / Can't, plus guests and what they'll
  bring) and volunteer tasks people sign up for;
- on the day: check-ins, a walk-in counter at the gate (every tap is kept
  with its time, so you can see when people arrived) and a live log;
- after: feedback (1-5 and a comment), the camera's photos from those hours,
  a summary and exports (CSV and JSON, the map as GeoJSON).

An event also has its own map on top of the garden map (garden_map.py,
EVENT_CATEGORIES: stage, dance floor, food, parking, first aid...).
Tables are created in farm_db.get_conn().
"""
import csv
import io
import json
from datetime import datetime, timedelta

import farm_db

# id, label, emoji, what the heroes do on the 3D farm meanwhile
KINDS = [
    ("party", "Party", "🎉", "party"),
    ("festival", "Festival", "🎪", "party"),
    ("gathering", "Gathering", "🤝", "campfire"),
    ("campfire", "Campfire night", "🔥", "campfire"),
    ("harvest", "Harvest festival", "🧺", "harvest"),
    ("workshop", "Workshop", "🛠️", "plant"),
    ("volunteer", "Volunteer day", "🙌", "water"),
    ("market", "Market", "🛒", "harvest"),
    ("kids", "Kids' day", "🧸", "play"),
    ("other", "Other", "📅", "play"),
]
KIND = {k[0]: {"id": k[0], "label": k[1], "emoji": k[2], "act": k[3]} for k in KINDS}
FARM_ACTS = [("party", "Party"), ("campfire", "Campfire dance"), ("harvest", "Harvest festival"), ("play", "Play park"),
             ("plant", "Planting day"), ("water", "Watering round"), ("animals", "Animal care")]
ANSWERS = {"going": "Going", "maybe": "Maybe", "no": "Can't come"}
DEFAULT_HOURS = 3                      # an event without an end time lasts this long
TITLE_MAX, PLACE_MAX, DESC_MAX, NOTE_MAX, BRING_MAX, TASK_MAX = 80, 120, 2000, 500, 80, 80


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _q(sql, args=(), one=False):
    conn = farm_db.get_conn()
    cur = conn.execute(sql, args)
    rows = cur.fetchone() if one else cur.fetchall()
    conn.close()
    return rows


def _run(sql, args=()):
    conn = farm_db.get_conn()
    cur = conn.execute(sql, args)
    conn.commit()
    conn.close()
    return cur


def _dt(s):
    try:
        return datetime.fromisoformat(s) if s else None
    except ValueError:
        return None


# ---------------------------------------------------------------- the event itself

def clean(form):
    """Checks the event form. Returns (fields, error)."""
    title = " ".join((form.get("title") or "").split())
    if not title:
        return {}, "Give the event a name."
    if len(title) > TITLE_MAX:
        return {}, f"Names can be at most {TITLE_MAX} characters."
    kind = form.get("kind") or "gathering"
    if kind not in KIND:
        return {}, "Pick what kind of event it is."
    try:
        start = datetime.strptime(f"{form.get('date', '')} {form.get('time') or '18:00'}", "%Y-%m-%d %H:%M")
    except ValueError:
        return {}, "Pick the day (and time) it starts."
    end = None
    if form.get("end_date") or form.get("end_time"):
        end_day = form.get("end_date") or start.strftime("%Y-%m-%d")
        try:
            end = datetime.strptime(f"{end_day} {form.get('end_time') or '23:59'}", "%Y-%m-%d %H:%M")
        except (ValueError, TypeError):
            return {}, "The end time doesn't look right."
        if end <= start:
            return {}, "The event has to end after it starts."
    place = " ".join((form.get("place") or "").split())[:PLACE_MAX] or None
    desc = (form.get("description") or "").strip()
    if len(desc) > DESC_MAX:
        return {}, f"The description can be at most {DESC_MAX} characters."
    cap = (form.get("capacity") or "").strip()
    if cap:
        try:
            cap = int(cap)
            if cap < 0 or cap > 100000:
                raise ValueError
        except ValueError:
            return {}, "Capacity is a number of people."
    act = form.get("farm_act") or KIND[kind]["act"]
    if act not in dict(FARM_ACTS):
        act = KIND[kind]["act"]
    return {"title": title, "kind": kind, "starts_at": start.isoformat(timespec="minutes"),
            "ends_at": end.isoformat(timespec="minutes") if end else None, "place": place,
            "description": desc or None, "capacity": cap or None, "farm_act": act}, None


def create(fields, user_id):
    cur = _run("INSERT INTO events (title, kind, starts_at, ends_at, place, description, capacity, farm_act, created_by, created_at) "
               "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
               (fields["title"], fields["kind"], fields["starts_at"], fields["ends_at"], fields["place"],
                fields["description"], fields["capacity"], fields["farm_act"], user_id, _now()))
    return cur.lastrowid


def update(event_id, fields):
    keys = ("title", "kind", "starts_at", "ends_at", "place", "description", "capacity", "farm_act")
    _run(f"UPDATE events SET {', '.join(k + ' = ?' for k in keys)}, updated_at = ? WHERE id = ?",
         tuple(fields[k] for k in keys) + (_now(), event_id))


def set_status(event_id, status):
    _run("UPDATE events SET status = ?, updated_at = ? WHERE id = ?", (status, _now(), event_id))


def delete(event_id):
    _run("UPDATE events SET deleted_at = ? WHERE id = ?", (_now(), event_id))
    _run("UPDATE map_features SET deleted_at = ? WHERE event_id = ? AND deleted_at IS NULL", (_now(), event_id))


_EVENT_SQL = """
    SELECT e.*, g.name AS created_by_name,
        (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.answer = 'going') AS going,
        (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.answer = 'maybe') AS maybe,
        (SELECT COALESCE(SUM(r.guests), 0) FROM event_rsvps r WHERE r.event_id = e.id AND r.answer = 'going') AS guests,
        (SELECT COUNT(*) FROM event_checkins c WHERE c.event_id = e.id) AS checked_in,
        (SELECT COALESCE(SUM(h.delta), 0) FROM event_headcount h WHERE h.event_id = e.id) AS walk_ins
    FROM events e LEFT JOIN growers g ON g.id = e.created_by
"""


def get(event_id):
    row = _q(_EVENT_SQL + " WHERE e.id = ? AND e.deleted_at IS NULL", (event_id,), one=True)
    return view(row) if row else None


def list_events():
    return [view(r) for r in _q(_EVENT_SQL + " WHERE e.deleted_at IS NULL ORDER BY e.starts_at")]


def view(row, now=None):
    """An event row as a dict, with its kind, when it ends and where it stands (upcoming, now, past, cancelled)."""
    ev = dict(row)
    now = now or datetime.now()
    start = _dt(ev["starts_at"])
    end = _dt(ev["ends_at"]) or start + timedelta(hours=DEFAULT_HOURS)
    ev["start"], ev["end"] = start, end
    ev["kind_info"] = KIND.get(ev["kind"], KIND["other"])
    ev["phase"] = "cancelled" if ev["status"] == "cancelled" else "now" if start <= now < end else "upcoming" if now < start else "past"
    ev["expected"] = ev.get("going", 0) + ev.get("guests", 0)
    ev["attended"] = ev.get("checked_in", 0) + max(0, ev.get("walk_ins", 0))
    ev["when"] = when_text(start, _dt(ev["ends_at"]))
    ev["days_to"] = (start.date() - now.date()).days
    return ev


def when_text(start, end):
    s = f"{start:%a %-d %b %Y · %H:%M}"
    if end:
        s += f"–{end:%H:%M}" if end.date() == start.date() else f" – {end:%a %-d %b %H:%M}"
    return s


def happening(now=None, within_hours=0):
    """Events going on now (or starting within the next few hours), soonest first."""
    now = now or datetime.now()
    out = []
    for ev in list_events():
        if ev["status"] == "cancelled":
            continue
        if ev["start"] - timedelta(hours=within_hours) <= now < ev["end"]:
            out.append(ev)
    return out


def upcoming(days=7, now=None):
    now = now or datetime.now()
    return [e for e in list_events() if e["phase"] == "upcoming" and e["start"] <= now + timedelta(days=days)]


def can_manage(ev, user):
    return bool(user) and (user.get("is_admin") or ev.get("created_by") == user.get("id"))


# ---------------------------------------------------------------- who's coming

def set_rsvp(event_id, grower_id, answer, guests=0, bring=None):
    if answer == "clear":
        _run("DELETE FROM event_rsvps WHERE event_id = ? AND grower_id = ?", (event_id, grower_id))
        return None
    if answer not in ANSWERS:
        return "Pick Going, Maybe or Can't come."
    try:
        guests = max(0, min(20, int(guests or 0)))
    except (TypeError, ValueError):
        guests = 0
    bring = " ".join((bring or "").split())[:BRING_MAX] or None
    _run("INSERT INTO event_rsvps (event_id, grower_id, answer, guests, bring, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
         "ON CONFLICT(event_id, grower_id) DO UPDATE SET answer = excluded.answer, guests = excluded.guests, "
         "bring = excluded.bring, updated_at = excluded.updated_at",
         (event_id, grower_id, answer, guests if answer != "no" else 0, bring if answer != "no" else None, _now()))
    return None


def rsvps(event_id):
    return _q("SELECT r.*, g.name, g.appearance FROM event_rsvps r JOIN growers g ON g.id = r.grower_id "
              "WHERE r.event_id = ? AND g.deleted_at IS NULL ORDER BY r.answer = 'going' DESC, r.answer = 'maybe' DESC, g.name", (event_id,))


def rsvp_of(event_id, grower_id):
    return _q("SELECT * FROM event_rsvps WHERE event_id = ? AND grower_id = ?", (event_id, grower_id), one=True)


# ---------------------------------------------------------------- volunteer tasks

def add_task(event_id, title, needed, user_id):
    title = " ".join((title or "").split())[:TASK_MAX]
    if not title:
        return "Name the task (e.g. Setting up the stage)."
    try:
        needed = max(1, min(50, int(needed or 1)))
    except (TypeError, ValueError):
        needed = 1
    _run("INSERT INTO event_tasks (event_id, title, needed, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
         (event_id, title, needed, user_id, _now()))
    return None


def task(task_id):
    return _q("SELECT * FROM event_tasks WHERE id = ?", (task_id,), one=True)


def tasks(event_id):
    rows = _q("SELECT * FROM event_tasks WHERE event_id = ? ORDER BY done, id", (event_id,))
    people = _q("SELECT tp.task_id, g.id, g.name FROM event_task_people tp JOIN event_tasks t ON t.id = tp.task_id "
                "JOIN growers g ON g.id = tp.grower_id WHERE t.event_id = ? ORDER BY g.name", (event_id,))
    out = []
    for r in rows:
        t = dict(r)
        t["people"] = [{"id": p["id"], "name": p["name"]} for p in people if p["task_id"] == r["id"]]
        t["open"] = max(0, t["needed"] - len(t["people"]))
        out.append(t)
    return out


def toggle_volunteer(task_id, grower_id):
    """Signs up for a task, or leaves it. Returns True when signed up."""
    if _q("SELECT 1 FROM event_task_people WHERE task_id = ? AND grower_id = ?", (task_id, grower_id), one=True):
        _run("DELETE FROM event_task_people WHERE task_id = ? AND grower_id = ?", (task_id, grower_id))
        return False
    _run("INSERT INTO event_task_people (task_id, grower_id) VALUES (?, ?)", (task_id, grower_id))
    return True


def set_task_done(task_id, done):
    _run("UPDATE event_tasks SET done = ? WHERE id = ?", (1 if done else 0, task_id))


def delete_task(task_id):
    _run("DELETE FROM event_tasks WHERE id = ?", (task_id,))


# ---------------------------------------------------------------- on the day

def check_in(event_id, grower_id, by_id):
    _run("INSERT OR IGNORE INTO event_checkins (event_id, grower_id, at, by_id) VALUES (?, ?, ?, ?)",
         (event_id, grower_id, _now(), by_id))


def check_out(event_id, grower_id):
    _run("DELETE FROM event_checkins WHERE event_id = ? AND grower_id = ?", (event_id, grower_id))


def checkins(event_id):
    return _q("SELECT c.*, g.name FROM event_checkins c JOIN growers g ON g.id = c.grower_id WHERE c.event_id = ? ORDER BY c.at",
              (event_id,))


def count_walk_in(event_id, delta, by_id):
    """+1 / -1 at the gate for people without a hero; never below zero. Returns the new total."""
    delta = 1 if delta > 0 else -1
    total = _q("SELECT COALESCE(SUM(delta), 0) FROM event_headcount WHERE event_id = ?", (event_id,), one=True)[0]
    if total + delta >= 0:
        _run("INSERT INTO event_headcount (event_id, delta, at, by_id) VALUES (?, ?, ?, ?)", (event_id, delta, _now(), by_id))
        total += delta
    return total


def arrivals(ev, bucket_min=15):
    """How many were there over time: check-ins and walk-ins in 15-minute steps (for the arrivals chart)."""
    marks = [(_dt(r["at"]), 1) for r in checkins(ev["id"])]
    marks += [(_dt(r["at"]), r["delta"]) for r in _q("SELECT at, delta FROM event_headcount WHERE event_id = ? ORDER BY at", (ev["id"],))]
    marks = sorted(m for m in marks if m[0])
    if not marks:
        return []
    t0 = min(ev["start"], marks[0][0]).replace(second=0, microsecond=0)
    t0 -= timedelta(minutes=t0.minute % bucket_min)
    t1 = max(marks[-1][0], min(ev["end"], datetime.now()))
    out, total, i, t = [], 0, 0, t0
    while t <= t1 + timedelta(minutes=bucket_min) and len(out) < 200:
        nxt = t + timedelta(minutes=bucket_min)
        while i < len(marks) and marks[i][0] < nxt:
            total += marks[i][1]
            i += 1
        out.append({"t": t.strftime("%H:%M"), "n": max(0, total)})
        t = nxt
    return out


def add_note(event_id, grower_id, text):
    text = (text or "").strip()
    if not text:
        return "Write something first."
    _run("INSERT INTO event_notes (event_id, grower_id, at, text) VALUES (?, ?, ?, ?)", (event_id, grower_id, _now(), text[:NOTE_MAX]))
    return None


def notes(event_id):
    return _q("SELECT n.*, g.name FROM event_notes n LEFT JOIN growers g ON g.id = n.grower_id WHERE n.event_id = ? ORDER BY n.at DESC, n.id DESC",
              (event_id,))


def note(note_id):
    return _q("SELECT * FROM event_notes WHERE id = ?", (note_id,), one=True)


def delete_note(note_id):
    _run("DELETE FROM event_notes WHERE id = ?", (note_id,))


def photos(ev, limit=24):
    """The camera's photos from the event's hours (half an hour either side)."""
    a = (ev["start"] - timedelta(minutes=30)).isoformat(timespec="seconds")
    b = (ev["end"] + timedelta(minutes=30)).isoformat(timespec="seconds")
    return _q("SELECT path, taken_at FROM captures WHERE kind = 'photo' AND taken_at BETWEEN ? AND ? ORDER BY taken_at LIMIT ?", (a, b, limit))


# ---------------------------------------------------------------- afterwards

def set_feedback(event_id, grower_id, rating, comment):
    try:
        rating = int(rating)
    except (TypeError, ValueError):
        return "Pick 1 to 5 stars."
    if not 1 <= rating <= 5:
        return "Pick 1 to 5 stars."
    comment = (comment or "").strip()[:NOTE_MAX] or None
    _run("INSERT INTO event_feedback (event_id, grower_id, rating, comment, at) VALUES (?, ?, ?, ?, ?) "
         "ON CONFLICT(event_id, grower_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment, at = excluded.at",
         (event_id, grower_id, rating, comment, _now()))
    return None


def feedback(event_id):
    return _q("SELECT f.*, g.name FROM event_feedback f JOIN growers g ON g.id = f.grower_id WHERE f.event_id = ? ORDER BY f.at DESC", (event_id,))


def summary(ev):
    """The event's numbers in one place (the Data card and the JSON export)."""
    import garden_map
    fb = feedback(ev["id"])
    ts = tasks(ev["id"])
    feats = garden_map.list_features(ev["id"])
    area = sum(garden_map.area_m2(json.loads(f["geometry"])) for f in feats if f["kind"] == "area")
    no = _q("SELECT COUNT(*) FROM event_rsvps WHERE event_id = ? AND answer = 'no'", (ev["id"],), one=True)[0]
    peak = max([a["n"] for a in arrivals(ev)] or [0])
    return {
        "going": ev["going"], "maybe": ev["maybe"], "cant": no, "guests": ev["guests"], "expected": ev["expected"],
        "capacity": ev["capacity"], "checked_in": ev["checked_in"], "walk_ins": max(0, ev["walk_ins"]), "attended": ev["attended"],
        "peak": peak,
        "show_rate": round(100 * ev["checked_in"] / ev["going"]) if ev["going"] else None,
        "rating": round(sum(f["rating"] for f in fb) / len(fb), 1) if fb else None, "ratings": len(fb),
        "tasks": len(ts), "tasks_done": sum(1 for t in ts if t["done"]),
        "volunteers": len({p["id"] for t in ts for p in t["people"]}),
        "spots_open": sum(t["open"] for t in ts),
        "notes": len(notes(ev["id"])), "photos": len(photos(ev, 1000)),
        "mapped": len(feats), "mapped_m2": round(area, 1),
    }


def people_csv(ev):
    """Everyone who answered, checked in, volunteered or gave feedback: one row each."""
    rows = {}

    def row(gid, name):
        return rows.setdefault(gid, {"hero": name, "answer": "", "guests": "", "bringing": "", "checked_in": "",
                                     "tasks": [], "rating": "", "comment": ""})
    for r in rsvps(ev["id"]):
        x = row(r["grower_id"], r["name"])
        x.update(answer=ANSWERS.get(r["answer"], r["answer"]), guests=r["guests"] or "", bringing=r["bring"] or "")
    for c in checkins(ev["id"]):
        row(c["grower_id"], c["name"])["checked_in"] = c["at"].replace("T", " ")[:16]
    for t in tasks(ev["id"]):
        for p in t["people"]:
            row(p["id"], p["name"])["tasks"].append(t["title"])
    for f in feedback(ev["id"]):
        x = row(f["grower_id"], f["name"])
        x.update(rating=f["rating"], comment=f["comment"] or "")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Hero", "Answer", "Guests", "Bringing", "Checked in", "Volunteer tasks", "Rating", "Comment"])
    for x in sorted(rows.values(), key=lambda x: x["hero"].lower()):
        w.writerow([x["hero"], x["answer"], x["guests"], x["bringing"], x["checked_in"], "; ".join(x["tasks"]), x["rating"], x["comment"]])
    w.writerow([])
    w.writerow(["Walk-ins at the gate (+1 / -1)", "Time"])
    for h in _q("SELECT delta, at FROM event_headcount WHERE event_id = ? ORDER BY at", (ev["id"],)):
        w.writerow([f"{h['delta']:+d}", h["at"].replace("T", " ")])
    return buf.getvalue()


def export(ev):
    """Everything about one event, for keeping or for other tools."""
    import garden_map
    s = summary(ev)
    return {
        "event": {k: ev[k] for k in ("id", "title", "kind", "starts_at", "ends_at", "place", "description", "capacity", "status", "farm_act")}
                 | {"created_by": ev["created_by_name"]},
        "summary": s,
        "rsvps": [{"hero": r["name"], "answer": r["answer"], "guests": r["guests"], "bringing": r["bring"], "at": r["updated_at"]} for r in rsvps(ev["id"])],
        "tasks": [{"title": t["title"], "needed": t["needed"], "done": bool(t["done"]), "people": [p["name"] for p in t["people"]]} for t in tasks(ev["id"])],
        "checkins": [{"hero": c["name"], "at": c["at"]} for c in checkins(ev["id"])],
        "walk_ins": [{"delta": h["delta"], "at": h["at"]} for h in _q("SELECT delta, at FROM event_headcount WHERE event_id = ? ORDER BY at", (ev["id"],))],
        "arrivals": arrivals(ev),
        "log": [{"hero": n["name"], "at": n["at"], "text": n["text"]} for n in reversed(notes(ev["id"]))],
        "feedback": [{"hero": f["name"], "rating": f["rating"], "comment": f["comment"], "at": f["at"]} for f in feedback(ev["id"])],
        "photos": [p["path"] for p in photos(ev, 1000)],
        "map": garden_map.feature_collection(event_id=ev["id"], garden_name=ev["title"]),
    }
