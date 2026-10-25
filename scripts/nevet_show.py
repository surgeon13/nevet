"""nevet show - Nevet's shop window: a colourful, curious look at what's happening on the farm, printed for a screen
people walk past, so they want to know more and scan the code to join.

  nevet show            print it once
  nevet show -w         print it again every X minutes, X being the photo interval from the installer (or the update
                        check's when photos are off; `nevet show -w 10` for every 10 minutes)
  nevet show on         print it on the Pi's own display (tty1) at every boot, every X minutes
  nevet show off        give the display back to the login prompt
  nevet show status     is it set to start at boot?

Every print is a little different: a new headline, new "did you know?" lines and the latest from the garden. It is made
for people who don't play yet, so it shows hero names and what they did (like the welcome screen) and the farm's
numbers, and never addresses, codes, notes, family links or system details, apart from the link the QR code opens.
"""
import os
import random
import shutil
import sqlite3
import subprocess
import sys
import textwrap
import time
import unicodedata
from datetime import date, datetime, timedelta
from pathlib import Path

import nevet_status as ns
import nevet_screen as scr

sys.path.insert(0, str(ns.REPO / "webapp"))
import qr  # noqa: E402

UNIT = "nevet-show.service"
C, SEP = ns.C, ns.SEP


def icons():
    """Emoji on terminals that draw them; the Pi's own text console has no emoji font, so plain marks there."""
    plain = os.environ.get("TERM", "") == "linux" or not ns.UTF8
    keys = ["sprout", "hero", "fire", "bloom", "party", "clock", "basket", "tree", "phone", "spark", "ask"]
    if plain:
        return dict(zip(keys, ["*", "o", "^", "@", "!", ">", "+", "Y", "#", "*", "?"]))
    return dict(zip(keys, ["🌱", "🦸", "🔥", "🌸", "🎈", "🕒", "🧺", "🌳", "📱", "✨", "❓"]))


def cells(s):
    """How many terminal cells a (coloured) string takes: emoji and wide characters take two, joiners none."""
    n = 0
    for ch in ns.ANSI.sub("", s):
        o = ord(ch)
        if o in (0x200D, 0xFE0F) or unicodedata.combining(ch):
            continue
        n += 2 if unicodedata.east_asian_width(ch) in ("W", "F") or 0x1F300 <= o <= 0x1FAFF else 1
    return n


def ago(ts):
    try:
        t = datetime.fromisoformat(ts)
    except (TypeError, ValueError):
        return ""
    m = (datetime.now() - t).total_seconds() / 60
    if m < 2:
        return "just now"
    if m < 60:
        return f"{int(m)} min ago"
    if m < 60 * 24:
        return f"{int(m // 60)} h ago"
    return f"{int(m // 1440)} day{'s' if m >= 2880 else ''} ago"


def facts():
    """Everything the shop window tells, read from the garden's database (read-only)."""
    g = scr.numbers()
    f = {"heroes": g["heroes"], "growing": g["growing"], "week": g["week"], "today": g["today"], "kg_all": g["kg"],
         "latest": g["latest"][:3], "events": g["events"], "ripe": 0, "kg_week": 0.0, "champion": None, "titles": 0,
         "bouts": 0, "invited": 0, "connections": 0, "groups": 0, "generations": 0, "level": 0.0, "next": None, "unlocked": []}
    if not ns.FARM_DB.exists():
        return f
    try:
        con = sqlite3.connect(f"file:{ns.FARM_DB}?mode=ro", uri=True, timeout=3)
        con.row_factory = sqlite3.Row
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        gcols = {r[1] for r in con.execute("PRAGMA table_info(growers)")}
        one = lambda sql, *a: con.execute(sql, a).fetchone()[0]
        week = (date.today() - timedelta(days=6)).isoformat()
        f["ripe"] = one("SELECT COUNT(*) FROM assets WHERE asset_type = 'plant' AND life_stage = 'mature'")
        if "quantities" in tables:
            grams = one("""SELECT COALESCE(SUM(CASE WHEN q.units = 'kg' THEN q.value * 1000 ELSE q.value END), 0)
                           FROM quantities q JOIN logs ON logs.id = q.log_id
                           WHERE logs.log_type = 'harvest' AND q.units IN ('g', 'kg') AND logs.timestamp >= ?""", week)
            f["kg_week"] = round(grams / 1000, 1)
        if "game_tournaments" in tables:
            r = con.execute("""SELECT g.name, (SELECT COUNT(*) FROM game_tournaments t2 WHERE t2.champion_id = t.champion_id) AS n
                               FROM game_tournaments t JOIN growers g ON g.id = t.champion_id
                               WHERE t.champion_id IS NOT NULL AND g.deleted_at IS NULL ORDER BY t.id DESC LIMIT 1""").fetchone()
            if r:
                f["champion"], f["titles"] = r["name"], r["n"]
        if "game_matches" in tables:
            f["bouts"] = one("SELECT COUNT(*) FROM game_matches WHERE game = 'arena' AND style != 'ceremony' AND ends_at <= ?",
                             datetime.now().isoformat(timespec="seconds"))
        if "relationships" in tables:
            f["connections"] = one("SELECT COUNT(*) FROM relationships WHERE status = 'accepted'")
        if "groups" in tables:
            f["groups"] = one("SELECT COUNT(*) FROM groups")
        if "invited_by" in gcols:
            rows = con.execute("SELECT id, invited_by FROM growers WHERE deleted_at IS NULL").fetchall()
            by = {r["id"]: r["invited_by"] for r in rows}
            f["invited"] = sum(1 for v in by.values() if v in by)
            def depth(i, seen=()):
                return 1 if by.get(i) not in by or i in seen else 1 + depth(by[i], seen + (i,))
            f["generations"] = max((depth(i) for i in by), default=0)
        con.close()
    except sqlite3.Error:
        pass
    try:
        import invites                                # the web app's bloom (the same numbers the 3D farm uses)
        b = invites.bloom(f["heroes"], f["invited"], f["connections"], f["groups"])
        f["level"], f["next"], f["unlocked"] = b["level"], b["next"], b["unlocked"]
    except Exception:
        pass
    return f


