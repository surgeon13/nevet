#!/usr/bin/env python3
"""Camera gallery + game stats web app for the Insta360 Pi camera project."""
import os
import re
import hmac
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse
from flask.sessions import SecureCookieSessionInterface
from flask import Flask, render_template, request, redirect, url_for, session, send_from_directory, jsonify, abort, g
from logging_config import setup_logging, LOGS_DIR
import about
import activity_views as av
import auth
import farm_db
import bulk
import extras
import events
import garden_map
import qr
import games
import tags
import netaccess
import relations
import heroes
import invites
import plants
import timeline
import today
import traffic

BASE_DIR = Path(os.environ.get("CAMERA_BASE_DIR", str(Path.home() / "camera_captures")))
PHOTO_DIR = BASE_DIR / "photos"
VIDEO_DIR = BASE_DIR / "videos"
DB_PATH = Path(os.environ.get("STATS_DB", str(Path.home() / "webapp" / "game_stats.db")))

app = Flask(__name__)
app.secret_key = auth.load_secret_key(farm_db.DB_PATH.parent)
app.config.update(
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_HTTPONLY=True,
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),   # stay logged in for a month
)


class _SessionInterface(SecureCookieSessionInterface):
    """Session cookies get the Secure flag when the page came over https
    (e.g. through Tailscale Funnel), but still work over plain http at home."""
    def get_cookie_secure(self, app):
        return request.is_secure


app.session_interface = _SessionInterface()
app.wsgi_app = netaccess.LocalProxyFix(app.wsgi_app)      # real visitor addresses behind a tunnel on the Pi
logger = setup_logging(app)
av.register(app)
traffic_counter = traffic.TrafficCounter(farm_db.get_conn).install(app)

# Pages anyone can open without logging in. Everything else needs an account.
PUBLIC_ENDPOINTS = {"login", "register", "join", "invite_link", "event_join", "healthz", "static", "api_add_stats", "api_map_geojson", "api_tag_scan"}
CSRF_EXEMPT = {"api_add_stats", "api_tag_scan"}        # their own API key (or the Pi itself)

LOG_FILES = {
    "watchdog": LOGS_DIR / "watchdog.log",
    "capture": LOGS_DIR / "capture.log",
    "webapp": LOGS_DIR / "webapp.log",
    "update": LOGS_DIR / "update.log",
}


def tail_lines(path, n=150):
    if not path.exists():
        return []
    with path.open("r", errors="replace") as f:
        lines = f.readlines()
    return [line.rstrip("\n") for line in lines[-n:]]


def get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("""
        CREATE TABLE IF NOT EXISTS stats_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            xp INTEGER,
            time_played INTEGER,
            compost REAL,
            credits INTEGER,
            plant_growth REAL,
            extra TEXT
        )
    """)
    return conn


def safe_next(target):
    """Only follow ?next= to pages on this site (no open redirects)."""
    if not target:
        return None
    parts = urlparse(target)
    if parts.scheme or parts.netloc or not target.startswith("/") or target.startswith("//"):
        return None
    return target


def log_in(row):
    session.clear()
    session.permanent = True
    session["user_id"] = row["id"]
    session["show_today"] = 1                 # the dashboard greets them with today's farm
    farm_db.touch_login(row["id"])


@app.before_request
def load_user_and_guard():
    g.user = None
    uid = session.get("user_id")
    if uid:
        row = farm_db.get_grower(uid)
        if row and row["password_hash"] and not row["deleted_at"]:
            g.user = {"id": row["id"], "name": row["name"], "is_admin": bool(row["is_admin"])}
        else:
            session.clear()                       # account deleted or password cleared
    if g.user is None and request.endpoint not in PUBLIC_ENDPOINTS:
        if request.path.startswith("/api/"):
            return jsonify({"error": "login required"}), 401
        return redirect(url_for("login", next=request.full_path if request.query_string else request.path))
    if request.method == "POST" and request.endpoint not in CSRF_EXEMPT:
        # forms send the token as a field, the map page's JSON calls as a header
        if not auth.csrf_ok(session, request.form.get("_csrf") or request.headers.get("X-CSRF-Token")):
            logger.warning("Rejected form without valid token: %s from %s", request.path, request.remote_addr)
            if request.path.startswith("/api/"):
                return jsonify({"error": "This page was open too long. Refresh it and try again."}), 400
            return render_template("message.html", title="Form expired",
                                   message="That form was open too long or came from somewhere else. "
                                           "Go back, refresh the page and try again."), 400


@app.context_processor
def inject_user():
    u = g.get("user")
    return {"current_user": u, "csrf_token": lambda: auth.csrf_token(session),
            "pending_connections": farm_db.pending_for(u["id"]) if u else 0}


def human_size(num_bytes):
    num_bytes = float(num_bytes)
    for unit in ["B", "KB", "MB", "GB"]:
        if num_bytes < 1024:
            return f"{num_bytes:.1f}{unit}"
        num_bytes /= 1024
    return f"{num_bytes:.1f}TB"


def recent_photos(n=9):
    """Just the last N photos for a compact dashboard preview — the full,
    unbounded listing lives on the /gallery page, not here."""
    if not PHOTO_DIR.exists():
        return []
    files = [f for f in PHOTO_DIR.rglob("*") if f.suffix.lower() in (".jpg", ".jpeg")]
    files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    return [
        {"name": f.name, "path": f"photos/{f.relative_to(PHOTO_DIR)}"}
        for f in files[:n]
    ]


def scan_assets():
    """Build a date-grouped listing of photos and videos with basic stats."""
    days = {}
    total_photos = total_videos = total_bytes = 0

    for kind, root in (("photo", PHOTO_DIR), ("video", VIDEO_DIR)):
        if not root.exists():
            continue
        for day_dir in sorted(root.iterdir(), reverse=True):
            if not day_dir.is_dir():
                continue
            for f in sorted(day_dir.iterdir(), reverse=True):
                if f.suffix.lower() not in (".jpg", ".jpeg", ".mp4"):
                    continue
                size = f.stat().st_size
                total_bytes += size
                if kind == "photo":
                    total_photos += 1
                else:
                    total_videos += 1
                days.setdefault(day_dir.name, {"photos": [], "videos": []})
                days[day_dir.name][f"{kind}s"].append({
                    "name": f.name,
                    "path": f"{kind}s/{day_dir.name}/{f.name}",
                    "size": human_size(size),
                })

    return {
        "days": days,
        "total_photos": total_photos,
        "total_videos": total_videos,
        "total_size": human_size(total_bytes),
    }


@app.route("/")
def hub():
    banner = session.pop("banner", None)      # set once by _after_logging, shown once
    if banner:
        banner["label"] = av.action_meta(banner.get("action"))["label"]
    report = today.report(g.user["id"])
    # the "Today at the farm" pop-up: after logging in, and on the first visit of each day,
    # when there is something to tell (actions logged today or things to do)
    day = report["date"].isoformat()
    greet = bool(session.pop("show_today", None) or session.get("today_seen") != day)
    session["today_seen"] = day
    return render_template(
        "console.html", today=report, greet=greet and not banner and bool(report["groups"] or report["todos"]),
        summary=farm_db.dashboard_summary(),
        recent=recent_photos(3),
        everyone=av.activity_bundle(None),
        mine=av.activity_bundle(g.user["id"]),
        players=farm_db.player_activity(),
        banner=banner,
        about=about.info(),
        events_now=events.happening(),
        events_next=events.upcoming(days=60),
        events_soon=_events_for_dashboard(g.user["id"]),
    )


def _events_for_dashboard(me):
    """The next few events for the dashboard's "Coming up" strip: your answer and a QR code to invite people."""
    out = []
    for ev in events.soon(limit=4):
        mine = events.rsvp_of(ev["id"], me)
        ev["mine"] = mine["answer"] if mine else None
        ev["link"] = _event_link(ev)
        ev["qr"] = _event_qr(ev, scale=6)
        out.append(ev)
    return out


@app.route("/time")
def time_page():
    """The farm's story as a vine through time (static/js/time3d.js)."""
    view = "tree" if request.args.get("view") == "tree" else "vine"
    try:
        focus = int(request.args.get("hero") or 0) or None
    except ValueError:
        focus = None
    return render_template("time.html", story=timeline.story(), view=view, focus=focus, me=g.user["id"])


@app.route("/gallery")
def gallery():
    return render_template("index.html", assets=scan_assets())


# ---------------------------------------------------------------------
# Heroes (growers). Creating and customizing a hero needs no password:
# just pick a username, like joining a game. Farm records (assets,
# logs) still need the admin login.
# ---------------------------------------------------------------------

def hero_view(row, counts=None):
    counts = counts or {k: row[k] for k in ("asset_count", "log_count", "harvest_count") if k in row.keys()}
    hero_class, appearance = heroes.hero_for_row(row)
    cls = heroes.class_by_id(hero_class)
    return {
        "id": row["id"],
        "name": row["name"],
        "joined_at": row["joined_at"],
        "class": cls,
        "appearance": appearance,
        "counts": counts,
        "progress": heroes.progress(**counts),
        "has_account": bool(row["password_hash"]) if "password_hash" in row.keys() else False,
    }


def can_edit_hero(grower_id):
    return bool(g.user and (g.user["id"] == grower_id or g.user["is_admin"]))


@app.route("/growers")
def growers_page():
    roster = [hero_view(r) for r in farm_db.list_growers()]
    in_bin = len(farm_db.deleted_heroes()) if g.user["is_admin"] else 0
    return render_template("growers.html", heroes=roster, catalog=heroes.catalog(),
                           deleted=request.args.get("deleted"), in_bin=in_bin)


def render_hero_form(hero_id, name, hero_class, appearance, error=None, welcome=False):
    cat = heroes.catalog()
    return render_template(
        "hero_form.html", hero_id=hero_id, name=name, error=error, welcome=welcome,
        hero_class=heroes.normalize_class(hero_class), appearance=appearance, catalog=cat,
    )


@app.route("/growers/new")
def grower_new():
    # New heroes are created by signing up, so every hero has a password.
    return redirect(url_for("register"))


@app.route("/growers/<int:grower_id>/customize", methods=["GET", "POST"])
def grower_customize(grower_id):
    row = farm_db.get_grower(grower_id)
    if not row or row["deleted_at"]:
        abort(404)
    if not can_edit_hero(grower_id):
        return render_template("message.html", title="Not your hero",
                               message=f"Only {row['name']} (or an admin) can change this hero."), 403
    if request.method == "POST":
        name, error = heroes.validate_name(request.form.get("name"))
        hero_class = heroes.normalize_class(request.form.get("hero_class"))
        appearance = heroes.from_form(request.form, name, hero_class)
        if not error:
            try:
                farm_db.update_hero(grower_id, name, hero_class, json.dumps(appearance))
            except ValueError:
                error = f"The name “{name}” is already taken. Try another one."
            else:
                return redirect(url_for("grower_page", grower_id=grower_id))
        return render_hero_form(grower_id, name, hero_class, appearance, error)
    hero_class, appearance = heroes.hero_for_row(row)
    return render_hero_form(grower_id, row["name"], hero_class, appearance,
                            welcome=request.args.get("welcome") == "1")


