"""NFC / RFID tags for the farm (and QR labels: every tag has one).

Kinds of tags:
- plant:  a sticker on a plant, bed, tree or worm bin. A phone tap opens it with quick-log buttons.
- action: a card for a whole-farm action ("Watered the whole farm"): one tap logs it.
- event:  check in to an event at the gate.
- hero:   a hero's key fob or card, for a reader at the gate (check-ins) and to say who's scanning.

Each tag has a short code; its link /t/<code> is what goes on an NFC sticker
(an NDEF URL record, which phones open by themselves) and in its printed QR.
A tag can also be linked to a chip's UID (the sticker's or fob's serial
number), so readers that only see the UID - a Flipper Zero, a PN532 on the
Pi, a USB card reader - recognise it too.

At a reader (POST /api/tags/scan, see scripts/nevet_tags.py): scan your hero
fob first, then tap tags - the action, plant or event tag is logged as you,
for two minutes after your fob. A fob alone checks you in to the event
that's on. Unknown UIDs are kept so they can be linked on the Tags page.

Flipper Zero files: flipper_nfc() writes an NTAG215 dump holding the link
(to emulate the tag with the Flipper, or write it to a sticker), flipper_rfid()
an EM4100 key (to write onto a blank T5577 fob).
"""
import hashlib
import re
import secrets
from datetime import datetime, timedelta

import farm_db

KINDS = {"plant": "Plant tag", "action": "Farm action", "event": "Event check-in", "hero": "Hero fob"}
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ACTOR_MINUTES = 2                 # after a hero fob at a reader, its next taps count as that hero
FARM_ACTIONS = ("watering", "weeding", "fertilizing", "feeding", "pest_control", "observation", "pruning")
PLANT_ACTIONS = ("watering", "harvest", "observation", "feeding", "pruning", "weeding", "fertilizing", "pest_control", "germination", "transplant")
TECHS = {"ntag": "NFC sticker (NTAG)", "mifare": "NFC card (MIFARE)", "em4100": "125 kHz fob (EM4100)", "hid": "125 kHz card (HID)", "qr": "QR label only", "other": "Other"}


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


def clean_uid(uid):
    """A chip's serial number as plain upper-case hex ('04:a3 91…' -> '04A391…'), or None."""
    u = re.sub(r"[^0-9A-Fa-f]", "", str(uid or "")).upper()
    return u if 4 <= len(u) <= 32 and len(u) % 2 == 0 else None


def pretty_uid(uid):
    return " ".join(uid[i:i + 2] for i in range(0, len(uid), 2)) if uid else ""


def new_code():
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        if not _q("SELECT 1 FROM tags WHERE code = ?", (code,), one=True):
            return code


# ---------------------------------------------------------------- tags

_TAG_SQL = """
    SELECT t.*, a.name AS asset_name, a.asset_type, e.title AS event_title, e.deleted_at AS event_deleted,
           h.name AS hero_name, c.name AS created_by_name
    FROM tags t
    LEFT JOIN assets a ON t.kind = 'plant' AND a.id = t.target_id
    LEFT JOIN events e ON t.kind = 'event' AND e.id = t.target_id
    LEFT JOIN growers h ON t.kind = 'hero' AND h.id = t.target_id
    LEFT JOIN growers c ON c.id = t.created_by
"""


def view(row):
    if not row:
        return None
    t = dict(row)
    t["kind_label"] = KINDS.get(t["kind"], t["kind"])
    t["action_label"] = (farm_db.ACTION_BY_ID.get(t["action"]) or {}).get("label") if t["action"] else None
    if t["kind"] == "plant":
        t["title"] = t["asset_name"] or "A plant that's gone"
    elif t["kind"] == "action":
        t["title"] = t["label"] or f"{t['action_label'] or 'Action'}: the whole farm"
    elif t["kind"] == "event":
        t["title"] = t["event_title"] or "An event that's gone"
    else:
        t["title"] = t["hero_name"] or "A hero that's gone"
    t["name"] = t["label"] or t["title"]
    t["uid_pretty"] = pretty_uid(t["uid"])
    t["tech_label"] = TECHS.get(t["tech"] or "", "")
    return t


def get(tag_id):
    return view(_q(_TAG_SQL + " WHERE t.id = ? AND t.deleted_at IS NULL", (tag_id,), one=True))


def by_code(code):
    return view(_q(_TAG_SQL + " WHERE t.code = ? AND t.deleted_at IS NULL", ((code or "").upper(),), one=True))


