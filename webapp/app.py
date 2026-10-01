#!/usr/bin/env python3
"""Camera gallery + game stats web app for the Insta360 Pi camera project."""
import os
import re
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse
from flask import Flask, render_template, request, redirect, url_for, session, send_from_directory, jsonify, abort, g
from logging_config import setup_logging, LOGS_DIR
import activity_views as av
import auth
import farm_db
import heroes
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
logger = setup_logging(app)
av.register(app)
traffic_counter = traffic.TrafficCounter(farm_db.get_conn).install(app)

# Pages anyone can open without logging in. Everything else needs an account.
PUBLIC_ENDPOINTS = {"login", "register", "healthz", "static", "api_add_stats"}
CSRF_EXEMPT = {"api_add_stats"}                        # uses its own API key

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
    farm_db.touch_login(row["id"])


@app.before_request
def load_user_and_guard():
    g.user = None
    uid = session.get("user_id")
    if uid:
        row = farm_db.get_grower(uid)
        if row and row["password_hash"]:
            g.user = {"id": row["id"], "name": row["name"], "is_admin": bool(row["is_admin"])}
        else:
            session.clear()                       # account removed or password cleared
    if g.user is None and request.endpoint not in PUBLIC_ENDPOINTS:
        if request.path.startswith("/api/"):
            return jsonify({"error": "login required"}), 401
        return redirect(url_for("login", next=request.full_path if request.query_string else request.path))
    if request.method == "POST" and request.endpoint not in CSRF_EXEMPT:
        if not auth.csrf_ok(session, request.form.get("_csrf")):
            logger.warning("Rejected form without valid token: %s from %s", request.path, request.remote_addr)
            return render_template("message.html", title="Form expired",
                                   message="That form was open too long or came from somewhere else. "
                                           "Go back, refresh the page and try again."), 400


@app.context_processor
def inject_user():
    return {"current_user": g.get("user"), "csrf_token": lambda: auth.csrf_token(session)}


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
    return render_template(
        "console.html",
        summary=farm_db.dashboard_summary(),
        recent=recent_photos(3),
        everyone=av.activity_bundle(None),
        mine=av.activity_bundle(g.user["id"]),
        players=farm_db.player_activity(),
        banner=banner,
    )


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
    return render_template("growers.html", heroes=roster, catalog=heroes.catalog())


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
    if not row:
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


@app.route("/growers/<int:grower_id>")
def grower_page(grower_id):
    grower = farm_db.get_grower(grower_id)
    if not grower:
        abort(404)
    hero = hero_view(grower, farm_db.grower_counts(grower_id))
    bundle = av.activity_bundle(grower_id)
    return render_template(
        "grower_detail.html", grower=grower, hero=hero, b=bundle, is_me=g.user["id"] == grower_id,
        catalog=heroes.catalog(), can_edit=can_edit_hero(grower_id),
        has_account=bool(grower["password_hash"]), created=request.args.get("created") == "1",
        pw_set=request.args.get("pw_set") == "1", pw_error=request.args.get("pw_error"),
    )


@app.route("/growers/<int:grower_id>/assets/new")
def asset_new(grower_id):
    return redirect(url_for("plant_new"))


@app.route("/assets")
def assets_page():
    assets = [dict(a) for a in farm_db.list_assets()]
    garden = [
        {"id": a["id"], "name": a["name"], "type": a["asset_type"],
         "stage": a["life_stage"] or "", "url": url_for("asset_page", asset_id=a["id"])}
        for a in assets
    ]
    return render_template("assets.html", assets=assets, garden=garden)


@app.route("/assets/<int:asset_id>")
def asset_page(asset_id):
    asset = farm_db.get_asset(asset_id)
    if not asset:
        abort(404)
    return render_template("asset_detail.html", asset=asset,
                           history=farm_db.recent_activity(asset_id=asset_id, limit=100))


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
        selected = {request.args.get("asset", type=int)} - {None}
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
                aid = farm_db.add_asset("plant", name, g.user["id"], variety=variety, life_stage=stage)
                action = "seeding" if how == "seeding" else "planting"
                farm_db.add_log(action, aid, notes=request.form.get("notes") or None,
                                grower_id=g.user["id"], new_stage=stage)
            logger.info("%s added %s %s", g.user["name"], kind, name)
            return _after_logging(before, action, 1, plant=name)
    return render_template("plant_new.html", error=error, form=form)


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
    all_growers = conn.execute("SELECT id, name FROM growers ORDER BY name COLLATE NOCASE").fetchall()
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
    if request.method == "POST":
        name, error = heroes.validate_name(request.form.get("name"))
        password = request.form.get("password", "")
        if not error:
            error = auth.validate_password(password, request.form.get("confirm", ""))
        if not error:
            existing = farm_db.find_grower_by_name(name)
            if existing and existing["password_hash"]:
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
        if not error:
            logger.info("New account %s%s%s", name, " (claimed existing hero)" if claimed else "",
                        " [admin]" if first_account else "")
            if g.user:          # a player adding someone else: stay logged in as yourself
                return redirect(url_for("grower_page", grower_id=gid, created=1))
            log_in(farm_db.get_grower(gid))
            return redirect(url_for("grower_customize", grower_id=gid, welcome=1))
    return render_template("register.html", error=error, name=name, first_account=first_account)


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/account", methods=["GET", "POST"])
def account():
    message, error = None, None
    if request.method == "POST":
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
    return render_template("account.html", message=message, error=error)


@app.route("/stats")
def stats():
    conn = get_db()
    latest = conn.execute("SELECT * FROM stats_log ORDER BY id DESC LIMIT 1").fetchone()
    history = conn.execute("SELECT * FROM stats_log ORDER BY id DESC LIMIT 50").fetchall()
    conn.close()
    return render_template("stats.html", latest=latest, history=history)


@app.route("/logs")
def logs_page():
    return render_template("logs.html")


@app.route("/api/logs")
def api_logs():
    return jsonify({name: tail_lines(path) for name, path in LOG_FILES.items()})


@app.route("/api/stats", methods=["POST"])
def api_add_stats():
    if request.headers.get("X-API-Key") != os.environ.get("WEBAPP_API_KEY", "changeme-api-key"):
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