@app.route("/growers/<int:grower_id>/password", methods=["POST"])
def grower_reset_password(grower_id):
    """Admins can set a new password for any player who forgot theirs."""
    if not (g.user and g.user["is_admin"]):
        abort(403)
    row = farm_db.get_grower(grower_id)
    if not row:
        abort(404)
    password = request.form.get("password", "")
    error = auth.validate_password(password, request.form.get("confirm", ""))
    if error:
        return redirect(url_for("grower_page", grower_id=grower_id, pw_error=error))
    farm_db.set_password(grower_id, auth.hash_password(password))
    logger.info("Admin %s set a new password for %s", g.user["name"], row["name"])
    return redirect(url_for("grower_page", grower_id=grower_id, pw_set=1))


def gender_of(look_json):
    try:
        return json.loads(look_json or "{}").get("gender")
    except ValueError:
        return None


def connections_for(grower_id, viewer):
    """What a profile shows under "Family & connections". Confirmed ones
    show to everyone; waiting ones only to the two people (and admins)."""
    out = []
    for r in farm_db.relationships_of(grower_id):
        pending = r["status"] == "pending"
        parties = (r["a_id"], r["b_id"])
        if pending and not (viewer["is_admin"] or viewer["id"] in parties):
            continue
        d = relations.describe(r["kind"], r["other_name"], gender_of(r["other_look"]), r["i_am_a"], r["note"])
        requester = r["created_by"]
        d.update(id=r["id"], other_id=r["other_id"], pending=pending,
                 can_confirm=pending and viewer["id"] != requester and (viewer["is_admin"] or viewer["id"] in parties),
                 requested_by_other=pending and requester == r["other_id"])
        out.append(d)
    return out


@app.route("/growers/<int:grower_id>/relationships", methods=["POST"])
def relationship_add(grower_id):
    row = farm_db.get_grower(grower_id)
    if not row or row["deleted_at"]:
        abort(404)
    if not can_edit_hero(grower_id):
        abort(403)
    def back(**kw):
        return redirect(url_for("grower_page", grower_id=grower_id, **kw) + "#connections")
    try:
        other = int(request.form.get("other", ""))
    except ValueError:
        return back(rel_error="Pick who they are.")
    o = farm_db.get_grower(other)
    kind, other_is_a = relations.parse_choice(request.form.get("rel"))
    if not o or o["deleted_at"] or other == grower_id or not kind:
        return back(rel_error="Pick another hero and how you are connected.")
    a, b = (other, grower_id) if other_is_a else (grower_id, other)
    if not farm_db.add_relationship(a, b, kind, relations.clean_note(request.form.get("note")), g.user["id"], pending=True):
        return back(rel_error="That connection is already there.")
    return back(rel_sent=o["name"])


@app.route("/relationships/<int:rel_id>/confirm", methods=["POST"])
def relationship_confirm(rel_id):
    """The other person (or an admin, for a hero with no account yet) confirms a connection."""
    r = farm_db.get_relationship(rel_id)
    if not r:
        abort(404)
    me = g.user["id"]
    if me == r["created_by"] or not (g.user["is_admin"] or me in (r["a_id"], r["b_id"])):
        abort(403)       # you can't confirm your own request
    farm_db.confirm_relationship(rel_id)
    back = request.form.get("back")
    return redirect(url_for("grower_page", grower_id=int(back) if back and back.isdigit() else me) + "#connections")


@app.route("/relationships/<int:rel_id>/delete", methods=["POST"])
def relationship_delete(rel_id):
    r = farm_db.get_relationship(rel_id)
    if not r:
        abort(404)
    if not (g.user["is_admin"] or g.user["id"] in (r["a_id"], r["b_id"])):
        abort(403)
    farm_db.remove_relationship(rel_id)
    back = request.form.get("back")
    return redirect(url_for("grower_page", grower_id=int(back) if back and back.isdigit() else g.user["id"]) + "#connections")


# ---------------------------------------------------------------------
# Groups: households, families, community gardens, volunteer teams.
# ---------------------------------------------------------------------

def can_manage_group(group_id):
    return bool(g.user["is_admin"] or farm_db.group_role(group_id, g.user["id"]) == "coordinator")


@app.route("/groups", methods=["GET", "POST"])
def groups_page():
    error = None
    if request.method == "POST":
        name = " ".join((request.form.get("name") or "").split())[:60]
        kind = request.form.get("kind") if request.form.get("kind") in relations.GROUP_KIND else "household"
        if not name:
            error = "Give the group a name."
        else:
            gid = farm_db.add_group(name, kind, g.user["id"], relations.clean_note(request.form.get("note")))
            return redirect(url_for("group_page", group_id=gid))
    return render_template("groups.html", groups=farm_db.list_groups(), mine={r["id"] for r in farm_db.list_groups(g.user["id"])},
                           kinds=relations.GROUP_KINDS, kind_names=relations.GROUP_KIND, error=error)


@app.route("/groups/<int:group_id>")
def group_page(group_id):
    grp = farm_db.get_group(group_id)
    if not grp:
        abort(404)
    members = [dict(m, appearance=heroes.hero_for_row(m)[1]) for m in farm_db.group_members(group_id)]
    ids = {m["id"] for m in members}
    return render_template("group_detail.html", group=grp, members=members, kind_name=relations.GROUP_KIND.get(grp["kind"], "Group"),
                           can_manage=can_manage_group(group_id), my_role=farm_db.group_role(group_id, g.user["id"]),
                           roles=relations.GROUP_ROLES, role_names=relations.GROUP_ROLE,
                           others=[r for r in farm_db.list_growers() if r["id"] not in ids],
                           open_join=grp["kind"] in ("community", "volunteers"), error=request.args.get("error"))


@app.route("/groups/<int:group_id>/members", methods=["POST"])
def group_member_set(group_id):
    if not farm_db.get_group(group_id):
        abort(404)
    action = request.form.get("action", "add")
    role = request.form.get("role") if request.form.get("role") in relations.GROUP_ROLE else "member"
    me = g.user["id"]
    if action == "join":                       # open groups: community gardens, volunteer teams
        if farm_db.get_group(group_id)["kind"] not in ("community", "volunteers"):
            abort(403)
        if not farm_db.group_role(group_id, me):
            farm_db.set_group_member(group_id, me, "member")
    elif action == "leave":
        farm_db.remove_group_member(group_id, me)
        return redirect(url_for("groups_page"))
    else:
        if not can_manage_group(group_id):
            abort(403)
        try:
            who = int(request.form.get("grower", ""))
        except ValueError:
            abort(400)
        target = farm_db.get_grower(who)
        if not target or target["deleted_at"]:
            abort(404)
        if action == "remove":
            if farm_db.group_role(group_id, who) == "coordinator":
                coords = [m for m in farm_db.group_members(group_id) if m["role"] == "coordinator"]
                if len(coords) <= 1:
                    return redirect(url_for("group_page", group_id=group_id, error="A group needs a coordinator."))
            farm_db.remove_group_member(group_id, who)
        else:
            farm_db.set_group_member(group_id, who, role)
    return redirect(url_for("group_page", group_id=group_id))


@app.route("/groups/<int:group_id>/delete", methods=["POST"])
def group_delete(group_id):
    if not farm_db.get_group(group_id):
        abort(404)
    if not can_manage_group(group_id):
        abort(403)
    farm_db.delete_group(group_id)
    return redirect(url_for("groups_page"))


@app.route("/growers/<int:grower_id>")
def grower_page(grower_id):
    grower = farm_db.get_grower(grower_id)
    if not grower:
        abort(404)
    if grower["deleted_at"]:
        if g.user["is_admin"]:
            return redirect(url_for("recycle_bin"))
        abort(404)
    hero = hero_view(grower, farm_db.grower_counts(grower_id))
    bundle = av.activity_bundle(grower_id)
    pw = games.powers(grower_id)
    return render_template(
        "grower_detail.html", grower=grower, hero=hero, b=bundle, is_me=g.user["id"] == grower_id,
        catalog=heroes.catalog(), can_edit=can_edit_hero(grower_id),
        has_account=bool(grower["password_hash"]), created=request.args.get("created") == "1",
        pw_set=request.args.get("pw_set") == "1", pw_error=request.args.get("pw_error"),
        delete_error=request.args.get("delete_error"),
        connections=connections_for(grower_id, g.user), rel_error=request.args.get("rel_error"), rel_sent=request.args.get("rel_sent"),
        rel_options=relations.form_options(), my_groups=farm_db.list_groups(grower_id),
        group_kind_names=relations.GROUP_KIND,
        rel_candidates=[r for r in farm_db.list_growers() if r["id"] != grower_id],
        powers=pw, skills=games.SKILLS, game_stats=games.hero_stats(grower_id), glory=games.glory(games.hero_stats(grower_id)),
        matches=games.recent_matches(6, grower_id), styles=games.ARENA_STYLES,
        invites=invites.summary(grower_id), mine=_my_invite(grower_id) if g.user["id"] == grower_id else None,
        inviter_candidates=_inviter_candidates(grower_id),
    )


def _inviter_candidates(grower_id):
    below = invites.descendants(grower_id)             # (not someone they invited: the tree can't go round in a circle)
    return [r for r in farm_db.list_growers() if r["id"] != grower_id and r["id"] not in below]


# ---------------------------------------------------------------------
# Deleting heroes: they go to a recycle bin first, where an admin can
# restore them or delete them for good.
# ---------------------------------------------------------------------

def admin_only():
    if not g.user["is_admin"]:
        abort(403)


@app.route("/growers/<int:grower_id>/delete", methods=["POST"])
def grower_delete(grower_id):
    row = farm_db.get_grower(grower_id)
    if not row or row["deleted_at"]:
        abort(404)
    is_me = g.user["id"] == grower_id
    if not (is_me or g.user["is_admin"]):
        abort(403)
    def back(error):
        return redirect(url_for("grower_page", grower_id=grower_id, delete_error=error))
    if is_me and not auth.check_password(row["password_hash"], request.form.get("password", "")):
        return back("That password isn't right.")
    if row["is_admin"] and row["password_hash"] and farm_db.admin_count() <= 1:
        return back("This is the only admin. Make another player admin first, so someone can still manage Nevet.")
    farm_db.delete_hero(grower_id, g.user["name"])
    logger.info("%s moved hero %s to the recycle bin", g.user["name"], row["name"])
    if is_me:
        session.clear()
        return render_template("message.html", title="Hero deleted",
                               message=f"{row['name']} is in the recycle bin. An admin can restore it "
                                       "with all its actions and plants."), 200
    return redirect(url_for("growers_page", deleted=row["name"]))


@app.route("/recycle-bin")
def recycle_bin():
    admin_only()
    rows = farm_db.deleted_heroes()
    binned = []
    for r in rows:
        h = hero_view(r)
        h.update(deleted_at=r["deleted_at"], deleted_by=r["deleted_by"])
        binned.append(h)
    return render_template("recycle_bin.html", heroes=binned, catalog=heroes.catalog(),
                           notice=request.args.get("notice"))


