#!/usr/bin/env python3
"""nevet - one-screen, coloured status for the Nevet Pi (made for SSH).

  nevet            system status, last 24 h, garden summary, latest logs
  nevet -n 10      show the latest 10 garden actions / system events
  nevet -w         live view, refreshes every 5 s (Ctrl+C to stop)
  nevet -w 2       live view, refreshes every 2 s
  nevet --no-color plain text (colours are also off when piped)
  nevet --color | less -R   keep colours when paging
  nevet net        network test: each WiFi adapter's signal, speed and
                   delay (built-in vs USB antenna), saved for comparison
  nevet net --quick   same without the 5 MB download
  nevet ts         Tailscale check: why Nevet can(not) be opened from
                   outside the home network, and exactly what to do

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
import textwrap
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
NETWORK_LOG = LOGS / "network.log"
SYS_NET = Path(os.environ.get("NEVET_SYS_NET", "/sys/class/net"))
PROC_NET_DEV = Path(os.environ.get("NEVET_PROC_NET_DEV", "/proc/net/dev"))
SPEED_URL = "https://speed.cloudflare.com/__down?bytes=5000000"

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
def run(cmd, timeout=4, any_rc=False):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 or any_rc else None
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
    if s >= 2 * 86400:
        return f"in {s // 86400} days"
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
               "-p", "LoadState", "-p", "ActiveState", "-p", "UnitFileState", "-p", "NextElapseUSecRealtime"])
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
        self.ts = None       # tailscale_info(), reused by the address list

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

    # camera + timelapse (both optional: the Pi works fine without a camera)
    cam = os.environ.get("CAMERA_DEVICE", "/dev/video0")
    cam_ok = os.path.exists(cam)
    photos = [t for t, m in logs["capture"] if re.match(r"Photo #\d+: saved", m)]
    last_photo = photos[-1] if photos else None
    tl = unit_info("nevet-timelapse.timer")
    age = (now - last_photo).total_seconds() / 60 if last_photo else None
    tl_missing = bool(tl) and tl.get("LoadState") == "not-found"
    tl_off = bool(tl) and tl.get("UnitFileState") in ("disabled", "masked")
    if tl_off or (tl_missing and not cam_ok):
        st.row("off", "Timelapse", "off")
    elif tl_missing:
        st.row("bad", "Timelapse", "timer not installed", "cd ~/nevet && sudo ./install.sh 5 15")
    elif tl and tl.get("ActiveState") != "active":
        st.row("bad", "Timelapse", "timer stopped", "sudo systemctl start nevet-timelapse.timer")
    elif not cam_ok:
        st.row("off", "Timelapse", "paused: no camera")
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

    # camera (optional)
    st.row("ok" if cam_ok else "off", "Camera", "connected" if cam_ok else "not connected")

    # network: the adapter that carries the internet
    adapters = wifi_adapters()
    used = next((a for a in adapters if a["default"]), None)
    dev = default_dev()
    if not used:                                  # connected but no route at all
        used = next((a for a in adapters if a.get("signal") is not None), None)
    if used and used.get("signal") is not None:
        sig = used["signal"]
        level = "ok" if sig >= 55 else "warn" if sig >= 35 else "bad"
        st.row(level, "WiFi", f"{used['ssid']} {SEP} {sig}%" + (f" {SEP} USB antenna" if used["usb"] else ""),
               "Weak WiFi: move the Pi nearer the router or add an extender (nevet net)")
        if not has_ipv4_route():
            st.row("warn", "IPv4", "none: no updates, no LAN address",
                   "WiFi gave no IPv4 address (weak signal?). The watchdog retries; now: sudo nmcli device reconnect "
                   + used["name"])
    elif dev and not dev.startswith("wl"):
        st.row("ok", "Network", f"{dev} (cable)" if dev.startswith(("eth", "en")) else dev)
    elif adapters or run(["nmcli", "-t", "device"]) is not None:
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

    # Tailscale: remote access from outside the home network
    ts = st.ts = tailscale_info()
    if ts is None:
        st.row("off", "Tailscale", "not installed (nevet ts)")
    else:
        lvl, text, hint = tailscale_summary(ts)
        st.row(lvl, "Tailscale", text, hint)

    # disk
    try:
        du = shutil.disk_usage(HOME)
        pct = 100 * du.used / du.total
        st.row("ok" if pct < 80 else "warn" if pct < 90 else "bad", "Disk",
               f"{pct:.0f}% used {SEP} {du.free / 2**30:.1f} GB free", "Disk filling up: move old photos off the Pi")
    except OSError:
        pass
    return st


def split_terse(line):
    """Split an `nmcli -t` line on ':' (nmcli escapes ':' inside values as '\\:')."""
    out, cur, esc = [], "", False
    for ch in line:
        if esc:
            cur += ch; esc = False
        elif ch == "\\":
            esc = True
        elif ch == ":":
            out.append(cur); cur = ""
        else:
            cur += ch
    out.append(cur)
    return out


def default_dev():
    """Adapter carrying the internet (IPv4 default route, else IPv6)."""
    for cmd in (["ip", "route", "show", "default"], ["ip", "-6", "route", "show", "default"]):
        m = re.search(r"\bdev (\S+)", run(cmd) or "")
        if m:
            return m.group(1)
    return None


def has_ipv4_route():
    return bool(re.search(r"\bdev \S+", run(["ip", "route", "show", "default"]) or ""))


def gateway(iface=None):
    line = run(["ip", "route", "show", "default"] + (["dev", iface] if iface else [])) or ""
    m = re.search(r"\bvia (\S+)", line)
    return m.group(1) if m else (gateway() if iface else None)


def gateway6(iface):
    m = re.search(r"\bvia (\S+)", run(["ip", "-6", "route", "show", "default", "dev", iface]) or "")
    return m.group(1) if m else None


def wifi_adapters():
    """Every WiFi adapter: built-in (wlan0) and USB antennas, with their link."""
    names = sorted(p.name for p in SYS_NET.glob("wl*")) if SYS_NET.exists() else []
    if not names:
        return []
    default = default_dev()
    live = {}
    for line in (run(["nmcli", "-t", "-f", "DEVICE,ACTIVE,SSID,SIGNAL,CHAN,FREQ", "dev", "wifi"]) or "").splitlines():
        f = split_terse(line)
        if len(f) >= 6 and f[1] == "yes":
            live[f[0]] = f
    states = {}
    for line in (run(["nmcli", "-t", "-f", "DEVICE,STATE", "device"]) or "").splitlines():
        f = split_terse(line)
        if len(f) >= 2:
            states[f[0]] = f[1]
    out = []
    for n in names:
        dev_path = os.path.realpath(SYS_NET / n / "device")
        usb = "/usb" in dev_path
        driver = os.path.basename(os.path.realpath(SYS_NET / n / "device" / "driver")) if (SYS_NET / n / "device" / "driver").exists() else ""
        rate = re.search(r"tx bitrate:\s*([\d.]+)", run(["iw", "dev", n, "link"]) or "")
        ip = re.search(r"inet (\d+\.\d+\.\d+\.\d+)", run(["ip", "-o", "-4", "addr", "show", "dev", n]) or "")
        f = live.get(n)
        out.append({
            "name": n, "usb": usb, "kind": "USB antenna" if usb else "built-in", "driver": driver,
            "state": states.get(n, "connected" if f else "?"),
            "ssid": f[2] if f else None, "signal": int(f[3]) if f and f[3].isdigit() else None,
            "chan": f[4] if f else None, "freq": f[5] if f else None,
            "rate": float(rate.group(1)) if rate else None, "ip": ip.group(1) if ip else None,
            "default": n == default,
        })
    return out


def wifi_networks():
    """Networks in range, strongest first: [{ssid, signal, chan, in_use, saved (profile name)}]."""
    saved = {}
    for line in (run(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"]) or "").splitlines():
        f = split_terse(line)
        if len(f) >= 2 and f[1] == "802-11-wireless":
            ssid = run(["nmcli", "-g", "802-11-wireless.ssid", "connection", "show", f[0]])
            if ssid:
                saved[split_terse(ssid)[0]] = f[0]
    nets = {}
    for line in (run(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,CHAN", "dev", "wifi", "list"], timeout=12) or "").splitlines():
        f = split_terse(line)
        if len(f) < 4 or not f[1]:
            continue
        sig = int(f[2]) if f[2].isdigit() else 0
        n = nets.setdefault(f[1], {"ssid": f[1], "signal": 0, "chan": f[3], "in_use": False, "saved": saved.get(f[1])})
        if sig > n["signal"]:
            n["signal"], n["chan"] = sig, f[3]
        n["in_use"] = n["in_use"] or f[0].strip() == "*"
    return sorted(nets.values(), key=lambda n: -n["signal"])


def better_saved_network(nets, margin=15):
    """A saved network clearly stronger than the one in use -> (net, current) or None."""
    cur = next((n for n in nets if n["in_use"]), None)
    if not cur:
        return None
    best = next((n for n in nets if n["saved"] and not n["in_use"]), None)
    return (best, cur) if best and best["signal"] >= cur["signal"] + margin else None


def shq(v):
    return v if re.fullmatch(r"[\w.@%+=:,/-]+", v) else "'" + v.replace("'", "'\\''") + "'"


def net_bytes():
    """{iface: (rx_bytes, tx_bytes)} since boot."""
    out = {}
    try:
        for line in PROC_NET_DEV.read_text().splitlines()[2:]:
            name, _, rest = line.partition(":")
            vals = rest.split()
            if len(vals) >= 9:
                out[name.strip()] = (int(vals[0]), int(vals[8]))
    except (OSError, ValueError):
        pass
    return out


def human_bytes(n):
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024


NETLOG = re.compile(r"(\w+)=(\S+)")


def speed_tests():
    """Past `nevet net` results, oldest first: [(time, {key: value})]."""
    return [(t, dict(NETLOG.findall(m))) for t, m in parsed(NETWORK_LOG)]


def web_traffic():
    if not FARM_DB.exists():
        return None
    try:
        con = sqlite3.connect(f"file:{FARM_DB}?mode=ro", uri=True, timeout=3)
        if not con.execute("SELECT 1 FROM sqlite_master WHERE name = 'web_traffic'").fetchone():
            con.close()
            return None
        today = date.today()
        def span(first, last):
            r = con.execute("SELECT COALESCE(SUM(requests),0), COALESCE(SUM(bytes_in),0), COALESCE(SUM(bytes_out),0) "
                            "FROM web_traffic WHERE day BETWEEN ? AND ?", (first.isoformat(), last.isoformat())).fetchone()
            return {"requests": r[0], "in": r[1], "out": r[2]}
        week_start = (today - timedelta(days=6)).isoformat()
        out = {
            "today": span(today, today),
            "yesterday": span(today - timedelta(days=1), today - timedelta(days=1)),
            "week": span(today - timedelta(days=6), today),
            "kinds": con.execute("SELECT kind, SUM(bytes_out) FROM web_traffic WHERE day >= ? GROUP BY kind "
                                 "ORDER BY 2 DESC", (week_start,)).fetchall(),
            "vias": dict(con.execute("SELECT via, SUM(bytes_out + bytes_in) FROM web_traffic WHERE day >= ? "
                                     "GROUP BY via", (week_start,)).fetchall()),
        }
        con.close()
        return out
    except sqlite3.Error:
        return None


def iso_time(v):
    """Tailscale RFC 3339 time -> local naive datetime (None for 'never')."""
    if not v or v.startswith("0001-"):
        return None
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
    except (ValueError, OverflowError):
        return None


def tailscale_info():
    """None if Tailscale isn't installed, else what `tailscale status` knows."""
    if not shutil.which("tailscale"):
        return None
    info = {"service": run(["systemctl", "is-active", "tailscaled"], any_rc=True) or "?",
            "state": None, "peers": [], "ips": [], "health": []}
    raw = run(["tailscale", "status", "--json"], timeout=6, any_rc=True)
    try:
        j = json.loads(raw) if raw else None
    except ValueError:
        j = None
    if not isinstance(j, dict):
        return info
    me = j.get("Self") or {}
    users = {str(k): v for k, v in (j.get("User") or {}).items()}
    tailnet = j.get("CurrentTailnet") or {}
    info.update(
        state=j.get("BackendState"), auth_url=j.get("AuthURL") or "",
        version=(j.get("Version") or "").split("-")[0],
        ips=[ip for ip in (j.get("TailscaleIPs") or me.get("TailscaleIPs") or []) if "." in ip],
        name=(me.get("DNSName") or "").split(".")[0] or me.get("HostName") or "",
        dns=(me.get("DNSName") or "").rstrip("."),
        expiry=iso_time(me.get("KeyExpiry")), health=j.get("Health") or [],
        login=(users.get(str(me.get("UserID"))) or {}).get("LoginName", ""),
        magic=bool(tailnet.get("MagicDNSEnabled")), tailnet=tailnet.get("Name", ""),
    )
    for p in (j.get("Peer") or {}).values():
        info["peers"].append({
            "name": (p.get("DNSName") or "").split(".")[0] or p.get("HostName") or "?",
            "os": p.get("OS") or "", "online": bool(p.get("Online")),
            "seen": iso_time(p.get("LastSeen")), "direct": bool(p.get("CurAddr")),
            "relay": p.get("Relay") or "",
        })
    info["peers"].sort(key=lambda p: (not p["online"], p["name"]))
    return info


