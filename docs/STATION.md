# Looking after the Nevet station

This guide is for the person who sets up and looks after the computer
that runs Nevet (we call it **the station**): usually a Raspberry Pi in the
garden shed, or an old PC. You don't need to be an expert. Copy the
commands exactly as they are written, one at a time, and read what the
screen says back. If you get stuck, [Troubleshooting](TROUBLESHOOTING.md)
has fixes for the usual problems.

Players don't need any of this: they only need the [player guide](GUIDE.md).

**Words used here**

- **Terminal**: the black window where you type commands. On the Pi you
  can use it directly (with a keyboard and screen) or from your own
  computer over **SSH** (`ssh your-name@raspi03b`).
- **sudo**: put in front of a command when it needs the computer's admin
  rights. It asks for your password.
- **Service**: a program the station starts by itself and keeps running,
  even after a restart or a power cut.
- **`nevet`**: Nevet's own command. Type `nevet` any time to see how the
  station is doing.

## Contents

1. [What you need](#what-you-need)
2. [Install Nevet](#install-nevet)
3. [Updates happen by themselves](#updates-happen-by-themselves)
4. [Check on the station: `nevet`](#check-on-the-station-nevet)
5. [Accounts and passwords](#accounts-and-passwords)
6. [Open Nevet from outside the garden](#open-nevet-from-outside-the-garden-tailscale)
7. [Open Nevet to everyone](#open-nevet-to-everyone-tailscale-funnel)
8. [The welcome screen with the join QR code](#the-welcome-screen-with-the-join-qr-code)
9. [Tags and the Flipper Zero](#tags-and-the-flipper-zero)
10. [WiFi and the USB antenna](#wifi-and-the-usb-antenna)
11. [The camera, photos and logs](#the-camera-photos-and-logs)
12. [For tinkerers](#for-tinkerers)

## What you need

- Raspberry Pi 3B
- Optional: Insta360 Air (USB, exposes itself as a UVC webcam — no vendor SDK needed),
  capture device `/dev/video0` (MJPEG up to 3008x1504, H264 at 1920x960)
- Optional: a USB WiFi antenna (dongle) for a stronger connection

**The camera is optional.** The web app never depends on it. Without one,
install with the timelapse off (`sudo ./install.sh off 15`); if the timer is
left on, photos are simply paused (logged once, not every 5 minutes) and
resume by themselves when a camera is plugged back in.

## Install Nevet

```bash
git clone https://github.com/surgeon13/nevet.git
cd nevet
sudo ./install.sh 5 15     # photo every 5 min, check for updates every 15 min
                           # (defaults 5 and 15; "off" disables either one)
sudo ./install.sh off 15   # no camera: timelapse off, updates every 15 min
```

### On a PC with Ubuntu Server (or Debian)

The same installer works on a regular PC (tested on Ubuntu 24.04 and the
22.04 Flask version). Without a camera, turn the timelapse off:

```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/surgeon13/nevet.git ~/nevet
cd ~/nevet
sudo ./install.sh off 15
nevet                      # shows the address to open: http://<pc-ip>:8000
```

- If the firewall is on (`sudo ufw status` says active):
  `sudo ufw allow 8000/tcp`.
- The watchdog works with NetworkManager or with systemd-networkd
  (Ubuntu Server's default), on a cable or WiFi; `nevet net` tests cable
  adapters too.
- The capture scripts are tuned for the Insta360 Air; other webcams need
  a different resolution in `scripts/capture_photo.sh`.
- To bring over the Pi's garden (players, plants, actions), copy its
  database once while the web app is stopped:
  ```bash
  sudo systemctl stop nevet-webapp
  scp user@raspi03b:webapp/farm.db ~/webapp/farm.db
  sudo systemctl start nevet-webapp
  ```
  Photos: `rsync -a user@raspi03b:camera_captures/photos/ ~/camera_captures/photos/`.
  The two machines don't sync afterwards; each keeps its own copy.

The installer creates `.env` from `config/.env.example` on first run. The
defaults work; change `WEBAPP_API_KEY` if other devices post stats, and set
`WEBAPP_OPEN_SIGNUP=false` if only existing players should add accounts. After
editing it:

```bash
sudo systemctl daemon-reload && sudo systemctl restart nevet-webapp
```

This installs and enables four systemd services, all of which survive
reboot, SSH disconnects, and crashes (`Restart=always` / timers):

| Service | What it does |
|---|---|
| `nevet-webapp.service` | Flask app on port 8000 — gallery at `/`, stats at `/stats`, live logs at `/logs` |
| `nevet-timelapse.timer` | Runs `scripts/capture_photo.sh` every N minutes |
| `nevet-watchdog.timer` | Every 2 min: checks WiFi and the web app, reconnects / restarts them if needed (never reboots) |
| `nevet-update.timer` | Every N min: checks GitHub for a new version, pulls it, restarts the web app, rolls back if it breaks |

To change either interval later, just run the installer again with new
numbers, e.g. `sudo ./install.sh 10 60`.

## Updates happen by themselves

`scripts/auto_update.sh` keeps the Pi on the latest version from GitHub:

- does nothing when offline, and only fast-forwards (never merges)
- restarts the web app only when web app files changed
- if the web app doesn't come back healthy within a minute, it rolls
  back to the previous version and skips that release until a newer one
  is published
- never overwrites edits made on the Pi: if tracked files were changed
  locally it waits and logs a warning (`git status` shows what)
- if an update changes services or dependencies, the log asks you to run
  `sudo ./install.sh` once

```bash
./scripts/auto_update.sh --check      # is there a new version? (changes nothing)
./scripts/auto_update.sh              # update right now
sudo systemctl start nevet-update     # same, via the service
```

Everything it does is in `~/camera_captures/logs/update.log` and in the
**Updates** panel on the Logs page.

**Companion repos.** Every update check also updates the repos listed in
`config/extra_repos.conf` (right now the acid synth,
[kg13-acid-space](https://github.com/surgeon13/kg13-acid-space)). Each one
is a read-only copy in `~/nevet-extras/<name>`, downloaded the first time
and then kept on the latest commit of its branch; local edits there are
never overwritten. No restart is needed: the web app serves them at
`/extras/<name>/` (logged-in players only, listed names only). To add one,
add a line `name  git-url  [branch]` to the config.

```bash
./scripts/update_extras.sh --check    # what would change
./scripts/update_extras.sh            # update them now
```

`nevet_status.py` lists each one under Updates.

## Check on the station: `nevet`

After `sudo ./install.sh`, type **`nevet`** in any SSH/terminal session for a
coloured one-screen summary:

- **System**: web app, timelapse, watchdog, updates, camera, Tailscale,
  disk, with a fix hint for anything wrong.
- **Station**: the Pi's name and model, CPU temperature, CPU load, memory,
  and whether the power supply has been too weak (under-voltage) or the Pi
  slowed down from heat.
- **Addresses**: the home-network address(es), the router, the farm's
  **outside (internet) address** (checked at most every 15 minutes), the
  **Tailscale address** and name, the public Funnel address when Nevet is
  open to everyone, and the links to open the website from each place.
- **Network**: each WiFi adapter and cable, which one carries the internet,
  router ping, last speed test, data since boot.
- **Web app traffic**: data sent today / yesterday / 7 days, by kind and by
  where visitors came from.
- **Last 24 hours**, the **garden** (actions, plants by stage, worm bins,
  active heroes, this week's harvest, groups and connections, map, the
  invite code, companion repos), **today at the farm** (what was logged
  today and the to-do list, the same as the dashboard), and the **latest 5
  garden actions and system events**.

```bash
nevet            # summary
nevet -n 10      # latest 10 instead of 5
nevet -w         # live view, refreshes every 5 s (Ctrl+C to stop)
nevet net        # network test: every WiFi adapter, ping + 5 MB download (~30 s)
nevet net --quick   # same without the download
nevet ts         # can Nevet be opened from outside? (Tailscale check)
nevet public on  # open Nevet to everyone (Tailscale Funnel); off / status
```

**Web app traffic.** The web app counts every request and the bytes it sent and received,
per day, by type (photos & videos, static files such as the 3D libraries,
pages, API) and by how the visitor connected (home network or Tailscale).
Counts are kept in memory and written to `farm.db` (table `web_traffic`)
every 30 seconds, so the SD card isn't written on every request. Checks
the Pi makes to itself (watchdog, updater) aren't counted. Sizes include
HTTP headers but not WiFi/TCP overhead, so the radio moves a bit more.
Yesterday's totals are also written to `webapp.log` once a day.

Before re-running the installer it also works as
`python3 ~/nevet/scripts/nevet_status.py`.

## Accounts and passwords

Everything in the web app needs a log-in. Each player has an account:
a hero name and a password (stored only as a salted hash).

- **First time:** open the web app and **Sign up**. The first account
  becomes the **admin**. If you already had heroes from before (like
  `M`), sign up with the same name to claim that hero with its plants
  and logs.
- **Adding people:** anyone can sign up from the log-in page, or a
  logged-in player uses **Add a player** on the Heroes page. Set
  `WEBAPP_OPEN_SIGNUP=false` in `.env` to allow only the second way.
- **Forgot a password:** the admin opens that player's hero page and
  sets a new one, or on the Pi (as your normal user, not sudo):

```bash
python3 scripts/users.py list
python3 scripts/users.py reset-password NAME
python3 scripts/users.py make-admin NAME
```

You stay logged in for 30 days per device. Players can change their
password on the **Account** page (from their hero page). After 8 wrong
passwords from one device, log-in pauses for a few minutes.

## Open Nevet from outside the garden (Tailscale)

[Tailscale](https://tailscale.com) gives the Pi a private address
(`100.x.y.z`) that works from anywhere, on mobile data too, but only for
devices logged in to **your** Tailscale account. Nothing is opened to the
internet. It also works on guest/café WiFi, where devices often can't
reach each other directly.

1. On the Pi (once):
   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up          # open the link it prints, log in
   ```
2. On your phone/laptop: install the Tailscale app and log in with the
   **same account**, then switch it on.
3. Open `http://100.x.y.z:8000` (or `http://raspi03b:8000` with MagicDNS).

**`nevet ts`** checks every step and says what's missing: service
running, logged in, the Pi's address, key expiry, whether the web app
answers on the Tailscale address, the internet path (UDP / relays), and
which of your devices are online in Tailscale. The most common reasons it
"never connects": the phone isn't on Tailscale or uses another account,
the app is switched off, or the Pi's login key expired (in the admin
console, open the Pi and choose **Disable key expiry**).

The watchdog restarts `tailscaled` if it stops and logs when Tailscale
goes online or gets logged out; `nevet` shows a Tailscale row.

## Open Nevet to everyone (Tailscale Funnel)

Tailscale (above) is private: only your own devices get in. To let anyone
open Nevet from anywhere, like friends, volunteers or other gardens, switch on
**Tailscale Funnel**. It gives the Pi a public https address
(`https://raspi03b.<your-tailnet>.ts.net`), with no router changes and no
open ports at home:

```bash
nevet public on        # open Nevet to the internet; prints the address
nevet public status    # is it open, and where
nevet public off       # back to home + Tailscale only
```

The first time, Tailscale may print a link to allow Funnel and HTTPS for
your tailnet: open it, click allow, and run `nevet public on` again. If it
complains about permissions, run `sudo tailscale set --operator=$USER` once.

What changes when Nevet is public:

- Everyone needs to **log in**, as before; nothing is visible without an
  account.
- People signing up **from the internet** need the **invite code**. An
  admin finds it on the Account page and can make a new one at any time (the
  old one stops working). At home and on your Tailscale devices no code is
  needed. To let anyone join without a code, set `WEBAPP_PUBLIC_SIGNUP=true`.
- Wrong passwords are counted per visitor (their real address, not the
  tunnel's), so the lockout still works.
- Over https the login cookie is marked secure; at home plain http keeps
  working.
- The stats API refuses the default key from the internet: set your own
  `WEBAPP_API_KEY` if other machines post stats over the internet.

## The welcome screen with the join QR code

A full-screen, minimal dashboard for a screen by the garden (the Pi's own
HDMI display, or any terminal over SSH) that invites people to join:

- a big **QR code** that phones read with their camera; it opens sign-up;
- three steps (scan, pick a hero name and password, log what you do);
- the address to type instead, and the invite code when it's needed;
- the garden in numbers (heroes, plants growing, actions this week, kg
  harvested), the next event, and a rotating line of what's happening;
- a footer with the station's status and how many people scanned the code
  and joined from it.

It fits itself to the screen: a big QR code with double-size modules on a
large display, a smaller one and a one-line header on an 80×24 console.

```
nevet screen            show it (q or Esc to leave, r to refresh)
nevet screen on         show it on the Pi's display (tty1) at every boot
nevet screen off        give the display back to the login prompt
nevet screen status     is it on?
```

`nevet screen on` needs the service from `sudo ./install.sh` (run it once
after this update). The QR code opens `/join` (which counts the scan, then
goes to sign-up) on, in order: `NEVET_JOIN_URL` from `.env` if you set it
(e.g. your own domain); the public Tailscale Funnel address when Nevet is
open to the internet (`nevet public on`), with the invite code filled in
unless `WEBAPP_PUBLIC_SIGNUP=true`; otherwise the home network address
(phones on the garden's WiFi). The QR code is made by `webapp/qr.py`, with no
extra packages.

### Events on the welcome screen

The screen lists the events coming up. When one is less than 30 days
away, the QR code takes turns: 20 seconds for joining Nevet, then 15
seconds for joining the event (key **e** switches by hand, **a** goes back
to taking turns). The event code opens `/e/<id>` on the same address, with
the invite code when sign-up needs one, so new people can sign up from it
and land on the event. Event links (on the dashboard, the event page and
the printable posters) start with the address set on the Tags page, or
`NEVET_JOIN_URL`. Printed posters only carry the invite code when an admin
picks **Poster for new people**.

## Tags and the Flipper Zero

How tags work for players is in the [player guide](GUIDE.md#tags-tap-a-sticker-to-log). This part is about
the equipment.

**With a Flipper Zero** (testing tags and handling farm data):

- **Flipper .nfc** (each tag): an NTAG215 holding the tag's link. On the
  Flipper (NFC → Saved) you can emulate it and tap a phone against the
  Flipper to test the tag before buying stickers, or write it to a sticker.
- **Flipper .rfid** (hero fobs): an EM4100 key; write it onto a blank T5577
  fob with the Flipper (125 kHz RFID → Saved → Write). The reader then knows
  the fob.
- `nevet tags export` writes all the files into `~/nevet-flipper/` (`nfc/`
  and `lfrfid/` folders to copy with qFlipper); `--push` sends them to a
  Flipper plugged in by USB (experimental).
- `nevet tags reader`: the Flipper plugged into the Pi becomes the **gate
  reader**. Scan your hero fob, then tap tags within two minutes: farm
  cards, plant tags (their "reader logs" action) and event tags are logged
  as you. A fob on its own checks you in to the event that's on. New chips
  show up on the Tags page under "Scanned, not linked yet", to link in one
  click.
- `nevet tags check`: says what each scanned chip is, without logging, for
  testing a batch of tags.
- `nevet tags`: the list of tags and the latest scans.

The reader uses the Flipper's USB command line (`rfid read`; close qFlipper
first, and add your user to the `dialout` group once:
`sudo usermod -aG dialout $USER`). Reading NFC chips through the Flipper's
command line depends on its firmware (`--nfc` tries); for NFC at the gate, a
USB card reader that types the UID works too: `nevet tags reader --stdin`.
Readers post to `/api/tags/scan`, allowed from the Pi itself or with
`WEBAPP_API_KEY`.

## WiFi and the USB antenna

The Pi 3B's built-in WiFi is 2.4 GHz only with a tiny antenna. A USB WiFi
dongle usually does better (bigger antenna, often 5 GHz). Nevet handles any
number of adapters: the watchdog watches and reconnects whichever one
carries the internet, and turns WiFi power saving off on all of them.

1. **Measure first:** `nevet net`. It tests every connected adapter
   (router ping, internet ping, packet loss, 5 MB download), says which is
   faster, and saves the result to `~/camera_captures/logs/network.log`, so
   you can compare before/after moving the Pi or the antenna.
2. **Use the antenna first:**
   ```bash
   sudo ~/nevet/scripts/wifi_antenna.sh usb    # antenna first, built-in = backup
   ~/nevet/scripts/wifi_antenna.sh             # show which adapter is used
   sudo ~/nevet/scripts/wifi_antenna.sh undo   # back to built-in only
   ```
   `usb` copies the WiFi network the Pi is on (name + password) into a
   NetworkManager profile tied to the USB adapter and gives it a better
   route, so traffic goes through the antenna. The built-in WiFi stays
   connected: if the antenna is unplugged or fails, nothing is lost. It
   survives reboots.
3. **Run `nevet net` again** to confirm the antenna wins.

Tips: a short USB extension cable lets you raise the antenna away from the
Pi (the board and its power supply are noisy). A dongle draws power too;
if `nevet` shows under-voltage, use the official 5.1 V / 2.5 A supply with a
short cable.

**Not every USB WiFi adapter works on Linux.** If `lsusb` lists it but no
`wlan1` appears in `ip link`, Linux has no driver for its chip (`nevet`
and `nevet net` point this out). Old adapters are often unsupported, e.g.
Netgear WNA3100 v1 (Broadcom BCM43231) and Linksys WUSB300N (Marvell
88W8360). Chips with built-in Linux drivers: MediaTek MT7601U / MT7610U /
MT7612U, Ralink RT5370 / RT5372, Atheros AR9271 (e.g. TP-Link TL-WN722N
**v1**; later versions use other chips). The same model name can hide
different chips in different hardware versions, so check the version.

**A WiFi extender is often the better fix**: no driver needed. Best of all,
connect the Pi to the extender's Ethernet port with a cable; Nevet uses
the cable automatically.

`nevet net` also lists the WiFi networks in range with their signal and
says when a saved network is clearly stronger than the one in use. When
the WiFi gives the Pi no IPv4 address (weak signal, or a busy guest
network running out of addresses) the Pi may still be online over IPv6,
but GitHub updates and the home-network address need IPv4: `nevet` shows
an IPv4 warning and the watchdog reconnects to ask for one.

## The camera, photos and logs

```bash
./scripts/capture_photo.sh            # one timestamped photo
./scripts/capture_video.sh [seconds]  # one timestamped video (default 10s)
./scripts/test_camera_scripts.sh      # full validation suite
./scripts/fix_orientation.sh --before YYYY-MM-DD   # flip photos taken before the camera fix
python3 scripts/backfill_captures.py  # one-time: add existing photos/videos to the database
./scripts/health_report.sh            # why is the Pi dropping offline? paste this output
./scripts/wifi_antenna.sh             # which WiFi adapter carries the internet
```

Captured media lives in `~/camera_captures/{photos,videos}/YYYY-MM-DD/`,
organized by date with an incrementing counter — deliberately kept outside
the repo (see `.gitignore`) since it's runtime data, not code.

### Logs

All logs live under `~/camera_captures/logs/` — one file per subsystem:

| File | Written by |
|---|---|
| `logs/capture.log` | `capture_photo.sh` / `capture_video.sh` — every attempt, success, and failure |
| `logs/watchdog.log` | `wifi_watchdog.sh` — every WiFi and web app check (signal, power, temperature), reconnects, restarts |
| `logs/webapp.log` | The Flask app — logins, rejected API calls, stats writes, daily traffic totals |
| `logs/network.log` | `nevet net` — one line per adapter per test (signal, ping, loss, download) |

Shell scripts share `scripts/lib/log.sh` for consistent timestamped logging.
`webapp.log` self-rotates via Python's `RotatingFileHandler` (1MB × 3 backups);
`capture.log` and `watchdog.log` rotate weekly via `config/nevet-logrotate.conf`,
installed to `/etc/logrotate.d/nevet` by `install.sh`. None of `logs/` is
committed to the repo (see `.gitignore`) — it's runtime data, not code.

```bash
tail -f ~/camera_captures/logs/capture.log
tail -f ~/camera_captures/logs/watchdog.log
tail -f ~/camera_captures/logs/webapp.log
```

The same three logs are also viewable live, color-coded, auto-refreshing
every 5s, at `/logs` in the web app (login required).

Handy service commands:

```bash
systemctl status nevet-webapp.service
systemctl status nevet-timelapse.timer
systemctl list-timers nevet-timelapse.timer nevet-watchdog.timer
journalctl -u nevet-timelapse.service -f
journalctl -u nevet-webapp.service -f
tail -f ~/camera_captures/logs/watchdog.log
```

## For tinkerers

### Where things are

```
scripts/                    capture_photo.sh, capture_video.sh, test_camera_scripts.sh, wifi_watchdog.sh,
                            wifi_antenna.sh, nevet_status.py (the `nevet` command)
  scripts/nevet_tags.py       `nevet tags`: tag list, the gate reader (Flipper Zero or USB reader), Flipper export
  scripts/nevet_screen.py     `nevet screen`: the welcome dashboard with the join QR code
  scripts/lib/log.sh          shared timestamped logging helper
  scripts/lib/camera.sh       "is a camera plugged in?" check shared by the capture scripts
webapp/                      Flask app: dashboard, heroes, garden map, gallery, logs, game stats
  webapp/app.py
  webapp/garden_map.py         garden map data (GeoJSON beds, paths, points, plant pins)
  webapp/about.py              numbers, version and "what's new" for the About popup
  webapp/relations.py          relationship kinds (parent, spouse, sibling...) and group types
  webapp/bulk.py               "olive x 5" lists -> many plants at once, spread over a bed
  webapp/timeline.py           the farm's story, day by day, for the Time page
  webapp/tags.py               NFC / RFID tags and QR labels, the reader API's logic, Flipper Zero files
  webapp/qr.py                 QR codes (for the welcome screen), no extra packages
  webapp/events.py             events: parties, festivals and gatherings, and the data they gather
  webapp/today.py              today's actions + to-dos for the dashboard
  webapp/plants.py             plant species catalog + "which plant is this?" from its name
  webapp/static/js/plants3d.js 3D models of every plant, at every growth stage
  webapp/static/assets/plants/catalog.json  the species list (add new plants here)
  webapp/static/js/farm3d.js   the farm: all heroes doing group activities in 3D
  webapp/static/js/farm-worlds.js  the land around the farm, one per farm setting
  webapp/static/vendor/        Leaflet + Leaflet-Geoman (map drawing), MIT licensed
  webapp/game_stats.py         importable helper for logging game stats
  webapp/logging_config.py     rotating file logging setup
  webapp/traffic.py            counts the web app's data transfer
systemd/                     unit file templates (rendered by install.sh)
config/
  config/.env.example          secrets template — copy to .env, never committed
  config/nevet-logrotate.conf  log rotation for the bash-generated logs
docs/                         guides: player, kids, station, architecture, API, troubleshooting
install.sh                    one-shot installer
CHANGELOG.md                  project history
```

### The game stats API (the XP tab)

The game stats page (`/stats`) is the dashboard's **XP** tab (next to
Dashboard and Time); Events has its own node.

`webapp/game_stats.py` is a small helper for logging XP / time played /
compost / credits / plant growth to the same SQLite DB the web app reads:

```python
from game_stats import log_stat
log_stat(xp=120, compost=3.5, credits=50, plant_growth=0.82)
```

Or over HTTP, e.g. from other code/devices on the network:

```bash
curl -X POST http://<pi-ip>:8000/api/stats \
  -H "X-API-Key: $WEBAPP_API_KEY" -H "Content-Type: application/json" \
  -d '{"xp": 120, "compost": 3.5, "credits": 50}'
```

Full request/response shapes and the DB schema are in [`docs/API.md`](API.md).

### Settings you can change in the code

- **Today at the farm**: the limits (3 days without water, 7 days without
  worm food, 14 days without sprouts) are at the top of `webapp/today.py`.
- **The farm story (Time)**: built by `webapp/timeline.py` from the most
  recent 240 days that have something in them.
- **Farm lands**: `/farm?world=desert` previews a land without saving it.
  The chosen land is saved for the whole station.
- **The live channel** (`/farm?tv=1`) draws at most 30 frames a second,
  keeps the screen awake and reloads every 6 hours to pick up new plants
  and heroes. The 3D runs on the device showing it, not on the Pi. Log in
  once on that device (logins last 30 days).
- **The party synth** uses the sound engine from
  [kg13-acid-space](https://github.com/surgeon13/kg13-acid-space)
  (`engine/acid-engine.js`). Without it downloaded yet, a simple built-in
  beat plays instead.
- **The garden map** reads tiles and place search from the internet
  (OpenStreetMap, Esri); the garden's own data stays on the Pi. Other
  programs can read the map at `/api/map.geojson` with the API key.

### Adding things

- **A new plant species:** copy a similar entry in
  `webapp/static/assets/plants/catalog.json`, give it a new `id`, its names
  and keywords, and adjust the shape settings (height, leaf, fruit shape and
  colour...). No code changes needed.
- **New hero clothes and gear:** see the README in `webapp/static/assets/heroes/`.
- **A new land around the 3D farm:** add it to `CONFIG` and a scenery
  function in `webapp/static/js/farm-worlds.js`.
- **Streaming the farm to YouTube or Twitch:** open the live view
  (`/farm?tv=1`) on a computer running OBS, as a browser source or a
  captured window, and stream from there. The Pi 3B can't draw the 3D and
  encode video at the same time.

How everything fits together is in [Architecture](ARCHITECTURE.md), and every
web address and database table in the [API reference](API.md).
