"""nevet tags - NFC / RFID tags from the Pi's terminal, with a Flipper Zero as the reader.

  nevet tags                  the farm's tags and the latest scans
  nevet tags reader           the gate reader: scan a hero fob, then tap tags (logged as that hero);
                              a fob alone checks the hero in to the event that's on
  nevet tags check            test tags: says what each scanned chip is, logs nothing
  nevet tags export [DIR]     Flipper files for every tag (nfc/*.nfc: NTAG215 with the tag's link,
                              lfrfid/*.rfid: EM4100 hero fobs), to copy to the Flipper's SD card
  nevet tags export --push    ...and send them straight to a Flipper plugged in by USB (experimental)

Reader options:
  --port /dev/ttyACM0         the Flipper's USB serial port (found by itself when there's one)
  --stdin                     read UIDs typed by a USB card reader (one per line) instead of a Flipper
  --nfc                       also ask the Flipper for NFC chips (depends on its firmware's command line)
  --name gate                 this reader's name (the hero-then-tag pairing is per reader)

The Flipper is driven through its USB command line (`rfid read`); close qFlipper
first, only one program can use the port. Scans go to the web app on this Pi
(POST http://127.0.0.1:8000/api/tags/scan, allowed from the Pi itself).
"""
import glob
import json
import os
import re
import select
import sys
import termios
import time
import tty
import urllib.request
from pathlib import Path

import nevet_status as ns

API = os.environ.get("NEVET_API", "http://127.0.0.1:8000")
PROMPT = b">: "
LF_PROTOCOLS = r"(EM4100|EM-Micro|EM\-?4100|H10301|HIDProx|HID\w*|Indala\w*|IoProx\w*|AWID|Pyramid|Viking|Jablotron|Paradox|PAC/Stanley|Keri|Gallagher|Nexwatch|FDX-[AB]|Electra|Idteck|GProxII|Noralsy|Securakey)"
HEX_RUN = re.compile(r"\b([0-9A-Fa-f]{2}(?:[ :][0-9A-Fa-f]{2}){2,15})\b")
c = ns.C.wrap


def _tags_module():
    os.environ.setdefault("FARM_DB", str(ns.FARM_DB))
    sys.path.insert(0, str(ns.REPO / "webapp"))
    import tags
    return tags


# ---------------------------------------------------------------- talking to the web app
def post_scan(uid, tech, reader, check=False):
    body = json.dumps({"uid": uid, "tech": tech, "reader": reader, "via": "flipper" if tech != "keyboard" else "reader", "check": check}).encode()
    req = urllib.request.Request(API + "/api/tags/scan", data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode()) | {"ok": False}
        except ValueError:
            return {"ok": False, "text": f"The web app said {e.code}."}
    except OSError as e:
        return {"ok": False, "text": f"Can't reach the web app at {API} ({e}). Is nevet-webapp running?"}


def show(res, uid):
    if not res.get("ok"):
        print(" " + c("✗", "bred") + " " + res.get("text", "?"))
    elif not res.get("known"):
        print(" " + c("?", "byellow") + f" {res.get('text')}")
    else:
        style = "bgreen" if res.get("logged") or "checked in" in res.get("text", "") else "cyan"
        print(" " + c("●", style) + " " + res.get("text", ""))
    sys.stdout.flush()


# ---------------------------------------------------------------- the Flipper's USB command line
def find_flipper():
    for pat in ("/dev/serial/by-id/*Flipper*", "/dev/serial/by-id/*flip*", "/dev/ttyACM*"):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[0]
    return None


