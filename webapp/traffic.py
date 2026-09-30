"""Web app data transfer accounting.

Counts requests and bytes (received from / sent to visitors) per day,
split by what was fetched (pages, photos & videos, static files such as
the 3D libraries, API) and how the visitor connected (home network or
Tailscale). The Pi talking to itself (watchdog / updater health checks)
isn't counted, since it never crosses the network.

Counts are kept in memory and written to farm.db every 30 seconds (and
on shutdown), so the SD card isn't written on every request. Sizes
include HTTP headers but not TCP/Wi-Fi overhead, so real radio traffic
is a little higher.
"""
import atexit
import ipaddress
import logging
import threading
import time
from collections import defaultdict
from datetime import date, timedelta

FLUSH_SECONDS = 30
TAILSCALE = ipaddress.ip_network("100.64.0.0/10")
log = logging.getLogger("nevet.traffic")

def classify_path(path):
    if path.startswith("/media/"):
        return "media"
    if path.startswith("/static/"):
        return "static"
    if path.startswith("/api/") or path == "/healthz":
        return "api"
    return "page"


def classify_client(addr):
    """-> 'lan' / 'tailscale' / 'internet', or None for the Pi itself."""
    try:
        ip = ipaddress.ip_address((addr or "").split("%")[0])
    except ValueError:
        return "lan"
    if ip.is_loopback:
        return None
    if ip.version == 4 and ip in TAILSCALE:
        return "tailscale"
    return "lan" if ip.is_private or ip.is_link_local else "internet"


def header_bytes(headers):
    return sum(len(k) + len(v) + 4 for k, v in headers.items())


class TrafficCounter:
    def __init__(self, get_conn):
        self._get_conn = get_conn
        self._buf = defaultdict(lambda: [0, 0, 0])      # (day, kind, via) -> [requests, in, out]
        self._lock = threading.Lock()
        self._thread = None
        self._summary_day = date.today()
        self.log = log

    # -- recording (called for every response) ---------------------------
    def record(self, remote_addr, path, request, response):
        via = classify_client(remote_addr)
        if via is None:
            return
        try:
            body_in = request.content_length or 0
            bytes_in = body_in + header_bytes(request.headers) + len(request.method) + len(request.full_path) + 12
            length = response.content_length
            if length is None and not response.is_streamed:
                length = len(response.get_data())
            bytes_out = (length or 0) + header_bytes(response.headers) + 17
        except Exception:                         # accounting must never break a page
            return
        key = (date.today().isoformat(), classify_path(path), via)
        with self._lock:
            row = self._buf[key]
            row[0] += 1
            row[1] += bytes_in
            row[2] += bytes_out
        self._ensure_thread()

    def _ensure_thread(self):
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._loop, name="traffic-flush", daemon=True)
            self._thread.start()

    def _loop(self):
        while True:
            time.sleep(FLUSH_SECONDS)
            self.flush()

    # -- writing ------------------------------------------------------------
    def flush(self):
        with self._lock:
            rows, self._buf = dict(self._buf), defaultdict(lambda: [0, 0, 0])
        if rows:
            try:
                conn = self._get_conn()
                conn.executemany(
                    "INSERT INTO web_traffic (day, kind, via, requests, bytes_in, bytes_out) VALUES (?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(day, kind, via) DO UPDATE SET requests = requests + excluded.requests, "
                    "bytes_in = bytes_in + excluded.bytes_in, bytes_out = bytes_out + excluded.bytes_out",
                    [(d, k, v, r[0], r[1], r[2]) for (d, k, v), r in rows.items()])
                conn.commit()
                conn.close()
            except Exception as e:
                self.log.warning("Couldn't save traffic counts: %s", e)
                with self._lock:                  # keep them for the next try
                    for key, r in rows.items():
                        row = self._buf[key]
                        row[0] += r[0]; row[1] += r[1]; row[2] += r[2]
                return
        self._daily_summary()

    def _daily_summary(self):
        """Once per day, log yesterday's totals to webapp.log."""
        today = date.today()
        if today == self._summary_day:
            return
        day, self._summary_day = self._summary_day, today
        try:
            t = totals(self._get_conn, day, day)
        except Exception:
            return
        if t["requests"]:
            self.log.info("Traffic %s: %s requests, %s sent, %s received (home network %s, Tailscale %s)",
                     day.isoformat(), f"{t['requests']:,}", human(t["bytes_out"]), human(t["bytes_in"]),
                     human(t["by_via"].get("lan", 0)), human(t["by_via"].get("tailscale", 0)))

    def install(self, app):
        """Hook into a Flask app: count every response, flush on exit."""
        from flask import request
        self.log = app.logger

        @app.after_request
        def _count(response):
            self.record(request.remote_addr, request.path, request, response)
            return response

        atexit.register(self.flush)
        return self


def totals(get_conn, first, last):
    conn = get_conn()
    rows = conn.execute("SELECT kind, via, SUM(requests) r, SUM(bytes_in) i, SUM(bytes_out) o FROM web_traffic "
                        "WHERE day BETWEEN ? AND ? GROUP BY kind, via", (first.isoformat(), last.isoformat())).fetchall()
    conn.close()
    out = {"requests": 0, "bytes_in": 0, "bytes_out": 0, "by_kind": defaultdict(int), "by_via": defaultdict(int)}
    for kind, via, r, i, o in rows:
        out["requests"] += r or 0
        out["bytes_in"] += i or 0
        out["bytes_out"] += o or 0
        out["by_kind"][kind] += o or 0
        out["by_via"][via] += (o or 0) + (i or 0)
    return out


def last_days(get_conn, days=7):
    return totals(get_conn, date.today() - timedelta(days=days - 1), date.today())


def human(n):
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
