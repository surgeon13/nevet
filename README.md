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

## Status in the terminal

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

Growers are RPG-style heroes at `/growers` (the **Heroes** bud on the
dashboard). Every account is a hero: pick a class and customize looks and
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

The dashboard's brain is the garden's hub: fine mycelium threads braid
out to each section, waves of colour and little sparks of light travel
along them, and they sway a little (all still with "reduce motion").
Every section is a node on the hub (there's no menu bar); the **Nevet**
logo at the top always leads back to it. The ⓘ button opens **About
Nevet**: the garden's numbers, the version running and what's new in
the latest update.

### The farm (tap the brain)

Tapping the brain dives into **the farm**: a full-screen 3D farm where
every hero (up to 16, the most recently active first) walks in through
the gate and joins a group activity:

- **Harvest festival**: heroes pick ripe produce from the beds and carry
  it to the cart, which fills up as they go; plants grow new fruit.
- **Watering round**: watering cans out, plants perk up and their soil
  darkens; empty cans get refilled at the hand pump.
- **Planting day**: heroes sow the new field and the sprouts grow into
  plants; a full field is harvested and sown again.
- **Campfire dance**: night falls, the fire is lit and everyone dances
  the same moves around it, the ring turning now and then.
- **Animal care**: everyone looks after the animals. Heroes kneel at the
  worm bins and worm beds to drop in scraps, scatter grain for the chickens
  (who come running to peck), throw bread to the ducks from the pond's shore
  (they swim over) and puff a smoker at the beehives on the garden map. Each
  hero goes on to a different animal next, so every animal gets visited.
- **Play park** (⚽): out through the gate there's a play park. About 40% of
  the heroes play football on a pitch with goals and nets, in two teams
  (the Tomatoes in red and the Blueberries in blue: their name tags take the
  team colour, and each team gets a keeper once it has three players); goals
  go up on the scoreboard with a GOAL! banner and a little celebration. The
  others take turns on the swings (pumping higher and higher), the slide
  (three goes each, queueing at the ladder), the seesaw, the trampoline
  (with a flip now and then) and in the sandbox, where a sandcastle grows
  while they dig; whoever finds everything taken cheers on the touchline.
  Two kites fly overhead.
- **Party!**: a stage between the yard and the pond. The dance floor is
  always full size (about 8.4 × 7.4 m, the pond moved east to make room) with the dancers spread over all of it
  (up to 19 dancers plus the DJ) and changes its light show every 8 beats
  (checkerboard, rippling diamonds, rolling stripes, a pinwheel, rings,
  sparkle); lit tiles pop on the kick. The DJ booth stands at the far end
  under a truss with chasing LEDs and a neon NEVET sign, with lasers fanning
  over the crowd, two moving spotlights, low fog, a disco ball with eight
  beams, string lights, balloons and confetti. Every 8 beats a spotlight
  from the sky picks one dancer for a dance-off solo. Whoever opened the
  farm is the DJ. The whole floor does one dance at a time and moves
  on to the next: Disco, Pogo, Voodoo, Yemenite step, Robot, Chicken
  dance, The sprinkler, Twist, Running man and Hands up, plus formation
  dances where everyone walks into place first: Hora (circle), Mayim
  Mayim, Debka (line) and the Conga line. The current dance is shown in
  the title. The speaker button plays a little synth beat (off until you
  tap it).
- **The party synth: TB-303 + TR-909.** The synth button in the top bar
  opens a little synth docked above the bottom bar (the picture moves up so
  the dance floor stays in view); the speaker button plays or stops it. Its
  sound engine comes from
  [kg13-acid-space](https://github.com/surgeon13/kg13-acid-space)
  (`engine/acid-engine.js`, kept up to date with the companion repos): a
  TB-303 bass line and a TR-909 drum kit on one 16-step pattern.
  - **303 tab**: tap a step to cycle on → accent → slide → rest, drag it up
    or down to pick the note; knobs for cutoff, resonance, envelope, decay,
    accent and drive, plus saw/square.
  - **909 tab**: a little drum machine with every drum on its own row
    (kick, snare, clap, closed hat, open hat, rim). Tap a square, or drag
    along a row to paint several; tap a drum's name to mute it; **SW**
    sets the swing (0, 15, 30, 45%).
  - Tap **303** or **909** to switch; tap the one you're on again to mute or
    unmute it (its dot goes dark when muted). − / + set the tempo, 🎲 makes a
    new pattern, ▾ hides the synth and keeps it playing. A tip line explains
    whatever you touch. The pattern and settings are remembered in your
    browser.
  - The party follows the music: the tempo and beat, the kick, accents, the
    filter and resonance, and the notes float up from the booth. Leaving
    party mode stops it. Without the engine downloaded yet, the speaker
    plays a simple built-in beat.

**Your garden, on the farm.** Once areas are drawn on the garden map,
the farm builds its garden from it, turned and scaled to fit behind the
lane: beds in their real shapes with each plant growing where it was
pinned (unpinned plants fill the beds, then pots), **worm beds** (a map
area type; the more worm feedings this month, the more worms), compost,
greenhouse (its plants stay inside), pond, orchard, lawn, wildflowers,
walkways, fences and drip lines, and the map's points: taps (heroes refill
their cans there too), beehives with bees, trees, rain barrels, tool sheds,
benches, gates and the Nevet node with its camera. Plants nobody has
watered for 3 days or more droop and show a water drop; on the watering
round heroes go to those first. A chalkboard in the yard shows this
week's real numbers: actions, harvests (and kilos), waterings, worm
feedings and plants growing. With nothing drawn on the map yet, the farm
keeps its own four beds.

**Auto** changes activity about every minute. Drag to look around,
pinch to zoom, tap a hero to follow them (they wave), tap the ground to
let go. The beds show the garden's real plants (as their 3D models, at
their stage) with name signs and the worm bins stand by the barn; only
the heroes come, companion pets stay home; there's also a barn, windmill, greenhouse,
pond with ducks, chickens, butterflies and fireflies. The camera button
saves a picture. Keys 1-7 pick an activity, A toggles auto, Esc goes
back. Heroes plan their routes around beds, buildings
and each other, and keep their own spot while working. The farm is just for fun: nothing there changes the garden's
records.