@app.route("/recycle-bin/<int:grower_id>/restore", methods=["POST"])
def recycle_restore(grower_id):
    admin_only()
    row = farm_db.get_grower(grower_id)
    if not row or not row["deleted_at"]:
        abort(404)
    farm_db.restore_hero(grower_id)
    logger.info("%s restored hero %s from the recycle bin", g.user["name"], row["name"])
    return redirect(url_for("recycle_bin", notice=f"{row['name']} is back."))


@app.route("/recycle-bin/<int:grower_id>/purge", methods=["POST"])
def recycle_purge(grower_id):
    admin_only()
    row = farm_db.get_grower(grower_id)
    if not row or not row["deleted_at"]:
        abort(404)
    farm_db.purge_hero(grower_id)
    logger.info("%s permanently deleted hero %s", g.user["name"], row["name"])
    return redirect(url_for("recycle_bin", notice=f"{row['name']} was deleted for good."))


@app.route("/recycle-bin/empty", methods=["POST"])
def recycle_empty():
    admin_only()
    rows = farm_db.deleted_heroes()
    for r in rows:
        farm_db.purge_hero(r["id"])
    logger.info("%s emptied the recycle bin (%d heroes)", g.user["name"], len(rows))
    return redirect(url_for("recycle_bin", notice=f"Recycle bin emptied ({len(rows)} deleted for good)."))


@app.route("/growers/<int:grower_id>/assets/new")
def asset_new(grower_id):
    return redirect(url_for("plant_new"))


def plant_view(a):
    """What the 3D plant models need to know about an asset."""
    return {"id": a["id"], "name": a["name"], "type": a["asset_type"], "stage": a["life_stage"] or "",
            "species": plants.species_for(a), "model_stage": plants.model_stage(a["life_stage"], a["asset_type"]),
            "url": url_for("asset_page", asset_id=a["id"])}


@app.route("/assets")
def assets_page():
    assets = [dict(a) for a in farm_db.list_assets()]
    garden = [plant_view(a) for a in assets]
    for a, v in zip(assets, garden):
        a["species"] = v["species"]
        a["model_stage"] = v["model_stage"]
    return render_template("assets.html", assets=assets, garden=garden,
                           plant_catalog=plants.subset({v["species"] for v in garden}))


@app.route("/assets/<int:asset_id>")
def asset_page(asset_id):
    asset = farm_db.get_asset(asset_id)
    if not asset:
        abort(404)
    view = plant_view(asset)
    return render_template("asset_detail.html", asset=asset, pinned=garden_map.asset_pinned(asset_id),
                           asset_tags=tags.list_tags("plant", asset_id),
                           history=farm_db.recent_activity(asset_id=asset_id, limit=100),
                           plant=view, species=plants.species(view["species"]), picked=plants.valid(asset["species"]),
                           detected=plants.detect(asset["name"], asset["variety"], asset["asset_type"]),
                           species_groups=plants.groups(), plant_catalog=plants.catalog(), stages=plants.STAGES,
                           notice=request.args.get("notice"))


@app.route("/assets/<int:asset_id>/species", methods=["POST"])
def asset_species(asset_id):
    """Pick which 3D model a plant is drawn with ('auto' = from its name)."""
    asset = farm_db.get_asset(asset_id)
    if not asset:
        abort(404)
    choice = request.form.get("species", "auto")
    if choice != "auto" and not plants.valid(choice):
        abort(400)
    farm_db.set_species(asset_id, None if choice == "auto" else choice)
    logger.info("%s set %s's 3D model to %s", g.user["name"], asset["name"], choice)
    return redirect(url_for("asset_page", asset_id=asset_id, notice="Model updated."))


@app.route("/assets/<int:asset_id>/logs/new")
def log_new(asset_id):
    return redirect(url_for("log_action", asset=asset_id))


def _after_logging(before, action, n, whole=False, plant=None):
    """Back to the dashboard with a one-time 'logged, +XP' banner."""
    after = heroes.progress(**farm_db.grower_counts(g.user["id"]))
    session["banner"] = {"action": action, "n": n, "whole": whole, "new_plant": plant,
                         "xp": after["xp"] - before["xp"],
                         "level": after["level"] if after["level"] > before["level"] else None}
    return redirect(url_for("hub") + "#activity")


@app.route("/log", methods=["GET", "POST"])
def log_action():
    """One screen: what did you do, on which plants, any details."""
    me = g.user["id"]
    error = None
    form = request.form if request.method == "POST" else {}
    if request.method == "POST":
        action = request.form.get("action", "")
        meta = farm_db.ACTION_BY_ID.get(action)
        wanted = [int(x) for x in request.form.getlist("asset") if x.isdigit()]
        targets = farm_db.assets_by_ids(wanted)
        whole = request.form.get("whole_garden") == "1"
        amount = request.form.get("amount", "").strip().replace(",", ".")
        unit = request.form.get("unit") if request.form.get("unit") in av.AMOUNT_UNITS else "g"
        stage = request.form.get("stage") if request.form.get("stage") in ("germination", "seedling", "growing", "mature") else None
        if action == "harvest" and request.form.get("final") == "1":
            stage = "harvested"
        if not meta or meta.get("new_plant") or meta.get("legacy"):
            error = "Pick what you did."
        elif not targets and not whole:
            error = "Pick at least one plant, or “Whole garden”."
        elif amount and not re.fullmatch(r"\d+(\.\d+)?", amount):
            error = "The amount should be a number, like 250 or 1.5."
        if not error:
            before = heroes.progress(**farm_db.grower_counts(me))
            notes = (request.form.get("notes") or "").strip()[:500] or None
            recipient = (request.form.get("recipient") or "").strip()[:80] or None if meta.get("recipient") else None
            for asset in targets:
                qty = None
                if amount and meta.get("amount"):
                    qty = [{"measure": "weight" if unit in ("g", "kg") else "count",
                            "value": float(amount), "units": unit, "label": asset["name"]}]
                farm_db.add_log(action, asset["id"], notes=notes, recipient=recipient, quantities=qty,
                                grower_id=me, new_stage=stage)
            if whole:
                qty = [{"measure": "weight" if unit in ("g", "kg") else "count", "value": float(amount),
                        "units": unit, "label": "garden"}] if amount and meta.get("amount") else None
                farm_db.add_log(action, None, notes=notes, recipient=recipient, quantities=qty, grower_id=me)
            logger.info("%s logged %s x%d%s", g.user["name"], action, len(targets), " + whole garden" if whole else "")
            return _after_logging(before, action, len(targets), whole)
    growing = farm_db.plants(None, current=True)
    mine = [p for p in growing if p["grower_id"] == me]
    others = [p for p in growing if p["grower_id"] != me]
    if request.method == "POST":
        selected = {int(x) for x in request.form.getlist("asset") if x.isdigit()}
    else:
        selected = {int(x) for x in request.args.getlist("asset") if x.isdigit()}   # a to-do link can pick several
    return render_template(
        "log_action.html", error=error, form=form,
        actions=[a for a in farm_db.ACTIONS if not a.get("legacy") and not a.get("new_plant")],
        selected_action=form.get("action") or request.args.get("action", ""),
        mine=mine, others=others, selected=selected, units=av.AMOUNT_UNITS,
    )


@app.route("/plants/new", methods=["GET", "POST"])
def plant_new():
    """Add a plant or worm bin you look after; logs the planting as your action."""
    error = None
    form = request.form if request.method == "POST" else {"how": request.args.get("how", "planting"), "asset_type": "plant"}
    if request.method == "POST":
        name = " ".join(request.form.get("name", "").split())[:40]
        variety = " ".join(request.form.get("variety", "").split())[:40] or None
        kind = request.form.get("asset_type") if request.form.get("asset_type") in farm_db.ASSET_TYPES else "plant"
        species = request.form.get("species")
        species = species if kind == "plant" and plants.valid(species) else None    # None: from the name
        how = request.form.get("how") if request.form.get("how") in ("seeding", "planting", "growing") else "planting"
        if not name:
            error = "Give it a name, like “Cherry tomato” or “Worm bin 2”."
        else:
            before = heroes.progress(**farm_db.grower_counts(g.user["id"]))
            if kind == "worm_bin":
                aid = farm_db.add_asset("worm_bin", name, g.user["id"], variety=variety)
                farm_db.add_log("setup", aid, notes=request.form.get("notes") or None, grower_id=g.user["id"])
                action = "setup"
            else:
                stage = {"seeding": "seed", "planting": "seedling", "growing": "growing"}[how]
                aid = farm_db.add_asset("plant", name, g.user["id"], variety=variety, life_stage=stage, species=species)
                action = "seeding" if how == "seeding" else "planting"
                farm_db.add_log(action, aid, notes=request.form.get("notes") or None,
                                grower_id=g.user["id"], new_stage=stage)
            logger.info("%s added %s %s", g.user["name"], kind, name)
            return _after_logging(before, action, 1, plant=name)
    return render_template("plant_new.html", error=error, form=form, species_groups=plants.groups(),
                           plant_catalog=plants.catalog())


def _map_beds():
    """Areas drawn on the garden map that plants can go in: [(id, label, row)]."""
    out = []
    for f in garden_map.list_features():
        if f["kind"] != "area":
            continue
        cat = garden_map.category("area", f["category"]) or {}
        label = f["name"] or cat.get("label", "Area")
        if f["name"] and cat.get("label"):
            label += f" ({cat['label'].lower()})"
        out.append((f["id"], label, f))
    return out


