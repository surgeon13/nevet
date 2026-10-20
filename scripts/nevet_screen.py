"""nevet screen - a full-screen welcome dashboard for the Pi's own display (or any terminal).

A big QR code people scan with their phone camera to join Nevet, three steps,
the garden's live numbers, the next event and a rotating line of what's
happening. Made to run all day on a screen by the garden:

  nevet screen            show it (q or Esc to leave)
  nevet screen on         show it on the Pi's own display (tty1) at every boot
  nevet screen off        give the display back to the login prompt
  nevet screen status     is it set to start at boot?

The QR code opens the sign-up page. Which address it uses:
  1. NEVET_JOIN_URL in .env, if set (e.g. your own domain)
  2. the public Tailscale Funnel address when Nevet is open to the internet
     (`nevet public on`), with the invite code filled in unless
     WEBAPP_PUBLIC_SIGNUP=true
  3. otherwise the home network address (works for phones on the same WiFi)
The code opens the short link /join (counts the scan, then sign-up), so the web app
knows how many people scanned the screen and how many of them joined.
"""
import curses
import locale
import os
import sqlite3
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import nevet_status as ns

REPO = ns.REPO
sys.path.insert(0, str(REPO / "webapp"))
import qr  # noqa: E402  (webapp/qr.py: no extra packages)

UNIT = "nevet-screen.service"

# big letters for the title (3 rows, half blocks)
FONT = {
    "N": ["█▄  █", "█ █ █", "█  ▀█"],
    "E": ["█▀▀▀", "█▀▀ ", "█▄▄▄"],
    "V": ["█   █", "▀▄ ▄▀", "  █  "],
    "T": ["▀▀█▀▀", "  █  ", "  █  "],
}
SPROUT = ["▄▄     ▄▄", " ▀█▄ ▄█▀ ", "   ▐█▌   "]


def big(word):
    return ["  ".join(FONT[c][r] for c in word) for r in range(3)]


def env_file():
    """The app's settings (.env next to the repo), so the screen agrees with the web app."""
    out = {}
    for path in (REPO / ".env", Path.home() / "webapp" / ".env"):
        try:
            for line in path.read_text().splitlines():
                k, sep, v = line.strip().partition("=")
                if sep and not k.startswith("#"):
                    out.setdefault(k.strip(), v.strip().strip('"').strip("'"))
        except OSError:
            pass
    return out


def setting(con, key):
    try:
        r = con.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return r[0] if r else None
    except sqlite3.Error:
        return None


