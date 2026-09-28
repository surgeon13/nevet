"""Accounts and login helpers.

Players are growers (heroes) with a password. Passwords are stored as
salted hashes (werkzeug), never in plain text. Logged-in state lives in
Flask's signed session cookie, so the signing key must be secret: if
.env still has a placeholder, a random key is generated once and kept
next to the database.
"""
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from werkzeug.security import check_password_hash, generate_password_hash

PASSWORD_MIN, PASSWORD_MAX = 6, 128
PLACEHOLDER_SECRETS = {"", "nevet-secret-change-me", "change-this-too-please"}

# Wrong-password protection: this many failures from one address within
# the window blocks further tries until the window has passed.
MAX_FAILURES = 8
FAILURE_WINDOW = 5 * 60


def load_secret_key(data_dir):
    env = os.environ.get("WEBAPP_SECRET", "").strip()
    if env not in PLACEHOLDER_SECRETS:
        return env
    path = Path(data_dir) / ".flask_secret"
    try:
        key = path.read_text().strip()
        if len(key) >= 32:
            return key
    except OSError:
        pass
    key = secrets.token_hex(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key)
    return key


def hash_password(password):
    return generate_password_hash(password)


def check_password(stored_hash, password):
    if not stored_hash or not password:
        return False
    try:
        return check_password_hash(stored_hash, password)
    except (ValueError, TypeError):
        return False


def validate_password(password, confirm=None):
    """Returns an error message, or None if the password is fine."""
    if len(password or "") < PASSWORD_MIN:
        return f"Passwords need at least {PASSWORD_MIN} characters."
    if len(password) > PASSWORD_MAX:
        return f"Passwords can be at most {PASSWORD_MAX} characters."
    if confirm is not None and password != confirm:
        return "The two passwords don't match."
    return None


def open_signup():
    """Anyone reaching the site can sign up (like joining a game) unless
    WEBAPP_OPEN_SIGNUP=false; then only logged-in players can add accounts."""
    return os.environ.get("WEBAPP_OPEN_SIGNUP", "true").strip().lower() not in ("0", "false", "no", "off")


class LoginLimiter:
    def __init__(self):
        self._fails = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, q, now):
        while q and now - q[0] > FAILURE_WINDOW:
            q.popleft()

    def blocked(self, key):
        now = time.monotonic()
        with self._lock:
            q = self._fails[key]
            self._prune(q, now)
            return len(q) >= MAX_FAILURES

    def fail(self, key):
        with self._lock:
            self._fails[key].append(time.monotonic())

    def reset(self, key):
        with self._lock:
            self._fails.pop(key, None)


limiter = LoginLimiter()


def csrf_token(session):
    token = session.get("_csrf")
    if not token:
        token = secrets.token_urlsafe(24)
        session["_csrf"] = token
    return token


def csrf_ok(session, sent):
    expected = session.get("_csrf")
    return bool(sent and expected and secrets.compare_digest(sent, expected))