@app.route("/plants/bulk", methods=["GET", "POST"])
def plants_bulk():
    """Many plants at once from a typed list ("olive x 5"), checked in a preview first."""
    step = request.form.get("step") if request.method == "POST" else None
    beds = _map_beds()
    ctx = dict(species_groups=plants.groups(), beds=[(i, l) for i, l, _ in beds], max_total=bulk.MAX_TOTAL)
    text = request.form.get("text", "")
    how = request.form.get("how") if request.form.get("how") in ("seeding", "planting", "growing") else "planting"
    place = request.form.get("place", type=int)
    if step == "preview":
        rows, problems = bulk.parse(text)
        if not rows:
            return render_template("plants_bulk.html", error="Type at least one plant, like “olive x 5”.", text=text, how=how, place=place, **ctx)
        taken = bulk.existing_names()
        for r in rows:
            r["names"] = bulk.names_for(r["name"], r["count"], taken)
        return render_template("plants_bulk.html", rows=rows, problems=problems, text=text, how=how, place=place, **ctx)
    if step == "add":
        names, counts = request.form.getlist("name"), request.form.getlist("count")
        varieties, species = request.form.getlist("variety"), request.form.getlist("species")
        rows = []
        for i, raw in enumerate(names):
            name = bulk._clean_name(raw)
            try:
                count = max(0, min(bulk.MAX_PER_LINE, int(counts[i])))
            except (IndexError, ValueError):
                count = 0
            if name and count:
                sp = species[i] if i < len(species) and plants.valid(species[i]) else None
                var = " ".join((varieties[i] if i < len(varieties) else "").split())[:40] or None
                rows.append((name, count, var, sp))
        total = sum(r[1] for r in rows)
        if not rows:
            return render_template("plants_bulk.html", error="Nothing to add: every line has a count of 0.", text=text, how=how, place=place, **ctx)
        if total > bulk.MAX_TOTAL:
            return render_template("plants_bulk.html", error=f"That's {total} plants; add at most {bulk.MAX_TOTAL} at a time.", text=text, how=how, place=place, **ctx)
        me = g.user["id"]
        before = heroes.progress(**farm_db.grower_counts(me))
        stage = {"seeding": "seed", "planting": "seedling", "growing": "growing"}[how]
        action = "seeding" if how == "seeding" else "planting"
        notes = (request.form.get("notes") or "").strip()[:500] or None
        taken = bulk.existing_names()
        new_ids = []
        for name, count, var, sp in rows:
            for nm in bulk.names_for(name, count, taken):
                aid = farm_db.add_asset("plant", nm, me, variety=var, life_stage=stage, species=sp)
                farm_db.add_log(action, aid, notes=notes, grower_id=me, new_stage=stage)
                taken.add(nm.lower())
                new_ids.append(aid)
        bed = next((f for i, _, f in beds if i == place), None)
        if bed:                                        # pin them on the garden map, spread over the bed
            geom = json.loads(bed["geometry"])
            pins = [json.loads(f["geometry"])["coordinates"] for f in garden_map.list_features() if f["kind"] == "asset"]
            for aid, pt in zip(new_ids, bulk.spread_points(geom, len(new_ids), pins)):
                garden_map.create_feature({"kind": "asset", "asset_id": aid, "category": "plant",
                                           "geometry": {"type": "Point", "coordinates": pt}}, me)
        logger.info("%s added %d plants at once%s", g.user["name"], len(new_ids), f" in {bed['name'] or 'a bed'}" if bed else "")
        return _after_logging(before, action, len(new_ids), plant=f"{len(new_ids)} plants")
    return render_template("plants_bulk.html", text=text, how=how, place=place, **ctx)


@app.route("/activity")
def activity():
    """Full history with filters: who, what, which plant, when."""
    who = request.args.get("who", type=int)
    kind = request.args.get("type") if request.args.get("type") in farm_db.LOG_TYPES else None
    plant = request.args.get("plant", type=int)
    period = request.args.get("period") if request.args.get("period") in ("7", "30", "90") else "all"
    page = max(request.args.get("page", 1, type=int), 1)
    per_page = 60
    since = (datetime.now() - timedelta(days=int(period))).date().isoformat() if period != "all" else None
    rows = farm_db.recent_activity(who, kind, plant, since, limit=per_page + 1, offset=(page - 1) * per_page)
    has_more = len(rows) > per_page
    rows = rows[:per_page]
    conn = farm_db.get_conn()
    all_growers = conn.execute("SELECT id, name FROM growers WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE").fetchall()
    all_assets = conn.execute("SELECT id, name, asset_type FROM assets ORDER BY name COLLATE NOCASE").fetchall()
    used_types = [r[0] for r in conn.execute("SELECT DISTINCT log_type FROM logs")]
    conn.close()
    action_opts = [a for a in farm_db.ACTIONS if not a.get("legacy") or a["id"] in used_types]
    params = {k: v for k, v in {"who": who, "type": kind, "plant": plant,
                                 "period": None if period == "all" else period}.items() if v}
    return render_template(
        "activity.html", groups=av.group_by_day(rows), who=who, kind=kind, plant=plant, period=period,
        page=page, has_more=has_more, params=params, growers=all_growers, assets=all_assets,
        action_opts=action_opts, totals=farm_db.activity_totals(who) if not (kind or plant or since) else None,
    )


@app.route("/extras/<name>/")
@app.route("/extras/<name>/<path:filepath>")
def extra_file(name, filepath="index.html"):
    """Files of a companion repo (config/extra_repos.conf), e.g. the acid synth."""
    full = extras.path_for(name, filepath)
    if full is None:
        abort(404)
    if full.is_dir():
        full = full / "index.html"
    if not full.is_file():
        abort(404)
    resp = send_from_directory(full.parent, full.name)
    resp.headers["Cache-Control"] = "no-cache"          # updates show up on the next load
    return resp


@app.route("/media/<path:filepath>")
def media(filepath):
    full = (BASE_DIR / filepath).resolve()
    if not str(full).startswith(str(BASE_DIR.resolve()) + os.sep):
        abort(403)
    if not full.is_file():
        abort(404)
    return send_from_directory(full.parent, full.name)


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(safe_next(request.args.get("next")) or url_for("hub"))
    error, name = None, ""
    if request.method == "POST":
        name = " ".join(request.form.get("name", "").split())
        key = request.remote_addr or "?"
        if auth.limiter.blocked(key):
            error = "Too many wrong tries. Wait a few minutes and try again."
        else:
            row = farm_db.find_grower_by_name(name) if name else None
            if row and auth.check_password(row["password_hash"], request.form.get("password", "")):
                auth.limiter.reset(key)
                log_in(row)
                logger.info("Login: %s from %s", row["name"], key)
                return redirect(safe_next(request.args.get("next")) or url_for("hub"))
            auth.limiter.fail(key)
            logger.warning("Failed login for %r from %s", name, key)
            if row and not row["password_hash"]:
                error = f"The hero “{row['name']}” has no password yet. Sign up with that name to claim it."
            else:
                error = "Wrong name or password."
    players, unclaimed = farm_db.list_players()
    return render_template(
        "login.html", error=error, name=name, open_signup=auth.open_signup(),
        no_accounts=not players, catalog=heroes.catalog(),
        players=[{"name": p["name"], "appearance": heroes.hero_for_row(p)[1]} for p in players],
        unclaimed=[u["name"] for u in unclaimed],
    )


@app.route("/register", methods=["GET", "POST"])
def register():
    """Sign up = create a hero with a password. Signing up with the name of
    an existing hero that has no password yet claims that hero (and all its
    plants and logs). The very first account becomes the admin."""
    first_account = farm_db.account_count() == 0
    if not g.user and not auth.open_signup() and not first_account:
        return render_template("message.html", title="Sign-up is closed",
                               message="Ask a player who already has an account to add you."), 403
    error, name = None, (request.args.get("name") or "")[:20]
    # visitors from the internet (not home WiFi or your Tailscale devices) need an invite code: the farm's,
    # or any player's own code (which also says who invited them)
    need_code = not g.user and not first_account and netaccess.from_internet(request.remote_addr) and not auth.public_signup()
    link_code = session.get("invite_from") if not g.user else None          # came through someone's invite link (/i/<code>)
    inviter = invites.find_code(request.form.get("invite") or request.args.get("invite") or link_code or "") if not g.user else None
    if request.method == "POST":
        name, error = heroes.validate_name(request.form.get("name"))
        password = request.form.get("password", "")
        if need_code and not error:
            code = (request.form.get("invite") or "").strip().upper().replace(" ", "")
            want = farm_db.get_setting("invite_code") or ""
            personal = invites.find_code(code)
            if not (want and hmac.compare_digest(code, want)) and not personal:
                auth.limiter.fail(request.remote_addr or "?")
                error = "That invite code isn't right. Ask the player who invited you for their code or link."
            elif auth.limiter.blocked(request.remote_addr or "?"):
                error = "Too many wrong tries. Wait a few minutes and try again."
            else:
                inviter = personal or inviter
        if not error:
            error = auth.validate_password(password, request.form.get("confirm", ""))
        if not error:
            existing = farm_db.find_grower_by_name(name, include_deleted=True)
            if existing and existing["deleted_at"]:
                error = f"“{existing['name']}” is in the recycle bin. An admin can restore it, or pick another name."
            elif existing and existing["password_hash"]:
                error = f"The name “{existing['name']}” is already taken. Pick another one or log in."
            elif existing:
                farm_db.set_password(existing["id"], auth.hash_password(password))
                if first_account:
                    farm_db.set_admin(existing["id"], True)
                gid, claimed = existing["id"], True
            else:
                hero_class, look = heroes.default_appearance(name)
                gid = farm_db.create_hero(name, hero_class, json.dumps(look),
                                          password_hash=auth.hash_password(password), is_admin=first_account)
                claimed = False
        if not error:                                    # who invited them: the player adding them, an invite link or code, or "who invited you?"
            if g.user:
                inv_id, via = g.user["id"], "added"
            elif inviter:
                inv_id, via = inviter["id"], "link" if link_code and invites.clean_code(link_code) == inviter["invite_code"] else "code"
            else:
                pick = farm_db.find_grower_by_name((request.form.get("invited_by") or "").strip()) if request.form.get("invited_by") else None
                inv_id, via = (pick["id"], "set") if pick else (None, None)
            if inv_id and not (claimed and farm_db.get_grower(gid)["invited_by"]):
                invites.set_inviter(gid, inv_id, via, by=g.user["id"] if g.user else gid, place=netaccess.where(request.remote_addr))
            session.pop("invite_from", None)
            from_screen = bool(session.pop("from_screen", None)) and not g.user
            join_ev = session.pop("join_event", None) if not g.user else None
            if from_screen:
                farm_db.set_setting("screen_joins", str(int(farm_db.get_setting("screen_joins") or 0) + 1))
            logger.info("New account %s%s%s%s%s", name, " (claimed existing hero)" if claimed else "",
                        " [admin]" if first_account else "", " (from the welcome screen's QR code)" if from_screen else "",
                        f" (invited by #{inv_id}, {invites.VIA.get(via, via)})" if inv_id else "")
            if g.user:          # a player adding someone else: stay logged in as yourself
                return redirect(url_for("grower_page", grower_id=gid, created=1))
            log_in(farm_db.get_grower(gid))
            if join_ev and events.get(join_ev):         # came from an event's QR code: straight to "Are you coming?"
                events.count_qr(join_ev, "joins")
                return redirect(url_for("event_page", event_id=join_ev, join=1, welcome=1) + "#rsvp")
            return redirect(url_for("grower_customize", grower_id=gid, welcome=1))
    join_ev = events.get(session["join_event"]) if session.get("join_event") and not g.user else None
    pickable = [] if g.user or inviter or first_account else [r["name"] for r in farm_db.list_growers() if r["password_hash"]]
    return render_template("register.html", error=error, name=name, first_account=first_account, need_code=need_code, join_ev=join_ev,
                           inviter=inviter, inviter_code=inviter["invite_code"] if inviter else "", pickable=pickable)


@app.route("/i/<code>")
def invite_link(code):
    """A player's own invite link: counts the visit (once per visitor), then sign-up with their code filled in.
    Players who are already logged in see whose link it was."""
    code = invites.clean_code(code)
    who = invites.find_code(code)
    if g.user:
        return redirect(url_for("grower_page", grower_id=who["id"]) if who else url_for("hub"))
    if not who:
        return render_template("message.html", title="This invite link has expired",
                               message="Ask the player who sent it for a fresh one (their Account page has it)."), 404
    if session.get("invite_from") != code:
        session["invite_from"] = code
        invites.log("opened", inviter=who["id"], place=netaccess.where(request.remote_addr))
    return redirect(url_for("register", invite=code))