def by_uid(uid):
    uid = clean_uid(uid)
    if not uid:
        return None
    row = _q(_TAG_SQL + " WHERE t.uid = ? AND t.deleted_at IS NULL", (uid,), one=True)
    if not row and len(uid) == 8:
        # USB card readers usually give an EM4100 fob's last 4 bytes (typed in decimal); the Flipper all 5
        row = _q(_TAG_SQL + " WHERE length(t.uid) = 10 AND substr(t.uid, 3) = ? AND t.deleted_at IS NULL", (uid,), one=True)
    return view(row)


def list_tags(kind=None, target_id=None):
    sql, args = _TAG_SQL + " WHERE t.deleted_at IS NULL", []
    if kind:
        sql += " AND t.kind = ?"
        args.append(kind)
    if target_id is not None:
        sql += " AND t.target_id = ?"
        args.append(target_id)
    return [view(r) for r in _q(sql + " ORDER BY t.kind, t.id DESC", args)]


def create(kind, target_id=None, action=None, label=None, uid=None, tech=None, user_id=None):
    """Makes a tag. Returns (tag, error)."""
    if kind not in KINDS:
        return None, "Pick what the tag is for."
    label = " ".join((label or "").split())[:60] or None
    if kind == "action":
        target_id = None
        if action not in FARM_ACTIONS:
            return None, "Pick the action the card logs."
    elif kind == "plant":
        if not farm_db.get_asset(target_id or 0):
            return None, "Pick the plant or worm bin."
        if action and action not in PLANT_ACTIONS:
            action = None
    elif kind == "event":
        if not _q("SELECT 1 FROM events WHERE id = ? AND deleted_at IS NULL", (target_id or 0,), one=True):
            return None, "Pick the event."
        action = None
    elif kind == "hero":
        g = farm_db.get_grower(target_id or 0)
        if not g or g["deleted_at"]:
            return None, "Pick the hero."
        action = None
    uid = clean_uid(uid)
    if uid and by_uid(uid):
        return None, "That chip is already linked to another tag."
    tech = tech if tech in TECHS else ("em4100" if kind == "hero" else "ntag")
    cur = _run("INSERT INTO tags (code, kind, target_id, action, label, uid, tech, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
               (new_code(), kind, target_id, action, label, uid, tech, user_id, _now()))
    return get(cur.lastrowid), None


def link_uid(tag_id, uid, tech=None):
    """Links a chip's serial number to the tag. Returns an error or None."""
    uid = clean_uid(uid)
    if not uid:
        return "That doesn't look like a chip's UID (hex, like 04 A3 91 2B C4 61 80)."
    other = by_uid(uid)
    if other and other["id"] != tag_id:
        return f"That chip is already linked to “{other['name']}”."
    _run("UPDATE tags SET uid = ?, tech = COALESCE(?, tech) WHERE id = ?", (uid, tech if tech in TECHS else None, tag_id))
    _run("UPDATE tag_scans SET tag_id = ? WHERE tag_id IS NULL AND uid = ?", (tag_id, uid))
    return None


def unlink_uid(tag_id):
    _run("UPDATE tags SET uid = NULL WHERE id = ?", (tag_id,))


def rename(tag_id, label):
    _run("UPDATE tags SET label = ? WHERE id = ?", (" ".join((label or "").split())[:60] or None, tag_id))


def delete(tag_id):
    _run("UPDATE tags SET deleted_at = ?, uid = NULL WHERE id = ?", (_now(), tag_id))


# ---------------------------------------------------------------- scans

def record(tag, via, uid=None, tech=None, reader=None, grower_id=None, result=None):
    at = _now()
    _run("INSERT INTO tag_scans (tag_id, uid, tech, via, reader, grower_id, at, result) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
         (tag["id"] if tag else None, clean_uid(uid), tech, via, reader, grower_id, at, result))
    if tag:
        _run("UPDATE tags SET scans = scans + 1, last_scan_at = ? WHERE id = ?", (at, tag["id"]))


def recent_scans(limit=20):
    return _q("""SELECT s.*, t.code, t.kind, g.name AS who FROM tag_scans s LEFT JOIN tags t ON t.id = s.tag_id
                 LEFT JOIN growers g ON g.id = s.grower_id ORDER BY s.at DESC, s.id DESC LIMIT ?""", (limit,))