def invite_code():
    """The invite code visitors from the internet need (made here if the admin hasn't opened the Account page yet)."""
    if not ns.FARM_DB.exists():
        return None
    try:
        con = sqlite3.connect(ns.FARM_DB, timeout=3)
        code = setting(con, "invite_code")
        if not code:
            import netaccess
            code = netaccess.new_invite_code()
            con.execute("INSERT INTO app_settings (key, value) VALUES ('invite_code', ?) "
                        "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (code,))
            con.commit()
        con.close()
        return code
    except sqlite3.Error:
        return None


def join_target(funnel=None):
    """-> dict(url, shown, where, invite, note) for the QR code."""
    env = {**env_file(), **os.environ}
    public_signup = env.get("WEBAPP_PUBLIC_SIGNUP", "false").lower() in ("1", "true", "yes", "on")
    custom = env.get("NEVET_JOIN_URL", "").strip()
    on, url = funnel if funnel else (None, None)
    invite = None
    if custom:
        base, where, note = custom.rstrip("/") + "/", "internet", "Open to everyone"
        invite = None if public_signup else invite_code()
    elif on and url:
        base, where, note = url, "internet", "Works from anywhere"
        invite = None if public_signup else invite_code()
    else:
        lan = [ip for ip, label in ns.addresses() if label != "Tailscale"]
        base = f"http://{lan[0]}:8000/" if lan else None
        where, note = "home", "Phones on the garden's WiFi"
    if not base:
        return {"url": None, "shown": "No network yet", "where": "none", "invite": None, "note": "Connect the Pi to the WiFi"}
    q = "join" + (f"?i={invite}" if invite else "")
    shown = base.split("://", 1)[1] + "join"
    return {"url": base + q, "shown": shown, "where": where, "invite": invite, "note": note}


def numbers():
    """The garden's numbers, today's actions, the next event and the screen's own scan / sign-up counts."""
    g = {"heroes": 0, "growing": 0, "week": 0, "kg": 0.0, "latest": [], "event": None, "scans": 0, "joins": 0, "today": 0}
    if not ns.FARM_DB.exists():
        return g
    try:
        con = sqlite3.connect(f"file:{ns.FARM_DB}?mode=ro", uri=True, timeout=3)
        con.row_factory = sqlite3.Row
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        one = lambda sql, *a: con.execute(sql, a).fetchone()[0]
        week = (date.today() - timedelta(days=6)).isoformat()
        g["heroes"] = one("SELECT COUNT(*) FROM growers WHERE deleted_at IS NULL")
        g["growing"] = one("SELECT COUNT(*) FROM assets WHERE life_stage IS NULL OR life_stage NOT IN ('harvested','archived')")
        g["week"] = one("SELECT COUNT(*) FROM logs WHERE timestamp >= ?", week)
        g["today"] = one("SELECT COUNT(*) FROM logs WHERE timestamp >= ?", date.today().isoformat())
        if "quantities" in tables:
            grams = one("""SELECT COALESCE(SUM(CASE WHEN q.units = 'kg' THEN q.value * 1000 ELSE q.value END), 0)
                           FROM quantities q JOIN logs ON logs.id = q.log_id
                           WHERE logs.log_type = 'harvest' AND q.units IN ('g', 'kg')""")
            g["kg"] = round(grams / 1000, 1)
        g["latest"] = [dict(r) for r in con.execute("""
            SELECT logs.timestamp, logs.log_type, assets.name AS asset, growers.name AS who
            FROM logs LEFT JOIN assets ON assets.id = logs.asset_id LEFT JOIN growers ON growers.id = logs.grower_id
            ORDER BY logs.timestamp DESC, logs.id DESC LIMIT 6""")]
        if "events" in tables:
            now = datetime.now().isoformat(timespec="minutes")
            r = con.execute("""SELECT e.*, (SELECT COUNT(*) + COALESCE(SUM(guests), 0) FROM event_rsvps r WHERE r.event_id = e.id AND r.answer = 'going') AS coming
                               FROM events e WHERE e.deleted_at IS NULL AND e.status != 'cancelled'
                               AND COALESCE(e.ends_at, e.starts_at) >= ? ORDER BY e.starts_at LIMIT 1""", (now[:10],)).fetchone()
            if r:
                g["event"] = dict(r)
        if "app_settings" in tables:
            g["scans"] = int(setting(con, "screen_scans") or 0)
            g["joins"] = int(setting(con, "screen_joins") or 0)
        con.close()
    except (sqlite3.Error, ValueError):
        pass
    return g


def event_line(ev):
    if not ev:
        return None
    try:
        start = datetime.fromisoformat(ev["starts_at"])
    except ValueError:
        return None
    end = datetime.fromisoformat(ev["ends_at"]) if ev.get("ends_at") else start + timedelta(hours=3)
    now = datetime.now()
    if start <= now < end:
        when = "happening now"
    elif start.date() == now.date():
        when = f"today {start:%H:%M}"
    elif start.date() == now.date() + timedelta(days=1):
        when = f"tomorrow {start:%H:%M}"
    else:
        when = f"{start:%a %-d %b, %H:%M}"
    return f"{ev['title']} · {when}" + (f" · {ev['coming']} coming" if ev.get("coming") else "")


def ticker_items(g):
    items = []
    for r in g["latest"]:
        verb = (ns.ACTION_BY_ID.get(r["log_type"]) or {}).get("verb", (r["log_type"] or "").replace("_", " "))
        when = r["timestamp"][11:16] if (r["timestamp"] or "")[:10] == date.today().isoformat() else (r["timestamp"] or "")[5:10]
        items.append(f"{r['who'] or 'Someone'} {verb} {r['asset'] or 'the whole garden'} · {when}")
    items += ["Every watering, harvest and planting earns your hero XP",
              "Plan parties, festivals and work days together in Events",
              "Map the garden's beds and paths, and see them on the 3D farm",
              "Tap the brain on the dashboard to visit the farm in 3D"]
    return items


# ---------------------------------------------------------------- drawing
class Screen:
    def __init__(self, win, kiosk=False):
        self.w, self.kiosk = win, kiosk
        self.data, self.target, self.status = None, None, {}
        self.data_at = self.target_at = 0
        self.tick, self.tick_at = 0, 0
        self.funnel = (None, None)
        curses.curs_set(0)
        win.timeout(1000)
        self.color = curses.has_colors()
        if self.color:
            curses.start_color()
            try:
                curses.use_default_colors()
                bg = -1
            except curses.error:
                bg = curses.COLOR_BLACK
            curses.init_pair(1, curses.COLOR_GREEN, bg)                       # brand
            curses.init_pair(2, curses.COLOR_BLACK, curses.COLOR_WHITE)       # the QR code: dark on light
            curses.init_pair(3, curses.COLOR_YELLOW, bg)                      # highlights
            curses.init_pair(4, curses.COLOR_CYAN, bg)                        # the address
            curses.init_pair(5, curses.COLOR_WHITE, curses.COLOR_GREEN)       # step numbers
        self.utf8 = (locale.getpreferredencoding(False) or "").lower().replace("-", "") in ("utf8",)

    def attr(self, n, extra=0):
        return (curses.color_pair(n) if self.color else 0) | extra

    @staticmethod
    def clip(text, n):
        return text if len(text) <= n else text[:max(0, n - 1)] + ("…" if n > 0 else "")

    def put(self, y, x, text, a=0):
        H, W = self.w.getmaxyx()
        if y < 0 or y >= H or x >= W:
            return
        if x < 0:
            text, x = text[-x:], 0
        text = text[:max(0, W - x - (1 if y == H - 1 else 0))]
        try:
            self.w.addstr(y, x, text, a)
        except curses.error:
            pass

    def refresh_data(self, force=False):
        now = time.time()
        if force or now - self.target_at > 120:                                # tailscale and the network: every 2 minutes
            try:
                self.funnel = ns.funnel_state()
            except Exception:
                self.funnel = (None, None)
            self.target = join_target(self.funnel)
            st = ns.station()
            self.status = {"temp": st.get("temp"), "uptime": ns.uptime() if hasattr(ns, "uptime") else None,
                           "lan": next((ip for ip, label in ns.addresses() if label != "Tailscale"), None),
                           "online": ns.has_ipv4_route() if hasattr(ns, "has_ipv4_route") else None}
            self.target_at = now
        if force or now - self.data_at > 30:
            self.data = numbers()
            self.data_at = now

    def draw_qr(self, y, x, lines, wide):
        for i, row in enumerate(lines):
            if self.utf8:
                self.put(y + i, x, row, self.attr(2) if self.color else curses.A_REVERSE)
        return len(lines)

    def qr_lines(self, max_w, max_h):
        """The biggest QR code that fits: (lines, scale) or (None, 0). Big screens get modules twice the size;
        small ones a thinner light border (phones still read it)."""
        if not self.target or not self.target["url"]:
            return None, 0
        m = qr.encode(self.target["url"], ecl="M")
        for big, quiet in ((True, 3), (False, 3), (False, 2), (False, 1)):
            lines = qr.text_lines(m, quiet=quiet, big=big)
            if len(lines[0]) <= max_w and len(lines) <= max_h:
                return lines, 2 if big else 1
        return None, 0

    def draw(self):
        self.w.erase()
        H, W = self.w.getmaxyx()
        g, t = self.data or numbers(), self.target or {"url": None, "shown": "…", "note": "", "invite": None, "where": "none"}
        green, dim, bold = self.attr(1), curses.A_DIM, curses.A_BOLD
        now = datetime.now()
        # header: big NEVET (or a small one), the date and time on the right
        top = 1
        if W >= 60 and H >= 30 and self.utf8:
            for i, row in enumerate(SPROUT):
                self.put(top + i, 3, row, green | bold)
            for i, row in enumerate(big("NEVET")):
                self.put(top + i, 14, row, green | bold)
            self.put(top + 3, 14, self.clip("Grow together. A community garden that plays like a game.", W - 20), dim)
            head_h = 5
        else:                                                                 # small screens: one line
            self.put(top, 2, ("▀█▀ " if self.utf8 else "") + "NEVET", green | bold)
            self.put(top, 13, self.clip("grow together: a community garden that plays like a game", W - 13 - 24), dim)
            head_h = 1
        clock = now.strftime("%H:%M")
        day = now.strftime("%a %-d %b")
        if head_h > 1:
            self.put(top, W - len(clock) - 3, clock, bold)
            self.put(top + 1, W - len(day) - 3, day, dim)
        else:
            self.put(top, W - len(day) - len(clock) - 5, day, dim)
            self.put(top, W - len(clock) - 3, clock, bold)

        body_y, foot_y = top + head_h + 1, H - 2
        avail_h = foot_y - body_y - 1
        info_w = 46 if W >= 110 else 38
        lines, wide = self.qr_lines(W - info_w - 6, avail_h)
        side = lines is not None
        if not side:                                                          # stacked: QR on top, short info below
            lines, wide = self.qr_lines(W - 4, avail_h - 6)
        if lines:
            qw, qh = len(lines[0]), len(lines)
            if side:
                gap = max(2, (W - qw - info_w) // 3)
                qx, qy = gap, body_y + max(0, (avail_h - qh) // 2)
                ix, iy = qx + qw + gap, body_y + max(0, (avail_h - (17 if H > 30 else 13)) // 2)
            else:
                qx, qy = (W - qw) // 2, body_y
                ix, iy = 3, body_y + qh + 1
            self.draw_qr(qy, qx, lines, wide)
            if side and qy + qh < foot_y:
                cap = "Scan me"
                self.put(qy + qh, qx + (qw - len(cap)) // 2, cap, green | bold)
        else:
            ix, iy = 3, body_y
            msg = "Make the window bigger to show the QR code" if t["url"] else t["note"]
            self.put(iy, ix, msg, self.attr(3))
            iy += 2
        iw = W - ix - 2

        # join steps, the address and the invite code
        y = iy
        self.put(y, ix, "JOIN NEVET", green | bold)
        y += 2
        steps = [("Scan the code with your phone camera", "or type the address below"),
                 ("Pick a hero name and a password", "your hero levels up as you garden"),
                 ("Log what you do in the garden", "water, plant, harvest, feed the worms")]
        for n, (a, b) in enumerate(steps, 1):
            self.put(y, ix, f" {n} ", self.attr(5, bold) if self.color else curses.A_REVERSE)
            self.put(y, ix + 4, self.clip(a, iw - 4), bold)
            if H > 30:
                self.put(y + 1, ix + 4, self.clip(b, iw - 4), dim)
                y += 1
            y += 2 if H > 30 else 1
        if H <= 30:
            y += 1
        self.put(y, ix, self.clip(t["shown"], iw), self.attr(4, bold))
        y += 1
        self.put(y, ix, t["note"][:iw], dim)
        y += 1
        if t.get("invite"):
            code = t["invite"]
            self.put(y, ix, "Invite code  ", dim)
            self.put(y, ix + 13, f"{code[:4]} {code[4:]}", self.attr(3, bold))
            y += 1
        y += 1

        # the garden in numbers, the next event, and what's happening
        nums = [(str(g["heroes"]), "heroes"), (str(g["growing"]), "growing"), (str(g["week"]), "actions this week")]
        if g["kg"]:
            nums.append((f"{g['kg']:g} kg", "harvested"))
        x = ix
        for val, label in nums:
            if x + len(val) + len(label) + 2 > ix + iw:
                break
            self.put(y, x, val, bold)
            self.put(y, x + len(val) + 1, label, dim)
            x += len(val) + len(label) + 4
        y += 2 if H > 30 else 1
        ev = event_line(g["event"])
        if ev and y < foot_y - 1:
            self.put(y, ix, "NEXT ", self.attr(3, bold))
            self.put(y, ix + 5, self.clip(ev, iw - 5), bold)
            y += 2 if H > 30 else 1
        items = ticker_items(g)
        if items and y < foot_y:
            if time.time() - self.tick_at > 6:
                self.tick, self.tick_at = (self.tick + 1) % len(items), time.time()
            item = items[self.tick % len(items)]
            self.put(y, ix, ("▸ " if self.utf8 else "> ") + self.clip(item, iw - 2), self.attr(1))

        # footer: station status (and key hints when someone's at the keyboard)
        st = self.status
        bits = []
        bits.append(("● " if self.utf8 else "* ") + ("online" if st.get("online") else "offline"))
        if st.get("lan"):
            bits.append(st["lan"])
        if st.get("temp"):
            bits.append(f"{st['temp']:.0f}°C" if self.utf8 else f"{st['temp']:.0f}C")
        if g["scans"]:
            bits.append(f"{g['scans']} scan{'s' if g['scans'] != 1 else ''} · {g['joins']} joined from this screen")
        foot = "   ".join(bits)
        self.put(H - 2, 2, "─" * (W - 4) if self.utf8 else "-" * (W - 4), dim)
        self.put(H - 1, 2, foot[:W - 4], dim)
        if not self.kiosk:
            hint = "q quit · r refresh"
            if len(foot) + len(hint) + 6 < W:
                self.put(H - 1, W - len(hint) - 3, hint, dim)
        self.w.noutrefresh()
        curses.doupdate()

    def run(self):
        self.refresh_data(force=True)
        while True:
            self.refresh_data()
            self.draw()
            k = self.w.getch()
            if k in (ord("q"), ord("Q"), 27) and not self.kiosk:
                return
            if k in (ord("r"), ord("R")):
                self.refresh_data(force=True)
            elif k == ord(" "):
                self.tick_at = 0
            elif k == curses.KEY_RESIZE:
                curses.update_lines_cols()


def show(kiosk=False):
    locale.setlocale(locale.LC_ALL, "")
    os.environ.setdefault("ESCDELAY", "50")
    try:
        curses.wrapper(lambda w: Screen(w, kiosk=kiosk).run())
    except KeyboardInterrupt:
        pass


# ---------------------------------------------------------------- start at boot on the Pi's own display
def _sudo(args):
    cmd = ["systemctl"] + args
    if os.geteuid() != 0:
        cmd = ["sudo", "-n"] + cmd
    return subprocess.run(cmd, capture_output=True, text=True)


def autostart(action):
    unit = Path("/etc/systemd/system") / UNIT
    if action == "status":
        enabled = subprocess.run(["systemctl", "is-enabled", UNIT], capture_output=True, text=True).stdout.strip()
        active = subprocess.run(["systemctl", "is-active", UNIT], capture_output=True, text=True).stdout.strip()
        print(f"Welcome screen on the Pi's display: {'on at boot' if enabled == 'enabled' else 'off'} ({active or 'unknown'})")
        if not unit.exists():
            print("Not installed yet: run `sudo ./install.sh` once in the repo, then `nevet screen on`.")
        return 0
    if not unit.exists():
        print("The screen service isn't installed yet. Run once in the repo:  sudo ./install.sh")
        return 1
    if action == "on":
        r = _sudo(["enable", "--now", UNIT])
        msg = "The welcome screen now shows on the Pi's display (tty1), also after a reboot."
    else:
        r = _sudo(["disable", "--now", UNIT])
        if r.returncode == 0:
            _sudo(["start", "getty@tty1.service"])
        msg = "The Pi's display shows the login prompt again."
    if r.returncode != 0:
        print("Needs admin rights. Run:  sudo systemctl " + ("enable --now " if action == "on" else "disable --now ") + UNIT)
        return 1
    print(msg)
    return 0
