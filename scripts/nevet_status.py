#!/usr/bin/env python3
"""nevet - one-screen, coloured status for the Nevet Pi (made for SSH).

  nevet            system status, last 24 h, garden summary, latest logs
  nevet -n 10      show the latest 10 garden actions / system events
  nevet -w         live view, refreshes every 5 s (Ctrl+C to stop)
  nevet -w 2       live view, refreshes every 2 s
  nevet --no-color plain text (colours are also off when piped)
  nevet --color | less -R   keep colours when paging

Installed as the `nevet` command by install.sh; also runnable as
python3 ~/nevet/scripts/nevet_status.py
"""
import argparse
import ipaddress
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
HOME = Path.home()
BASE = Path(os.environ.get("CAMERA_BASE_DIR", str(HOME / "camera_captures")))
LOGS = BASE / "logs"
FARM_DB = Path(os.environ.get("FARM_DB", str(HOME / "webapp" / "farm.db")))
UPDATE_STATUS = BASE / ".update" / "status.json"

sys.path.insert(0, str(REPO / "webapp"))
try:
    from farm_db import ACTION_BY_ID          # action names/verbs, same as the web app
except Exception:                             # pragma: no cover - keep working if the app changes
    ACTION_BY_ID = {}

UTF8 = (sys.stdout.encoding or "").lower().replace("-", "") == "utf8"
DOT, BAR, SEP, ARROW, TIMES = ("●", "█", "·", "→", "×") if UTF8 else ("*", "#", "-", "->", "x")


# ---------------------------------------------------------------- colours
class C:
    on = True
    codes = {"reset": "0", "bold": "1", "dim": "2", "red": "31", "green": "32", "yellow": "33",
             "blue": "34", "magenta": "35", "cyan": "36", "grey": "90", "bgreen": "92", "byellow": "93",
             "bred": "91", "title": "1;30;42"}

    @classmethod
    def wrap(cls, text, *styles):
        if not cls.on or not styles:
            return text
        return "\033[" + ";".join(cls.codes[s] for s in styles) + "m" + text + "\033[0m"


LEVEL_STYLE = {"ok": ("bgreen",), "info": ("cyan",), "warn": ("byellow",), "bad": ("bred",), "off": ("grey",)}
ANSI = re.compile(r"\033\[[0-9;]*m")


def vlen(s):
    return len(ANSI.sub("", s))


def fit(s, width):
    """Cut a coloured string to `width` visible characters."""
    if vlen(s) <= width:
        return s
    out, n, i = [], 0, 0
    while i < len(s) and n < width - 1:
        m = ANSI.match(s, i)
        if m:
            out.append(m.group()); i = m.end(); continue
        out.append(s[i]); n += 1; i += 1
    return "".join(out) + ("…" if UTF8 else "~") + ("\033[0m" if C.on else "")


# ---------------------------------------------------------------- helpers
def run(cmd, timeout=4):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def ago(t, now=None):
    if not t:
        return "never"
    s = int(((now or datetime.now()) - t).total_seconds())
    if s < 0:
        return "just now"
    if s < 60:
        return "just now"
    if s < 3600:
        return f"{s // 60} min ago"
    if s < 86400:
        return f"{s // 3600} h {s % 3600 // 60} min ago" if s < 4 * 3600 else f"{s // 3600} h ago"
    return f"{s // 86400} days ago" if s >= 2 * 86400 else "yesterday"


def until(t):
    s = int((t - datetime.now()).total_seconds())
    if s <= 60:
        return "in <1 min"
    return f"in {s // 60} min" if s < 3600 else f"in {s // 3600} h"


def short_time(t):
    if t.date() == date.today():
        return t.strftime("%H:%M")
    if (date.today() - t.date()).days < 7:
        return t.strftime("%a %H:%M")
    return t.strftime("%d %b")


def tail_lines(path, max_bytes=250_000):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - max_bytes))
            data = f.read().decode("utf-8", "replace")
    except OSError:
        return []
    lines = data.splitlines()
    return lines[1:] if size > max_bytes else lines