TS_ADMIN = "login.tailscale.com/admin/machines"


def tailscale_summary(ts):
    """-> (level, short text, fix hint) for the status screen."""
    if ts["service"] != "active":
        return "bad", "service not running", "sudo systemctl enable --now tailscaled"
    state = ts["state"]
    if state == "NeedsLogin":
        return "bad", "logged out", "sudo tailscale up  (open the link it prints)"
    if state == "NeedsMachineAuth":
        return "bad", "waiting for approval", f"Approve {ts.get('name') or 'the Pi'} at {TS_ADMIN}"
    if state == "Stopped":
        return "bad", "switched off", "sudo tailscale up"
    if state != "Running":
        return "warn", f"{state or 'not answering'}", "Details: nevet ts"
    exp = ts.get("expiry")
    if exp and exp <= datetime.now():
        return "bad", "login key expired", f"sudo tailscale up, then 'Disable key expiry' at {TS_ADMIN}"
    text = f"online {SEP} {ts['ips'][0] if ts['ips'] else '?'}"
    if exp and (exp - datetime.now()).days < 14:
        return "warn", text, f"Tailscale key expires {until(exp)}: see nevet ts"
    if not ts["peers"]:
        return "warn", text, "No phone/laptop on your Tailscale yet: nevet ts"
    return "ok", text, None


