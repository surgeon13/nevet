# Changelog

## 2026-10-07 (family and groups)

- The Locs hairstyle now stands up in pointed locs like a pineapple crown.

- Connections need the other person's confirmation (badge by their name, Confirm or Decline on their profile).
- **Family & connections** on each profile: parents and children, husband
  and wife, partners, siblings, grandparents, guardians, friends,
  neighbours, volunteers and more, shown from both sides.
- **Groups**: households, families, couples, community gardens and volunteer
  teams, with coordinators and members; open groups can be joined.
- New tables `relationships`, `groups`, `group_members` (created in place on
  existing databases).

## 2026-10-07 (party dances)

- Party mode now rotates through 14 dances, one after another: Disco,
  Pogo, Voodoo, Yemenite step, Robot, Chicken dance, The sprinkler, Twist,
  Running man, Hands up, and the Israeli folk dances Hora, Mayim Mayim and
  Debka, plus the Conga line. The title shows the current dance.

## 2026-10-06 (your garden on the farm)

- The farm builds its garden from the **garden map**: beds in their real
  shapes with plants where they were pinned, worm beds, compost,
  greenhouse, pond, orchard, lawn, wildflowers, walkways, fences, drip
  lines, taps, beehives, trees, rain barrels, sheds, benches and the Nevet
  node. With nothing drawn yet it keeps its default beds.
- New map area type: **Worm bed**. On the farm, the more worm feedings
  this month, the more worms.
- Plants not watered for 3+ days droop and show a water drop; heroes water
  those first, and refill at the garden's taps too.
- A chalkboard in the farm yard shows this week's real numbers.

## 2026-10-06 (plants in 3D)

- **3D plant models** for about 90 species (tomatoes, cherry tomatoes,
  peppers, mint, basil and the other herbs, greens, roots, squash and
  melons, beans, corn, flowers, berries, fruit trees, palms, succulents,
  mushrooms, microgreens, compost worms, bees), each at every growth
  stage from seed to harvested and dried.
- Nevet works out which plant it is from the name and variety (English
  or Hebrew); pick a different one on Add a plant (with a live preview)
  or on the plant's page.
- Plant page: turn the model, tap a stage to see the plant from seed to
  harvest. Plants page: the 3D garden uses the real models (it also
  works again: it stopped drawing on its first frame), and every row has
  a small picture.
- The farm's beds, greenhouse and new field grow the real models too.

## 2026-10-06 (party mode, no more bumping)

- **Party!** on the farm, next to the campfire: dance floor with flashing
  tiles, string lights, disco ball and beams, balloons, confetti and music
  notes; the player who opened the farm is the DJ, everyone else grooves in
  their own style, does group moves and forms conga lines. Optional synth
  beat with the speaker button.
- Heroes no longer bump into things or each other: routes are planned on a
  navigation grid around beds, buildings, the cart, campfire and pond; work
  spots are reserved; heroes steer around each other and re-plan if stuck.
- Only the heroes come to the farm: companion pets stay home.

## 2026-10-06 (the farm)

- Tap the brain on the dashboard to visit **the farm**: a full-screen 3D
  farm where all heroes walk in through the gate and do group activities
  together: harvest festival, watering round, planting day and a
  campfire dance at night. Auto mode cycles through them.
- The farm has the garden's real plants (with name signs) and worm bins,
  a barn, windmill, greenhouse, pond with ducks, chickens, butterflies,
  fireflies, drifting clouds and stars. Follow a hero by tapping them;
  save a photo with the camera button.
- Heroes now swing their legs when they walk, and heroes and farm props
  are merged into far fewer draw calls so 16 heroes run smoothly.
- The About popup now opens from the ⓘ button; a hint shows "Tap the
  brain to visit the farm" until the first visit.

## 2026-10-03 (simpler top bar, mycelium hub)

- The row of section links under the top bar is gone: every section is
  on the dashboard hub, and the Nevet logo leads back to it.
- The About popup is much more compact: one line about Nevet, the
  garden's numbers, what's new and the version.
- New hub look: fine mycelium threads braid out from the brain to each
  section, with tiny spores, flowing colour and sparks of light
  travelling out like signals.

## 2026-10-02 (garden map, living hub, more hair)

- New **Garden map** page: street map or satellite view, place search and
  "my location", zoom down to single beds. Draw beds and areas, paths and
  irrigation lines, drop points (tap, compost, tree, tool shed, beehive,
  Nevet node...), pin plants and worm bins. Edit names, types, colours,
  notes and shapes; delete with Undo and a Recently removed list; areas in
  m² and dunams, lines in metres; show/hide by kind; download as GeoJSON.
  The admin saves the garden's spot so the map opens there.
- Plant pages link to the map; the dashboard hub has a Map bud.
- Read-only `/api/map.geojson` (with the API key) for other programs and,
  later, other Nevet gardens.
- Dashboard vines come alive: waves of colour flow from the brain to each
  section, branches sway and leaves catch the light.
- Tap the brain (or ⓘ) for **About Nevet**: the garden's numbers,
  version, what's new and links.
- 12 new hair styles: long dreadlocks, punk spikes, mullet, pompadour,
  beehive, powdered wig, samurai top knot, victory rolls, space buns,
  flat-top, viking braids and curtains.

## 2026-10-02 (gender, recycle bin, more hero items, plant hub)

- Gender for heroes: female, male, non-binary, other or not specified
  (the default). It sets the body shape and small face details, and
  shows on the hero page.
- Delete a hero: players delete their own (password needed), the admin
  any hero except the last admin. Deleted heroes go to a **Recycle bin**
  (admin): restore with everything, delete for good (garden history is
  kept, credited to nobody), or empty the bin.