Heroes move on the profile and customize pages: they breathe and blink,
and every few seconds play a short emote (wave, look around, hop, tool
swing, fist pump, nod, twirl, stretch, cheer), never the same one twice
in a row. Tap a hero to make it emote; trying on a new item makes it hop.
With "reduce motion" switched on in the device settings, heroes only
breathe and blink.

## Adding many plants at once

**Plants → + Add many** (or the link on "Add a plant") takes a typed list:

```
olive x 5
mint x 3
yellow cherry x 3
basil x 3
bishops crown pepper x 3
```

"olive x 5", "5 olive", "5 x olive", "olive 5", "olive: 5" all work,
Hebrew names too. A preview shows each line with its count, name, an
optional variety and the 3D plant it detected (changeable), and the names
it will use. Every plant is added on its own (Olive 1 … Olive 5, numbered
on after any olives already there) with a planting log, so each tree or pot
keeps its own history. Pick how they start (seeds, seedlings, already
growing) and, if beds are drawn on the garden map, which bed: they are
pinned there, spread out. They show up on the farm right away; without a
garden map the farm's beds take two or three rows when there are many
plants. Up to 200 plants at a time.

### Farm settings: nine lands around the farm

The globe button in the farm's top bar picks the land around the farm.
The choice is saved for this Nevet, so everyone (and the live view) sees
the same farm; `/farm?world=desert` previews one without saving it.

- **Green valley** (the classic farm): meadows, wild flowers, round trees
  with apples and rolling hills.
- **Desert oasis**: sand and dunes, date palms around the pond, saguaro
  cacti, desert shrubs, sandstone boulders, two camels resting by the oasis,
  tumbleweeds rolling by and red flat-topped mesas on the horizon.
- **Seaside**: the farm sits by a beach: the sea with waves rolling in,
  a wooden pier, beach umbrellas and towels, a red and white lighthouse on a
  rocky point (its beam sweeps round at night), sailboats out at sea, gulls
  circling, palms and pines, and dune grass.
- **Deep forest**: hundreds of tall pines and a few broad trees all round,
  ferns, red toadstools, mossy rocks, fallen logs, two deer grazing at the
  forest's edge, and a misty green light.
- **Snowy mountains**: snow everywhere, pines heavy with snow, snowmen by
  the play park, a log cabin with smoke from its chimney, snow-capped peaks
  on the horizon and snow falling.
- **Jungle**: giant rainforest trees with buttress roots and hanging vines,
  palms and banana plants, big leafy ground cover and tropical flowers, a
  waterfall pouring off a cliff into a pool, an old stepped temple ruin and
  parrots flying over the canopy.
