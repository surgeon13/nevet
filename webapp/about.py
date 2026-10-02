"""Facts for the dashboard's About popup (tap the brain): this garden's
numbers, which version is running, and what's new in the latest update."""
import re
import socket
import subprocess
from pathlib import Path

import farm_db

REPO_DIR = Path(__file__).resolve().parent.parent
CHANGELOG = REPO_DIR / "CHANGELOG.md"
_cache = {}


def _git(*args):
    try:
        out = subprocess.run(["git", "-C", str(REPO_DIR), *args], capture_output=True, text=True, timeout=3)
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _head_key():
    """Changes whenever the checked-out commit changes (cheap: no git call)."""
    head = REPO_DIR / ".git" / "HEAD"
    try:
        ref = head.read_text().strip()
        target = REPO_DIR / ".git" / ref[5:] if ref.startswith("ref: ") else head
        return f"{ref}:{target.stat().st_mtime if target.exists() else ''}"
    except OSError:
        return None


def version():
    key = _head_key()
    if _cache.get("version_key") != key or "version" not in _cache:
        commit, _, date = _git("log", "-1", "--format=%h|%cs").partition("|")
        url = _git("config", "--get", "remote.origin.url")
        m = re.match(r"(?:https://|git@)github\.com[/:]([^/]+/[^/]+?)(?:\.git)?$", url)
        _cache.update(version_key=key, version={
            "commit": commit or "unknown", "date": date,
            "repo": f"https://github.com/{m.group(1)}" if m else "",
        })
    return _cache["version"]


def _plain(text):
    return re.sub(r"\*\*|`", "", " ".join(text.split()))


def whats_new(limit=6):
    """Title and bullet points of the newest CHANGELOG entry."""
    try:
        mtime = CHANGELOG.stat().st_mtime
    except OSError:
        return None
    if _cache.get("news_mtime") != mtime:
        title, bullets, current = None, [], None
        for line in CHANGELOG.read_text(encoding="utf-8").splitlines():
            if line.startswith("## "):
                if title:
                    break
                title = line[3:].strip()
            elif title and line.startswith("- "):
                current = line[2:]
                bullets.append(current)
            elif title and current is not None and line.startswith("  ") and line.strip():
                bullets[-1] += " " + line.strip()
            elif not line.strip():
                current = None
        _cache.update(news_mtime=mtime, news={"title": title or "", "items": [_plain(b) for b in bullets]})
    news = _cache["news"]
    return {"title": news["title"], "items": news["items"][:limit], "more": max(0, len(news["items"]) - limit)}


def garden_numbers():
    conn = farm_db.get_conn()
    one = lambda sql: conn.execute(sql).fetchone()[0]
    numbers = {
        "heroes": one("SELECT COUNT(*) FROM growers WHERE deleted_at IS NULL"),
        "growing": one(f"SELECT COUNT(*) FROM assets WHERE {farm_db.ACTIVE_STAGES_SQL}"),
        "actions": one("SELECT COUNT(*) FROM logs"),
        "harvests": one("SELECT COUNT(*) FROM logs WHERE log_type = 'harvest'"),
        "mapped": one("SELECT COUNT(*) FROM map_features WHERE deleted_at IS NULL"),
        "photos": one("SELECT COUNT(*) FROM captures WHERE kind = 'photo'"),
        "since": one("SELECT MIN(t) FROM (SELECT MIN(joined_at) AS t FROM growers UNION ALL SELECT MIN(timestamp) FROM logs)"),
    }
    conn.close()
    return numbers


def info():
    return {"version": version(), "news": whats_new(), "numbers": garden_numbers(), "node": socket.gethostname()}