TS = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:,\d+)?\s+(.*)$")


def parsed(path):
    out = []
    for line in tail_lines(path):
        m = TS.match(line)
        if m:
            try:
                out.append((datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S"), m.group(2)))
            except ValueError:
                pass
    return out


def unit_info(unit):
    raw = run(["systemctl", "show", unit, "--timestamp=unix",
               "-p", "LoadState", "-p", "ActiveState", "-p", "NextElapseUSecRealtime"])
    if raw is None:
        return None
    info = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
    nxt = info.get("NextElapseUSecRealtime", "")
    info["next"] = datetime.fromtimestamp(float(nxt[1:])) if nxt.startswith("@") and nxt[1:].replace(".", "").isdigit() else None
    return info


# ---------------------------------------------------------------- data
class Status:
    def __init__(self):
        self.issues = []     # (level, fix hint or None)
        self.rows = []       # (level, label, value)

    def row(self, level, label, value, hint=None):
        self.rows.append((level, label, value))
        if level in ("warn", "bad"):
            self.issues.append((level, hint))


def collect_system(logs):
    st = Status()
    now = datetime.now()

    # web app
    active = run(["systemctl", "is-active", "nevet-webapp"])
    try:
        healthy = urllib.request.urlopen("http://127.0.0.1:8000/healthz", timeout=3).read().strip() == b"ok"
    except Exception:
        healthy = False
    starts = [(t, m) for t, m in logs["webapp"] if "Starting web app" in m or "waitress not installed" in m]
    dev = bool(starts) and "waitress not installed" in starts[-1][1]
    if healthy:
        st.row("warn" if dev else "ok", "Web app", "running" + (" (dev server)" if dev else ""),
               "sudo apt install -y python3-waitress")
    elif active == "active":
        st.row("bad", "Web app", "running but not answering", "sudo systemctl restart nevet-webapp")
    else:
        st.row("bad", "Web app", "stopped" if active else "not answering", "sudo systemctl restart nevet-webapp")

    # timelapse: last saved photo
    photos = [t for t, m in logs["capture"] if re.match(r"Photo #\d+: saved", m)]
    last_photo = photos[-1] if photos else None
    tl = unit_info("nevet-timelapse.timer")
    age = (now - last_photo).total_seconds() / 60 if last_photo else None
    if tl and tl.get("LoadState") == "not-found":
        st.row("bad", "Timelapse", "timer not installed", "cd ~/nevet && sudo ./install.sh 5 15")
    elif tl and tl.get("ActiveState") != "active":
        st.row("bad", "Timelapse", "timer stopped", "sudo systemctl start nevet-timelapse.timer")
    else:
        level = "ok" if age is not None and age < 20 else "warn" if age is not None and age < 90 else "bad"
        nxt = f", next {until(tl['next'])}" if tl and tl.get("next") else ""
        when = f"last {ago(last_photo)}" if last_photo else "no photos yet"
        st.row(level, "Timelapse", f"{when}{nxt}", "tail ~/camera_captures/logs/capture.log")

    # watchdog: last check
    checks = [(t, m) for t, m in logs["watchdog"] if m.startswith(("OK", "WARN", "FAIL"))]
    if checks:
        t, m = checks[-1]
        word = "OK" if m.startswith("OK") else m.split()[0]
        st.row("ok" if word == "OK" else "warn" if word == "WARN" else "bad", "Watchdog", f"{word} {ago(t)}",
               "tail ~/camera_captures/logs/watchdog.log")
    else:
        st.row("warn", "Watchdog", "no checks logged yet", "cd ~/nevet && sudo ./install.sh 5 15")

    # auto-update
    up = unit_info("nevet-update.timer")
    try:
        us = json.loads(UPDATE_STATUS.read_text())
    except (OSError, ValueError):
        us = None
    if up and up.get("LoadState") == "not-found":
        st.row("off", "Updates", "not set up (sudo ./install.sh 5 15)")
    elif us:
        checked = datetime.strptime(us["checked_at"], "%Y-%m-%d %H:%M:%S") if us.get("checked_at") else None
        label = {"up_to_date": "up to date", "updated": "updated", "offline": "offline",
                 "blocked": "blocked", "skipped": "skipped a version", "rolled_back": "rolled back",
                 "error": "error"}.get(us.get("status"), us.get("status", "?"))
        level = "ok" if us.get("status") in ("up_to_date", "updated") else "warn" if us.get("status") in ("offline", "skipped") else "bad"
        st.row(level, "Updates", f"{label} {SEP} {ago(checked)}", us.get("message"))
    else:
        st.row("off", "Updates", "no check yet")

    # camera
    cam = os.environ.get("CAMERA_DEVICE", "/dev/video0")
    st.row("ok" if os.path.exists(cam) else "bad", "Camera", "connected" if os.path.exists(cam) else f"not found ({cam})",
           "Check the camera's USB cable (lsusb)")

    # WiFi
    wifi = run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"])
    line = next((l for l in (wifi or "").splitlines() if l.startswith("yes:")), None)
    if line:
        ssid, sig = line.split(":")[1], line.split(":")[-1]
        sig_n = int(sig) if sig.isdigit() else 0
        st.row("ok" if sig_n >= 55 else "warn" if sig_n >= 35 else "bad", "WiFi", f"{ssid} {SEP} {sig}%",
               "Weak WiFi: move Pi nearer the router")
    elif wifi is not None:
        st.row("bad", "WiFi", "not connected", "The watchdog reconnects on its own")

    # power + temperature
    thr = run(["vcgencmd", "get_throttled"])
    temp = None
    try:
        temp = int(Path("/sys/class/thermal/thermal_zone0/temp").read_text()) / 1000
    except (OSError, ValueError):
        pass
    tstr = f" {SEP} {temp:.0f}°C" if temp is not None else ""
    if thr and "=" in thr:
        v = int(thr.split("=")[1], 16)
        if v & 0x1:
            st.row("bad", "Power", "UNDER-VOLTAGE now" + tstr, "Use a 5V 2.5A power supply")
        elif v & 0x10000:
            st.row("warn", "Power", "under-voltage since boot" + tstr, "Use a 5V 2.5A power supply")
        else:
            st.row("warn" if temp and temp >= 75 else "ok", "Power", "OK" + tstr, "Hot: give the Pi some air")
    elif temp is not None:
        st.row("warn" if temp >= 75 else "ok", "Temp", f"{temp:.0f}°C", "Hot: give the Pi some air")

    # disk
    try:
        du = shutil.disk_usage(HOME)
        pct = 100 * du.used / du.total
        st.row("ok" if pct < 80 else "warn" if pct < 90 else "bad", "Disk",
               f"{pct:.0f}% used {SEP} {du.free / 2**30:.1f} GB free", "Disk filling up: move old photos off the Pi")
    except OSError:
        pass
    return st


def addresses():
    out = []
    for a in (run(["hostname", "-I"]) or "").split():
        try:
            ip = ipaddress.ip_address(a)
        except ValueError:
            continue
        if ip.version == 4:
            out.append((a, "Tailscale" if ip in ipaddress.ip_network("100.64.0.0/10") else "WiFi/LAN"))
    return out


# System events: routine lines (WiFi OK, photo saved, up to date) collapse
# into their latest occurrence + a count, everything else is listed.
def classify(src, msg):
    """-> (kind, level, text) or None to skip."""
    if src == "watchdog":
        if msg.startswith("OK  online"):
            sig = re.search(r"signal=(\S+)", msg)
            return "wifi_ok", "ok", f"WiFi OK {SEP} {sig.group(1)} signal" if sig else "WiFi OK"
        if msg.startswith("OK"):
            return None, "ok", msg[3:].strip()
        if "no internet" in msg:
            return None, "warn", "Internet down (WiFi still OK)"
        if msg.startswith("FAIL WiFi link down"):
            return None, "bad", "WiFi link down"
        if msg.startswith("FAIL web app"):
            return None, "bad", "Web app not answering"
        if "restarting nevet-webapp" in msg:
            return None, "warn", "Watchdog restarted the web app"
        if "camera" in msg and "missing" in msg:
            return None, "bad", "Camera missing"
        if "power save was ON" in msg or msg.startswith("  [dry-run]") or msg.startswith("     still down"):
            return None
        if msg.startswith("  reconnect"):
            return None, "info", "WiFi " + msg.strip()
        return None, ("bad" if "FAIL" in msg else "warn" if "WARN" in msg else "info"), msg.strip()
    if src == "capture":
        m = re.match(r"Photo #(\d+): saved \S+ \((.+)\)", msg)
        if m:
            return "photo", "ok", f"Photo #{m.group(1)} saved ({m.group(2)})"
        m = re.match(r"Video #(\d+): saved \S+ \((.+)\)", msg)
        if m:
            return None, "ok", f"Video #{m.group(1)} saved ({m.group(2)})"
        if msg.startswith(("Capturing photo", "Recording video", "Photo #")) and "FAIL" not in msg and "overlay" not in msg and "corrupt" not in msg:
            return None
        if "FAIL" in msg:
            return None, "bad", msg.split(" - ")[0].replace(": FAILED", " failed")
        return None, "warn", msg
    if src == "update":
        if msg.startswith("  "):
            return None
        if msg.startswith("Up to date"):
            return "uptodate", "ok", msg
        if msg.startswith("Updated"):
            return None, "info", msg.replace("->", ARROW).rstrip(":")
        if msg.startswith("Offline"):
            return "offline", "warn", "Update check: GitHub unreachable"
        if msg.startswith("No web app changes"):
            return None
        return None, ("ok" if msg.startswith("OK") else "bad" if msg.startswith("FAIL") else "warn"), msg
    if src == "webapp":
        level, _, text = msg.partition(" ")
        if text.startswith("Login: "):
            return None, "info", text[7:].split(" from ")[0] + " logged in"
        if text.startswith("Failed login for"):
            who = re.search(r"'(.*?)'", text)
            return None, "warn", f"Wrong password for {who.group(1) if who else '?'}"
        if "Starting web app" in text:
            return None, "ok", "Web app started"
        if "waitress not installed" in text:
            return None, "warn", "Web app started (dev server)"
        if re.search(r" logged \w+ x\d+", text) or text.startswith("Stats logged"):
            return None                        # garden actions are listed in their own section
        return None, {"ERROR": "bad", "WARNING": "warn"}.get(level, "info"), text
    return None


def system_events(logs, n):
    since = datetime.now() - timedelta(hours=24)
    routine, events = {}, []
    for src, lines in logs.items():
        for t, msg in lines:
            c = classify(src, msg)
            if not c:
                continue
            kind, level, text = c
            if kind:
                prev = routine.get(kind)
                count = (prev[3] if prev else 0) + (1 if t >= since else 0)
                routine[kind] = (t, level, text, count)
            else:
                events.append((t, level, text, None))
    events += list(routine.values())
    events.sort(key=lambda e: e[0], reverse=True)
    return events[:n]


def last_24h(logs):
    since = datetime.now() - timedelta(hours=24)
    recent = {k: [m for t, m in v if t >= since] for k, v in logs.items()}
    return [
        ("Photos", sum(1 for m in recent["capture"] if re.match(r"Photo #\d+: saved", m))),
        ("WiFi drops", sum(1 for m in recent["watchdog"] if m.startswith("FAIL WiFi link down"))),
        ("App restarts", sum(1 for m in recent["watchdog"] if "restarting nevet-webapp" in m)
         + sum(1 for m in recent["webapp"] if "Starting web app" in m or "waitress not installed" in m)),
        ("Updates", sum(1 for m in recent["update"] if m.startswith("Updated"))),
    ]


def garden(n):
    if not FARM_DB.exists():
        return None
    try:
        con = sqlite3.connect(f"file:{FARM_DB}?mode=ro", uri=True, timeout=3)
        con.row_factory = sqlite3.Row
        log_cols = {r[1] for r in con.execute("PRAGMA table_info(logs)")}
        grow_cols = {r[1] for r in con.execute("PRAGMA table_info(growers)")}
        who = "logs.grower_id" if "grower_id" in log_cols else "assets.grower_id"
        today = date.today().isoformat()
        week = (date.today() - timedelta(days=6)).isoformat()
        one = lambda sql, *a: con.execute(sql, a).fetchone()[0]
        g = {
            "total": one("SELECT COUNT(*) FROM logs"),
            "today": one("SELECT COUNT(*) FROM logs WHERE timestamp >= ?", today),
            "week": one("SELECT COUNT(*) FROM logs WHERE timestamp >= ?", week),
            "growing": one("SELECT COUNT(*) FROM assets WHERE life_stage IS NULL OR life_stage NOT IN ('harvested','archived')"),
            "players": one("SELECT COUNT(*) FROM growers WHERE password_hash IS NOT NULL") if "password_hash" in grow_cols
                       else one("SELECT COUNT(*) FROM growers"),
            "top": con.execute("SELECT log_type, COUNT(*) n FROM logs GROUP BY log_type ORDER BY n DESC LIMIT 5").fetchall(),
            "latest": con.execute(f"""
                SELECT logs.timestamp, logs.log_type, logs.recipient, assets.name AS asset, growers.name AS who
                FROM logs LEFT JOIN assets ON assets.id = logs.asset_id
                LEFT JOIN growers ON growers.id = {who}
                ORDER BY logs.timestamp DESC, logs.id DESC LIMIT ?""", (n,)).fetchall(),
        }
        con.close()
        return g
    except sqlite3.Error as e:
        return {"error": str(e)}


def git_version():
    return run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"]) or "?"


def uptime():
    try:
        s = int(float(Path("/proc/uptime").read_text().split()[0]))
    except (OSError, ValueError):
        return "?"
    d, h, m = s // 86400, s % 86400 // 3600, s % 3600 // 60
    return f"{d}d {h}h" if d else f"{h}h {m}m" if h else f"{m}m"


# ---------------------------------------------------------------- render
def render(n):
    W = max(36, min(shutil.get_terminal_size((60, 24)).columns, 66))
    logs = {k: parsed(LOGS / f"{k}.log") for k in ("watchdog", "capture", "update", "webapp")}
    st = collect_system(logs)
    out = []
    P = out.append

    def heading(text):
        P("")
        P(C.wrap(text.upper(), "bold", "green") + " " + C.wrap("─" * max(0, W - len(text) - 1) if UTF8 else "-" * max(0, W - len(text) - 1), "grey"))

    bad = sum(1 for lv, _ in st.issues if lv == "bad")
    warn = sum(1 for lv, _ in st.issues if lv == "warn")
    if bad:
        overall = C.wrap(f"{DOT} {bad} problem{'s' if bad > 1 else ''}", "bred", "bold")
        if warn:
            overall += C.wrap(f" {SEP} {warn} warning{'s' if warn > 1 else ''}", "byellow")
    elif warn:
        overall = C.wrap(f"{DOT} {warn} warning{'s' if warn > 1 else ''}", "byellow", "bold")
    else:
        overall = C.wrap(f"{DOT} all good", "bgreen", "bold")
    P(C.wrap(" NEVET ", "title") + "  " + overall)
    P(C.wrap(f"{datetime.now():%a %d %b %H:%M} {SEP} up {uptime()} {SEP} v{git_version()}", "grey"))

    heading("System")
    for level, label, value in st.rows:
        P(fit(f" {C.wrap(DOT, *LEVEL_STYLE[level])} {label:<10} {value}", W))
    addrs = addresses()
    if addrs:
        P(C.wrap(" Open in a browser:", "grey"))
        for ip, kind in addrs:
            P(fit(f"   {C.wrap(f'http://{ip}:8000', 'cyan', 'bold')} {C.wrap(kind, 'grey')}", W))
    hints = [(lv, h) for lv, h in st.issues if h]
    if hints:
        P(C.wrap(" To fix:", "grey"))
        for level, hint in dict.fromkeys(hints):
            P(fit(C.wrap(f" {ARROW} ", *LEVEL_STYLE[level]) + hint, W))

    heading("Last 24 hours")
    stats = last_24h(logs)
    cols = 2 if W >= 44 else 1
    cell = W // cols
    for i in range(0, len(stats), cols):
        line = ""
        for label, value in stats[i:i + cols]:
            bad_stat = value and label in ("WiFi drops", "App restarts") and value > 2
            val = C.wrap(str(value), "byellow" if bad_stat else "bold")
            line += f" {label:<12}{' ' * max(1, cell - 14 - len(str(value)))}{val}"
        P(line)

    g = garden(n)
    heading("Garden")
    if g is None:
        P(C.wrap(" No garden database yet.", "grey"))
    elif "error" in g:
        P(C.wrap(f" Couldn't read the garden database: {g['error']}", "bred"))
    else:
        for label, value, unit in (("Actions", g["total"], f"total {SEP} {g['today']} today"),
                                   ("This week", g["week"], "actions"),
                                   ("Growing", g["growing"], "plants & bins"),
                                   ("Players", g["players"], "")):
            P(fit(f" {C.wrap(f'{label:<10}', 'grey')} {C.wrap(str(value), 'bold')} {unit}".rstrip(), W))
        if g["top"]:
            top_n = g["top"][0]["n"]
            bar_w = max(4, W - 22)
            for r in g["top"]:
                label = ACTION_BY_ID.get(r["log_type"], {}).get("label", r["log_type"].replace("_", " ").capitalize())
                bar = BAR * max(1, round(bar_w * r["n"] / top_n))
                P(fit(f" {label:<14}{r['n']:>4} {C.wrap(bar, 'green')}", W))

        heading(f"Latest {n} garden actions")
        if not g["latest"]:
            P(C.wrap(" Nothing logged yet.", "grey"))
        for r in g["latest"]:
            try:
                t = datetime.fromisoformat(r["timestamp"])
            except (TypeError, ValueError):
                continue
            verb = ACTION_BY_ID.get(r["log_type"], {}).get("verb", r["log_type"].replace("_", " "))
            what = r["asset"] or "the whole garden"
            to = f" to {r['recipient']}" if r["recipient"] else ""
            P(fit(f" {C.wrap(short_time(t), 'grey')} {C.wrap(r['who'] or 'Someone', 'bold', 'cyan')} {verb} {what}{to}", W))

    heading(f"Latest {n} system events")
    ev = system_events(logs, n)
    if not ev:
        P(C.wrap(" No log entries yet.", "grey"))
    for t, level, text, count in ev:
        extra = C.wrap(f" {TIMES}{count}/24h", "grey") if count and count > 1 else ""
        P(fit(f" {C.wrap(short_time(t), 'grey')} {C.wrap(DOT, *LEVEL_STYLE[level])} {text}{extra}", W))
    P("")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(prog="nevet", description="Nevet status for the terminal.")
    ap.add_argument("command", nargs="?", default="status", choices=["status"], help=argparse.SUPPRESS)
    ap.add_argument("-n", type=int, default=5, metavar="N", help="how many latest actions/events (default 5)")
    ap.add_argument("-w", "--watch", nargs="?", const=5, type=float, metavar="SEC", help="refresh every SEC seconds")
    ap.add_argument("--no-color", action="store_true", help="plain text")
    ap.add_argument("--color", action="store_true", help="colours even when piped (e.g. into less -R)")
    a = ap.parse_args()
    C.on = a.color or (sys.stdout.isatty() and not a.no_color and "NO_COLOR" not in os.environ)
    if os.geteuid() == 0 and "FARM_DB" not in os.environ:
        print("Tip: run `nevet` as your normal user (not sudo) so it finds your logs and garden data.\n")
    n = max(1, min(a.n, 50))
    if not a.watch:
        print(render(n))
        return
    try:
        while True:
            screen = render(n)
            sys.stdout.write("\033[H\033[2J" + screen + C.wrap(f"\n refreshing every {a.watch:g}s {SEP} Ctrl+C to stop", "grey"))
            sys.stdout.flush()
            time.sleep(max(1, a.watch))
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main()