- More customizing: 4 new eye styles (shades, dizzy, puppy, monocle),
  4 mouths, 4 facial hair styles (chevron, soul patch, sideburns, wizard
  beard), earrings (new slot), 8 hats, 7 extravagant outfits, 7 funny
  tools and 6 backs including a flickering jet pack and an aqualung.
  Some items move (propeller, jet flames, flapping wings, bubbles,
  sparkles, disco shimmer).
- New **Companion** tab: 4 new companions (frog, chick, ladybug,
  hedgehog), plus name, colour, size and accessory for any companion.
- Dashboard: the lines around the brain are now vines with leaves; each
  section is a bud, and the highlighted one blooms while its vine grows
  out again. Softer garden backdrop and icon chips for the plant counts.
- Existing heroes look exactly the same (new settings start at their
  defaults).

## 2026-10-01 (hero variety and movement)

- Many more hero options (companions unchanged): 9 new hair styles
  (ponytail, pigtails, side braid, bob, side swept, curly, afro, locs,
  buzz cut), new hair, skin, eye and outfit colours, 4 new eye styles
  (starry, hearts, fierce, glasses), 4 new mouths, a new Facial hair
  category (stubble, mustache, handlebar, goatee, full beard), 10 new
  head items (backwards cap, trucker cap, bucket hat, bandana, sweatband,
  beret, ranch hat, beekeeper veil, acorn helmet, harvest crown), 7 new
  outfits, 6 new tools and 5 new back items.
- Existing heroes keep their exact look: default looks only pick from
  the original options, and the new facial hair starts at "None".
- Heroes move: idle breathing and sway, blinking, and an emote every
  4-9 seconds (wave, look around, hop, tool swing, fist pump, nod,
  twirl, stretch, cheer). Tools move with the hand. Tap a hero to make
  it emote; a hop when trying on items in the customizer. Reduced-motion
  settings are respected.

## 2026-10-01 (IPv6)

- The web app also listens on IPv6 when the system supports it (falls
  back to IPv4 only otherwise), so it still answers when the WiFi gives
  the Pi no IPv4 address.
- `nevet` shows the Pi's IPv6 address to open when there's no IPv4
  address on the home network; long addresses are never cut off.

## 2026-10-01 (PC / Ubuntu Server)

- Installs on a regular PC with Ubuntu Server: tested on Ubuntu 24.04
  (Python 3.12, Flask 3.0) and the 22.04 Flask 2.0 stack.
- Watchdog reconnects through systemd-networkd (`networkctl reconfigure`,
  then a networkd restart) when NetworkManager isn't installed; shows
  WiFi signal in dBm without NetworkManager and no signal for a cable.
- `nevet` and `nevet net` show and test cable adapters (eth0, enp3s0...),
  hide Docker/VM bridge addresses, and give camera-aware install hints.
- Tailscale timestamps with nanoseconds parse on Python 3.10.

## 2026-09-30 (Tailscale, WiFi diagnosis)

- New `nevet ts`: step-by-step remote access check (installed, service,
  logged in, address, key expiry, web app on the Tailscale address,
  UDP/relay path, your devices online) with the exact fix for each step
  and how to open Nevet from a phone.
- `nevet` shows a Tailscale row and the MagicDNS address; hints now
  wrap instead of being cut off on phone screens.
- Watchdog restarts `tailscaled` if it stops and logs Tailscale state
  changes; install.sh enables tailscaled and prints the Tailscale URL.
- Faster WiFi recovery: NetworkManager restart from the 3rd failed check
  (was the 5th), repeated every ~8 min.
- IPv6-only detection: when the WiFi gives no IPv4 address the watchdog
  logs it and reconnects for a new lease; `nevet` warns, and
  `nevet net` tests over IPv6 instead of giving up.
- `nevet` / `nevet net` point out USB WiFi adapters Linux has no
  driver for; `nevet net` lists networks in range and suggests a clearly
  stronger saved network.
- health_report.sh includes Tailscale.

## 2026-09-30 (no camera, USB WiFi antenna, traffic)

- Camera is optional. Photo/video capture checks for the camera first:
  without one it logs "photos paused" once (not a failure every 5
  minutes) and resumes by itself when a camera is plugged back in.
  `sudo ./install.sh off 15` turns the timelapse off. The watchdog logs
  camera plug/unplug and no longer warns about a stopped timelapse you
  turned off; `nevet` shows Camera "not connected" and Timelapse "off"
  in grey instead of as problems.
- Multiple WiFi adapters: the watchdog detects USB antennas, checks and
  reconnects whichever adapter carries the internet, logs it
  ("via wlan1 (USB) signal=78% rate=... router=3.1ms"), and turns power
  saving off on every adapter. install.sh allows reconnects on wlan0-3.
- New `nevet net`: tests every connected adapter (router and internet
  ping, packet loss, 5 MB download), compares them, logs results to
  `logs/network.log`. `--quick` skips the download.
- New `scripts/wifi_antenna.sh usb`: makes the USB antenna the main
  connection, built-in WiFi stays connected as a backup; `undo` reverts.
- Web app traffic accounting: requests and bytes sent/received per day,
  by type and by home network / Tailscale, in the new `web_traffic`
  table (buffered, written every 30 s and on shutdown); daily totals in
  webapp.log.
- `nevet` gained Network (adapters, router ping, last speed test, data
  since boot) and Web app traffic (today / yesterday / 7 days, by type
  and connection) sections; the addresses list shows which adapter each
  address belongs to.
- health_report.sh reports every WiFi adapter, not just wlan0.

## 2026-09-30 (terminal status)

- New `nevet` command (installed by install.sh): coloured status summary
  for SSH — system health with fix hints, website addresses, last 24 h
  counts, garden totals, latest 5 garden actions and system events.
  Fits phone-width terminals; `-n N`, `-w` live view, `--no-color`.

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
