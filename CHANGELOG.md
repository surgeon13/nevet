# Changelog

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
