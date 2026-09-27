#!/usr/bin/env python3
"""Camera gallery + game stats web app for the Insta360 Pi camera project."""
import os
import json
import sqlite3
import functools
from datetime import datetime
from pathlib import Path
from flask import Flask, render_template, request, redirect, url_for, session, send_from_directory, jsonify, abort
from logging_config import setup_logging, LOGS_DIR
import farm_db
import heroes

BASE_DIR = Path(os.environ.get("CAMERA_BASE_DIR", str(Path.home() / "camera_captures")))
PHOTO_DIR = BASE_DIR / "photos"
VIDEO_DIR = BASE_DIR / "videos"
DB_PATH = Path(os.environ.get("STATS_DB", str(Path.home() / "webapp" / "game_stats.db")))
LOGIN_PASSWORD = os.environ.get("WEBAPP_PASSWORD", "changeme")
SECRET_KEY = os.environ.get("WEBAPP_SECRET", "nevet-secret-change-me")

app = Flask(__name__)
app.secret_key = SECRET_KEY
logger = setup_logging(app)

LOG_FILES = {
    "watchdog": LOGS_DIR / "watchdog.log",
    "capture": LOGS_DIR / "capture.log",
    "webapp": LOGS_DIR / "webapp.log",
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


def login_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


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
    return render_template(
        "console.html",
        summary=farm_db.dashboard_summary(),
        recent=recent_photos(9),
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
    }


@app.context_processor
def inject_playing_hero():
    return {"playing_hero": session.get("hero_name"), "playing_hero_id": session.get("hero_id")}


@app.route("/growers")
def growers_page():
    roster = [hero_view(r) for r in farm_db.list_growers()]
    return render_template("growers.html", heroes=roster, catalog=heroes.catalog())


def render_hero_form(mode, hero_id=None, name="", hero_class=None, appearance=None, error=None):
    cat = heroes.catalog()
    if appearance is None:
        hero_class, appearance = heroes.default_appearance(name or "new hero", hero_class or cat["classes"][0]["id"])
    return render_template(
        "hero_form.html", mode=mode, hero_id=hero_id, name=name, error=error,
        hero_class=heroes.normalize_class(hero_class), appearance=appearance, catalog=cat,
    )


@app.route("/growers/new", methods=["GET", "POST"])
def grower_new():
    if request.method == "POST":
        name, error = heroes.validate_name(request.form.get("name"))
        hero_class = heroes.normalize_class(request.form.get("hero_class"))
        appearance = heroes.from_form(request.form, name, hero_class)
        if not error:
            try:
                gid = farm_db.create_hero(name, hero_class, json.dumps(appearance))
            except ValueError:
                error = f"The name “{name}” is already taken. Try another one."
            else:
                app.logger.info("New hero created: %s (%s)", name, hero_class)
                session["hero_id"], session["hero_name"] = gid, name
                return redirect(url_for("grower_page", grower_id=gid, new=1))
        return render_hero_form("create", name=name, hero_class=hero_class, appearance=appearance, error=error)
    return render_hero_form("create")


@app.route("/growers/<int:grower_id>/customize", methods=["GET", "POST"])
def grower_customize(grower_id):
    row = farm_db.get_grower(grower_id)
    if not row:
        abort(404)
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
                if session.get("hero_id") == grower_id:
                    session["hero_name"] = name
                return redirect(url_for("grower_page", grower_id=grower_id))
        return render_hero_form("edit", grower_id, name, hero_class, appearance, error)
    hero_class, appearance = heroes.hero_for_row(row)
    return render_hero_form("edit", grower_id, row["name"], hero_class, appearance)


@app.route("/growers/<int:grower_id>/play", methods=["POST"])
def grower_play(grower_id):
    row = farm_db.get_grower(grower_id)
    if not row:
        abort(404)
    session["hero_id"], session["hero_name"] = row["id"], row["name"]
    return redirect(request.form.get("next") or url_for("grower_page", grower_id=grower_id))


@app.route("/growers/<int:grower_id>")
def grower_page(grower_id):
    grower, assets, logs = farm_db.grower_summary(grower_id)
    if not grower:
        abort(404)
    hero = hero_view(grower, farm_db.grower_counts(grower_id))
    return render_template(
        "grower_detail.html", grower=grower, hero=hero, assets=assets, logs=logs,
        catalog=heroes.catalog(), just_created=request.args.get("new") == "1",
    )


@app.route("/growers/<int:grower_id>/assets/new", methods=["GET", "POST"])
@login_required
def asset_new(grower_id):
    if request.method == "POST":
        asset_id = farm_db.add_asset(
            asset_type=request.form.get("asset_type", "plant"),
            name=request.form.get("name", "").strip(),
            grower_id=grower_id,
            variety=request.form.get("variety") or None,
            life_stage=request.form.get("life_stage") or None,
        )
        return redirect(url_for("asset_page", asset_id=asset_id))
    return render_template(
        "asset_form.html", grower_id=grower_id,
        asset_types=farm_db.ASSET_TYPES, stages=farm_db.PLANT_STAGES,
    )


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
    asset, logs, quantities = farm_db.asset_detail(asset_id)
    if not asset:
        abort(404)
    return render_template("asset_detail.html", asset=asset, logs=logs, quantities=quantities)


@app.route("/assets/<int:asset_id>/logs/new", methods=["GET", "POST"])
@login_required
def log_new(asset_id):
    if request.method == "POST":
        qty_value = request.form.get("qty_value")
        quantities = None
        if qty_value:
            quantities = [{
                "measure": request.form.get("qty_measure", "count"),
                "value": float(qty_value),
                "units": request.form.get("qty_units") or None,
                "label": request.form.get("qty_label") or None,
            }]
        farm_db.add_log(
            log_type=request.form.get("log_type"),
            asset_id=asset_id,
            notes=request.form.get("notes") or None,
            recipient=request.form.get("recipient") or None,
            location=request.form.get("location") or None,
            quantities=quantities,
        )
        return redirect(url_for("asset_page", asset_id=asset_id))
    return render_template("log_form.html", asset_id=asset_id, log_types=farm_db.LOG_TYPES)


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
    error = None
    if request.method == "POST":
        if request.form.get("password") == LOGIN_PASSWORD:
            session["logged_in"] = True
            logger.info("Successful login from %s", request.remote_addr)
            return redirect(request.args.get("next") or url_for("stats"))
        error = "Wrong password"
        logger.warning("Failed login attempt from %s", request.remote_addr)
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("hub"))


@app.route("/stats")
@login_required
def stats():
    conn = get_db()
    latest = conn.execute("SELECT * FROM stats_log ORDER BY id DESC LIMIT 1").fetchone()
    history = conn.execute("SELECT * FROM stats_log ORDER BY id DESC LIMIT 50").fetchall()
    conn.close()
    return render_template("stats.html", latest=latest, history=history)


@app.route("/logs")
@login_required
def logs_page():
    return render_template("logs.html")


@app.route("/api/logs")
@login_required
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


if __name__ == "__main__":
    # waitress is a production-grade server (multi-threaded, doesn't hang
    # on slow clients the way Flask's built-in dev server can). Falls back
    # to the dev server if waitress isn't installed yet.
    try:
        from waitress import serve
        app.logger.info("Starting web app with waitress on :8000")
        serve(app, host="0.0.0.0", port=8000, threads=6, channel_timeout=60)
    except ImportError:
        app.logger.warning("waitress not installed - using Flask dev server")
        app.run(host="0.0.0.0", port=8000, threaded=True)