# USB WiFi dongles that are plugged in but have no driver never get a wlanN.
USB_WIFI = re.compile(r"wlan|802\.11|wi-?fi|wireless[- ](n|g|ac|ax|lan|adapter|network)|\bwna\d|archer\s*t\d|"
                      r"tl-wn|rtl8\d{3}|mt76\d\d|ar9271|rt5370|rt5372", re.I)


def driverless_usb_wifi(adapters):
    """[names] of USB WiFi devices that lsusb sees but Linux can't use."""
    if any(a["usb"] for a in adapters):
        return []
    out = []
    for line in (run(["lsusb"]) or "").splitlines():
        m = re.match(r"Bus \d+ Device \d+: ID [0-9a-f]{4}:[0-9a-f]{4}\s*(.*)", line)
        if m and USB_WIFI.search(m.group(1)) and not re.search(r"bluetooth|hub|receiver|keyboard|mouse", m.group(1), re.I):
            out.append(short_usb_name(m.group(1)))
    return out


def short_usb_name(desc):
    """'NetGear, Inc. WNA3100(v1) Wireless-N 300 [Broadcom BCM43231]' -> 'NetGear WNA3100(v1) (Broadcom BCM43231)'."""
    chip = re.search(r"\[(.+?)\]", desc)
    words = []
    for w in re.sub(r",? (Inc|Corp|Co|Ltd|Technology|Semiconductor)\b\.?,?", "", desc.split("[")[0]).split():
        words.append(w)
        if re.search(r"\d", w):
            break
    return " ".join(words) + (f" ({chip.group(1)})" if chip else "")