- **African bushland**: golden tall grass, flat-topped acacias, baobabs,
  termite mounds and rocky outcrops, giraffes browsing, elephants flapping
  their ears, zebras grazing, vultures circling and a snow-topped
  Kilimanjaro far away.
- **Island lagoon**: the farm is a Pacific island: a white beach ringed with
  palms, a turquoise lagoon you can see into, surf breaking on the reef,
  huts on stilts with a boardwalk, an outrigger canoe going round, dolphins
  leaping, a smoking volcano on a far island and tiki torches lit at night.
- **City farm**: an urban farm in the middle of town: sidewalks with street
  lights and trees in planters, a ring road with cars driving round and a
  zebra crossing, blocks of buildings whose windows light up at night,
  rooftop gardens and water towers, pigeons, and a GROW LOCAL billboard.

The farm itself (beds, barn, pond, party stage, play park) stays the same in
every setting, and the play park's border changes with it (a hedge, an adobe
wall, a white picket fence or logs). More settings can be added in
`static/js/farm-worlds.js` (its `CONFIG` and a scenery function).

## The farm as a live channel (24/7)

The TV button in the farm's top bar (or `/farm?tv=1`) turns the farm into a
live channel to leave running on a TV, tablet or old laptop:

- no buttons, just a **LIVE** badge with the farm's name, the activity and
  the clock;
- activities change by themselves, following the real time of day: harvest,
  watering, animal care, the play park and planting by day, campfire and party from 20:00
  to 06:00;
- the camera glides round the farm and every so often follows a busy hero
  for a while;
- when someone logs an action on Nevet, it pops up on screen within 30
  seconds ("Dana harvested Cherry tomato") and the heroes act it out;
- it keeps the screen awake, draws at most 30 frames a second, and reloads
  every 6 hours to pick up new plants and heroes. Tap the screen for the
  exit button.

The 3D runs on the device showing it, not on the Pi; the Pi only sends the
page and the new actions. Log in once on the TV device (logins last 30 days).
To stream it to YouTube or Twitch, open the live view on a computer running
OBS (as a browser source or a captured window) and stream from there; the
Pi 3B can't render and encode video itself.

## The welcome screen (`nevet screen`)

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

## Events (parties, festivals and gatherings)

