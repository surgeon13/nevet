"""Who invited whom: every hero's own invite link and code, the mother tree, and the invite log.

* Every player has a personal invite code (made the first time it's needed). Their link /i/<code> opens
  sign-up with the code filled in, and their code works wherever the farm's invite code does (people
  joining from the internet need one).
* A new hero remembers who invited them (growers.invited_by) and how (growers.invited_via): their link,
  their code, added by them while logged in, or said so later ("Who invited you?").
* The invite log (invite_events) keeps what happened: links opened, heroes who joined, who added whom,
  inviters set later and codes renewed.
* community() is how far the farm has bloomed: the more heroes join, invite friends and connect, the more the 3D
  farm grows (taller plants, more flowers, the mother tree, a rainbow, birds, shooting stars, balloons, the aurora).
* tree() is the mother tree for the farm story page (time.html, static/js/time3d.js): every hero on the
  branch of the hero who invited them, at the height of the day they joined, with their connections.
"""
import json
import math
import secrets
from datetime import datetime

import farm_db
import relations

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"          # no 0/O, 1/I (like the farm's invite code)
VIA = {
    "link": "their invite link",
    "code": "their invite code",
    "added": "added by them",
    "set": "told us later",
}
KIND_GROUP = {                                        # how a connection is drawn on the tree
    "spouse": "love", "partner": "love",
    "parent": "family", "guardian": "family", "grandparent": "family", "aunt_uncle": "family",
    "sibling": "family", "cousin": "family",
    "friend": "friends", "neighbour": "friends", "housemate": "friends",
    "mentor": "team", "coordinator": "team", "teammate": "team", "other": "team",
}


def _now():
    return datetime.now().isoformat(timespec="seconds")


def clean_code(text):
    return "".join(ch for ch in (text or "").upper() if ch in ALPHABET)[:12]


def log(kind, inviter=None, invitee=None, via=None, place=None, note=None):
    """One line in the invite log. kind: opened, joined, added, set, cleared, new_code."""
    conn = farm_db.get_conn()
    conn.execute("INSERT INTO invite_events (at, kind, inviter_id, invitee_id, via, place, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
                 (_now(), kind, inviter, invitee, via, place, (note or "")[:120] or None))
    conn.commit()
    conn.close()


def code_for(grower_id, renew=False):
    """The hero's own invite code (made the first time, or a fresh one with renew=True)."""
    conn = farm_db.get_conn()
    row = conn.execute("SELECT invite_code FROM growers WHERE id = ?", (grower_id,)).fetchone()
    if not row:
        conn.close()
        return None
    code = row["invite_code"]
    if not code or renew:
        farm_code = farm_db.get_setting("invite_code") or ""
        while True:
            code = "".join(secrets.choice(ALPHABET) for _ in range(8))
            if code != farm_code and not conn.execute("SELECT 1 FROM growers WHERE invite_code = ?", (code,)).fetchone():
                break
        conn.execute("UPDATE growers SET invite_code = ? WHERE id = ?", (code, grower_id))
        conn.commit()
        conn.close()
        if renew:
            log("new_code", inviter=grower_id)
        return code
    conn.close()
    return code


def find_code(code):
    """The player whose invite code this is (a hero with an account, not in the recycle bin), or None."""
    code = clean_code(code)
    if len(code) < 6:
        return None
    conn = farm_db.get_conn()
    row = conn.execute("SELECT * FROM growers WHERE invite_code = ? AND deleted_at IS NULL AND password_hash IS NOT NULL",
                       (code,)).fetchone()
    conn.close()
    return row


def descendants(grower_id):
    """Everyone below a hero on the mother tree (the heroes they invited, the heroes those invited...)."""
    conn = farm_db.get_conn()
    kids = {}
    for r in conn.execute("SELECT id, invited_by FROM growers WHERE invited_by IS NOT NULL"):
        kids.setdefault(r["invited_by"], []).append(r["id"])
    conn.close()
    out, todo = set(), [grower_id]
    while todo:
        for k in kids.get(todo.pop(), []):
            if k not in out:
                out.add(k)
                todo.append(k)
    return out