def addresses():
    """[(ip, label)] for every IPv4 address, labelled by adapter."""
    out = []
    for line in (run(["ip", "-o", "-4", "addr", "show"]) or "").splitlines():
        m = re.match(r"\d+:\s+(\S+)\s+inet (\d+\.\d+\.\d+\.\d+)", line)
        if not m or m.group(1) == "lo":
            continue
        dev, ip = m.group(1), m.group(2)
        if dev.startswith("tailscale") or ipaddress.ip_address(ip) in ipaddress.ip_network("100.64.0.0/10"):
            label = "Tailscale"
        elif dev.startswith("wl"):
            label = f"{dev} {'USB' if '/usb' in os.path.realpath(SYS_NET / dev / 'device') else 'built-in'}"
        else:
            label = dev
        out.append((ip, label))
    if not out:                                   # no `ip`? fall back to hostname -I
        for a in (run(["hostname", "-I"]) or "").split():
            try:
                if ipaddress.ip_address(a).version == 4:
                    out.append((a, "Tailscale" if ipaddress.ip_address(a) in ipaddress.ip_network("100.64.0.0/10") else "LAN"))
            except ValueError:
                pass
    return out


# System events: routine lines (WiFi OK, photo saved, up to date) collapse
# into their latest occurrence + a count, everything else is listed.
def classify(src, msg):
    """-> (kind, level, text) or None to skip."""
    if src == "watchdog":
        if msg.startswith("OK  online"):
            sig = re.search(r"signal=(\S+)", msg)
            via = re.search(r"via (\S+)", msg)
            text = "WiFi OK" + (f" {SEP} {sig.group(1)}" if sig else "") + (f" via {via.group(1)}" if via else "")
            if "IPv6 only" in msg:
                return "wifi_v6", "warn", text + " (no IPv4)"
            return "wifi_ok", "ok", text
        if msg.startswith("WARN no IPv4"):
            return None, "warn", "No IPv4 address: reconnecting"
        if msg.startswith("IPv4 address back"):
            return None, "ok", "IPv4 address back"
        if msg.startswith("Tailscale online"):
            return None, "ok", msg
        for key, level, text in (("logged out", "bad", "Tailscale logged out"),
                                 ("restarting it", "warn", "Tailscale service restarted"),
                                 ("tailscaled service", "bad", "Tailscale service down"),
                                 ("waits for approval", "bad", "Tailscale: approve the Pi"),
                                 ("switched off", "bad", "Tailscale switched off"),
                                 ("Tailscale state:", "warn", None)):
            if key in msg:
                return None, level, text or msg.split("WARN ", 1)[-1]
        if msg.startswith("Camera connected"):
            return None, "ok", "Camera connected"
        if msg.startswith("Camera disconnected"):
            return None, "info", "Camera disconnected"
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
        if msg.startswith("Camera not connected"):
            return None, "info", "No camera: photos paused"
        if msg.startswith("Camera connected again"):
            return None, "ok", "Camera back: photos resumed"
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
        m = re.match(r"Traffic (\d{4}-\d{2}-\d{2}): .*?, (.+?) sent", text)
        if m:
            day = datetime.strptime(m.group(1), "%Y-%m-%d")
            return None, "info", f"Web app sent {m.group(2)} on {day:%d %b}"
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


ANTENNA_CMD = "sudo ~/nevet/scripts/wifi_antenna.sh usb"


def antenna_tip(adapters):
    """A hint when a USB antenna is plugged in but isn't carrying the internet."""
    usb = next((a for a in adapters if a["usb"]), None)
    if not usb or usb["default"]:
        return None
    if usb["ip"]:
        return f"USB antenna {usb['name']} is only the backup. To use it first:"
    return f"USB antenna {usb['name']} isn't connected. To use it:"


def tip_lines(text, W, style="cyan", cmd=None):
    """'→ text' word-wrapped to the screen, then an optional command on its own line."""
    lines = textwrap.wrap(text, max(20, W - 3)) or [""]
    out = [C.wrap(f" {ARROW} ", style) + lines[0]] + ["   " + ln for ln in lines[1:]]
    if cmd:
        out.append("   " + C.wrap(cmd, "cyan", "bold"))
    return out


# ---------------------------------------------------------------- render
KIND_NAMES = {"media": "Photos & videos", "static": "3D & page files", "page": "Pages", "api": "API"}
VIA_NAMES = {"lan": "Home network", "tailscale": "Tailscale", "internet": "Internet"}


