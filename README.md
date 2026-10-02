# Nevet

A small web-based game console running on a Raspberry Pi 3B with an
Insta360 Air camera: automatic photo/video capture, a WiFi/health
watchdog with automatic recovery, and a Flask web app (gallery, live
log console, and a login-gated game stats dashboard).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it all fits
together, [`docs/API.md`](docs/API.md) for the full HTTP/DB reference,
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) for known issues
and fixes, and [`CHANGELOG.md`](CHANGELOG.md) for the project's history.

## Hardware

- Raspberry Pi 3B
- Optional: Insta360 Air (USB, exposes itself as a UVC webcam — no vendor SDK needed),
  capture device `/dev/video0` (MJPEG up to 3008x1504, H264 at 1920x960)
- Optional: a USB WiFi antenna (dongle) for a stronger connection

**The camera is optional.** The web app never depends on it. Without one,
install with the timelapse off (`sudo ./install.sh off 15`); if the timer is
left on, photos are simply paused (logged once, not every 5 minutes) and
resume by themselves when a camera is plugged back in.

## Repo layout

```
scripts/                    capture_photo.sh, capture_video.sh, test_camera_scripts.sh, wifi_watchdog.sh,
                            wifi_antenna.sh, nevet_status.py (the `nevet` command)
  scripts/lib/log.sh          shared timestamped logging helper
  scripts/lib/camera.sh       "is a camera plugged in?" check shared by the capture scripts
webapp/                      Flask app: dashboard, heroes, garden map, gallery, logs, game stats
  webapp/app.py
  webapp/garden_map.py         garden map data (GeoJSON beds, paths, points, plant pins)
  webapp/about.py              numbers, version and "what's new" for the About popup
  webapp/static/vendor/        Leaflet + Leaflet-Geoman (map drawing), MIT licensed
  webapp/game_stats.py         importable helper for logging game stats
  webapp/logging_config.py     rotating file logging setup
  webapp/traffic.py            counts the web app's data transfer
systemd/                     unit file templates (rendered by install.sh)
config/
  config/.env.example          secrets template — copy to .env, never committed
  config/nevet-logrotate.conf  log rotation for the bash-generated logs
docs/                         architecture, API, troubleshooting
install.sh                    one-shot installer
CHANGELOG.md                  project history
```

## Install

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

### Automatic updates

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

## Status in the terminal

After `sudo ./install.sh`, type **`nevet`** in any SSH/terminal session for a
coloured one-screen summary: web app, timelapse, watchdog, updates, camera,
WiFi, power and disk (with a fix hint for anything wrong), the addresses to
open the website, the **network** (each WiFi adapter, which one carries the
internet, router ping, last speed test, data since boot), the **web app
traffic** (data sent today / yesterday / 7 days, split by photos, 3D files,
pages and API, home network vs Tailscale), the last 24 hours, the garden
totals, and the **latest 5 garden actions and system events**.

```bash
nevet            # summary
nevet -n 10      # latest 10 instead of 5
nevet -w         # live view, refreshes every 5 s (Ctrl+C to stop)
nevet net        # network test: every WiFi adapter, ping + 5 MB download (~30 s)
nevet net --quick   # same without the download
nevet ts         # can Nevet be opened from outside? (Tailscale check)
```

## Open Nevet from outside (Tailscale)

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

## Network and the USB WiFi antenna

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

## Web app traffic

The web app counts every request and the bytes it sent and received,
per day, by type (photos & videos, static files such as the 3D libraries,
pages, API) and by how the visitor connected (home network or Tailscale).
Counts are kept in memory and written to `farm.db` (table `web_traffic`)
every 30 seconds, so the SD card isn't written on every request. Checks
the Pi makes to itself (watchdog, updater) aren't counted. Sizes include
HTTP headers but not WiFi/TCP overhead, so the radio moves a bit more.
Yesterday's totals are also written to `webapp.log` once a day.

Before re-running the installer it also works as
`python3 ~/nevet/scripts/nevet_status.py`.

## Manual commands

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

## Logging

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

## Accounts

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

## Heroes

Growers are RPG-style heroes at `/growers` (the **Heroes** link in the
nav). Every account is a hero: pick a class and customize looks and
gear with a live 3D preview. Players can edit their own hero; the admin
can edit any.
Levels and XP come from real farm activity. Heroes are drawn by code
from `webapp/static/assets/heroes/catalog.json`; see the README in that
folder for adding items or real artwork.

