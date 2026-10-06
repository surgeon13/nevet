# Architecture

Nevet runs entirely on a Raspberry Pi 3B, attached to an Insta360 Air
camera over USB (it exposes itself as a standard UVC webcam at
`/dev/video0` — no vendor SDK involved). Everything is orchestrated by
systemd: the web app plus three timers (timelapse, watchdog, auto-update) run in the background,
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

All the services are `enable`d, so they survive reboots, SSH
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

## The WiFi watchdog

Runs every 2 minutes and **never reboots the Pi** (photo capture and the
database work offline). Each run:

1. Checks the internet over HTTP/TCP (ping alone is blocked on many
   networks) and tells apart *link down* (no IP / router unreachable)
   from *internet down but WiFi fine*.
2. Link down: reconnects, escalating from a device reconnect to a WiFi
   radio off/on to a NetworkManager restart (from the 3rd failed check,
   then every ~8 min).
   Internet down only: logs it and leaves WiFi alone.
3. Checks the web app on `/healthz` and restarts it after two misses.
4. Logs the adapter in use, signal, link rate, router ping, under-voltage,
   temperature, memory and disk every time.

It works with several WiFi adapters (built-in `wlan0` plus USB antennas):
it watches the one that carries the internet (the default route; set
`NEVET_WIFI_IFACE` to force one), turns power saving off on all of them,
and logs camera plug/unplug. `scripts/wifi_antenna.sh usb` makes a USB
antenna the preferred route with the built-in WiFi as backup, and
`nevet net` measures each adapter. `scripts/health_report.sh` summarises
the last 24 hours.

It also restarts `tailscaled` if it stopped, logs Tailscale state
changes, and when the WiFi gives no IPv4 address (online over IPv6 only)
it reconnects to ask for one. Reconnect escalation: device reconnect,
then radio off/on, then a NetworkManager restart from the 3rd failed
check (repeated every ~8 min).

The camera is optional: `scripts/lib/camera.sh` makes the capture scripts
skip quietly (logged once) while `/dev/video0` is missing.

## The web app

A Flask app served by waitress on port 8000:

- **`app.py`** routes; **`auth.py`** passwords, session key, CSRF and
  wrong-password limits; **`farm_db.py`** the farm database (players,
  plants, actions) with in-place migrations; **`heroes.py`** hero
  catalog, validation and XP; **`activity_views.py`** the dashboard /
  profile / history data and small view helpers.
- **Accounts** — every page except log-in, sign-up, `/healthz` and the
  API-key stats endpoint needs a player log-in. Players are growers
  with a salted password hash; the first account is admin. Deleting a
  hero is a soft delete (`growers.deleted_at`): binned heroes drop out
  of lists, counts and log-in until restored; deleting for good unlinks
  their plants and actions (`grower_id` set to NULL) before removing the
  row, so garden history survives.
- **Actions** — every log records who did it (`logs.grower_id`), so
  totals exist per player and for the whole garden: dashboard
  (Everyone / Just me), hero profiles, and the filterable `/activity`
  history.
- **The farm** — `/farm` passes up to 16 heroes, the garden's growing
  plants (species, stage, days since watered, feedings), the garden map
  projected to local metres (`garden_map.farm_layout()`) and this week's
  numbers (`farm_db.farm_numbers()`) to `static/js/farm3d.js`. With areas on
  the map, the bed area is built from the map (fitted, turned a quarter if
  that fits better), every shape registering its obstacles on the
  navigation grid; otherwise the farm uses its default beds. farm3d.js
  builds the farm from toon shapes, places each hero with `hero3d.js` and runs the group activities on a
  simulation clock. Static props and each hero's rig parts are merged into
  a few meshes (`NevetHero.merge`) to keep draw calls low on phones.
- **Plant models** — `static/assets/plants/catalog.json` lists ~90
  species as a model archetype (fruiting, herb, leafy, root, vine, stalk,
  flower, berry, tree, succulent, mushroom, microgreens, worms, hive) plus
  parameters, with English/Hebrew keywords. `plants.py` loads it (cached by
  mtime) and detects a plant's species from its name and variety;
  `assets.species` overrides it. `static/js/plants3d.js` builds a species
  at any growth stage from simple shapes and bakes it into one
  vertex-coloured mesh plus one for the produce (two draw calls), which
  the plant page, the Plants garden and thumbnails, the add-plant preview
  and the farm all use.
- **Garden map** — `garden_map.py` stores beds, paths, points and plant
  pins as GeoJSON in `map_features` (soft delete for undo) and validates
  every shape; `/map` draws them with Leaflet and Leaflet-Geoman
  (vendored in `static/vendor/`) over OpenStreetMap or Esri satellite
  tiles, which the viewer's browser fetches directly. `/api/map.geojson`
  is the read-only door for other programs and future Nevet nodes.
- **3D** — three.js (vendored in `static/js/`) draws the dashboard hub
  (brain with mycelium threads out to the section nodes; the highlighted one blooms), the
  plant garden, plant models (`plants3d.js`) and procedural heroes (`hero3d.js`, with idle motion,
  emotes and moving item effects); all of it runs in the viewer's
  browser, not on the Pi.
- **System logs (`/logs`)** — tails watchdog, capture, web app and
  update logs every 5 seconds.
- **Traffic** — `traffic.py` counts every response (requests, bytes in
  and out) per day, by type and by home network / Tailscale, buffers the
  counts in memory and writes them to the `web_traffic` table every 30 s
  and on shutdown. `nevet` shows the totals.

See `docs/API.md` for the full HTTP surface and `docs/TROUBLESHOOTING.md`
for known failure modes and fixes.
