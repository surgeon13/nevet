# Changelog

## 2026-09-29 (activity)

- Log in with one tap: saved players appear as hero portraits (last
  player on the device first), then just the password.
- Every action records who did it. Older logs are credited to the
  plant's owner.
- "Log an action" screen (floating Log button on every page): pick the
  action (watering, pruning, fertilizing, weeding, pest control,
  feeding worms, harvest, sprouted, transplant, check-up, gave away),
  one or more plants or the whole garden, and optional amount, growth
  stage, note. Shows XP gained and level-ups.
- "Add a plant" (plant or worm bin, sown or planted) counts as your
  planting action.
- Dashboard: garden activity for Everyone or Just me — totals, actions
  by type, actions per day (14 days), growing now / grown before,
  latest actions, and a by-player table. Only the last 3 photos.
- Hero profiles: growing now, grown before, actions by type and per
  day, latest actions. XP now counts actions the player did.
- New Activity page: full history filtered by player, action, plant
  and period. Plant pages show who did what.
- Harvest no longer marks a plant finished unless "last harvest" is
  ticked; planting/sprouting only move a plant forward, never back.
- Nav: Activity, Heroes, Gallery, System; two rows on phones.
- FIX: fix_orientation.sh let ffmpeg swallow its file list, so a batch
  run flipped only the first file(s). Now uses -nostdin, records what it
  flipped (never flips twice) and takes `--before DATE`.
- Cleanup: removed the old add-asset / log-event forms, unused
  functions and styles; docs updated to match the app.

## 2026-09-28 (accounts)

- Real log-in: each player has a hero name + password (salted hash);
  the old single shared password (`WEBAPP_PASSWORD`) is gone. Every page
  now needs a log-in except `/healthz` and the API-key stats endpoint.
- Sign up creates your hero, or claims an existing hero without a
  password (so `M` keeps its plants). First account is admin.
- Players edit only their own hero; admin can edit any and set a new
  password for players who forget. `scripts/users.py` does the same
  from the terminal (list, reset-password, make-admin).
- Account page to change password; log out; "Add a player" for adding
  family members while staying logged in. `WEBAPP_OPEN_SIGNUP=false`
  limits sign-up to logged-in players.
- Security: form tokens (CSRF), SameSite cookies, 30-day sessions,
  pause after repeated wrong passwords, no open redirects, and a random
  session key is generated if `.env` still has the placeholder.
- "Play as" replaced by the logged-in player.

## 2026-09-27 (auto-update)

- New `scripts/auto_update.sh` + `nevet-update.timer`: checks GitHub every
  N minutes (second installer argument, like the photo interval:
  `sudo ./install.sh 5 15`, or `off`), pulls new versions, restarts the
  web app when needed and rolls back automatically if it doesn't come
  back healthy. Never overwrites local edits; quiet when offline.
- `--check` mode to see whether an update is waiting without changing
  anything.
- Updates panel on the Logs page; update.log rotated weekly.
- install.sh validates the interval arguments and fixes repo file
  ownership (a `git pull` run as root breaks later pulls).

## 2026-09-27 (heroes)

- Growers are now RPG heroes. Create one with just a username (no
  password), pick a class (Gardener, Worm Tamer, Forager, Beekeeper,
  Druid) and customize looks (skin, hair, eyes, mouth, colours) and
  gear (head, outfit, tool, back, companion) with a live 3D preview.
- Heroes are drawn procedurally in 3D (`static/js/hero3d.js`) from
  `static/assets/heroes/catalog.json`; items have rarities like an RPG
  inventory. Real icons can replace drawn ones via an `icon` field.
- Character-select roster, hero profile with level and XP earned from
  real farm activity (logs, harvests, plants), and "Play as" to pick
  your hero; the nav shows who you're playing.
- Existing growers keep their data and get a unique default look.
- Farm records (assets, logs) still need the admin login.

## 2026-09-24 (reliability)

- FIX: watchdog judged "offline" by ping only, so on networks that block
  ping it bounced a working WiFi connection every 2 minutes. It now uses
  HTTP/TCP checks and tells apart "link down" (reconnects) from
  "internet down but WiFi fine" (leaves WiFi alone).
- Reconnect escalates: device reconnect -> WiFi radio off/on ->
  NetworkManager restart (at most every ~10 min). Never reboots.
- Web app self-heal: watchdog checks /healthz and restarts the app if
  it stops answering twice in a row. systemd never gives up restarting.
- Web app now served by waitress (production server) instead of Flask's
  development server.