def set_inviter(invitee_id, inviter_id, via, by=None, place=None):
    """Record who invited a hero. False when it can't be (themselves, someone they invited, or nobody)."""
    if not inviter_id or inviter_id == invitee_id or inviter_id in descendants(invitee_id):
        return False
    conn = farm_db.get_conn()
    ok = conn.execute("SELECT 1 FROM growers WHERE id = ? AND deleted_at IS NULL", (inviter_id,)).fetchone()
    if ok:
        conn.execute("UPDATE growers SET invited_by = ?, invited_via = ? WHERE id = ?", (inviter_id, via, invitee_id))
        conn.commit()
    conn.close()
    if ok:
        log("joined" if via in ("link", "code") else via, inviter=inviter_id, invitee=invitee_id, via=via, place=place,
            note=None if by in (None, invitee_id, inviter_id) else f"set by #{by}")
    return bool(ok)


def clear_inviter(invitee_id, by=None):
    conn = farm_db.get_conn()
    row = conn.execute("SELECT invited_by FROM growers WHERE id = ?", (invitee_id,)).fetchone()
    conn.execute("UPDATE growers SET invited_by = NULL, invited_via = NULL WHERE id = ?", (invitee_id,))
    conn.commit()
    conn.close()
    if row and row["invited_by"]:
        log("cleared", inviter=row["invited_by"], invitee=invitee_id, note=f"by #{by}" if by else None)


def summary(grower_id, with_code=False):
    """For a hero's page and invite card: who invited them, the heroes they invited, how often their link was opened
    (and their own code, made if needed, for their own card)."""
    conn = farm_db.get_conn()
    me = conn.execute("""SELECT g.invited_via, i.id AS by_id, i.name AS by_name FROM growers g
                         LEFT JOIN growers i ON i.id = g.invited_by AND i.deleted_at IS NULL WHERE g.id = ?""", (grower_id,)).fetchone()
    invited = conn.execute("""SELECT id, name, joined_at, invited_via FROM growers
                              WHERE invited_by = ? AND deleted_at IS NULL ORDER BY joined_at""", (grower_id,)).fetchall()
    opened = conn.execute("SELECT COUNT(*) FROM invite_events WHERE kind = 'opened' AND inviter_id = ?", (grower_id,)).fetchone()[0]
    conn.close()
    below = descendants(grower_id)
    return {"code": code_for(grower_id) if with_code else None,
            "by": {"id": me["by_id"], "name": me["by_name"], "via": VIA.get(me["invited_via"] or "", "")} if me and me["by_id"] else None,
            "invited": [{"id": r["id"], "name": r["name"], "joined": (r["joined_at"] or "")[:10], "via": VIA.get(r["invited_via"] or "", "")} for r in invited],
            "opened": opened, "family": len(below)}


def recent(limit=30):
    """The latest lines of the invite log, with names."""
    conn = farm_db.get_conn()
    rows = conn.execute("""SELECT e.*, a.name AS inviter, b.name AS invitee FROM invite_events e
                           LEFT JOIN growers a ON a.id = e.inviter_id LEFT JOIN growers b ON b.id = e.invitee_id
                           ORDER BY e.id DESC LIMIT ?""", (limit,)).fetchall()
    conn.close()
    words = {"opened": "opened {a}'s invite link", "joined": "{b} joined, invited by {a}", "added": "{a} added {b}",
             "set": "{b} said {a} invited them", "cleared": "{b}'s inviter ({a}) was cleared", "new_code": "{a} made a new invite code"}
    out = []
    for r in rows:
        text = words.get(r["kind"], r["kind"]).format(a=r["inviter"] or "someone", b=r["invitee"] or "someone")
        out.append({"at": r["at"], "kind": r["kind"], "text": text[:1].upper() + text[1:], "place": r["place"]})
    return out


def counts():
    """Totals for the terminal dashboard and the story page."""
    conn = farm_db.get_conn()
    q = lambda sql: conn.execute(sql).fetchone()[0]
    out = {"heroes": q("SELECT COUNT(*) FROM growers WHERE deleted_at IS NULL"),
           "invited": q("SELECT COUNT(*) FROM growers WHERE deleted_at IS NULL AND invited_by IS NOT NULL"),
           "opened": q("SELECT COUNT(*) FROM invite_events WHERE kind = 'opened'"),
           "connections": q("SELECT COUNT(*) FROM relationships WHERE status = 'accepted'")}
    top = conn.execute("""SELECT i.name, COUNT(*) AS n FROM growers g JOIN growers i ON i.id = g.invited_by
                          WHERE g.deleted_at IS NULL AND i.deleted_at IS NULL GROUP BY i.id ORDER BY n DESC, i.name LIMIT 1""").fetchone()
    conn.close()
    out["top"] = {"name": top["name"], "n": top["n"]} if top else None
    return out


