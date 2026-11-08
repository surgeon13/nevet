"""Shared set-up for Nevet's tests: a throwaway farm with heroes, plants, a worm bin, an event going on now,
tags and a group, and a Flask test client that can be a visitor, a member or an admin.

Run them with:  python3 -m pytest -q          (from the repo's top folder)
The 3D farm test (test_farm.py) also needs Playwright:  pip install playwright && playwright install chromium
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "webapp"
DATA = Path(tempfile.mkdtemp(prefix="nevet-test-"))

# everything the app writes goes into the throwaway folder (set before the app is imported)
os.environ.update({
    "CAMERA_BASE_DIR": str(DATA / "camera"),
    "FARM_DB": str(DATA / "farm.db"),
    "STATS_DB": str(DATA / "game_stats.db"),
    "NEVET_EXTRAS_DIR": str(DATA / "extras"),
    "WEBAPP_SECRET": "test-secret",
    "WEBAPP_API_KEY": "test-api-key",
})
(DATA / "camera").mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(WEB))

import app as nevet_app      # noqa: E402
import auth                 # noqa: E402
import events               # noqa: E402
import farm_db              # noqa: E402
import heroes               # noqa: E402
import invites              # noqa: E402
import tags                 # noqa: E402

PASSWORD = "secret12"


def _seed():
    """A small farm: an admin, members, a hero without a password, plants and a worm bin with weighed work."""
    ids = {}
    pw = auth.hash_password(PASSWORD)
    for i, (name, gender) in enumerate([("Michael", "male"), ("Dana", "female"), ("Yoav", "male"), ("Noa", "female"), ("Kid", "female")]):
        cls, look = heroes.default_appearance(name)
        look["gender"] = gender
        ids[name] = farm_db.create_hero(name, cls, json.dumps(look), None if name == "Kid" else pw, is_admin=(i == 0))
    invites.set_inviter(ids["Dana"], ids["Michael"], "link")
    farm_db.add_relationship(ids["Michael"], ids["Dana"], "spouse", by=ids["Michael"])
    farm_db.add_relationship(ids["Dana"], ids["Kid"], "parent", by=ids["Dana"])
    group_id = farm_db.add_group("Tomato club", "club", ids["Michael"])
    plant = farm_db.add_asset("plant", "Tomato", ids["Michael"], life_stage="growing", species="tomato")
    farm_db.add_asset("plant", "Basil", ids["Dana"], life_stage="seedling", species="basil")
    bin_id = farm_db.add_asset("worm_bin", "Worm bin 1", ids["Dana"])
    farm_db.add_log("watering", plant, grower_id=ids["Michael"])
    farm_db.add_log("harvest", plant, grower_id=ids["Michael"],
                    quantities=[{"measure": "weight", "value": 1.2, "units": "kg", "label": "Tomato"}])
    farm_db.add_log("feeding", bin_id, grower_id=ids["Dana"],
                    quantities=[{"measure": "weight", "value": 800, "units": "g", "label": "Worm bin 1"}])
    farm_db.add_log("observation", None, notes="All good", grower_id=ids["Yoav"])
    now = datetime.now()
    fields, err = events.clean({"title": "Full moon party", "kind": "party", "date": (now - timedelta(hours=1)).strftime("%Y-%m-%d"),
                                "time": (now - timedelta(hours=1)).strftime("%H:%M"), "place": "The dance field",
                                "end_date": (now + timedelta(hours=3)).strftime("%Y-%m-%d"), "end_time": (now + timedelta(hours=3)).strftime("%H:%M"),
                                "lineup": f"{now - timedelta(minutes=30):%H:%M} DJ Dana\n{now + timedelta(minutes=60):%H:%M} Acid live set"})
    assert not err, err
    event_id = events.create(fields, ids["Michael"])
    events.set_rsvp(event_id, ids["Dana"], "going")
    events.check_in(event_id, ids["Dana"], ids["Michael"])
    tag, _ = tags.create("plant", plant, label="Tomato")
    action_tag, _ = tags.create("action", action="feeding", label="Feed the worms")
    return {"ids": ids, "plant": plant, "bin": bin_id, "event": event_id, "group": group_id,
            "tag": tag, "action_tag": action_tag, "invite": invites.code_for(ids["Michael"])}


SEED = _seed()


@pytest.fixture(scope="session")
def seed():
    return SEED


@pytest.fixture()
def app():
    nevet_app.app.config["TESTING"] = True
    return nevet_app.app


def _client(app, user=None):
    c = app.test_client()
    with c.session_transaction() as s:
        s["_csrf"] = "test-token"
        if user:
            s["user_id"] = user
    return c


@pytest.fixture()
def guest(app):
    return _client(app)


@pytest.fixture()
def member(app):
    return _client(app, SEED["ids"]["Dana"])


@pytest.fixture()
def admin(app):
    return _client(app, SEED["ids"]["Michael"])


@pytest.fixture()
def csrf():
    return "test-token"