@app.route("/join")
def join():
    """The short link in the welcome screen's QR code (`nevet screen`): counts the scan, then sign-up
    (with the invite code filled in: /join?i=CODE). Players who are already logged in go to the dashboard."""
    if g.user:
        return redirect(url_for("hub"))
    if not session.get("from_screen"):
        session["from_screen"] = 1
        farm_db.set_setting("screen_scans", str(int(farm_db.get_setting("screen_scans") or 0) + 1))
    code = re.sub(r"[^A-Z0-9]", "", (request.args.get("i") or "").upper())[:12]
    return redirect(url_for("register", invite=code) if code else url_for("register"))


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/account", methods=["GET", "POST"])
def account():
    message, error = None, None
    if request.method == "POST" and request.form.get("action") == "new_invite":
        if not g.user["is_admin"]:
            abort(403)
        farm_db.set_setting("invite_code", netaccess.new_invite_code())
        logger.info("%s made a new invite code", g.user["name"])
        message = "New invite code made. The old one no longer works."
    elif request.method == "POST" and request.form.get("action") == "new_my_code":
        invites.code_for(g.user["id"], renew=True)
        logger.info("%s made a new personal invite code", g.user["name"])
        message = "Your new invite link is ready. The old link no longer works."
    elif request.method == "POST":
        row = farm_db.get_grower(g.user["id"])
        new = request.form.get("new_password", "")
        if not auth.check_password(row["password_hash"], request.form.get("current_password", "")):
            error = "Your current password isn't right."
        else:
            error = auth.validate_password(new, request.form.get("confirm", ""))
        if not error:
            farm_db.set_password(row["id"], auth.hash_password(new))
            logger.info("%s changed their password", row["name"])
            message = "Password changed."
    invite = None
    if g.user["is_admin"]:
        invite = farm_db.get_setting("invite_code")
        if not invite:
            invite = netaccess.new_invite_code()
            farm_db.set_setting("invite_code", invite)
    return render_template("account.html", message=message, error=error, invite=invite, mine=_my_invite(g.user["id"]),
                           invite_log=invites.recent(20) if g.user["is_admin"] else None,
                           here=netaccess.where(request.remote_addr), secure=request.is_secure)


def _my_invite(grower_id):
    """A hero's invite card: their link and code, its QR code, who invited them and whom they invited."""
    info = invites.summary(grower_id, with_code=True)
    info["link"] = _tag_base() + "i/" + info["code"]
    info["shown"] = info["link"].split("://", 1)[-1]
    info["qr"] = qr.svg(qr.encode(info["link"], ecl="M"), quiet=2, scale=5, title="QR code with your invite link")
    return info


@app.route("/growers/<int:grower_id>/inviter", methods=["POST"])
def grower_inviter(grower_id):
    """Who invited this hero: they can say so once themselves; an admin can set or clear it."""
    row = farm_db.get_grower(grower_id)
    if not row or row["deleted_at"]:
        abort(404)
    is_me = g.user["id"] == grower_id
    if not (g.user["is_admin"] or (is_me and not row["invited_by"])):
        abort(403)
    if request.form.get("clear") and g.user["is_admin"]:
        invites.clear_inviter(grower_id, by=g.user["id"])
        logger.info("%s cleared who invited %s", g.user["name"], row["name"])
        return redirect(url_for("grower_page", grower_id=grower_id) + "#connections")
    try:
        inviter_id = int(request.form.get("inviter") or 0)
    except ValueError:
        inviter_id = 0
    if not invites.set_inviter(grower_id, inviter_id, "set", by=g.user["id"], place=netaccess.where(request.remote_addr)):
        return redirect(url_for("grower_page", grower_id=grower_id, rel_error="That can't be the hero who invited them (it would go round in a circle).") + "#connections")
    logger.info("%s set who invited %s", g.user["name"], row["name"])
    return redirect(url_for("grower_page", grower_id=grower_id) + "#connections")


@app.route("/stats")
def stats():
    conn = get_db()
    latest = conn.execute("SELECT * FROM stats_log ORDER BY id DESC LIMIT 1").fetchone()
    history = conn.execute("SELECT * FROM stats_log ORDER BY id DESC LIMIT 50").fetchall()
    conn.close()
    period = request.args.get("period", "30")
    days = {"7": 7, "30": 30, "all": None}.get(period, 30)
    board = games.leaderboard(days)
    fighters = sorted((r for r in board if r.get("bouts")), key=lambda r: (-r.get("glory", 0), -r.get("wins", 0), r["name"].lower()))
    players = sorted((r for r in board if r.get("matches")), key=lambda r: (-r.get("goals", 0), -r.get("match_wins", 0), r["name"].lower()))
    return render_template("stats.html", latest=latest, history=history, fighters=fighters, players=players, period=period if period in ("7", "30", "all") else "30",
                           recent=games.recent_matches(10), totals=games.totals(), styles=games.ARENA_STYLES,
                           bracket=games.bracket(), champions=games.champions(8), records=games.records(games.leaderboard(None)),
                           moves=[k for k in ("punches", "pushes", "strikes") if any(r.get(k) for r in fighters)],
                           names={g["id"]: g["name"] for g in farm_db.list_growers()})


@app.route("/powers")
def powers_page():
    """How heroes' powers work: where they come from, and how matches are kept fair."""
    P = games.all_powers()
    rows = sorted(({"id": r["id"], "name": r["name"], **P[r["id"]]} for r in farm_db.list_growers() if r["id"] in P),
                  key=lambda r: (-r["level"], r["name"].lower()))
    return render_template("powers.html", g_=games, rows=rows, mine=P.get(g.user["id"]),
                           classes={c["id"]: c for c in heroes.catalog()["classes"]})


@app.route("/api/games/now")
def api_games_now():
    """The current and next match of an activity (made here, the same for everyone): ?mode=campfire for the mud
    tournament, ?mode=play for football. The farm calls this while it shows that activity; each match is made the
    first time someone asks for it."""
    return jsonify(games.now_playing(mode=request.args.get("mode", "play")))


@app.route("/logs")
def logs_page():
    return render_template("logs.html")


@app.route("/api/logs")
def api_logs():
    return jsonify({name: tail_lines(path) for name, path in LOG_FILES.items()})


@app.route("/api/stats", methods=["POST"])
def api_add_stats():
    key = os.environ.get("WEBAPP_API_KEY", "changeme-api-key")
    sent = request.headers.get("X-API-Key", "")
    default_from_outside = key == "changeme-api-key" and netaccess.where(request.remote_addr) == "internet"
    if not hmac.compare_digest(sent, key) or default_from_outside:
        logger.warning("Rejected /api/stats call from %s (bad API key)", request.remote_addr)
        abort(401)
    data = request.get_json(force=True, silent=True) or {}
    logger.info("Stats logged: %s", {k: v for k, v in data.items() if k != "extra"})
    conn = get_db()
    conn.execute(
        "INSERT INTO stats_log (timestamp, xp, time_played, compost, credits, plant_growth, extra) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            datetime.now().isoformat(timespec="seconds"),
            data.get("xp"), data.get("time_played"), data.get("compost"),
            data.get("credits"), data.get("plant_growth"), str(data.get("extra", "")),
        ),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ---------- garden map ----------
def _map_assets(rows):
    """Plants and worm bins for the 'pin a plant' list."""
    pinned = {r["asset_id"] for r in rows if r["asset_id"]}
    out = []
    for a in farm_db.list_assets():
        done = a["life_stage"] in ("harvested", "archived")
        out.append({"id": a["id"], "name": a["name"], "type": a["asset_type"], "variety": a["variety"] or "",
                    "stage": av.stage_label(a["life_stage"]), "owner": a["grower_name"] or "", "done": done,
                    "pinned": a["id"] in pinned, "url": url_for("asset_page", asset_id=a["id"]),
                    "log_url": url_for("log_action", asset=a["id"])})
    out.sort(key=lambda a: (a["done"], a["type"] == "worm_bin", a["name"].lower()))
    return out


@app.route("/map")
def map_page():
    rows = garden_map.list_features()
    data = {
        "features": garden_map.feature_collection(rows),
        "categories": garden_map.CATEGORIES,
        "palette": garden_map.PALETTE,
        "assets": _map_assets(rows),
        "home": garden_map.get_home(),
        "defaultView": garden_map.default_view(),
        "isAdmin": g.user["is_admin"],
        "focus": request.args.get("asset", type=int),
        "urls": {"features": url_for("api_map_features"), "home": url_for("api_map_home"),
                 "deleted": url_for("api_map_deleted"), "export": url_for("map_export")},
    }
    return render_template("map.html", data=data)


def _map_json(fid, status=200):
    return jsonify(garden_map.feature_dict(garden_map.get_feature(fid))), status


def _map_label(fields_or_row):
    ev = fields_or_row["event_id"] if "event_id" in fields_or_row.keys() else None
    cat = garden_map.category(fields_or_row["kind"], fields_or_row["category"], bool(ev))
    return (cat["label"] if cat else fields_or_row["kind"]).lower()


def _feature_in(fid, event_id, include_deleted=False):
    """A map item, only if it belongs to this map (the garden's when event_id is None)."""
    row = garden_map.get_feature(fid, include_deleted=include_deleted)
    return row if row and (row["event_id"] or None) == (event_id or None) else None


def _map_create(event_id=None):
    fields, err = garden_map.clean(request.get_json(silent=True), event_id=event_id)
    if err:
        return jsonify({"error": err}), 400
    fid = garden_map.create_feature(fields, g.user["id"])
    row = garden_map.get_feature(fid)
    logger.info("%s mapped %s %s%s", g.user["name"], _map_label(row), row["asset_name"] or row["name"] or f"#{fid}",
                f" for event #{event_id}" if event_id else "")
    return _map_json(fid, 201)


def _map_update(fid, event_id=None):
    row = _feature_in(fid, event_id)
    if not row:
        return jsonify({"error": "That map item is gone. Refresh the map."}), 404
    fields, err = garden_map.clean(request.get_json(silent=True), existing=row, event_id=event_id)
    if err:
        return jsonify({"error": err}), 400
    garden_map.update_feature(fid, fields, g.user["id"])
    return _map_json(fid)


def _map_delete(fid, event_id=None):
    row = _feature_in(fid, event_id)
    if not row or not garden_map.delete_feature(fid, g.user["id"]):
        return jsonify({"error": "That map item is already gone."}), 404
    logger.info("%s removed %s %s from the map", g.user["name"], _map_label(row), row["asset_name"] or row["name"] or f"#{fid}")
    return jsonify({"ok": True, "id": fid})


def _map_restore(fid, event_id=None):
    if not _feature_in(fid, event_id, include_deleted=True) or not garden_map.restore_feature(fid, g.user["id"]):
        return jsonify({"error": "Can't bring that back (already restored, or the plant was pinned again)."}), 409
    return _map_json(fid)