class Flipper:
    def __init__(self, port):
        self.fd = os.open(port, os.O_RDWR | os.O_NOCTTY)
        self.old = termios.tcgetattr(self.fd)
        tty.setraw(self.fd)
        self.buf = b""

    def close(self):
        try:
            self.send(b"\x03")
            termios.tcsetattr(self.fd, termios.TCSADRAIN, self.old)
        finally:
            os.close(self.fd)

    def send(self, data):
        os.write(self.fd, data)

    def read(self, timeout):
        r, _, _ = select.select([self.fd], [], [], timeout)
        if r:
            chunk = os.read(self.fd, 4096)
            if not chunk:
                raise OSError("the Flipper went away")
            self.buf += chunk
        return bool(r)

    def until_prompt(self, timeout=4):
        end = time.time() + timeout
        while time.time() < end:
            if PROMPT in self.buf:
                out, _, self.buf = self.buf.partition(PROMPT)
                return out.decode(errors="replace")
            self.read(0.2)
        return None

    def command(self, cmd, timeout=4):
        self.buf = b""
        self.send(cmd.encode() + b"\r")
        return self.until_prompt(timeout)

    def wake(self):
        self.send(b"\x03\r")
        time.sleep(0.3)
        self.buf = b""
        self.send(b"\r")
        return self.until_prompt(5) is not None

    def scan(self, cmd, wait):
        """Runs a reading command until a chip shows up (or wait seconds), then stops it. -> (uid, tech) or (None, None)."""
        self.buf = b""
        self.send(cmd.encode() + b"\r")
        end, text = time.time() + wait, ""
        while time.time() < end:
            self.read(0.25)
            text = self.buf.decode(errors="replace")
            uid, tech = parse_scan(text)
            if uid:
                break
        else:
            uid, tech = None, None
        self.send(b"\x03")
        self.until_prompt(3)
        return uid, tech


def parse_scan(text):
    """Finds a chip in what the Flipper printed. Knows `rfid read` (protocol name, then its data) and
    NFC 'UID: 04 ...' lines."""
    m = re.search(r"UID:?\s*((?:[0-9A-Fa-f]{2}[ :]?){4,10})", text)
    if m:
        return re.sub(r"[^0-9A-Fa-f]", "", m.group(1)).upper(), "ntag"
    m = re.search(LF_PROTOCOLS + r"[^\n]*?\n?[^\n]*?" + HEX_RUN.pattern, text)
    if m:
        proto = m.group(1).lower()
        tech = "em4100" if "em" in proto else "hid" if "hid" in proto or "h10301" in proto else proto
        return re.sub(r"[^0-9A-Fa-f]", "", m.group(2)).upper(), tech
    return None, None


# ---------------------------------------------------------------- commands
def list_tags():
    tags = _tags_module()
    rows = tags.list_tags()
    print(c(" Nevet tags ", "title") + f"  {len(rows)} tag{'s' if len(rows) != 1 else ''}\n")
    if not rows:
        print("  No tags yet: make them on the web app's Tags page.\n")
    for t in rows:
        chip = tags.pretty_uid(t["uid"]) if t["uid"] else c("no chip linked", "grey")
        print(f"  {c(t['code'], 'bold')}  {t['kind_label']:<15} {ns.fit(t['name'], 28):<28}  {chip}  {c(str(t['scans']) + (' scan' if t['scans'] == 1 else ' scans'), 'grey')}")
    scans = tags.recent_scans(8)
    if scans:
        print("\n " + c("Latest scans", "bold"))
        for s in scans:
            print(f"  {s['at'][5:16].replace('T', ' ')}  {s['via']:<7} {s['who'] or '':<10} {ns.fit(s['result'] or s['code'] or s['uid'] or '', 60)}")
    print()


def run_reader(port=None, use_stdin=False, nfc=False, name="gate", check=False):
    title = "Tag check (nothing is logged)" if check else f"Tag reader '{name}'"
    if use_stdin:
        print(c(f" {title} ", "title") + "  Scan cards on the USB reader (Ctrl+C to stop)\n")
        last = {}
        for line in sys.stdin:
            raw = line.strip()
            if not raw:
                continue
            uid = f"{int(raw):08X}" if raw.isdigit() and len(raw) in (8, 10) else raw      # readers that type the number in decimal
            if time.time() - last.get(uid, 0) < 2:
                continue
            last[uid] = time.time()
            show(post_scan(uid, "keyboard", name, check), uid)
        return 0
    port = port or find_flipper()
    if not port:
        print("No Flipper Zero found. Plug it in by USB (and close qFlipper), or use --port /dev/ttyACM0, or --stdin for a USB card reader.")
        return 1
    try:
        f = Flipper(port)
    except OSError as e:
        print(f"Can't open {port}: {e}. Close qFlipper, and check you're in the 'dialout' group (sudo usermod -aG dialout $USER, then log in again).")
        return 1
    try:
        if not f.wake():
            print(f"The Flipper on {port} isn't answering. Unlock it, go to its home screen, and try again.")
            return 1
        print(c(f" {title} ", "title") + f"  Flipper on {port} · hold a tag or fob to its back (Ctrl+C to stop)\n")
        if not check:
            print(c("  Scan your hero fob first, then tap tags: they're logged as you for 2 minutes.\n", "grey"))
        cmds = [("rfid read", 4)] + ([("nfc detect", 3)] if nfc else [])
        last_uid, last_at = None, 0
        while True:
            for cmd, wait in cmds:
                uid, tech = f.scan(cmd, wait)
                if not uid or (uid == last_uid and time.time() - last_at < 3):
                    continue
                last_uid, last_at = uid, time.time()
                print(c(f"  {time.strftime('%H:%M:%S')}  {tech.upper()} {ns.SEP} {' '.join(uid[i:i + 2] for i in range(0, len(uid), 2))}", "grey"))
                show(post_scan(uid, tech, name, check), uid)
                time.sleep(1.2)                                   # take the tag away
    except KeyboardInterrupt:
        print()
        return 0
    except OSError as e:
        print(f"\nThe Flipper connection stopped ({e}).")
        return 1
    finally:
        try:
            f.close()
        except OSError:
            pass


