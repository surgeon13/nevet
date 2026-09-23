#!/usr/bin/env python3
"""Camera gallery + game stats web app for the Insta360 Pi camera project."""
import os
import sqlite3
import functools
from datetime import datetime
from pathlib import Path
from flask import Flask, render_template, request, redirect, url_for, session, send_from_directory, jsonify, abort
from logging_config import setup_logging, LOGS_DIR

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
    return render_template("console.html")


@app.route("/gallery")
def gallery():
    return render_template("index.html", assets=scan_assets())


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


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
