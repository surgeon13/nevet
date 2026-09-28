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
- Insta360 Air (USB, exposes itself as a UVC webcam — no vendor SDK needed)
- Camera capture device: `/dev/video0` (MJPEG up to 3008x1504, H264 at 1920x960)

## Repo layout

```
scripts/                    capture_photo.sh, capture_video.sh, test_camera_scripts.sh, wifi_watchdog.sh
  scripts/lib/log.sh          shared timestamped logging helper
webapp/                      Flask app: gallery, login, live logs, game stats
  webapp/app.py
  webapp/game_stats.py         importable helper for logging game stats
  webapp/logging_config.py     rotating file logging setup
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
                           # (defaults 5 and 15; use "off" to disable updates)
```

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

## Manual commands

```bash
./scripts/capture_photo.sh            # one timestamped photo
./scripts/capture_video.sh [seconds]  # one timestamped video (default 10s)
./scripts/test_camera_scripts.sh      # full validation suite
./scripts/fix_orientation.sh          # one-time: flip existing photos/videos 180°
python3 scripts/backfill_captures.py  # one-time: add existing photos/videos to the database
./scripts/health_report.sh            # why is the Pi dropping offline? paste this output
```

Captured media lives in `~/camera_captures/{photos,videos}/YYYY-MM-DD/`,
organized by date with an incrementing counter — deliberately kept outside
the repo (see `.gitignore`) since it's runtime data, not code.

## Logging

All logs live under `~/camera_captures/logs/` — one file per subsystem:

| File | Written by |
|---|---|
| `logs/capture.log` | `capture_photo.sh` / `capture_video.sh` — every attempt, success, and failure |
| `logs/watchdog.log` | `wifi_watchdog.sh` — every WiFi check (latency, signal strength), reconnects, reboots, health checks |
| `logs/webapp.log` | The Flask app — logins, rejected API calls, stats writes |

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
