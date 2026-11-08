"""The weekly garden digest, and events on the farm (line-up, the crowd, the work done while they're on)."""
import json
import re
from datetime import date, datetime

import digest
import events
from conftest import SEED


def test_digest_counts_this_weeks_work(guest):
    d = digest.week()
    assert d["numbers"]["actions"]["now"] >= 4
    assert d["numbers"]["harvest_kg"]["now"] >= 1.2
    assert d["numbers"]["worm_kg"]["now"] >= 0.8
    assert any(h["name"] == "Michael" for h in d["helpers"])
    page = guest.get("/digest").get_data(as_text=True)          # visitors can read it
    assert "The week on the farm" in page and "All good" not in page     # (but never the notes on actions)
    text = digest.text(d, "https://example.org/digest")
    assert "jobs done" in text and "Michael" in text


def test_digest_weeks_start_on_sunday():
    assert digest.week_start(date(2026, 11, 11)) == date(2026, 11, 8)      # a Wednesday -> that Sunday
    assert digest.week_start(date(2026, 11, 8)) == date(2026, 11, 8)


def test_digest_old_week(member):
    assert member.get("/digest/2020-01-01").status_code == 200
    assert member.get("/digest/not-a-date").status_code == 200


def test_lineup_parsing():
    assert events.clean_lineup("21:00 DJ Dana\n22.30 - Live set") == ("21:00 DJ Dana\n22:30 Live set", None)
    assert events.clean_lineup("DJ Dana")[1]
    ev = {"lineup": "23:00 Late\n01:00 Later", "start": datetime(2026, 1, 1, 22), "end": datetime(2026, 1, 2, 3)}
    slots = events.lineup(ev)
    assert slots[1]["at"] == datetime(2026, 1, 2, 1)                    # after midnight: the next day


def test_live_event_on_the_farm(admin):
    page = admin.get("/farm").get_data(as_text=True)
    data = json.loads(re.search(r"window\.NEVET_FARM = (\{.*?\});</script>", page, re.S).group(1))
    assert data["event"]["title"] == "Full moon party"
    assert [s["what"] for s in data["event"]["lineup"]] == ["DJ Dana", "Acid live set"]
    names = [h["name"] for h in data["heroes"]]
    assert names[:2] == ["Michael", "Dana"]                             # you, then whoever checked in


def test_event_page_shows_lineup_and_work(admin):
    page = admin.get(f"/events/{SEED['event']}").get_data(as_text=True)
    assert "Acid live set" in page and "Garden work" in page
