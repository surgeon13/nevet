# Architecture

Nevet runs entirely on a Raspberry Pi 3B, attached to an Insta360 Air
camera over USB (it exposes itself as a standard UVC webcam at
`/dev/video0` — no vendor SDK involved). Everything is orchestrated by
systemd: three services/timers run continuously in the background,
independent of any SSH session being open.

## Component overview

```
                     ┌────────────────────┐
   /dev/video0  ───▶ │  scripts/           │
  (Insta360 Air)     │  capture_photo.sh   │──▶ camera_captures/photos/YYYY-MM-DD/
                     │  capture_video.sh   │──▶ camera_captures/videos/YYYY-MM-DD/
                     └─────────┬───────────┘
                               │ triggered every N min by
                               │ nevet-timelapse.timer
                               ▼
                     ┌────────────────────┐
                     │ nevet-timelapse     │
                     │ .service (oneshot)  │
                     └────────────────────┘

   WiFi/gateway ───▶ ┌────────────────────┐
                     │ scripts/            │
                     │ wifi_watchdog.sh     │──▶ camera_captures/logs/watchdog.log
                     └─────────┬───────────┘
                               │ every 2 min via
                               │ nevet-watchdog.timer
                               ▼
                     ┌────────────────────┐
                     │ nevet-watchdog       │
                     │ .service (oneshot)  │
                     └────────────────────┘

                     ┌────────────────────┐
   Browser  ───────▶ │ webapp/app.py        │──▶ camera_captures/logs/webapp.log
  (port 8000)        │ (Flask, always on)   │──▶ webapp/game_stats.db (SQLite)
                     └────────────────────┘
                       run continuously by
                       nevet-webapp.service
```

All three services are `enable`d, so they survive reboots, SSH
disconnects, and crashes (`Restart=always` on the webapp; timers
re-fire the oneshots on schedule regardless of prior success/failure).

## Directory layout

```
nevet/                      <- this repo, cloned wherever you like
├── scripts/                 shell scripts (capture, watchdog, tests)
│   └── lib/log.sh            shared logging helper, sourced by the others
├── webapp/                   Flask app: gallery, login, stats, live logs
│   ├── app.py
│   ├── game_stats.py          importable helper for logging game stats
│   ├── logging_config.py      rotating file logging setup
│   ├── templates/
│   └── static/
├── systemd/                  unit file templates (__USER__/__HOME__/__REPO_DIR__
│                              placeholders, rendered by install.sh)
├── config/
│   ├── .env.example           secrets template -> copied to .env (git-ignored)
│   └── nevet-logrotate.conf   rotates the bash-generated logs
├── docs/                      this folder
└── install.sh                 one-shot installer

~/camera_captures/            <- runtime data, NOT part of the repo (.gitignore)
├── photos/YYYY-MM-DD/
├── videos/YYYY-MM-DD/
├── logs/
│   ├── capture.log
│   ├── watchdog.log
│   └── webapp.log
├── .photo_counter
├── .video_counter
└── .watchdog_fail_count

~/webapp/game_stats.db        <- SQLite DB (game stats), also git-ignored
```

The split is deliberate: code lives in the repo and is versioned;
captured media, logs, counters, and the stats database are runtime
state and never committed (`.gitignore` excludes `camera_captures/`,
`logs/`, `*.db`, `*.log`, and `.env`).

## Why systemd instead of a loop script

Early iterations used a raw foreground `python3 -m http.server` and a
manually-started `mjpg_streamer` process — both died the moment the
SSH session closed or the Pi rebooted. Every long-running piece now
runs as a systemd service or timer instead:

- **`nevet-webapp.service`** — `Type=simple`, `Restart=always`. If the
  Flask process crashes, systemd restarts it within 5 seconds.
- **`nevet-timelapse.timer`** — fires `nevet-timelapse.service`
  (`Type=oneshot`, runs `capture_photo.sh` once) every N minutes
  (configurable via `install.sh <minutes>`, default 5). Using a timer
  rather than a `while true; do ...; sleep; done` loop means each run
  is independently logged and inspectable via `journalctl`, and a
  failure in one run doesn't kill the loop.
- **`nevet-watchdog.timer`** — same pattern, every 2 minutes, running
  `wifi_watchdog.sh`.

## The WiFi watchdog's escalation logic

1. Every run: ping `8.8.8.8` (falling back to the default gateway).
   Log the outcome — `OK` with latency/signal, or `FAIL` — regardless
   of whether it succeeded, so `watchdog.log` is a continuous timeline
   rather than only failure events.
2. On failure: attempt reconnection via `nmcli` (bring the active
   WiFi connection down and back up, or toggle the radio if none is
   found), wait 10s, and re-check.
3. A consecutive-failure counter persists across runs in
   `.watchdog_fail_count`. After **3 consecutive failed cycles**
   (roughly 6 minutes at the default 2-minute interval), the script
   reboots the Pi as a last resort.
4. Because all three systemd units are `enable`d, a reboot brings
   photo capture, the web app, and the watchdog itself back online
   automatically — no manual re-login or re-start needed.

The watchdog also does a lightweight health check each run (camera
device present, capture scripts executable, the other two services
active) and logs any problems it finds, without taking action on
those — they're visibility, not auto-remediated.

## The web app

A small Flask app, deliberately kept to a handful of files:

- **Gallery (`/`)** — scans `camera_captures/{photos,videos}/` at
  request time (no caching/database for media — the filesystem *is*
  the source of truth) and renders a date-grouped view with counts and
  total storage used.
- **Login (`/login`)** — a single shared password
  (`WEBAPP_PASSWORD`), session-based. Gates `/stats` and `/logs`.
- **Stats (`/stats`)** — reads the `stats_log` SQLite table (see
  `docs/API.md`) and shows the latest snapshot plus a 50-row history.
- **Logs (`/logs`)** — polls `/api/logs` every 5 seconds and renders
  three color-coded console panels (watchdog / capture / webapp),
  tailing the last 150 lines of each log file.
- **`/api/stats`** and **`/api/logs`** — see `docs/API.md`.

See `docs/API.md` for the full HTTP surface and `docs/TROUBLESHOOTING.md`
for known failure modes and fixes.