**Events** on the dashboard (it took the place of the Stats node; the game
stats moved to the dashboard's **XP** tab) is where
the farm plans its parties, festivals, harvest festivals, workshops,
volunteer days, markets, kids' days and campfire nights, and keeps what
happened at them.

- **Plan one**: name, kind, day and time, where, a description, how many
  people fit, and what the heroes on the 3D farm do meanwhile (party,
  campfire, harvest, play park...). Whoever creates it (and the admin) can
  edit, cancel or delete it.
- **Map the surroundings**: every event has its own map on top of the
  garden map (the garden shows faded underneath): draw the stage, dance
  floor, food court, market stalls, camping, parking, kids' area, chill-out
  and keep-out areas; walkways, the emergency route, barriers, queue lines
  and power or sound cables; and pin the entrance, info point, stage/DJ,
  speakers, food stalls, bar, drinking water, toilets, first aid, campfire,
  tents, power, bins, photo spot and meeting point. Areas and lengths are
  measured as you draw.
- **Who's coming**: everyone answers Going / Maybe / Can't come, with how
  many guests (people without a hero) and what they'll bring; a bar shows
  how full it is when there's a capacity.
- **Volunteers**: the organizer lists the jobs (setting up, sound, cooking,
  the gate, cleaning up) with how many people each needs; heroes sign up,
  and jobs get ticked off.
- **On the day**: "I'm here" check-ins (the organizer can check people in
  too), a big +/− walk-in counter for the gate that counts without
  reloading the page, and a live log of what's happening.
- **Afterwards**: 1-5 star feedback with comments, and the farm camera's
  photos from those hours.
- **The data**: expected vs. came, the most people there at once, how many
  of those who said "going" checked in, the rating, volunteers, mapped
  area, a chart of people there every 15 minutes, and downloads: everyone
  in a CSV (opens in Excel, Hebrew names included), everything in JSON
  (answers, tasks, check-ins, every gate tap with its time, the log,
  feedback, photos and the map), and the event map as GeoJSON.

Events also show up elsewhere: **Today at the farm** says when one is on
today, tomorrow or right now (and asks if you're coming), the dashboard
node shows what's next, the **Time** story gets a page for each event that
took place, and while an event is on, the **3D farm** (and its live view)
joins in with the event's activity and name.

## Our farm story (the Time tab)

**Time** on the dashboard opens the farm's story as a 3D love story in green
and pink: two vines, the green garden and the pink of its people, winding
around each other from the first day to today through a soft pink sky.

- Every day something happened is a **blossom** on the vine, bigger on
  busier days.
- Days with a big moment get a glowing **heart**: the very first day ("Once
  upon a time…"), heroes joining, two heroes connecting (only once both
  confirmed), groups forming, a plant planted for the first time, the first
  harvest of each plant, big harvests. Love days get the brightest hearts.
- A card tells each day's story: what happened, who took part, how much
  was picked, photos taken.
- Drag, scroll, use the slider or the ‹ › buttons to travel; tap a blossom
  to jump to it; ▶ plays the story (it starts by itself the first time).

The story is built by `webapp/timeline.py` (the most recent 240 days with
something in them).

## Today at the farm

The dashboard opens with **Today at the farm**: what was logged today
(grouped, e.g. "Dror watered the whole garden · 05:41") and what needs
doing, worked out from the farm's own data:

- plants not watered for 3+ days (a whole-garden watering counts for all)
- worm bins not fed for 7+ days
- plants marked mature: ready to harvest
- seeds sown 14+ days ago with no sprouts logged
- connections waiting for you to confirm

Each to-do has a button that opens the log page with the right action and
plants already picked. The same summary pops up the first time you open
Nevet after logging in, and on your first visit each new day (only when
there's something to tell). The limits are at the top of `webapp/today.py`.

## Family, households and groups

Nevet is for small organic groups: couples, families with little children,
households, community gardens and volunteer teams.

- **Family & connections** on every profile: add who is your parent, child,
  spouse, partner, sibling, grandparent, guardian, aunt/uncle, cousin,
  housemate, friend, neighbour, mentor, coordinator/volunteer, fellow
  volunteer or "connected to". It reads from both sides ("Noa is Dana's
  child" / "Dana is Noa's parent") and uses mother/father, wife/husband and
  so on when the hero's gender is set. **Both people must agree**: when you
  add a connection the other hero gets a badge by their name and a Confirm
  button on their profile; until then it shows as "waiting" and only the two
  of you (and admins) can see it. Either person can decline, cancel or
  remove it later. An admin can confirm for a hero who has no account yet.
- **Groups** (Heroes, then Groups): a household, family, couple, community
  garden, volunteer team or other group with members and coordinators
  (member, coordinator, guest). The creator is coordinator; coordinators add
  and remove people and delete the group; anyone can leave; community
  gardens and volunteer teams can be joined by anyone. A group always keeps
  a coordinator.
- Connections are information only. They do not give anyone control over
  another hero.

## Plants in 3D

Every plant is drawn as a little 3D model of what it really is, at the
stage it's at: seed (a mound with seeds and a marker), sprouting,
seedling, growing (flowers, green fruit), mature (ripe fruit),
harvested (picked, cut back, or pulled out of the ground) and archived
(dried up). There are about 90 species: tomatoes and cherry tomatoes,
bell and chili peppers, eggplant, mint, basil, parsley, coriander, dill,
rosemary, thyme, za'atar, sage, chives, lavender, lettuces, kale, chard,
cabbage, carrots, radishes, beets, onions, garlic, potatoes, cucumbers,
zucchini, pumpkins, melons, beans, peas, corn, wheat, sunflowers and
other flowers, strawberries and other berries, citrus, olive, fig,
pomegranate and other fruit trees, date palm, banana, succulents,
mushrooms, microgreens, compost worms and a beehive.

Nevet works out the species from the plant's name and variety, in
English or Hebrew ("Cherry tomato", "עגבניית שרי", or "Tomato" with
variety "Cherry"). If it guesses wrong, or can't tell, pick the right
one: on **Add a plant** (the preview shows what it grows into) or on the
plant's page under the model (**change**). The models show on:

- the plant's page: turn it with a finger, and tap a stage under it to
  see how it looks from seed to harvest;
- the Plants page: the 3D garden and a small picture next to each name;
- the farm's beds.

To add a plant Nevet doesn't know yet, copy a similar entry in
`webapp/static/assets/plants/catalog.json`, give it a new `id`, its names
and keywords, and adjust the shape settings (height, leaf, fruit shape
and colour...). No code changes needed.

## Garden map

The **Map** page (the Map bud on the dashboard) puts the
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