def lbl(text, width=10):
    """Grey row label padded to a fixed width (padding before colouring)."""
    return C.wrap(f"{text:<{width}}", "grey")


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
    ts = st.ts
    if ts and ts.get("state") == "Running" and ts.get("magic") and ts.get("name"):
        addrs.append((ts["name"], "Tailscale name"))
    if addrs:
        P(C.wrap(" Open in a browser:", "grey"))
        for ip, kind in addrs:
            P(fit(f"   {C.wrap(f'http://{ip}:8000', 'cyan', 'bold')} {C.wrap(kind, 'grey')}", W))
    hints = [(lv, h) for lv, h in st.issues if h]
    if hints:
        P(C.wrap(" To fix:", "grey"))
        for level, hint in dict.fromkeys(hints):
            out.extend(tip_lines(hint, W, LEVEL_STYLE[level][0]))

    # ---- network: which adapter, how good, last speed test, data moved
    heading("Network")
    adapters = wifi_adapters()
    for a in adapters:
        if a["signal"] is not None:
            level = ("ok" if a["signal"] >= 55 else "warn" if a["signal"] >= 35 else "bad") if a["default"] else "info"
            detail = f"{a['signal']}% signal" + (f" {SEP} " + C.wrap("in use", "bold") if a["default"] else f" {SEP} standby")
        else:
            level, detail = "off", ("not connected" if a["state"] in ("disconnected", "?") else a["state"])
        P(fit(f" {C.wrap(DOT, *LEVEL_STYLE[level])} {a['name']:<6}{a['kind']:<12}{detail}", W))
    if not adapters:
        P(C.wrap(" No WiFi adapters found.", "grey"))
    tip = antenna_tip(adapters)
    if tip:
        out.extend(tip_lines(tip, W, cmd=ANTENNA_CMD))
    for dongle in driverless_usb_wifi(adapters):
        out.extend(tip_lines(f"USB WiFi {dongle} has no Linux driver, so it can't be used. Unplug it.", W, "byellow"))
    last_ok = next((m for t, m in reversed(logs["watchdog"]) if m.startswith("OK  online")), "")
    router = re.search(r"router=([\d.]+)ms", last_ok)
    if router:
        P(fit(f" {lbl('Router')} {C.wrap(router.group(1), 'bold')} ms ping", W))
    tests = [(t, r) for t, r in speed_tests() if r.get("down", "-") != "-"]
    if tests:
        t, r = tests[-1]
        P(fit(f" {lbl('Download')} {C.wrap(r['down'], 'bold')} Mb/s"
              + C.wrap(f" {SEP} {r.get('iface', '?')} {SEP} {ago(t)}", "grey"), W))
    else:
        P(fit(f" {lbl('Download')} not tested yet: run {C.wrap('nevet net', 'cyan')}", W))
    counters = net_bytes()
    used = next((a["name"] for a in adapters if a["default"]), None) or default_dev()
    if used in counters:
        rx, tx = counters[used]
        P(fit(f" {lbl('Since boot')} {C.wrap(human_bytes(rx), 'bold')} in {SEP} "
              f"{C.wrap(human_bytes(tx), 'bold')} out {C.wrap(f'({used})', 'grey')}", W))

    # ---- web app traffic (counted by the web app itself)
    wt = web_traffic()
    heading("Web app traffic")
    if wt is None:
        P(C.wrap(" Nothing counted yet (starts after this update).", "grey"))
    else:
        for label, key in (("Today", "today"), ("Yesterday", "yesterday"), ("7 days", "week")):
            v = wt[key]
            P(fit(f" {lbl(label)} {C.wrap(human_bytes(v['out']), 'bold')} sent {SEP} "
                  f"{v['requests']:,} requests", W))
        wk = wt["week"]
        if wk["in"]:
            P(fit(f" {lbl('')} {C.wrap(human_bytes(wk['in']), 'bold')} received in 7 days", W))
        top = max((b for _, b in wt["kinds"]), default=0)
        for kind, b in wt["kinds"]:
            if not b:
                continue
            bar = BAR * max(1, round(max(4, W - 29) * b / top))
            P(fit(f" {KIND_NAMES.get(kind, kind):<16}{human_bytes(b):>9} {C.wrap(bar, 'green')}", W))
        vias = wt["vias"]
        if vias:
            parts = [f"{VIA_NAMES.get(k, k)} {C.wrap(human_bytes(v), 'bold')}"
                     for k, v in sorted(vias.items(), key=lambda kv: -kv[1])]
            P(fit(" " + f" {SEP} ".join(parts), W))

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
            P(fit(f" {lbl(label)} {C.wrap(str(value), 'bold')} {unit}".rstrip(), W))
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


# ---------------------------------------------------------------- nevet net
def ping_stats(target, iface, count=10):
    out = run(["ping", "-I", iface, "-c", str(count), "-i", "0.2", "-W", "2", target], timeout=count + 8) or ""
    loss = re.search(r"([\d.]+)% packet loss", out)
    rtt = re.search(r"= [\d.]+/([\d.]+)/([\d.]+)/", out)
    if not loss:
        return None
    return {"loss": float(loss.group(1)), "avg": float(rtt.group(1)) if rtt else None, "max": float(rtt.group(2)) if rtt else None}


def download_mbps(iface):
    out = run(["curl", "--interface", iface, "-s", "-o", "/dev/null", "-m", "40",
               "-w", "%{speed_download} %{size_download}", SPEED_URL], timeout=45)
    try:
        speed, size = (float(x) for x in out.split())
    except (AttributeError, ValueError):
        return None
    return round(speed * 8 / 1e6, 1) if size > 100_000 else None


