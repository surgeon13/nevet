"""Companion repos served next to Nevet (config/extra_repos.conf).

scripts/update_extras.sh keeps a copy of each listed repo in
$NEVET_EXTRAS_DIR/<name> (default ~/nevet-extras). The web app serves those
files at /extras/<name>/..., but only for names listed in the config, never
the .git folder, and only to logged-in players (like every other page).
"""
import json
import os
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
CONF = Path(os.environ.get("NEVET_EXTRAS_CONF", str(REPO_DIR / "config" / "extra_repos.conf")))
EXTRAS_DIR = Path(os.environ.get("NEVET_EXTRAS_DIR", str(Path.home() / "nevet-extras")))
STATUS = Path(os.environ.get("CAMERA_BASE_DIR", str(Path.home() / "camera_captures"))) / ".update" / "extras.json"


def configured():
    """{name: {"url":..., "branch":...}} from the config file."""
    out = {}
    try:
        lines = CONF.read_text(encoding="utf-8").splitlines()
    except OSError:
        return out
    for line in lines:
        parts = line.split()
        if len(parts) < 2 or parts[0].startswith("#"):
            continue
        name = parts[0]
        if name.replace("-", "").replace("_", "").isalnum() and name == name.lower():
            out[name] = {"url": parts[1], "branch": parts[2] if len(parts) > 2 else "main"}
    return out


def path_for(name, rel=""):
    """Absolute path of a file inside an extra, or None if it isn't allowed."""
    if name not in configured():
        return None
    root = (EXTRAS_DIR / name).resolve()
    full = (root / rel).resolve() if rel else root
    if full != root and not str(full).startswith(str(root) + os.sep):
        return None
    if ".git" in full.relative_to(root).parts:
        return None
    return full


def available(name, entry="index.html"):
    p = path_for(name, entry)
    return bool(p and p.is_file())


def status():
    try:
        return json.loads(STATUS.read_text())
    except (OSError, ValueError):
        return {}