def headlines(f, I):
    """Lines that make people curious: one is the big headline, the rest can follow."""
    out = []
    if f["champion"]:
        out.append(f"{I['fire']} {f['champion']} is the campfire's grand champion" + (f" ({f['titles']} titles)" if f["titles"] > 1 else "") + ". Who's next?")
    if f["ripe"]:
        out.append(f"{I['basket']} {f['ripe']} plant{'s are' if f['ripe'] != 1 else ' is'} ripe right now. Someone has to pick {'them' if f['ripe'] != 1 else 'it'}...")
    if f["level"] >= 0.1:
        nxt = f" Next: {f['next']['name'].lower()}." if f["next"] else " Every wonder is out."
        out.append(f"{I['bloom']} The farm is {round(f['level'] * 100)}% in bloom.{nxt}")
    if f["generations"] >= 2:
        out.append(f"{I['tree']} {f['invited']} heroes came through a friend. The mother tree has {f['generations']} generations.")
    if f["events"]:
        line = scr.event_line(f["events"][0])
        if line:
            out.append(f"{I['party']} Coming up: {line}")
    if f["week"]:
        out.append(f"{I['sprout']} {f['week']} things done in the garden this week" + (f", {f['kg_week']:g} kg picked" if f["kg_week"] else "") + ".")
    if f["bouts"]:
        out.append(f"{I['fire']} {f['bouts']} mud-wrestling bouts round the campfire so far, and every grab is counted.")
    if not out:
        out.append(f"{I['sprout']} A garden game for real gardens is starting here. Be one of the first heroes!")
    return out


WHISPERS = [                                          # a line under the title, a different one each time
    "Psst... the heroes of this garden have a secret 3D farm.",
    "Every plant here has a story. Some have stickers you can tap.",
    "Tonight someone could become champion at the campfire.",
    "This garden remembers everything: every seed, every harvest, every friend.",
    "There's a tree here that grows a blossom for every new friend.",
    "The more people join, the more this farm blooms.",
]
WONDERS = [                                           # "did you know?": what's waiting inside
    "A 3D farm where the heroes dance round a campfire while three of them wrestle in the mud.",
    "Powers you can't buy: they only grow from real watering, planting and picking.",
    "Tap a sticker on a plant with your phone, and the job is done and logged.",
    "Every friend you invite grows on your branch of the mother tree.",
    "When the farm blooms enough, hot-air balloons appear. Then the northern lights.",
    "The party has a big wheel, an LED wall, lasers and confetti cannons.",
    "Somewhere in the play park, a sandcastle grows while heroes dig.",
    "Dress your hero any way you like: a crown, a jet pack, a rubber chicken...",
    "Pick a pet friend: a worm, a snail, a bee, a frog or a little sprout spirit.",
    "The farm's whole story grows as two vines, one blossom for every day.",
    "Nine lands to choose from: desert, seaside, snowy mountains, jungle, a city...",
    "Football matches, a slide and a trampoline: the play park never sleeps.",
]