def net_test(quick=False):
    W = max(36, min(shutil.get_terminal_size((60, 24)).columns, 66))
    P = print

    def heading(text):
        line = "─" if UTF8 else "-"
        P(""); P(C.wrap(text.upper(), "bold", "green") + " " + C.wrap(line * max(0, W - len(text) - 1), "grey"))

    P(C.wrap(" NEVET NET ", "title") + "  " + C.wrap("network test", "bold"))
    P(C.wrap(f"{datetime.now():%a %d %b %H:%M}", "grey"))
    adapters = wifi_adapters()
    heading("WiFi adapters")
    if not adapters:
        P(C.wrap(" No WiFi adapters found (is the USB antenna plugged in? try: lsusb)", "bred"))
    for a in adapters:
        on = a["signal"] is not None
        level = "ok" if on and a["default"] else "info" if on else "off"
        P(fit(f" {C.wrap(DOT, *LEVEL_STYLE[level])} {C.wrap(a['name'], 'bold')}  {a['kind']}"
              + (C.wrap(f" ({a['driver']})", "grey") if a["driver"] else "") + (C.wrap("  in use", "bgreen") if a["default"] else ""), W))
        if on:
            band = ""
            try:
                band = " 5 GHz" if int(re.sub(r"\D", "", a["freq"] or "0")) >= 5000 else " 2.4 GHz"
            except ValueError:
                pass
            P(fit(f"     {a['ssid']} {SEP} {a['signal']}%" + (f" {SEP} {a['rate']:g} Mb/s" if a["rate"] else "")
                  + (f" {SEP}{band} ch {a['chan']}" if a["chan"] else ""), W))
        else:
            P(fit(C.wrap(f"     {a['state']}", "grey"), W))

    for dongle in driverless_usb_wifi(adapters):
        for line in tip_lines(f"USB WiFi {dongle} has no Linux driver, so it can't be used. "
                              "Unplug it; use an extender or a Linux-supported USB adapter.", W, "byellow"):
            P(line)

    nets = wifi_networks()
    if nets:
        heading("WiFi networks in range")
        for n in nets[:6]:
            level = "ok" if n["in_use"] else "info" if n["saved"] else "off"
            tag = C.wrap("connected", "bgreen") if n["in_use"] else ("saved" if n["saved"] else "")
            chan = f"ch {n['chan']:<3}"
            P(fit(f" {C.wrap(DOT, *LEVEL_STYLE[level])} {n['ssid'][:18]:<18} {n['signal']:>3}% {C.wrap(chan, 'grey')} {tag}", W))
        better = better_saved_network(nets)
        if better:
            best, cur = better
            for line in tip_lines(f"{best['ssid']} is saved and stronger here ({best['signal']}% vs {cur['signal']}%). "
                                  "Switch to it:", W, cmd=f"sudo nmcli connection up {shq(best['saved'])}"):
                P(line)
            for line in tip_lines("and make the Pi prefer it from now on:", W,
                                  cmd=f"sudo nmcli connection modify {shq(best['saved'])} connection.autoconnect-priority 10"):
                P(line)
        cur = next((n for n in nets if n["in_use"]), None)
        if cur and cur["signal"] < 40 and not better:
            for line in tip_lines(f"Weak signal ({cur['signal']}%): move the Pi closer to the router, add a WiFi extender "
                                  "(best: Pi on the extender's Ethernet port), or use a supported USB antenna.", W, "byellow"):
                P(line)

    testable = [a for a in adapters if a["ip"] or a["signal"] is not None]
    if not testable:
        P(C.wrap("\n No connected adapter to test.", "bred"))
        return
    idle_usb = next((a for a in adapters if a["usb"] and not a["ip"]), None)
    if idle_usb:
        for line in tip_lines(f"{idle_usb['name']} (USB antenna) isn't connected, so it can't be tested. "
                              "Connect it, then test again:", W, cmd=ANTENNA_CMD):
            P(line)
    results = []
    for a in testable:
        heading(f"Testing {a['name']} ({a['kind']})")
        v4 = bool(a["ip"])
        gw = gateway(a["name"]) if v4 else gateway6(a["name"])
        r = {"iface": a["name"], "kind": "USB" if a["usb"] else "built-in", "ssid": a["ssid"] or "-",
             "signal": a["signal"], "rate": a["rate"]}
        if not v4:
            for line in tip_lines("No IPv4 address on this adapter (the WiFi didn't give one): testing over IPv6. "
                                  "GitHub updates and the home-network address need IPv4.", W, "byellow"):
                P(line)
        internet = "1.1.1.1" if v4 else "2606:4700:4700::1111"
        for label, target, key in (("Router", gw, "router"), ("Internet", internet, "internet")):
            sys.stdout.write(f" {label:<10}"); sys.stdout.flush()
            st = ping_stats(target, a["name"]) if target else None
            r[key] = st
            if st and st["avg"] is not None:
                lvl = "bgreen" if st["loss"] == 0 else "byellow" if st["loss"] < 10 else "bred"
                print(C.wrap(f"{st['avg']:.1f} ms", "bold") + f" avg {SEP} " + C.wrap(f"{st['loss']:g}% lost", lvl))
            else:
                print(C.wrap("no answer", "bred"))
        if quick:
            r["down"] = None
        else:
            sys.stdout.write(f" {'Download':<10}"); sys.stdout.flush()
            r["down"] = download_mbps(a["name"])
            print(C.wrap(f"{r['down']:g} Mb/s", "bold") + C.wrap(" (5 MB test)", "grey") if r["down"] else C.wrap("failed", "bred"))
        results.append(r)

    # save for comparison over time (e.g. before/after moving the antenna)
    LOGS.mkdir(parents=True, exist_ok=True)
    with open(NETWORK_LOG, "a") as f:
        for r in results:
            fmt = lambda st: f"{st['avg']:.1f}/{st['loss']:g}" if st and st["avg"] is not None else "-"
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} iface={r['iface']} kind={r['kind']} ssid={r['ssid'].replace(' ', '_')} "
                    f"signal={r['signal'] if r['signal'] is not None else '-'} rate={r['rate'] if r['rate'] else '-'} "
                    f"router={fmt(r['router'])} internet={fmt(r['internet'])} down={r['down'] if r['down'] else '-'}\n")

    if len(results) > 1 and all(r["down"] for r in results):
        best = max(results, key=lambda r: r["down"])
        other = min(results, key=lambda r: r["down"])
        heading("Verdict")
        factor = best["down"] / other["down"] if other["down"] else 0
        P(fit(f" {C.wrap(best['iface'], 'bold')} ({best['kind']}) is " +
              (C.wrap(f"{factor:.1f}x faster", "bgreen") if factor >= 1.2 else C.wrap("about the same", "bold")) +
              f" than {other['iface']}", W))
        used = next((a["name"] for a in adapters if a["default"]), None)
        if factor >= 1.2 and best["kind"] == "USB":
            tip = (tip_lines("Good: the antenna already carries the internet.", W, "bgreen") if best["iface"] == used
                   else tip_lines("Use the antenna first:", W, cmd=ANTENNA_CMD))
        elif factor >= 1.2:
            tip = tip_lines("The antenna isn't helping here. Try another spot, or a USB extension "
                            "cable to lift it away from the Pi.", W, "byellow")
        else:
            tip = []
        for line in tip:
            P(line)

    tests = speed_tests()[-8:]
    heading("Recent tests")
    for t, r in reversed(tests):
        down = r.get("down", "-")
        internet = r.get("internet", "-").split("/")[0]
        speed = f"{down} Mb/s" if down != "-" else "-"
        try:
            ping = f"{float(internet):.0f} ms"
        except ValueError:
            ping = ""
        P(fit(f" {C.wrap(f'{t:%a %H:%M}', 'grey')} {r.get('iface', '?'):<6}{r.get('kind', ''):<8}"
              f"{r.get('signal', '-'):>4}%{' ' * max(1, 10 - len(speed))}{C.wrap(speed, 'bold')} {ping}", W))
    P(C.wrap("\n Saved to ~/camera_captures/logs/network.log", "grey"))


