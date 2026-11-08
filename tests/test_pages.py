"""Every page opens without a server error: for a visitor, a member and an admin.

New pages are picked up by themselves (from the app's routes). A page with a part in its address that isn't in
SAMPLES below fails this test, so add an example for it.
"""
import re

import pytest

from conftest import SEED, nevet_app

SAMPLES = {
    "grower_id": lambda s: s["ids"]["Dana"], "asset_id": lambda s: s["plant"], "event_id": lambda s: s["event"],
    "group_id": lambda s: s["group"], "tag_id": lambda s: s["tag"]["id"], "rel_id": lambda s: 1, "task_id": lambda s: 1,
    "note_id": lambda s: 1, "fid": lambda s: 1, "name": lambda s: "acid", "filepath": lambda s: "index.html",
    "fmt": lambda s: "csv", "what": lambda s: "x",
}
SKIP = {"static", "logout"}
NO_ARGS_CODE = {"/i/<code>": lambda s: s["invite"], "/t/<code>": lambda s: s["tag"]["code"]}


def pages():
    out = []
    for rule in nevet_app.app.url_map.iter_rules():
        if "GET" not in rule.methods or rule.endpoint in SKIP:
            continue
        out.append(rule)
    return sorted(out, key=lambda r: r.rule)


def url_for_rule(rule):
    url = rule.rule
    for arg in rule.arguments:
        if arg == "code":
            value = NO_ARGS_CODE[rule.rule](SEED) if rule.rule in NO_ARGS_CODE else "NOPE"
        elif arg in SAMPLES:
            value = SAMPLES[arg](SEED)
        else:
            pytest.fail(f"{rule.rule}: add an example value for <{arg}> to SAMPLES in tests/test_pages.py")
        url = re.sub(r"<(?:[^:<>]+:)?" + arg + ">", str(value), url)
    return url


@pytest.mark.parametrize("who", ["guest", "member", "admin"])
def test_every_page_opens(who, request):
    client = request.getfixturevalue(who)
    broken = []
    for rule in pages():
        url = url_for_rule(rule)
        r = client.get(url)
        if r.status_code >= 500:
            broken.append(f"{url} -> {r.status_code}")
    assert not broken, f"pages with server errors as {who}:\n" + "\n".join(broken)


@pytest.mark.parametrize("url", ["/", "/farm", "/leaderboards", "/powers", "/growers", "/activity", "/assets", "/events", "/time"])
def test_main_pages_for_members(member, url):
    r = member.get(url)
    assert r.status_code == 200, r.status_code


@pytest.mark.parametrize("url", ["/", "/farm", "/leaderboards", "/growers"])
def test_visitors_can_look_around(guest, url):
    r = guest.get(url)
    assert r.status_code == 200, r.status_code


def test_visitors_dont_see_private_things(guest):
    page = guest.get(f"/growers/{SEED['ids']['Dana']}").get_data(as_text=True)
    assert "All good" not in guest.get("/activity").get_data(as_text=True)      # notes on actions stay private
    assert "Tomato club" not in page                                          # groups too
    assert guest.get("/account").status_code in (302, 303)


def test_healthz(guest):
    assert guest.get("/healthz").status_code == 200