Customizing: gender (female, male, non-binary, other, or not specified),
11 skins, 27 hair styles (ponytail, braid, afro, locs, long dreadlocks,
punk spikes, mullet, and styles from history: 1700s powdered wig, samurai
top knot, 40s victory rolls, 50s pompadour, 60s beehive, 80s flat-top,
90s curtains...), 16 hair
colours, 13 eye styles (glasses, shades, monocle, starry, dizzy...),
13 mouths, 9 kinds of facial hair (up to a wizard beard), 14 outfit
colours, 24 head items (chef hat, top hat, propeller cap, viking helmet,
flowerpot, halo...), 6 kinds of earrings, 20 outfits (tuxedo, disco,
astronaut, superhero, royal robe...), 19 tools (rubber chicken, frying
pan, bubble wand, magic wand...) and 15 back items (jet pack, aqualung,
balloons, turtle shell, angel and dragon wings...).

**Companion** tab: 8 companions (worm, snail, bee, sprout spirit, frog,
chick, ladybug, hedgehog). Give yours a name (shown above it), a colour,
a size (tiny to big) and an accessory (bow, party hat, flower, top hat,
crown).

**Deleting a hero:** on your hero page open **Delete my hero** and
confirm with your password; the admin can delete any hero except the
last admin. Deleted heroes go to the **Recycle bin** (admin only, linked
from the Heroes page): **Restore** brings the hero back with all its
plants and actions and its log-in; **Delete for good** removes the hero
but keeps the garden history (its actions show without a name). A name
in the bin can't be taken by a new sign-up until it's deleted for good.

The dashboard's brain is the garden's hub: vines grow out to each
section, carry soft waves of colour and sway a little (still with
"reduce motion"). Tap the brain, or the ⓘ button, for **About Nevet**:
the garden's numbers, the version running, what's new in the latest
update, and links.

Heroes move on the profile and customize pages: they breathe and blink,
and every few seconds play a short emote (wave, look around, hop, tool
swing, fist pump, nod, twirl, stretch, cheer), never the same one twice
in a row. Tap a hero to make it emote; trying on a new item makes it hop.
With "reduce motion" switched on in the device settings, heroes only
breathe and blink.

## Garden map

The **Map** page (nav bar, or the Map bud on the dashboard) puts the
garden on an open map: OpenStreetMap streets or satellite photos, zoomed
in far enough to draw single beds.

- **Find the garden:** search an address or place, or tap the location
  button. The admin then opens **Garden** and taps **Save this view as
  the garden's spot**, so the map always opens there.
- **Add to map:** draw a **bed or area** (tap its corners), a **path or
  line** (walkways, irrigation lines, fences), drop a **point** (water
  tap, compost, tree, tool shed, beehive, rain barrel, gate, Nevet
  node...) or **pin a plant or worm bin** where it grows. Corners snap to
  nearby shapes.
- Tap anything to name it, change its type or colour, add notes, **edit
  its shape** (drag corners) or **move** it, or delete it (**Undo**
  appears for a few seconds; **Recently removed** in the Garden list
  restores older ones). Areas show square metres (and dunams), lines
  their length.
- A pinned plant links to its page and to **Log an action**; plant pages
  have **Show on map** / **Pin on map**.
- **Garden** lists everything with show/hide switches per kind, total bed
  area and **Download map (.geojson)**. Other programs (later: other
  Nevet gardens) can read the map at `/api/map.geojson` with the API key,
  see `docs/API.md`.

Every player can add and change map items; each remembers who added and
last edited it. The map tiles and place search come from the internet
(OpenStreetMap, Esri), so the map needs a connection in the viewer's
browser; the garden's own data stays on the Pi. "My location" only works
over a secure link (https): see "Phone location on the map" in
`docs/TROUBLESHOOTING.md`.

## Game stats

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

Full request/response shapes and the DB schema are in [`docs/API.md`](docs/API.md).

## Useful operational commands

```bash
systemctl status nevet-webapp.service
systemctl status nevet-timelapse.timer
systemctl list-timers nevet-timelapse.timer nevet-watchdog.timer
journalctl -u nevet-timelapse.service -f
journalctl -u nevet-webapp.service -f
tail -f ~/camera_captures/logs/watchdog.log
```

## License

MIT — see [LICENSE](LICENSE).