# ---------------------------------------------------------------- nevet ts
def ts_check():
    """Can Nevet be opened from outside the home network? Step-by-step check."""
    W = max(36, min(shutil.get_terminal_size((60, 24)).columns, 66))
    P = print

    def heading(text):
        line = "─" if UTF8 else "-"
        P(""); P(C.wrap(text.upper(), "bold", "green") + " " + C.wrap(line * max(0, W - len(text) - 1), "grey"))

    def row(level, label, value):
        P(fit(f" {C.wrap(DOT, *LEVEL_STYLE[level])} {label:<11}{value}", W))

    def say(text, style="cyan", cmd=None):
        for line in tip_lines(text, W, style, cmd):
            P(line)

    P(C.wrap(" NEVET TS ", "title") + "  " + C.wrap("remote access check", "bold"))
    P(C.wrap(f"{datetime.now():%a %d %b %H:%M}", "grey"))
    heading("Tailscale on the Pi")
    ts = tailscale_info()
    if ts is None:
        row("bad", "Installed", "no")
        say("Tailscale gives the Pi an address that works from anywhere, only for your own devices. Install it:",
            cmd="curl -fsSL https://tailscale.com/install.sh | sh")
        say("Then log in (open the link it prints, on your phone):", cmd="sudo tailscale up")
        return
    row("ok", "Installed", ts.get("version") or "yes")
    if ts["service"] != "active":
        row("bad", "Service", ts["service"])
        say("Start it and keep it on after reboots:", "bred", "sudo systemctl enable --now tailscaled")
        return
    row("ok", "Service", "running")
    state = ts["state"]
    if state != "Running":
        row("bad", "Logged in", {"NeedsLogin": "no (logged out)", "Stopped": "switched off",
                                 "NeedsMachineAuth": "waiting for approval"}.get(state, state or "not answering"))
        if state == "NeedsMachineAuth":
            say(f"Approve this Pi at {TS_ADMIN}", "bred")
        else:
            say("Log in: run this and open the link it prints (on your phone is fine):", "bred", "sudo tailscale up")
        if ts.get("auth_url"):
            P("   or open: " + C.wrap(ts["auth_url"], "cyan"))
        return
    row("ok", "Logged in", ts.get("login") or "yes")
    ip = ts["ips"][0] if ts["ips"] else None
    row("ok" if ip else "bad", "Pi address", f"{ip or '?'}" + (f" {SEP} {ts['name']}" if ts.get("name") else ""))
    exp = ts.get("expiry")
    if exp is None:
        row("ok", "Key expiry", "disabled (good)")
    elif exp <= datetime.now():
        row("bad", "Key expiry", "EXPIRED")
    else:
        days = (exp - datetime.now()).days
        row("warn" if days < 14 else "info", "Key expiry", f"in {days} days ({exp:%d %b %Y})")
    if exp is not None:
        say(f"The Pi drops off Tailscale when its key expires. At {TS_ADMIN} open "
            f"{ts.get('name') or 'the Pi'} > ... > Disable key expiry.", "byellow" if exp and (exp - datetime.now()).days < 14 else "cyan")
    if ip:
        try:
            ok = urllib.request.urlopen(f"http://{ip}:8000/healthz", timeout=4).read().strip() == b"ok"
        except Exception:
            ok = False
        row("ok" if ok else "bad", "Web app", f"answers on {ip}" if ok else f"not answering on {ip}")
        if not ok:
            say("The web app isn't reachable on the Tailscale address. Check: nevet  (Web app row), "
                "and any firewall (sudo nft list ruleset).", "bred")
    for h in ts.get("health") or []:
        row("warn", "Warning", h)

    heading("Internet path")
    tty = sys.stdout.isatty()
    if tty:
        sys.stdout.write(C.wrap(" checking (a few seconds)...", "grey")); sys.stdout.flush()
    nc = run(["tailscale", "netcheck"], timeout=25, any_rc=True) or ""
    if tty:
        sys.stdout.write("\r" + " " * 30 + "\r")
    f = dict(re.findall(r"\*\s*([\w ]+?):\s*(.*)", nc))
    if not f:
        row("warn", "Netcheck", "no result")
    else:
        udp = f.get("UDP", "").startswith("true")
        row("ok" if udp else "warn", "UDP", "open (direct links possible)" if udp else "blocked: uses relays")
        row("info", "IPv4", f.get("IPv4", "?").split(",")[0])
        row("info", "IPv6", f.get("IPv6", "?").split(",")[0])
        if f.get("Nearest DERP"):
            row("info", "Relay", f["Nearest DERP"])
        if not udp:
            say("Still works, just slower. Common on guest/café WiFi.", "grey")

    heading("Your other devices")
    peers = ts["peers"]
    for p in peers[:10]:
        if p["online"]:
            how = "direct" if p["direct"] else (f"relay {p['relay']}" if p["relay"] else "online")
            row("ok", p["name"][:10], f"{p['os']:<8}online {SEP} {how}")
        else:
            row("off", p["name"][:10], f"{p['os']:<8}offline {SEP} {ago(p['seen'])}")
    if len(peers) > 10:
        P(C.wrap(f" ...and {len(peers) - 10} more", "grey"))
    if not peers:
        P(C.wrap(" None yet.", "grey"))

    heading("Open Nevet from outside")
    online = [p for p in peers if p["online"]]
    if not peers:
        say("No other device is on your Tailscale yet, so nothing outside can reach the Pi. "
            "That's why it never connected.", "bred")
    elif not online:
        say("Your devices are all offline in Tailscale: open the Tailscale app and switch it on.", "byellow")
    else:
        say(f"Ready: {len(online)} device{'s are' if len(online) > 1 else ' is'} online and can open Nevet now.", "bgreen")
    P(" 1. Install the Tailscale app on your phone")
    P(" 2. Log in with the SAME account as the Pi" + (":" if ts.get("login") else ""))
    if ts.get("login"):
        P("    " + C.wrap(ts["login"], "bold"))
    P(" 3. Switch Tailscale on, then open:")
    if ip:
        P("    " + C.wrap(f"http://{ip}:8000", "cyan", "bold"))
    if ts.get("magic") and ts.get("name"):
        P("    " + C.wrap(f"http://{ts['name']}:8000", "cyan", "bold"))
    for line in textwrap.wrap("Works on mobile data too. Only your own devices can connect.", W - 1):
        P(C.wrap(" " + line, "grey"))