def render(width=None, height=None, seed=None):
    """The shop window as text (with colours when they're on)."""
    I = icons()
    cols, rows = shutil.get_terminal_size((100, 40))
    W = min(width or cols, 110)
    H = height or rows
    rnd = random.Random(seed if seed is not None else int(time.time() // 60))
    f = facts()
    t = scr.join_target()
    out = []
    P = out.append

    def centre(s, style=()):
        pad = max(0, (W - cells(s)) // 2)
        P(" " * pad + (C.wrap(s, *style) if style else s))

    # the title: NEVET in big letters, a sprout either side
    letters = scr.big("NEVET")
    for i, (row, sp) in enumerate(zip(letters, scr.SPROUT)):
        line = C.wrap(sp, "bgreen") + "   " + C.wrap(row, "bold", "magenta" if i == 1 else "bgreen") + "   " + C.wrap(sp, "bgreen")
        centre(line)
    centre("a garden game for real gardens", ("bold",))
    centre("do real things in the garden, and your hero grows", ("grey",))
    centre(rnd.choice(WHISPERS), ("cyan",))
    P("")
    # the headline: a different one each time
    heads = headlines(f, I)
    first = heads[rnd.randrange(len(heads))]
    centre(first, ("bold", "byellow"))
    P("")
    # what's happening (left) and the QR code to join (right, when there's room; below otherwise)
    lines = []
    lines.append(C.wrap("RIGHT NOW ON THE FARM", "bold", "bgreen"))
    if f["heroes"]:
        lines.append(f"{I['hero']} {C.wrap(str(f['heroes']), 'bold')} hero{'es' if f['heroes'] != 1 else ''}"
                     + (f" {SEP} {C.wrap(str(f['growing']), 'bold')} plants growing" if f["growing"] else "")
                     + (f" {SEP} {C.wrap(str(f['ripe']), 'bold')} ripe" if f["ripe"] else ""))
    else:
        lines.append(f"{I['hero']} Nobody has joined yet: be the very first hero!")
    if f["week"]:
        lines.append(f"{I['sprout']} This week: {C.wrap(str(f['week']), 'bold')} actions" + (f" {SEP} {C.wrap(format(f['kg_week'], 'g'), 'bold')} kg picked" if f["kg_week"] else ""))
    seen = set()
    for r in f["latest"]:
        verb = (ns.ACTION_BY_ID.get(r["log_type"]) or {}).get("verb", (r["log_type"] or "").replace("_", " "))
        if (r["who"], verb, r["asset"]) in seen:      # (the same thing twice in a row: once is enough)
            continue
        seen.add((r["who"], verb, r["asset"]))
        lines.append(f"{I['clock']} {C.wrap(r['who'] or 'Someone', 'bold', 'cyan')} {verb} {(r['asset'] or 'the whole garden').lower()} {C.wrap(ago(r['timestamp']), 'grey')}")
    if f["champion"]:
        lines.append(f"{I['fire']} Campfire champion: {C.wrap(f['champion'], 'bold', 'byellow')}")
    if f["level"] >= 0.05:
        bar_w = 14
        fill = round(f["level"] * bar_w)
        bar = C.wrap(ns.BAR * fill, "magenta") + C.wrap(("░" if ns.UTF8 else ".") * (bar_w - fill), "grey")
        lines.append(f"{I['bloom']} Bloom {bar} {round(f['level'] * 100)}%")
    for ev in f["events"][:2]:
        line = scr.event_line(ev)
        if line:
            lines.append(f"{I['party']} {line}")
    lines.append("")
    lines.append(C.wrap("DID YOU KNOW?", "bold", "magenta"))
    wonders = rnd.sample(WONDERS, 3)
    more = [h for h in heads if h != first]
    if more:
        wonders.append(rnd.choice(more).split(" ", 1)[1])

    qlines = []
    if t.get("url"):
        m = qr.encode(t["url"], ecl="M")
        room_h = max(10, H - len(out) - 6)
        for big, quiet in ((False, 2), (False, 1)):
            q = qr.text_lines(m, quiet=quiet, big=big)
            if len(q) <= room_h:
                qlines = q
                break
    qstyle = ("black_on_white",)
    C.codes.setdefault("black_on_white", "30;47" if os.environ.get("TERM", "") == "linux" else "30;107")
    side = qlines and W >= len(qlines[0]) + 52
    text_w = W - (len(qlines[0]) + 4 if side else 0) - 2
    for w in wonders:                                 # (long ones wrap, indented under their mark)
        for k, part in enumerate(textwrap.wrap(w, max(20, text_w - 4))):
            lines.append((f"{I['spark']} " if k == 0 else "  ") + part)
    if side:
        caption = [C.wrap(f"{I['phone']} SCAN TO JOIN", "bold", "bgreen"), "point your phone's camera", "at the square", "",
                   C.wrap(t.get("shown") or "", "cyan"), C.wrap(t.get("note") or "", "grey")]
        n = max(len(lines), len(qlines) + len(caption) + 1)
        right = qlines + [""] + caption
        for i in range(n):
            left = ns.fit(" " + lines[i], text_w) if i < len(lines) else ""
            r = right[i] if i < len(right) else ""
            if i < len(qlines):
                r = C.wrap(r, *qstyle)
            else:
                r = "  " + r
            P(left + " " * max(1, text_w - cells(left) + 2) + r)     # (cells, not characters: the QR code's rows must line up)
    else:
        for l in lines:
            P(ns.fit(" " + l, W))
        if qlines:
            P("")
            for q in qlines:
                centre(C.wrap(q, *qstyle))
            centre(f"{I['phone']} Scan to join: point your phone's camera at the square", ("bold", "bgreen"))
            if t.get("shown"):
                centre(t["shown"], ("cyan",))
    if not t.get("url"):
        P("")
        centre("Join at the garden: ask a player to show you how.", ("bold",))
    return "\n".join(out)


def run(watch=None, kiosk=False):
    """Print it, or keep printing it every X minutes (watch: seconds, or None for the installer's X)."""
    if watch is False:
        print(render())
        return 0
    try:
        while True:
            screen = render()
            wait, why = ns.next_refresh(watch)
            nxt = (datetime.now() + timedelta(seconds=wait)).strftime("%H:%M")
            foot = C.wrap(f" Something new on this screen at {nxt}", "grey") + ("" if kiosk else C.wrap(f" {SEP} {why} {SEP} Ctrl+C to stop", "grey"))
            sys.stdout.write("\033[H\033[2J\033[3J" + screen + "\n" + foot)
            sys.stdout.flush()
            time.sleep(wait)
    except KeyboardInterrupt:
        print()
    return 0


# ---------------------------------------------------------------- on the Pi's own display at every boot
def install_unit(unit):
    """Put the service in place from systemd/nevet-show.service (what install.sh does), so `nevet show on` works
    right after an update without running the whole installer again."""
    try:
        import pwd
        user = os.environ.get("SUDO_USER") or pwd.getpwuid(os.getuid()).pw_name
        home = pwd.getpwnam(user).pw_dir
        text = (ns.REPO / "systemd" / UNIT).read_text()
    except (OSError, KeyError):
        return False
    text = text.replace("__USER__", user).replace("__HOME__", home).replace("__REPO_DIR__", str(ns.REPO))
    cmd = ["tee", str(unit)] if os.geteuid() == 0 else ["sudo", "-n", "tee", str(unit)]
    try:
        r = subprocess.run(cmd, input=text, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return False
    if r.returncode != 0:
        return False
    scr._sudo(["daemon-reload"])
    return True


def autostart(action):
    unit = Path("/etc/systemd/system") / UNIT
    if action == "status":
        enabled = subprocess.run(["systemctl", "is-enabled", UNIT], capture_output=True, text=True).stdout.strip()
        active = subprocess.run(["systemctl", "is-active", UNIT], capture_output=True, text=True).stdout.strip()
        mins, label, _ = ns.refresh_interval()
        print(f"Shop window on the Pi's display: {'on at boot' if enabled == 'enabled' else 'off'} ({active or 'unknown'}), "
              f"new every {mins:g} min, like {label}")
        if not unit.exists():
            print("Not installed yet: run `sudo ./install.sh` once in the repo, then `nevet show on`.")
        return 0
    if not unit.exists() and action == "on" and not install_unit(unit):
        print("The shop window service isn't installed yet. Run once in the repo:  sudo ./install.sh")
        return 1
    if not unit.exists():
        print("The shop window isn't on.")
        return 0
    if action == "on":
        r = scr._sudo(["enable", "--now", UNIT])
        msg = "The shop window now shows on the Pi's display (tty1), new every X minutes, also after a reboot."
    else:
        r = scr._sudo(["disable", "--now", UNIT])
        if r.returncode == 0:
            scr._sudo(["start", "getty@tty1.service"])
        msg = "The Pi's display shows the login prompt again."
    if r.returncode != 0:
        print("Needs admin rights. Run:  sudo systemctl " + ("enable --now " if action == "on" else "disable --now ") + UNIT)
        return 1
    print(msg)
    return 0