- WiFi power saving turned off permanently (common Pi 3B dropout cause).
- Watchdog log now includes under-voltage, temperature, free memory and
  disk use on every check.
- New scripts/health_report.sh: one-screen diagnosis.
- install.sh no longer aborts when offline; sudo rules for the watchdog
  are limited to exact commands and validated with visudo first.

## 2026-09-24

- Watchdog no longer reboots the Pi. It logs and retries WiFi forever;
  timelapse capture and the database keep working offline.
- New `captures` table: every photo/video is recorded in farm.db
  (kind, path, time, size, timelapse/manual, online/offline).
  `scripts/backfill_captures.py` imports existing files.
- New `webapp/static/assets/` folder (icons, textures, models, sounds),
  served live with no restart.
- Shared `static/js/nevet3d.js` helper for 3D views (WebGL fallback,
  theme colours, labels, battery-friendly pause when tab hidden).
- 3D Garden on the Assets page: each plant drawn by its life stage,
  drag to rotate, pinch to zoom, tap to open.

## [0.1.0] — Initial release

First public version of the repo. Everything below shipped together as
part of this initial release.

### Camera capture
- `capture_photo.sh` — timestamped, incrementally numbered photo
  capture, organized into per-day folders, with a burned-in visible
  timestamp overlay. Retries once if the camera hands back a corrupt
  first frame (a known UVC quirk right after opening the device).
- `capture_video.sh` — same pattern for video clips; the camera's
  native H264 stream is copied directly (no re-encoding) with the
  timestamp embedded as container metadata.
- `test_camera_scripts.sh` — end-to-end validation: checks the
  environment, performs a real photo and video capture, verifies file
  validity and counter increments.
- Confirmed the Insta360 Air works as a standard UVC webcam over USB
  on the Raspberry Pi 3B (`/dev/video0`, MJPEG up to 3008x1504, H264 at
  1920x960 — no vendor SDK required).

### Automation and reliability
- `nevet-timelapse.timer` — automatic periodic photo capture
  (configurable interval, default every 5 minutes).
- `wifi_watchdog.sh` — checks internet connectivity every run, logs
  every check (latency + WiFi signal strength, not just failures),
  retries WiFi reconnection via `nmcli`, and reboots the Pi as a last
  resort after 3 consecutive failed cycles. Also does a lightweight
  health check of the camera device and other services each run.
- All long-running processes run as systemd services/timers
  (`nevet-webapp`, `nevet-timelapse`, `nevet-watchdog`) with
  `Restart=always` / timer-triggered scheduling, so they survive SSH
  disconnects and reboots without manual restarting.

### Web app
- Flask app (`webapp/app.py`) serving:
  - a photo/video gallery grouped by date, with asset counts and total
    storage used;
  - a session-based login gating the stats and logs pages;
  - a live log console at `/logs` — three color-coded, auto-refreshing
    panels (watchdog / capture / webapp);
  - a game stats dashboard at `/stats` (XP, time played, compost,
    credits, plant growth), backed by a SQLite `stats_log` table;
  - `webapp/game_stats.py`, an importable helper plus a `POST
    /api/stats` HTTP endpoint for logging stats from game code.
- Simple, friendly dashboard mockup design (central hub with satellite
  data nodes, top tab bar, physical 3-button + jog-dial control bar)
  with a working light/dark theme toggle.

### Logging
- `scripts/lib/log.sh` — shared timestamped logging helper used by all
  shell scripts.
- Dedicated runtime log directory (`~/camera_captures/logs/`):
  `capture.log`, `watchdog.log`, `webapp.log`.
- `webapp/logging_config.py` — rotating file handler for the Flask
  app's own log.
- `config/nevet-logrotate.conf` — weekly rotation for the
  bash-generated logs, installed to `/etc/logrotate.d/nevet`.

### Project structure
- Proper repo layout: `scripts/`, `webapp/`, `systemd/`, `config/`,
  `docs/`, `install.sh`, `.gitignore`, `LICENSE` (MIT), `README.md`.
- Systemd unit files as versioned templates
  (`__USER__`/`__HOME__`/`__REPO_DIR__` placeholders) rendered by
  `install.sh`, rather than generated ad hoc.
- `config/.env.example` — secrets template; `.env` itself git-ignored.
- `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/TROUBLESHOOTING.md`.

## Tooling note
- Claude (this chat) now has direct push access to this repo via a
  scoped, repo-limited fine-grained token, so future changes can be
  committed and pushed here directly, ready for `git pull` on the Pi.