def tag_base():
    """Where tag links point: the address saved on the Tags page, NEVET_JOIN_URL, or the welcome screen's address."""
    import sqlite3
    try:
        con = sqlite3.connect(f"file:{ns.FARM_DB}?mode=ro", uri=True)
        r = con.execute("SELECT value FROM app_settings WHERE key = 'tag_base_url'").fetchone()
        con.close()
        if r and r[0]:
            return r[0].rstrip("/") + "/"
    except sqlite3.Error:
        pass
    sys.path.insert(0, str(ns.REPO / "scripts"))
    import nevet_screen
    env = {**nevet_screen.env_file(), **os.environ}
    if env.get("NEVET_JOIN_URL"):
        return env["NEVET_JOIN_URL"].rstrip("/") + "/"
    t = nevet_screen.join_target(ns.funnel_state())
    return (t["url"] or "http://nevet.local:8000/join").rsplit("/join", 1)[0] + "/"


def export(out_dir=None, push=False, port=None):
    tags = _tags_module()
    base = tag_base()
    out = Path(out_dir or Path.home() / "nevet-flipper")
    files = []
    for t in tags.list_tags():
        url = base + "t/" + t["code"]
        files.append(("nfc", tags.file_name(t, "nfc"), tags.flipper_nfc(t, url)))
        if t["kind"] == "hero" or t["tech"] in ("em4100",):
            if not t["uid"]:
                tags.link_uid(t["id"], tags.em4100_id(t), "em4100")
                t = tags.get(t["id"])
            files.append(("lfrfid", tags.file_name(t, "rfid"), tags.flipper_rfid(t)))
    for folder, name, body in files:
        (out / folder / "nevet").mkdir(parents=True, exist_ok=True)
        (out / folder / "nevet" / name).write_text(body)
    print(f"Wrote {len(files)} Flipper file{'s' if len(files) != 1 else ''} to {out}/ (links start with {base}).")
    print("Copy the nfc/ and lfrfid/ folders onto the Flipper's SD card (qFlipper → File manager → SD card).")
    if not push:
        return 0
    port = port or find_flipper()
    if not port:
        print("No Flipper Zero found to push to.")
        return 1
    f = Flipper(port)
    try:
        if not f.wake():
            print("The Flipper isn't answering.")
            return 1
        for folder in sorted({x[0] for x in files}):
            f.command(f"storage mkdir /ext/{folder}/nevet")
        for folder, name, body in files:
            path = f"/ext/{folder}/nevet/{name}"
            data = body.encode()
            f.command(f"storage remove {path}")
            f.buf = b""
            f.send(f"storage write_chunk {path} {len(data)}\r".encode())
            end = time.time() + 4
            while b"Ready" not in f.buf and time.time() < end:
                f.read(0.2)
            if b"Ready" not in f.buf:
                print(f"  {name}: the Flipper didn't accept it (its firmware may not have write_chunk). Copy it with qFlipper instead.")
                f.send(b"\x03")
                f.until_prompt(2)
                continue
            f.send(data)
            f.until_prompt(6)
            print(f"  sent {path}")
        print("Done: on the Flipper, NFC → Saved (or 125 kHz RFID → Saved) → nevet.")
    finally:
        f.close()
    return 0


def main(args):
    if args.what in (None, "list"):
        list_tags()
        return 0
    if args.what in ("reader", "check"):
        return run_reader(args.port, args.stdin, args.nfc, args.name, check=args.what == "check")
    if args.what == "export":
        return export(args.dir, args.push, args.port)
    return 2
