"""Hero cards: take your hero to another Nevet site.

Every Nevet site has its own signing key (made the first time it's needed and kept in its settings). A hero card
is a small JSON file the site signs: the hero's name, class and look, and a "passport" with what they've done
there (level, XP, jobs, kilograms harvested and fed to the worms, events). Another site checks the signature, so
it knows the card wasn't changed and which site (by its key's fingerprint) made it, and then:

- someone new can join with their card (their name and look come along),
- a member can add the card to their hero here,
- an admin can add a visiting hero (no login; they can claim it later by signing up with that name).

A card never brings XP or powers: those only grow from garden work logged on this site. The passport is shown on
the hero's page ("Also a hero at ..."), so people can see who they are. Each site keeps its own data; a shared
place for sites to find each other comes later. A site's key and name: /api/site.

A card travels as a .nevetcard.json file, or as text ("NEVETCARD1:" + compressed card) for a QR code or a chat.
"""
import base64
import hashlib
import json
import os
import zlib
from datetime import datetime

import ed25519
import farm_db
import heroes

VERSION = 1
PREFIX = "NEVETCARD1:"
MAX_BYTES = 16000                    # a card (or its text) bigger than this isn't a card
NAME_MAX = 60


def _b64(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def canonical(card):
    """The exact bytes that get signed: the card without its signature, keys sorted, no spaces."""
    body = {k: v for k, v in card.items() if k != "sig"}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def fingerprint(pub):
    h = hashlib.sha256(pub).hexdigest()[:16]
    return "-".join(h[i:i + 4] for i in range(0, 16, 4))


def _seed():
    seed = farm_db.get_setting("site_key")
    if not seed:
        seed = os.urandom(32).hex()
        farm_db.set_setting("site_key", seed)
    return bytes.fromhex(seed)


def site_name():
    return farm_db.get_setting("site_name") or "Nevet Farm"


def set_site_name(name):
    name = " ".join((name or "").split())[:NAME_MAX]
    farm_db.set_setting("site_name", name or "Nevet Farm")


def site(url=""):
    """This site: its name, address and public key (what other sites see)."""
    pub = ed25519.public_key(_seed())
    return {"name": site_name(), "url": url, "key": _b64(pub), "fingerprint": fingerprint(pub), "nevet_cards": VERSION}


def passport(grower_id):
    """What a hero has done here, for their card."""
    counts = farm_db.grower_counts(grower_id)
    prog = heroes.progress(**counts)
    conn = farm_db.get_conn()
    kg = lambda t: round(conn.execute("SELECT COALESCE(SUM(" + farm_db.log_kg_sql("l") + "), 0) FROM logs l "
                                      "WHERE l.grower_id = ? AND l.log_type = ?", (grower_id, t)).fetchone()[0], 1)
    out = {"level": prog["level"], "xp": prog["xp"], "rank": heroes.rank(prog["level"])["title"],
           "actions": counts["log_count"], "plants": counts["asset_count"],
           "harvest_kg": kg("harvest"), "worm_kg": kg("feeding"),
           "events": conn.execute("SELECT COUNT(*) FROM event_checkins WHERE grower_id = ?", (grower_id,)).fetchone()[0]}
    conn.close()
    return out


def make(grower_id, url=""):
    """A signed card for a hero of this site."""
    row = farm_db.get_grower(grower_id)
    hero_class, look = heroes.hero_for_row(row)
    me = site(url)
    card = {
        "nevet_card": VERSION,
        "id": f"{me['fingerprint']}/{grower_id}",
        "hero": {"name": row["name"], "class": hero_class, "appearance": look, "joined": (row["joined_at"] or "")[:10]},
        "home": {"name": me["name"], "url": url, "key": me["key"]},
        "passport": passport(grower_id),
        "issued": datetime.now().isoformat(timespec="seconds"),
    }
    card["sig"] = _b64(ed25519.sign(_seed(), canonical(card)))
    return card


def to_text(card):
    """The card as one line of text (for a QR code or a chat)."""
    return PREFIX + _b64(zlib.compress(json.dumps(card, separators=(",", ":"), ensure_ascii=False).encode("utf-8"), 9))


def parse(text):
    """A card from a file's contents or its text form. Returns (card, error)."""
    text = (text or "").strip()
    if not text:
        return None, "Choose a hero card file, or paste its text."
    if len(text) > MAX_BYTES:
        return None, "That's too big to be a hero card."
    try:
        if text.startswith(PREFIX):
            raw = zlib.decompressobj().decompress(_unb64(text[len(PREFIX):].strip()), MAX_BYTES)
            card = json.loads(raw.decode("utf-8"))
        else:
            card = json.loads(text)
    except (ValueError, zlib.error, UnicodeDecodeError):
        return None, "That isn't a hero card (it couldn't be read)."
    if not isinstance(card, dict) or card.get("nevet_card") != VERSION:
        return None, "That isn't a Nevet hero card (or it's from a newer version of Nevet)."
    return card, None


def check(card):
    """Checks a card's signature and contents. Returns (info, error); info has the hero (tidied), home and passport."""
    try:
        hero, home, pp = card["hero"], card["home"], card.get("passport") or {}
        pub, sig = _unb64(home["key"]), _unb64(card["sig"])
        name, err = heroes.validate_name(hero.get("name"))
        if err:
            return None, "The card's hero name isn't valid here: " + err
        if not ed25519.verify(pub, canonical(card), sig):
            return None, "This card's signature doesn't match: it was changed after it was made, so it can't be used."
    except (KeyError, TypeError, ValueError, AttributeError):
        return None, "This hero card is missing something, so it can't be used."
    hero_class = heroes.normalize_class(hero.get("class"))
    look = heroes.normalize(hero.get("appearance") if isinstance(hero.get("appearance"), dict) else {}, name, hero_class)
    num = lambda k: pp.get(k) if isinstance(pp.get(k), (int, float)) and not isinstance(pp.get(k), bool) else 0
    clean_pp = {k: num(k) for k in ("level", "xp", "actions", "plants", "harvest_kg", "worm_kg", "events")}
    clean_pp["rank"] = str(pp.get("rank") or "")[:40]
    fp = fingerprint(pub)
    mine = fp == site()["fingerprint"]
    return {"id": str(card.get("id") or "")[:80], "name": name, "class": hero_class, "appearance": look,
            "joined": str(hero.get("joined") or "")[:10], "issued": str(card.get("issued") or "")[:19],
            "home": {"name": " ".join(str(home.get("name") or "Nevet").split())[:NAME_MAX], "url": str(home.get("url") or "")[:200],
                     "key": home["key"], "fingerprint": fp, "known": known_site(home["key"]), "this_site": mine},
            "passport": clean_pp}, None


def known_site(key):
    """Has this site seen cards from that site before?"""
    conn = farm_db.get_conn()
    n = conn.execute("SELECT COUNT(*) FROM hero_cards WHERE home_key = ?", (key,)).fetchone()[0]
    conn.close()
    return n > 0


def attach(grower_id, card, info, by_id):
    """Keeps a checked card with a hero of this site (a newer card from the same hero replaces the older one)."""
    conn = farm_db.get_conn()
    old = conn.execute("SELECT id, issued FROM hero_cards WHERE grower_id = ? AND home_key = ? AND remote_id = ?",
                       (grower_id, info["home"]["key"], info["id"])).fetchone()
    now = datetime.now().isoformat(timespec="seconds")
    text = json.dumps(card, separators=(",", ":"), ensure_ascii=False)
    if old:
        if (old["issued"] or "") <= info["issued"]:
            conn.execute("UPDATE hero_cards SET card = ?, issued = ?, home_name = ?, home_url = ?, imported_at = ?, imported_by = ? WHERE id = ?",
                         (text, info["issued"], info["home"]["name"], info["home"]["url"], now, by_id, old["id"]))
    else:
        conn.execute("INSERT INTO hero_cards (grower_id, home_key, home_fp, home_name, home_url, remote_id, remote_name, card, issued, "
                     "imported_at, imported_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (grower_id, info["home"]["key"], info["home"]["fingerprint"], info["home"]["name"], info["home"]["url"],
                      info["id"], info["name"], text, info["issued"], now, by_id))
    conn.commit()
    conn.close()


def passports(grower_id):
    """The cards from other sites kept with a hero: where else they're a hero, and what they've done there."""
    conn = farm_db.get_conn()
    rows = conn.execute("SELECT * FROM hero_cards WHERE grower_id = ? ORDER BY imported_at DESC", (grower_id,)).fetchall()
    conn.close()
    out = []
    for r in rows:
        try:
            pp = json.loads(r["card"]).get("passport") or {}
        except ValueError:
            pp = {}
        out.append({"id": r["id"], "home": r["home_name"], "url": r["home_url"], "fingerprint": r["home_fp"], "name": r["remote_name"],
                    "issued": (r["issued"] or "")[:10], "level": pp.get("level"), "rank": pp.get("rank"), "actions": pp.get("actions"),
                    "harvest_kg": pp.get("harvest_kg"), "worm_kg": pp.get("worm_kg"), "events": pp.get("events")})
    return out


def remove(card_row_id, grower_id):
    conn = farm_db.get_conn()
    conn.execute("DELETE FROM hero_cards WHERE id = ? AND grower_id = ?", (card_row_id, grower_id))
    conn.commit()
    conn.close()