def unknown_uids(limit=10):
    """Chips scanned at a reader that aren't linked to a tag yet (newest first)."""
    return _q("""SELECT uid, tech, MAX(at) AS at, COUNT(*) AS n FROM tag_scans
                 WHERE tag_id IS NULL AND uid IS NOT NULL AND uid NOT IN (SELECT uid FROM tags WHERE uid IS NOT NULL)
                 GROUP BY uid ORDER BY MAX(at) DESC LIMIT ?""", (limit,))


def _actor(reader):
    """The hero whose fob was scanned at this reader in the last two minutes."""
    since = (datetime.now() - timedelta(minutes=ACTOR_MINUTES)).isoformat(timespec="seconds")
    r = _q("""SELECT s.grower_id, g.name FROM tag_scans s JOIN tags t ON t.id = s.tag_id JOIN growers g ON g.id = s.grower_id
              WHERE t.kind = 'hero' AND s.reader IS ? AND s.at >= ? AND g.deleted_at IS NULL ORDER BY s.at DESC, s.id DESC LIMIT 1""",
           (reader, since), one=True)
    return (r["grower_id"], r["name"]) if r else (None, None)


def reader_scan(uid, tech=None, reader=None, via="reader", check=False):
    """A chip seen by a reader at the farm. Does what the tag is for and returns {ok, known, text, ...}.
    check=True only says what the chip is (nevet tags check), without logging anything."""
    import events
    uid = clean_uid(uid)
    if not uid:
        return {"ok": False, "known": False, "text": "No UID in that scan."}
    tag = by_uid(uid)
    if check:
        if not tag:
            return {"ok": True, "known": False, "uid": uid, "text": f"Chip {pretty_uid(uid)} isn't linked to a tag yet."}
        what = {"plant": f"plant tag for {tag['asset_name']}", "action": f"farm action: {(tag['action_label'] or '').lower()}",
                "event": f"check-in for {tag['event_title']}", "hero": f"{tag['hero_name']}'s fob"}[tag["kind"]]
        return {"ok": True, "known": True, "uid": uid, "code": tag["code"], "kind": tag["kind"], "name": tag["name"],
                "text": f"{tag['name']} ({what}) · code {tag['code']} · {tag['scans']} scans"}
    if not tag:
        record(None, via, uid, tech, reader, result="unknown")
        return {"ok": True, "known": False, "uid": uid, "text": f"New chip {pretty_uid(uid)}: link it to a tag on the Tags page."}
    out = {"ok": True, "known": True, "uid": uid, "code": tag["code"], "kind": tag["kind"], "name": tag["name"]}
    if tag["kind"] == "hero":
        gid = tag["target_id"]
        hero = farm_db.get_grower(gid)
        if not hero or hero["deleted_at"]:
            record(tag, via, uid, tech, reader, None, "hero in the recycle bin")
            return out | {"text": f"This fob belongs to {tag['hero_name'] or 'a hero'}, who is in the recycle bin. An admin can restore them."}
        on = [e for e in events.happening() if e["status"] != "cancelled"]
        if on:
            events.check_in(on[0]["id"], gid, gid)
            text = f"{tag['hero_name']} checked in to {on[0]['title']}."
        else:
            text = f"Hi {tag['hero_name']}! Tap a tag within {ACTOR_MINUTES} minutes to log it."
        record(tag, via, uid, tech, reader, gid, text)
        return out | {"text": text, "hero": tag["hero_name"]}
    actor, actor_name = _actor(reader)
    if not actor:
        text = f"{tag['name']}: scan your hero fob first, then this tag."
        record(tag, via, uid, tech, reader, None, "no hero")
        return out | {"text": text, "needs_hero": True}
    if tag["kind"] == "event":
        events.check_in(tag["target_id"], actor, actor)
        text = f"{actor_name} checked in to {tag['event_title']}."
    elif tag["kind"] == "action":
        farm_db.add_log(tag["action"], None, notes="Logged with a tag", grower_id=actor)
        text = f"{actor_name}: {tag['action_label'].lower()}, the whole farm. Logged!"
    else:
        act = tag["action"] or "observation"
        farm_db.add_log(act, tag["target_id"], notes="Logged with a tag", grower_id=actor)
        text = f"{actor_name}: {(farm_db.ACTION_BY_ID.get(act) or {}).get('label', act).lower()}, {tag['asset_name']}. Logged!"
    record(tag, via, uid, tech, reader, actor, text)
    return out | {"text": text, "hero": actor_name, "logged": tag["kind"] != "event"}


# ---------------------------------------------------------------- what goes on the chip

URI_PREFIXES = [(b"https://www.", 0x02), (b"http://www.", 0x01), (b"https://", 0x04), (b"http://", 0x03)]