@app.route("/api/map/features", methods=["GET", "POST"])
def api_map_features():
    if request.method == "GET":
        return jsonify(garden_map.feature_collection())
    return _map_create()


@app.route("/api/map/features/<int:fid>", methods=["POST"])
def api_map_feature_update(fid):
    return _map_update(fid)


@app.route("/api/map/features/<int:fid>/delete", methods=["POST"])
def api_map_feature_delete(fid):
    return _map_delete(fid)


@app.route("/api/map/features/<int:fid>/restore", methods=["POST"])
def api_map_feature_restore(fid):
    return _map_restore(fid)


@app.route("/api/map/deleted")
def api_map_deleted():
    return jsonify({"features": [garden_map.feature_dict(r) | {"deleted_at": r["deleted_at"]}
                                 for r in garden_map.recently_deleted()]})


@app.route("/api/map/home", methods=["POST"])
def api_map_home():
    if not g.user["is_admin"]:
        return jsonify({"error": "Only the admin can set the garden's spot."}), 403
    data = request.get_json(silent=True) or {}
    try:
        garden_map.set_home(data.get("lat"), data.get("lng"), data.get("zoom"))
    except (ValueError, TypeError):
        return jsonify({"error": "That spot isn't on the map."}), 400
    logger.info("%s set the garden's map spot", g.user["name"])
    return jsonify({"ok": True, "home": garden_map.get_home()})


