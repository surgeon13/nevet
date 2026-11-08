"""The main things people do: log garden work (with weights and XP), quick logs from a tag, events."""
import farm_db
import heroes
from conftest import SEED


def xp_of(gid):
    return heroes.progress(**farm_db.grower_counts(gid))["xp"]


def test_weighed_worm_food_earns_more_xp(member, csrf):
    gid = SEED["ids"]["Dana"]
    before = xp_of(gid)
    r = member.post("/log", data={"_csrf": csrf, "action": "feeding", "asset": str(SEED["bin"]), "amount": "2", "unit": "kg"})
    assert r.status_code in (200, 302, 303)
    assert xp_of(gid) - before == heroes.action_xp("feeding", 2) == 50


def test_watering_earns_the_base_xp(member, csrf):
    gid = SEED["ids"]["Dana"]
    before = xp_of(gid)
    member.post("/log", data={"_csrf": csrf, "action": "watering", "asset": str(SEED["plant"])})
    assert xp_of(gid) - before == heroes.XP_BASE


def test_quick_feed_from_a_tag(member, csrf):
    gid = SEED["ids"]["Dana"]
    before = xp_of(gid)
    member.post(f"/t/{SEED['action_tag']['code']}/log", data={"_csrf": csrf, "action": "feeding", "amount": "500", "unit": "g"})
    assert xp_of(gid) - before == heroes.action_xp("feeding", 0.5)


def test_forms_need_their_token(member):
    gid = SEED["ids"]["Dana"]
    before = xp_of(gid)
    member.post("/log", data={"action": "watering", "asset": str(SEED["plant"])})
    assert xp_of(gid) == before


def test_visitors_cant_log(guest, csrf):
    r = guest.post("/log", data={"_csrf": csrf, "action": "watering", "asset": str(SEED["plant"])})
    assert r.status_code in (302, 303, 401, 403)


def test_rsvp_and_check_in(admin, csrf):
    ev = SEED["event"]
    assert admin.post(f"/events/{ev}/rsvp", data={"_csrf": csrf, "answer": "going"}).status_code in (200, 302, 303)
    page = admin.get(f"/events/{ev}").get_data(as_text=True)
    assert "Full moon party" in page