def ndef_uri_message(url):
    """An NDEF message with one URI record: phones open the link when they touch the tag."""
    raw = url.encode("utf-8")
    code = 0
    for prefix, c in URI_PREFIXES:
        if raw.startswith(prefix):
            raw, code = raw[len(prefix):], c
            break
    payload = bytes([code]) + raw
    if len(payload) < 256:
        return bytes([0xD1, 0x01, len(payload), 0x55]) + payload           # MB ME SR, well-known type "U"
    return bytes([0xC1, 0x01]) + len(payload).to_bytes(4, "big") + b"U" + payload


def fake_uid(seed, length=7):
    """A made-up chip serial number for emulating a tag (NXP-style: starts with 04)."""
    h = hashlib.sha256(str(seed).encode()).digest()
    return "04" + h[:length - 1].hex().upper()


def ntag215_pages(uid_hex, url):
    """The 135 pages (4 bytes each) of an NTAG215 holding the link."""
    u = bytes.fromhex(uid_hex)
    bcc0 = 0x88 ^ u[0] ^ u[1] ^ u[2]
    bcc1 = u[3] ^ u[4] ^ u[5] ^ u[6]
    msg = ndef_uri_message(url)
    tlv = bytes([0x03, len(msg)]) + msg + b"\xFE" if len(msg) < 255 else bytes([0x03, 0xFF]) + len(msg).to_bytes(2, "big") + msg + b"\xFE"
    user = tlv + bytes(504 - len(tlv))
    if len(tlv) > 504:
        raise ValueError("Too long for an NTAG215")
    pages = [bytes([u[0], u[1], u[2], bcc0]), u[3:7], bytes([bcc1, 0x48, 0x00, 0x00]), bytes([0xE1, 0x10, 0x3E, 0x00])]
    pages += [user[i:i + 4] for i in range(0, 504, 4)]
    pages += [bytes([0x00, 0x00, 0x00, 0xBD]), bytes([0x04, 0x00, 0x00, 0xFF]), bytes([0x00, 0x05, 0x00, 0x00]), bytes(4), bytes(4)]
    return pages


def _hex(b):
    return " ".join(f"{x:02X}" for x in b)


def flipper_nfc(tag, url):
    """A Flipper Zero NFC file (NTAG215 with the tag's link): load it on the Flipper to emulate the tag
    for a phone, or write it to a blank NTAG215 sticker."""
    uid = tag["uid"] if tag.get("uid") and len(tag["uid"]) == 14 and tag.get("tech") in (None, "ntag") else fake_uid(tag["code"])
    pages = ntag215_pages(uid, url)
    lines = ["Filetype: Flipper NFC device", "Version: 4",
             f"# Nevet tag {tag['code']}: {tag['name']} -> {url}",
             "Device type: NTAG/Ultralight", f"UID: {_hex(bytes.fromhex(uid))}", "ATQA: 00 44", "SAK: 00",
             "Data format version: 2", "NTAG/Ultralight type: NTAG215", "Signature: " + _hex(bytes(32)),
             "Mifare version: 00 04 04 02 01 00 11 03"]
    for i in range(3):
        lines += [f"Counter {i}: 0", f"Tearing {i}: 00"]
    lines += [f"Pages total: {len(pages)}", f"Pages read: {len(pages)}"]
    lines += [f"Page {i}: {_hex(p)}" for i, p in enumerate(pages)]
    lines.append("Failed authentication attempts: 0")
    return "\n".join(lines) + "\n"


def em4100_id(tag):
    """The 5-byte EM4100 ID for a fob: the linked one, or a new one starting 4E 56 ("NV") made from the tag."""
    if tag.get("uid") and len(tag["uid"]) == 10:
        return tag["uid"]
    return "4E56" + hashlib.sha256(("nevet-fob-" + tag["code"]).encode()).hexdigest()[:6].upper()


def flipper_rfid(tag):
    """A Flipper Zero RFID file (EM4100): write it onto a blank T5577 fob with the Flipper."""
    return "\n".join(["Filetype: Flipper RFID key", "Version: 1", f"# Nevet tag {tag['code']}: {tag['name']}",
                      "Key type: EM4100", f"Data: {_hex(bytes.fromhex(em4100_id(tag)))}"]) + "\n"


def file_name(tag, ext):
    slug = re.sub(r"[^A-Za-z0-9]+", "_", tag["name"]).strip("_")[:24] or tag["kind"]
    return f"Nevet_{slug}_{tag['code']}.{ext}"
