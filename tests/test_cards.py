"""Hero cards: signed by one Nevet site, checked and used by another."""
import base64
import json
import os

import cards
import ed25519
import farm_db
from conftest import PASSWORD, SEED


def _b64(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def other_site_card(name="Rivka", level=7):
    """A card as another Nevet site (with its own key) would make it."""
    seed = os.urandom(32)
    card = {"nevet_card": 1, "id": "abcd-ef01-2345-6789/42",
            "hero": {"name": name, "class": "druid", "appearance": {"gender": "female"}, "joined": "2026-01-02"},
            "home": {"name": "Nevet Farm Haifa", "url": "https://haifa.example/", "key": _b64(ed25519.public_key(seed))},
            "passport": {"level": level, "xp": 999, "rank": "Gardener", "actions": 120, "plants": 9, "harvest_kg": 14.5, "worm_kg": 30, "events": 3},
            "issued": "2026-11-01T10:00:00"}
    card["sig"] = _b64(ed25519.sign(seed, cards.canonical(card)))
    return card


def test_ed25519_matches_rfc8032():
    seed = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
    assert ed25519.public_key(seed).hex() == "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
    sig = ed25519.sign(seed, b"")
    assert sig.hex().startswith("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e0652249015")
    assert ed25519.verify(ed25519.public_key(seed), b"", sig) and not ed25519.verify(ed25519.public_key(seed), b"x", sig)


def test_card_round_trip_and_tampering():
    card = cards.make(SEED["ids"]["Dana"], "https://farm.example/")
    back, err = cards.parse(cards.to_text(card))
    assert not err and back == card
    info, err = cards.check(back)
    assert not err and info["name"] == "Dana" and info["home"]["this_site"]
    back["passport"]["level"] = 99                                 # changed after it was signed
    assert cards.check(back)[1]
    assert cards.parse("hello")[1] and cards.parse("x" * 20000)[1]


def test_only_you_can_take_your_card(member, admin):
    dana, yoav = SEED["ids"]["Dana"], SEED["ids"]["Yoav"]
    r = member.get(f"/growers/{dana}/card.json")
    assert r.status_code == 200 and "attachment" in r.headers["Content-Disposition"]
    assert json.loads(r.data)["hero"]["name"] == "Dana"
    assert member.get(f"/growers/{yoav}/card").status_code == 403
    assert admin.get(f"/growers/{yoav}/card").status_code == 200    # (an admin can, for anyone)


def test_join_with_a_card(guest, csrf):
    text = cards.to_text(other_site_card("Rivka"))
    page = guest.post("/cards/import", data={"_csrf": csrf, "card": text}).get_data(as_text=True)
    assert "Genuine" in page and "Nevet Farm Haifa" in page
    r = guest.post("/cards/import", data={"_csrf": csrf, "card": text, "how": "join"})
    assert r.status_code in (302, 303) and "/register" in r.headers["Location"]
    assert "Joining with your hero card" in guest.get("/register").get_data(as_text=True)
    guest.post("/register", data={"_csrf": csrf, "name": "Rivka", "password": PASSWORD, "confirm": PASSWORD})
    row = farm_db.find_grower_by_name("Rivka")
    assert row and row["hero_class"] == "druid"
    assert cards.passports(row["id"])[0]["home"] == "Nevet Farm Haifa"
    assert farm_db.grower_counts(row["id"])["log_count"] == 0      # no XP comes with it


def test_add_a_card_to_my_hero(member, csrf):
    text = cards.to_text(other_site_card("Dana", level=4))
    member.post("/cards/import", data={"_csrf": csrf, "card": text, "how": "mine"})
    page = member.get(f"/growers/{SEED['ids']['Dana']}").get_data(as_text=True)
    assert "Also a hero at" in page and "Nevet Farm Haifa" in page


def test_admin_adds_a_visiting_hero(admin, member, csrf):
    text = cards.to_text(other_site_card("Visitor"))
    assert member.post("/cards/import", data={"_csrf": csrf, "card": text, "how": "visitor"}).status_code == 200   # members can't
    assert not farm_db.find_grower_by_name("Visitor")
    admin.post("/cards/import", data={"_csrf": csrf, "card": text, "how": "visitor"})
    row = farm_db.find_grower_by_name("Visitor")
    assert row and not row["password_hash"]                          # they can claim it by signing up
    page = admin.post("/cards/import", data={"_csrf": csrf, "card": text, "how": "visitor"}).get_data(as_text=True)
    assert "already a hero called" in page


def test_site_key_is_public(guest):
    info = guest.get("/api/site").get_json()
    assert info["fingerprint"] and info["key"] and info["nevet_cards"] == 1