@app.route("/map/export.geojson")
def map_export():
    body = json.dumps(garden_map.feature_collection(), ensure_ascii=False, indent=1)
    name = f"nevet-garden-map-{datetime.now():%Y-%m-%d}.geojson"
    return app.response_class(body, mimetype="application/geo+json",
                              headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.route("/api/farm/live")
def api_farm_live():
    """New actions since a log id, for the farm's live (TV) view to play out."""
    since = request.args.get("since", 0, type=int)
    rows = farm_db.recent_activity(limit=20)
    events = [{"id": r["id"], "type": r["log_type"], "who": r["grower_name"] or "Someone",
               "verb": (farm_db.ACTION_BY_ID.get(r["log_type"]) or {}).get("verb", r["log_type"].replace("_", " ")),
               "what": r["asset_name"] or "the whole garden", "time": r["timestamp"]}
              for r in rows if r["id"] > since]
    latest = max([since] + [e["id"] for e in events])
    return jsonify({"latest": latest, "events": list(reversed(events))})


@app.route("/api/map.geojson")
def api_map_geojson():
    """Read-only garden map for other programs (e.g. other Nevet gardens):
    a logged-in browser, or an X-API-Key header matching WEBAPP_API_KEY
    (only when that key has been changed from the default)."""
    key = os.environ.get("WEBAPP_API_KEY", "")
    sent = request.headers.get("X-API-Key", "")
    if not g.user and not (key and key != "changeme-api-key" and hmac.compare_digest(sent, key)):
        return jsonify({"error": "login or API key required"}), 401
    return jsonify(garden_map.feature_collection())


# ---------- events: parties, festivals and gatherings on the farm (events.py) ----------
def _event_or_404(event_id):
    ev = events.get(event_id)
    if not ev:
        abort(404)
    return ev


def _event_manager(ev):
    if not events.can_manage(ev, g.user):
        abort(403)


def _event_link(ev, invite=False):
    """The short link an event's QR code opens: /e/<id> (with the invite code for posters made by an admin)."""
    url = _tag_base() + f"e/{ev['id']}"
    code = farm_db.get_setting("invite_code") if invite else None
    return url + (f"?i={code}" if code else "")


def _event_qr(ev, scale=4, invite=False):
    return qr.svg(qr.encode(_event_link(ev, invite)), quiet=2, scale=scale, title="QR code to join " + ev["title"])


@app.route("/e/<int:event_id>")
def event_join(event_id):
    """Where an event's QR code leads. Counts the scan (once per visitor), then: players go to the event
    with "Are you coming?" ready; visitors without a hero see the invitation, and can log in or sign up
    and land back on the event."""
    ev = events.get(event_id)
    if not ev:
        return render_template("message.html", title="Event not found",
                               message="This event isn't on Nevet any more. Ask the person who invited you."), 404
    seen = session.get("ev_seen") or []
    if event_id not in seen:
        events.count_qr(event_id)
        session["ev_seen"] = (seen + [event_id])[-30:]
    if g.user:
        return redirect(url_for("event_page", event_id=event_id, join=1) + ("#rsvp" if ev["phase"] == "upcoming" else ""))
    session["join_event"] = event_id
    code = re.sub(r"[^A-Z0-9]", "", (request.args.get("i") or "").upper())[:12]
    return render_template("event_invite.html", ev=ev, code=code, open_signup=auth.open_signup(),
                           next_url=url_for("event_page", event_id=event_id, join=1))


@app.route("/events/<int:event_id>/qr.svg")
def event_qr_svg(event_id):
    ev = _event_or_404(event_id)
    invite = request.args.get("invite") == "1" and g.user["is_admin"]
    resp = app.response_class(_event_qr(ev, scale=10, invite=invite), mimetype="image/svg+xml")
    if request.args.get("download"):
        resp.headers["Content-Disposition"] = f'attachment; filename="nevet-event-{ev["id"]}-qr.svg"'
    return resp


@app.route("/events/<int:event_id>/poster")
def event_poster(event_id):
    """A printable poster with the event's QR code, for the gate, a notice board or a shop window."""
    ev = _event_or_404(event_id)
    invite = request.args.get("invite") == "1" and g.user["is_admin"]
    link = _event_link(ev, invite)
    return render_template("event_poster.html", ev=ev, link=link, shown=link.split("://", 1)[-1],
                           qr_svg=qr.svg(qr.encode(link, ecl="Q"), quiet=2, scale=12, title="QR code to join " + ev["title"]),
                           invite=invite)


def _back_to_event(ev, anchor=None, error=None):
    return redirect(url_for("event_page", event_id=ev["id"], error=error) + (f"#{anchor}" if anchor else ""))


def _wants_json():
    return request.headers.get("X-Requested-With") == "fetch"


@app.route("/events", methods=["GET", "POST"])
def events_page():
    if request.method == "POST":
        fields, err = events.clean(request.form)
        if err:
            return render_template("event_form.html", ev=None, form=request.form, error=err, kinds=events.KINDS, acts=events.FARM_ACTS), 400
        eid = events.create(fields, g.user["id"])
        logger.info("%s planned the event %s (%s)", g.user["name"], fields["title"], fields["starts_at"])
        return redirect(url_for("event_page", event_id=eid))
    evs = events.list_events()
    return render_template("events.html", now=[e for e in evs if e["phase"] == "now"],
                           upcoming=[e for e in evs if e["phase"] == "upcoming"],
                           past=list(reversed([e for e in evs if e["phase"] in ("past", "cancelled")])))


@app.route("/events/new")
def event_new():
    day = request.args.get("date") or (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d")
    return render_template("event_form.html", ev=None, form={"date": day, "time": "18:00", "kind": request.args.get("kind", "party")},
                           error=None, kinds=events.KINDS, acts=events.FARM_ACTS)


@app.route("/events/<int:event_id>")
def event_page(event_id):
    ev = _event_or_404(event_id)
    me = g.user["id"]
    rs = events.rsvps(event_id)
    checked = events.checkins(event_id)
    checked_ids = {c["grower_id"] for c in checked}
    fb = events.feedback(event_id)
    return render_template(
        "event.html", ev=ev, manage=events.can_manage(ev, g.user), error=request.args.get("error"),
        rsvps=rs, mine=events.rsvp_of(event_id, me), answers=events.ANSWERS,
        tasks=events.tasks(event_id), checkins=checked, checked_ids=checked_ids, me_in=me in checked_ids,
        to_check=[r for r in rs if r["answer"] != "no" and r["grower_id"] not in checked_ids],
        everyone=[r for r in farm_db.list_growers() if r["id"] not in checked_ids],
        notes=events.notes(event_id), photos=events.photos(ev), feedback=fb,
        my_feedback=next((f for f in fb if f["grower_id"] == me), None),
        summary=events.summary(ev), arrivals=events.arrivals(ev),
        map_count=len(garden_map.list_features(event_id)),
        acts=dict(events.FARM_ACTS),
        link=_event_link(ev), qr_svg=_event_qr(ev, scale=5),
        joining=bool(request.args.get("join")), welcome=bool(request.args.get("welcome")))


@app.route("/events/<int:event_id>/edit", methods=["GET", "POST"])
def event_edit(event_id):
    ev = _event_or_404(event_id)
    _event_manager(ev)
    if request.method == "POST":
        fields, err = events.clean(request.form)
        if err:
            return render_template("event_form.html", ev=ev, form=request.form, error=err, kinds=events.KINDS, acts=events.FARM_ACTS), 400
        events.update(event_id, fields)
        return redirect(url_for("event_page", event_id=event_id))
    form = {"title": ev["title"], "kind": ev["kind"], "date": ev["start"].strftime("%Y-%m-%d"), "time": ev["start"].strftime("%H:%M"),
            "end_date": ev["ends_at"][:10] if ev["ends_at"] else "", "end_time": ev["ends_at"][11:16] if ev["ends_at"] else "",
            "place": ev["place"] or "", "description": ev["description"] or "", "capacity": ev["capacity"] or "", "farm_act": ev["farm_act"]}
    return render_template("event_form.html", ev=ev, form=form, error=None, kinds=events.KINDS, acts=events.FARM_ACTS)


@app.route("/events/<int:event_id>/status", methods=["POST"])
def event_status(event_id):
    ev = _event_or_404(event_id)
    _event_manager(ev)
    status = "cancelled" if request.form.get("status") == "cancelled" else "planned"
    events.set_status(event_id, status)
    logger.info("%s %s the event %s", g.user["name"], "cancelled" if status == "cancelled" else "brought back", ev["title"])
    return _back_to_event(ev)


@app.route("/events/<int:event_id>/delete", methods=["POST"])
def event_delete(event_id):
    ev = _event_or_404(event_id)
    _event_manager(ev)
    events.delete(event_id)
    logger.info("%s deleted the event %s", g.user["name"], ev["title"])
    return redirect(url_for("events_page"))


@app.route("/events/<int:event_id>/rsvp", methods=["POST"])
def event_rsvp(event_id):
    ev = _event_or_404(event_id)
    if ev["status"] == "cancelled" and request.form.get("answer") != "clear":
        err = "This event was cancelled."
    else:
        err = events.set_rsvp(event_id, g.user["id"], request.form.get("answer"), request.form.get("guests"), request.form.get("bring"))
    if _wants_json():                    # the dashboard's one-tap buttons
        ev = events.get(event_id)
        mine = events.rsvp_of(event_id, g.user["id"])
        return jsonify({"ok": not err, "error": err, "answer": mine["answer"] if mine else None,
                        "going": ev["going"], "maybe": ev["maybe"], "expected": ev["expected"]}), (400 if err else 200)
    nxt = safe_next(request.form.get("next"))
    if nxt and not err:
        return redirect(nxt)
    return _back_to_event(ev, "rsvp", err)


@app.route("/events/<int:event_id>/tasks", methods=["POST"])
def event_task_add(event_id):
    ev = _event_or_404(event_id)
    _event_manager(ev)
    return _back_to_event(ev, "tasks", events.add_task(event_id, request.form.get("title"), request.form.get("needed"), g.user["id"]))


@app.route("/events/<int:event_id>/tasks/<int:task_id>/<what>", methods=["POST"])
def event_task_change(event_id, task_id, what):
    ev = _event_or_404(event_id)
    t = events.task(task_id)
    if not t or t["event_id"] != event_id:
        abort(404)
    if what == "volunteer":
        events.toggle_volunteer(task_id, g.user["id"])
    elif what in ("done", "undone", "delete"):
        _event_manager(ev)
        if what == "delete":
            events.delete_task(task_id)
        else:
            events.set_task_done(task_id, what == "done")
    else:
        abort(404)
    return _back_to_event(ev, "tasks")


@app.route("/events/<int:event_id>/checkin", methods=["POST"])
def event_checkin(event_id):
    ev = _event_or_404(event_id)
    who = request.form.get("grower_id", type=int) or g.user["id"]
    if who != g.user["id"] and not events.can_manage(ev, g.user):
        abort(403)
    if not farm_db.get_grower(who):
        abort(404)
    if request.form.get("out"):
        events.check_out(event_id, who)
    else:
        events.check_in(event_id, who, g.user["id"])
    return _back_to_event(ev, "day")


@app.route("/events/<int:event_id>/walkin", methods=["POST"])
def event_walkin(event_id):
    ev = _event_or_404(event_id)
    total = events.count_walk_in(event_id, request.form.get("delta", type=int) or 1, g.user["id"])
    if _wants_json():
        fresh = events.get(event_id)
        return jsonify({"walk_ins": total, "attended": fresh["attended"]})
    return _back_to_event(ev, "day")


@app.route("/events/<int:event_id>/notes", methods=["POST"])
def event_note_add(event_id):
    ev = _event_or_404(event_id)
    return _back_to_event(ev, "log", events.add_note(event_id, g.user["id"], request.form.get("text")))


@app.route("/events/<int:event_id>/notes/<int:note_id>/delete", methods=["POST"])
def event_note_delete(event_id, note_id):
    ev = _event_or_404(event_id)
    n = events.note(note_id)
    if not n or n["event_id"] != event_id:
        abort(404)
    if n["grower_id"] != g.user["id"]:
        _event_manager(ev)
    events.delete_note(note_id)
    return _back_to_event(ev, "log")


@app.route("/events/<int:event_id>/feedback", methods=["POST"])
def event_feedback(event_id):
    ev = _event_or_404(event_id)
    return _back_to_event(ev, "feedback", events.set_feedback(event_id, g.user["id"], request.form.get("rating"), request.form.get("comment")))


def _event_filename(ev, ext):
    slug = re.sub(r"[^a-z0-9]+", "-", ev["title"].lower()).strip("-")[:40] or "event"
    return f"nevet-event-{ev['start']:%Y-%m-%d}-{slug}.{ext}"


@app.route("/events/<int:event_id>/export.<fmt>")
def event_export(event_id, fmt):
    ev = _event_or_404(event_id)
    if fmt == "csv":
        body, mime = "﻿" + events.people_csv(ev), "text/csv"            # the BOM lets Excel read Hebrew names
    elif fmt == "json":
        body, mime = json.dumps(events.export(ev), ensure_ascii=False, indent=1, default=str), "application/json"
    elif fmt == "geojson":
        body, mime = json.dumps(garden_map.feature_collection(event_id=event_id, garden_name=ev["title"]), ensure_ascii=False, indent=1), "application/geo+json"
    else:
        abort(404)
    return app.response_class(body, mimetype=mime, headers={"Content-Disposition": f'attachment; filename="{_event_filename(ev, fmt)}"'})


@app.route("/events/<int:event_id>/map")
def event_map(event_id):
    ev = _event_or_404(event_id)
    garden = garden_map.list_features()
    data = {
        "features": garden_map.feature_collection(event_id=event_id, garden_name=ev["title"]),
        "background": garden_map.feature_collection(garden),
        "categories": garden_map.EVENT_CATEGORIES,
        "palette": garden_map.PALETTE,
        "assets": [],
        "home": garden_map.get_home(),
        "defaultView": garden_map.default_view(),
        "isAdmin": False,
        "focus": None,
        "event": {"id": ev["id"], "title": ev["title"], "emoji": ev["kind_info"]["emoji"], "when": ev["when"],
                  "url": url_for("event_page", event_id=event_id)},
        "urls": {"features": url_for("api_event_map_features", event_id=event_id),
                 "deleted": url_for("api_event_map_deleted", event_id=event_id),
                 "export": url_for("event_export", event_id=event_id, fmt="geojson"), "home": None},
    }
    return render_template("map.html", data=data, event=ev)


@app.route("/api/events/<int:event_id>/map/features", methods=["GET", "POST"])
def api_event_map_features(event_id):
    _event_or_404(event_id)
    if request.method == "GET":
        return jsonify(garden_map.feature_collection(event_id=event_id))
    return _map_create(event_id)


@app.route("/api/events/<int:event_id>/map/features/<int:fid>", methods=["POST"])
def api_event_map_feature_update(event_id, fid):
    _event_or_404(event_id)
    return _map_update(fid, event_id)


@app.route("/api/events/<int:event_id>/map/features/<int:fid>/delete", methods=["POST"])
def api_event_map_feature_delete(event_id, fid):
    _event_or_404(event_id)
    return _map_delete(fid, event_id)


@app.route("/api/events/<int:event_id>/map/features/<int:fid>/restore", methods=["POST"])
def api_event_map_feature_restore(event_id, fid):
    _event_or_404(event_id)
    return _map_restore(fid, event_id)


@app.route("/api/events/<int:event_id>/map/deleted")
def api_event_map_deleted(event_id):
    _event_or_404(event_id)
    return jsonify({"features": [garden_map.feature_dict(r) | {"deleted_at": r["deleted_at"]}
                                 for r in garden_map.recently_deleted(event_id=event_id)]})


# ---------- NFC / RFID tags and QR labels (tags.py; readers: scripts/nevet_tags.py) ----------
app.jinja_env.filters["uid"] = tags.pretty_uid


def _tag_base():
    """Where tag links point: the address saved on the Tags page, NEVET_JOIN_URL, or this site."""
    base = farm_db.get_setting("tag_base_url") or os.environ.get("NEVET_JOIN_URL") or request.url_root
    return base.rstrip("/") + "/"


def _tag_url(tag):
    return _tag_base() + "t/" + tag["code"]


def _tag_manager(tag):
    if not (g.user["is_admin"] or tag["created_by"] == g.user["id"]):
        abort(403)


QUICK_ACTIONS = ("watering", "observation", "weeding", "fertilizing", "pruning", "pest_control", "feeding", "germination")


@app.route("/t/<code>")
def tag_landing(code):
    """What a phone opens when it touches a tag (or scans its QR label)."""
    tag = tags.by_code(code)
    if not tag:
        return render_template("message.html", title="Unknown tag",
                               message="This tag isn't linked to anything on Nevet (any more). An admin can set it up on the Tags page."), 404
    tags.record(tag, "phone", grower_id=g.user["id"], result="opened on a phone")
    ctx = {"tag": tag, "url": _tag_url(tag)}
    if tag["kind"] == "plant":
        asset = farm_db.get_asset(tag["target_id"])
        if not asset:
            abort(404)
        worm = asset["asset_type"] == "worm_bin"
        quick = [a for a in (["feeding", "observation", "watering"] if worm else ["watering", "observation", "weeding", "pruning"])]
        if tag["action"] and tag["action"] in QUICK_ACTIONS:
            quick = [tag["action"]] + [a for a in quick if a != tag["action"]]
        ctx.update(asset=asset, quick=[farm_db.ACTION_BY_ID[a] for a in quick[:4]],
                   more=[farm_db.ACTION_BY_ID[a] for a in ("harvest", "fertilizing", "pest_control", "transplant", "delivery") if not worm or a != "transplant"],
                   history=farm_db.recent_activity(asset_id=asset["id"], limit=3))
    elif tag["kind"] == "action":
        last = farm_db.get_conn().execute("""SELECT logs.timestamp, growers.name FROM logs LEFT JOIN growers ON growers.id = logs.grower_id
                                             WHERE logs.log_type = ? AND logs.asset_id IS NULL ORDER BY logs.timestamp DESC LIMIT 1""", (tag["action"],)).fetchone()
        ctx.update(last=last)
    elif tag["kind"] == "event":
        ev = events.get(tag["target_id"])
        if not ev:
            abort(404)
        ctx.update(ev=ev, checked=g.user["id"] in {c["grower_id"] for c in events.checkins(ev["id"])})
    return render_template("tag.html", **ctx)


@app.route("/t/<code>/log", methods=["POST"])
def tag_log(code):
    """One tap in the garden: log this plant's action, or the whole-farm action, as you."""
    tag = tags.by_code(code)
    if not tag or tag["kind"] not in ("plant", "action"):
        abort(404)
    action = tag["action"] if tag["kind"] == "action" else request.form.get("action")
    if action not in (tags.FARM_ACTIONS if tag["kind"] == "action" else QUICK_ACTIONS):
        abort(400)
    before = heroes.progress(**farm_db.grower_counts(g.user["id"]))
    notes = (request.form.get("notes") or "").strip()[:500] or None
    farm_db.add_log(action, tag["target_id"] if tag["kind"] == "plant" else None, notes=notes, grower_id=g.user["id"])
    tags.record(tag, "phone", grower_id=g.user["id"], result=f"{farm_db.ACTION_BY_ID[action]['label']} logged")
    logger.info("%s logged %s with the tag %s (%s)", g.user["name"], action, tag["code"], tag["name"])
    return _after_logging(before, action, 1 if tag["kind"] == "plant" else 0, whole=tag["kind"] == "action")


@app.route("/t/<code>/checkin", methods=["POST"])
def tag_checkin(code):
    tag = tags.by_code(code)
    if not tag or tag["kind"] != "event" or not events.get(tag["target_id"]):
        abort(404)
    events.check_in(tag["target_id"], g.user["id"], g.user["id"])
    logger.info("%s checked in to event #%s with a tag", g.user["name"], tag["target_id"])
    return redirect(url_for("event_page", event_id=tag["target_id"]) + "#day")


@app.route("/tags", methods=["GET", "POST"])
def tags_page():
    error = request.args.get("error")
    if request.method == "POST":
        if request.form.get("base_url") is not None:
            if not g.user["is_admin"]:
                abort(403)
            base = (request.form.get("base_url") or "").strip()
            if base and not re.match(r"^https?://[^\s/]+", base):
                error = "Tag links start with http:// or https://"
            else:
                farm_db.set_setting("tag_base_url", base.rstrip("/") + "/" if base else "")
                return redirect(url_for("tags_page"))
        else:
            kind = request.form.get("kind")
            target = request.form.get("target_id", type=int) or request.form.get("target_" + (kind or ""), type=int)
            action = request.form.get("action") or request.form.get("action_farm" if kind == "action" else "action_plant")
            tag, error = tags.create(kind, target, action, request.form.get("label"), request.form.get("uid"),
                                     request.form.get("tech"), g.user["id"])
            if tag:
                logger.info("%s made the tag %s (%s: %s)", g.user["name"], tag["code"], tag["kind"], tag["name"])
                back = request.form.get("back")
                return redirect(back if back and back.startswith("/") and not back.startswith("//") else url_for("tags_page", made=tag["id"]) + f"#tag-{tag['id']}")
    all_tags = tags.list_tags()
    for t in all_tags:
        t["url"] = _tag_url(t)
    return render_template("tags.html", tags=all_tags, error=error, base=_tag_base(), made=request.args.get("made", type=int),
                           kinds=tags.KINDS, techs=tags.TECHS, farm_actions=[farm_db.ACTION_BY_ID[a] for a in tags.FARM_ACTIONS],
                           plant_actions=[farm_db.ACTION_BY_ID[a] for a in tags.PLANT_ACTIONS],
                           assets=farm_db.plants(None, current=True), evs=[e for e in events.list_events() if e["phase"] != "past"],
                           growers=farm_db.list_growers(), unknown=tags.unknown_uids(), scans=tags.recent_scans(15),
                           prefill={k: request.args.get(k) for k in ("kind", "target", "uid")})


@app.route("/tags/<int:tag_id>/<what>", methods=["POST"])
def tag_change(tag_id, what):
    tag = tags.get(tag_id)
    if not tag:
        abort(404)
    _tag_manager(tag)
    err = None
    if what == "link":
        err = tags.link_uid(tag_id, request.form.get("uid"), request.form.get("tech"))
    elif what == "unlink":
        tags.unlink_uid(tag_id)
    elif what == "rename":
        tags.rename(tag_id, request.form.get("label"))
    elif what == "delete":
        tags.delete(tag_id)
        logger.info("%s deleted the tag %s", g.user["name"], tag["code"])
    else:
        abort(404)
    return redirect(url_for("tags_page", error=err) + ("" if what == "delete" else f"#tag-{tag_id}"))


@app.route("/tags/<int:tag_id>/flipper.<fmt>")
def tag_flipper_file(tag_id, fmt):
    """The tag as a Flipper Zero file: .nfc (NTAG215 with the link) or .rfid (EM4100 fob)."""
    tag = tags.get(tag_id)
    if not tag or fmt not in ("nfc", "rfid"):
        abort(404)
    if fmt == "rfid" and not tag["uid"]:
        _tag_manager(tag)
        tags.link_uid(tag_id, tags.em4100_id(tag), "em4100")       # the fob you write will be recognised by the reader
        tag = tags.get(tag_id)
    body = tags.flipper_nfc(tag, _tag_url(tag)) if fmt == "nfc" else tags.flipper_rfid(tag)
    return app.response_class(body, mimetype="text/plain",
                              headers={"Content-Disposition": f'attachment; filename="{tags.file_name(tag, fmt)}"'})


@app.route("/tags/print")
def tags_print():
    """A sheet of labels: each tag's QR code, name and code (cut out, laminate, stick next to the NFC sticker)."""
    ids = {int(x) for x in request.args.getlist("id") if x.isdigit()}
    chosen = [t for t in tags.list_tags() if not ids or t["id"] in ids]
    for t in chosen:
        t["url"] = _tag_url(t)
        t["svg"] = qr.svg(qr.encode(t["url"]), quiet=2, scale=4, title="QR code for " + t["name"])
    return render_template("tags_print.html", tags=chosen)


def _reader_allowed():
    """Readers post from the Pi itself (nevet tags reader), or anywhere with WEBAPP_API_KEY."""
    if netaccess._loopback(request.remote_addr):         # the Pi itself (after LocalProxyFix: never a Funnel visitor)
        return True
    key = os.environ.get("WEBAPP_API_KEY", "changeme-api-key")
    sent = request.headers.get("X-API-Key", "")
    return bool(sent) and key != "changeme-api-key" and hmac.compare_digest(sent, key)


@app.route("/api/tags/scan", methods=["POST"])
def api_tag_scan():
    if not _reader_allowed():
        return jsonify({"error": "readers post from the Pi itself, or with the X-API-Key header"}), 401
    data = request.get_json(silent=True) or {}
    res = tags.reader_scan(data.get("uid"), (data.get("tech") or "")[:20] or None, (data.get("reader") or "reader")[:40],
                           (data.get("via") or "reader")[:20], check=bool(data.get("check")))
    logger.info("Tag reader %s: %s", data.get("reader") or "reader", res.get("text"))
    return jsonify(res), 200 if res.get("ok") else 400


# ---------- the farm: every hero together (tap the brain on the dashboard) ----------
FARM_MAX_HEROES = 20          # the party floor has room for 19 dancers and the DJ
# what grows in the farm's empty bed spots and the planting field
FARM_MAX_PLANTS = 80          # plants drawn on the farm (each one is 2 meshes)
FARM_FILL_SPECIES = ("tomato", "cherry_tomato", "bell_pepper", "lettuce", "basil", "mint", "carrot", "strawberry",
                     "sunflower", "corn", "zucchini", "pumpkin", "green_beans", "parsley", "chard", "radish", "spinach",
                     "apple", "lemon", "olive", "fig", "bees", "compost_worms")


# the farm's setting (chosen on the farm page; the same for everyone on this Nevet)
FARM_WORLDS = ("classic", "desert", "seaside", "forest", "snow", "jungle", "savanna", "island", "city")
FARM_ACTS = ("harvest", "water", "plant", "animals", "play", "campfire", "party")


def farm_world():
    """?world=desert previews a setting; otherwise the one chosen for this Nevet."""
    w = request.args.get("world")
    if w not in FARM_WORLDS:
        w = farm_db.get_setting("farm_world") or "classic"
    return w if w in FARM_WORLDS else "classic"


@app.route("/farm/world", methods=["POST"])
def farm_world_set():
    w = request.form.get("world")
    if w not in FARM_WORLDS:
        abort(400)
    farm_db.set_setting("farm_world", w)
    app.logger.info("%s set the farm to %s", g.user["name"], w)
    act = request.form.get("act")
    return redirect(url_for("farm_page", act=act if act in FARM_ACTS else None))


@app.route("/farm")
def farm_page():
    rows = farm_db.list_growers()
    POWERS = games.all_powers()
    # players who log in come first, most recently active first; the current player always joins
    rows = sorted(rows, key=lambda r: r["last_login"] or "", reverse=True)            # most recent first...
    rows = sorted(rows, key=lambda r: (r["id"] != g.user["id"], not r["password_hash"]))  # ...within each group (stable)
    playing = set(games.participants())              # heroes in the current matches always come along
    keep = [r for r in rows if r["id"] in playing]
    rows = keep + [r for r in rows if r["id"] not in playing] if len(rows) > FARM_MAX_HEROES else rows
    party = [hero_view(r) for r in rows[:FARM_MAX_HEROES]]
    current = sorted(farm_db.plants(current=True), key=lambda a: a["last_action"] or a["created_at"] or "", reverse=True)
    growing = [plant_view(a) for a in current[:FARM_MAX_PLANTS]]          # the most recently tended ones
    numbers = farm_db.farm_numbers()
    data = {
        "heroes": [{"id": h["id"], "name": h["name"], "level": h["progress"]["level"], "appearance": h["appearance"],
                    "powers": (POWERS.get(h["id"]) or {}).get("powers")} for h in party],
        "gamesUrl": url_for("api_games_now"),
        "more": max(0, len(rows) - FARM_MAX_HEROES),
        "plants": [{"id": p["id"], "name": p["name"], "type": p["type"], "species": p["species"], "stage": p["model_stage"],
                    "dry": numbers["assets"].get(p["id"], {}).get("dry", 0),
                    "fed": numbers["assets"].get(p["id"], {}).get("fed", 0)} for p in growing],
        # the party's music engine (TB-303 + TR-909) from kg13-acid-space, when it's downloaded
        "acidEngine": url_for("extra_file", name="acid", filepath="engine/acid-engine.js") if extras.available("acid", "engine/acid-engine.js") else None,
        "map": garden_map.farm_layout(),          # the garden map in metres (None: nothing drawn yet)
        "week": numbers["week"],                  # for the chalkboard
        "monthFeedings": numbers["month_feedings"],
        "plantCatalog": plants.subset({p["species"] for p in growing} | set(FARM_FILL_SPECIES)),
        "catalog": heroes.catalog(),
        "gardenName": "Nevet Farm",
        "tv": request.args.get("tv") == "1",          # the live channel view (no buttons, runs by itself)
        "lastLog": (lambda c: (c.execute("SELECT COALESCE(MAX(id), 0) FROM logs").fetchone()[0], c.close())[0])(farm_db.get_conn()),
        "start": request.args.get("act") if request.args.get("act") in FARM_ACTS else None,
        "world": farm_world(),                    # the land around the farm (see FARM_WORLDS)
        "community": invites.community(),         # how far the farm has bloomed with its people (invites.py)
        "event": (lambda e: {"id": e["id"], "title": e["title"], "emoji": e["kind_info"]["emoji"], "act": e["farm_act"] or e["kind_info"]["act"]}
                  if e else None)(next(iter(events.happening()), None)),
    }
    return render_template("farm.html", data=data)


@app.route("/healthz")
def healthz():
    """Unauthenticated liveness check used by the watchdog. Touches the
    database so a stuck DB counts as unhealthy too."""
    try:
        farm_db.get_conn().close()
    except Exception as e:  # pragma: no cover
        app.logger.error("healthz: database check failed: %s", e)
        return "db error", 500
    return "ok", 200


def _stop(signum, frame):
    """systemd stops the service with SIGTERM: save traffic counts first."""
    traffic_counter.flush()
    raise SystemExit(0)


def _ipv6_works():
    """Can we listen on IPv6? (Not on every system; checked on a spare port.)"""
    import socket
    try:
        s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        try:
            s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
            s.bind(("::", 0))
        finally:
            s.close()
        return True
    except (OSError, AttributeError):
        return False


if __name__ == "__main__":
    import signal
    signal.signal(signal.SIGTERM, _stop)
    # waitress is a production-grade server (multi-threaded, doesn't hang
    # on slow clients the way Flask's built-in dev server can). Falls back
    # to the dev server if waitress isn't installed yet.
    try:
        from waitress import serve
        # IPv6 too when available: some WiFi networks give the Pi only an
        # IPv6 address, and the site should still answer there.
        listen = "0.0.0.0:8000 [::]:8000" if _ipv6_works() else "0.0.0.0:8000"
        app.logger.info("Starting web app with waitress on :8000 (%s)", "IPv4 + IPv6" if "[::]" in listen else "IPv4")
        serve(app, listen=listen, threads=6, channel_timeout=60)
    except ImportError:
        app.logger.warning("waitress not installed - using Flask dev server")
        app.run(host="0.0.0.0", port=8000, threaded=True)
