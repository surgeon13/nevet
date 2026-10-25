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
  wrong-password limits; **`farm_db.py`** the farm database (with `relationships`, `groups` and `group_members` for families and volunteer groups, kinds in `relations.py`) (players,
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
  The land around the farm is a setting (`static/js/farm-worlds.js`: its
  `CONFIG` for classic, desert, seaside, forest, snow, jungle, savanna,
  island and city, and `build()` for the scenery, given farm3d.js's helpers) stored as `app_settings.farm_world`, set by
  `POST /farm/world` and passed as `data.world` (`?world=` previews one);
  it picks the ground, sky, fog, ground cover and the scenery builder, and
  little moving things register a step function in `WORLD_ANIM`. The
  layout lives at the top of farm3d.js: `LAND` is the outer fence, about
  4.2 times the old farm's ground. Inside it are the farmyard (`FARM`, its
  fence along the play park with the gate), the campfire field to the east
  (`FIRE`, `ARENA_W`, `CAMP_R`), the party field to the west (`PARTY_C`,
  `STAGE_HX`/`STAGE_HZ`, `STAGE`, the big wheel `WHEEL`) and the play park
  (`PLAY`, `HEDGE_X`). `BOX`, 1 m beyond the fence, is what the scenery
  goes round: farm-worlds.js gets it and places its trees, animals and
  props outside it. The navigation grid covers the whole farm. Each
  obstacle has a bounding box, and `buildNav()` marks only the cells it
  covers. A hero pushed off its route re-plans, and long walks turn into
  a jog. The Play activity hands out stations (`PST`: the ring, football,
  swings, slide, seesaw, trampoline, sandbox, watching the ring, touchline)
  and `stepFootball()` runs the ball and both teams outside the path
  planner. The mud arena is built around the campfire, its size from the
  number of heroes (`ARENA_W`; wall and gate obstacles in `ARENA_OBST`);
  in the Campfire dance everyone else dances round it (`CAMP`,
  `campSlot()`, `stepCamp()`: the party's dances, ring dances move the
  ring), `stepRing()` plays the station's bout (gather → intro → fight →
  outro, `RING.phase`) or the champion's ceremony, and in the Play park
  `stepMatch()` plays the station's football match. The fire is drawn
  with a noise shader on camera-facing planes (`FLAME_FS`, `flameBoard()`,
  also the torches) with a glow, ground light, embers, smoke and a
  flickering light (`FIREFX`). For the champion, its `uRainbow` uniform
  turns the flames rainbow. Show effects (`FX`): `makeJet()` /
  `fireJet()` are flame jets, used for the arena's braziers and the
  stage's pyro; `launchWork()` fires a firework, a pool of `Points`
  bursts; `makeCannon()` / `fireCannon()` are confetti cannons. All three
  are skipped when the device asks for reduced motion. The party stage
  (floor, booth, truss, LED wall with the `LED_FS` shader, speakers) stays
  up all the time and rests between parties (`stepStage()`); `PARTY.group`
  holds what only shows at a party. `FARM_DARK` / `lightTarget()` keep the farm
  in daylight unless the sun / moon button says night, and the campfire
  dims to dusk. `dressForFight()` rebuilds a wrestler with hero3d's `fight` body
  (`a.fightColor`, the corner's colour; gold plus a belt for the champion)
  and `undress()` changes them back. `addGear()` puts the style's props on a hero's
  arms, head and body and `removeGear()` takes them off.
- **Games** — `games.py` decides the matches the farm shows, so everyone
  watching sees the same one and the results can be kept. Powers come from
  the logs (`SKILL_WORK`, plus days active, event check-ins and volunteer
  jobs), the level and the class; `effective()` compresses them and
  `contest()` turns two of them into the chance a move lands. `now_playing()`
  makes the current and next campfire slot (32 s: the tournament's next
  bout, or the champion's ceremony, or a new tournament; `game_tournaments`
  keeps the field, the rounds and the champion) and football match
  (60 s slots) the first time the farm asks (`/api/games/now`), picking
  whoever played least lately and never the same hero in both at once.
  Tables: `game_matches` (the script the farm plays, as JSON),
  `game_players` (who, which side, the power used, won/lost/draw) and
  `game_stats` (one row per stat per hero per match).
- **Events** — `events.py` keeps events (`events`) and what they gather:
  `event_rsvps`, `event_tasks` + `event_task_people`, `event_checkins`,
  `event_headcount` (every +1/−1 at the gate with its time, which gives the
  arrivals curve), `event_notes` (the live log) and `event_feedback`
  (tables made in `farm_db.get_conn()`). An event's map is `map_features`
  rows with `event_id` set and their own types (`garden_map.EVENT_CATEGORIES`);
  the garden map, its API and the 3D farm only see rows without one. The
  event map page reuses `templates/map.html` + `garden_map.js` with
  `D.event` and the garden as a faded `D.background`, saving through
  `/api/events/<id>/map/*`. `today.py`, `timeline.py` and the farm page
  (`data.event`) read events too.
- **Invites and the mother tree** — `invites.py`. Every player has an
  `invite_code` (made when first needed, renewable). `/i/<code>` stores it
  in the session and logs an `opened` row in `invite_events`. Sign-up
  takes the farm's code or any player's code, records `growers.invited_by`
  and `invited_via` (link, code, added, set) and logs it.
  `set_inviter()` refuses loops (`descendants()`). `tree()` gives the nodes
  (outfit colour, join day, inviter) and the accepted relationships with
  both sides' words. `timeline.story()` adds `tree` and `counts` and tells
  "invited by" in the day's lines. `static/js/time3d.js` draws the tree
  (`treeG`: time runs up a twisted trunk, a radial layout by family size,
  branches and ribbons grown with `setDrawRange`) and golden arcs over the
  vine.
  `invites.community()` turns heroes, invites, connections and groups into
  a bloom level (`1 - e^(-score/40)`) and the wonders it unlocks
  (`BLOOM`). The farm gets it as `data.community`: `PG` makes the plants
  taller, the mother tree (`MOTHER`) grows with it, and `stepBloom()`
  animates plant blossoms, petals, the rainbow, flocks, balloons,
  shooting stars and the aurora (`BLOOMFX`).
- **Tags** — `tags.py` keeps `tags` (code, kind plant/action/event/hero,
  target, the reader's action, an optional chip UID) and `tag_scans` (every
  phone tap and reader scan). `/t/<code>` is what NFC stickers and QR labels
  hold; `/api/tags/scan` (loopback or API key) runs `tags.reader_scan()`:
  a hero fob sets who's scanning at that reader for two minutes, then tags
  log as that hero. `tags.flipper_nfc()` builds an NTAG215 dump with the
  link as an NDEF URI record (Flipper NFC file format v4) and
  `flipper_rfid()` an EM4100 key. `scripts/nevet_tags.py` drives a Flipper
  Zero over its USB command line (`rfid read`) and exports the files.
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

## Companion repos (extras)

`config/extra_repos.conf` lists repos that live next to Nevet. `scripts/update_extras.sh`
(run by `auto_update.sh` on every check) keeps a shallow read-only copy of each in
`~/nevet-extras/<name>` and writes `~/camera_captures/.update/extras.json`. `webapp/extras.py`
serves them at `/extras/<name>/` (configured names only, never `.git`, login required).
The farm's party mode loads `/extras/acid/engine/acid-engine.js` (kg13-acid-space's
UI-less TB-303 + TR-909 engine, `window.AcidEngine`) and `static/js/party-synth.js`
(the docked synth interface, `window.NevetSynth`). The engine's per-step `onStep`
callback drives the farm's beat clock (`beatsAt()`, phase-locked to the steps), lights
and dancers; `setViewShift()` lifts the 3D view while the dock is open.

## Public access

`webapp/netaccess.py`: `LocalProxyFix` (WSGI) trusts `X-Forwarded-For/-Proto/-Host` only on
requests from the Pi itself (Tailscale Funnel's proxy), so `request.remote_addr` is the real
visitor and `request.is_secure` reflects https; `where(addr)` → local / lan / tailscale /
internet. Internet sign-ups need `app_settings.invite_code`; the session cookie's Secure flag
follows `request.is_secure`. `nevet public on|off|status` wraps `tailscale funnel`.