def main():
    ap = argparse.ArgumentParser(prog="nevet", description="Nevet status for the terminal.")
    ap.add_argument("command", nargs="?", default="status", choices=["status", "net", "ts", "tailscale"],
                    help="status (default), net (network test) or ts (Tailscale / remote access check)")
    ap.add_argument("--quick", action="store_true", help="net: skip the 5 MB download test")
    ap.add_argument("-n", type=int, default=5, metavar="N", help="how many latest actions/events (default 5)")
    ap.add_argument("-w", "--watch", nargs="?", const=5, type=float, metavar="SEC", help="refresh every SEC seconds")
    ap.add_argument("--no-color", action="store_true", help="plain text")
    ap.add_argument("--color", action="store_true", help="colours even when piped (e.g. into less -R)")
    a = ap.parse_args()
    C.on = a.color or (sys.stdout.isatty() and not a.no_color and "NO_COLOR" not in os.environ)
    if os.geteuid() == 0 and "FARM_DB" not in os.environ:
        print("Tip: run `nevet` as your normal user (not sudo) so it finds your logs and garden data.\n")
    n = max(1, min(a.n, 50))
    if a.command == "net":
        net_test(quick=a.quick)
        return
    if a.command in ("ts", "tailscale"):
        ts_check()
        return
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