def _colour(look, palette):
    try:
        return palette.get(json.loads(look or "{}").get("outfitColor"))
    except ValueError:
        return None


def tree():
    """The mother tree: every hero, who invited them, the day they joined, and the connections between them."""
    try:
        import heroes
        palette = {o["id"]: o.get("color") for x in heroes.catalog()["looks"] if x.get("id") == "outfitColor" for o in x["options"]}
    except Exception:                                  # the tree still grows without the catalog
        palette = {}
    conn = farm_db.get_conn()
    rows = conn.execute("""SELECT id, name, joined_at, invited_by, invited_via, appearance, is_admin FROM growers
                           WHERE deleted_at IS NULL ORDER BY joined_at, id""").fetchall()
    ids = {r["id"] for r in rows}
    nodes = []
    for r in rows:
        by = r["invited_by"] if r["invited_by"] in ids else None
        nodes.append({"id": r["id"], "name": r["name"], "joined": (r["joined_at"] or "")[:10], "by": by,
                      "via": VIA.get(r["invited_via"] or "", "") if by else "", "color": _colour(r["appearance"], palette)})
    kids = {}
    for n in nodes:
        if n["by"]:
            kids[n["by"]] = kids.get(n["by"], 0) + 1
    for n in nodes:
        n["kids"] = kids.get(n["id"], 0)
    gender = {}
    for r in rows:
        try:
            gender[r["id"]] = json.loads(r["appearance"] or "{}").get("gender")
        except ValueError:
            pass
    links = []
    for r in conn.execute("""SELECT a_id, b_id, kind, created_at FROM relationships WHERE status = 'accepted'"""):
        if r["a_id"] in ids and r["b_id"] in ids:          # la: what A is to B (mother), lb: what B is to A (son)
            links.append({"a": r["a_id"], "b": r["b_id"], "kind": r["kind"], "group": KIND_GROUP.get(r["kind"], "team"),
                          "la": relations.label(r["kind"], gender.get(r["a_id"]), True).lower(),
                          "lb": relations.label(r["kind"], gender.get(r["b_id"]), False).lower(), "date": (r["created_at"] or "")[:10]})
    conn.close()
    return {"nodes": nodes, "links": links}


# The farm blooms as the community grows: what each level brings to the 3D farm (static/js/farm3d.js)
BLOOM = [
    (0.10, "butterflies", "Clouds of butterflies"),
    (0.20, "rainbow", "A rainbow over the farm"),
    (0.30, "blossom", "Plants in blossom, petals on the wind"),
    (0.40, "birds", "Flocks of birds"),
    (0.50, "stars", "Shooting stars at night"),
    (0.60, "balloons", "Hot-air balloons"),
    (0.70, "aurora", "The northern lights at night"),
    (0.85, "golden", "The mother tree in golden bloom"),
]


def community():
    """How far the farm has bloomed (0..1), from heroes, friends invited, connections and groups, and what that brings.

    Every hero counts 1, every hero who came through a friend 1, every confirmed connection 1.5 and every group 2;
    the level rises quickly at first and then more slowly (1 - e^(-score / 40)), so a family's farm already blooms
    a little and a big community's farm is in full flower."""
    c = counts()
    conn = farm_db.get_conn()
    try:
        groups = conn.execute("SELECT COUNT(*) FROM groups").fetchone()[0]
    except Exception:                                  # (very old databases)
        groups = 0
    conn.close()
    score = c["heroes"] + c["invited"] + 1.5 * c["connections"] + 2 * groups
    level = round(1 - math.exp(-score / 40.0), 3)
    unlocked = [k for t, k, _ in BLOOM if level >= t]
    nxt = next(({"at": t, "key": k, "name": name} for t, k, name in BLOOM if level < t), None)
    return dict(c, groups=groups, score=round(score, 1), level=level, unlocked=unlocked, next=nxt,
                gifts=[{"at": t, "key": k, "name": name, "on": level >= t} for t, k, name in BLOOM])
