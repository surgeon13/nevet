# API reference

The web app runs on port 8000. All routes are relative to
`http://<pi-ip>:8000`.

## Pages (browser routes)

Every page needs a logged-in player except `/login`, `/register`,
`/healthz` and `POST /api/stats` (API key). All POST forms carry a
`_csrf` token.

| Method | Path | Description |
|---|---|---|
| GET | `/` | Dashboard: 3D hub, last 3 photos, garden activity (Everyone / Just me) |
| GET, POST | `/login` | Tap-your-hero picker + password |
| GET, POST | `/register` | Sign up (or claim an existing hero without a password); `?name=` prefills |
| POST | `/logout` | Log out |
| GET, POST | `/account` | Change your password |
| GET, POST | `/log` | Log an action (watering, pruning, harvest...) on one or more plants or the whole garden; `?asset=ID` preselects a plant |
| GET, POST | `/plants/new` | Add a plant or worm bin (logs the planting as your action) |
| GET | `/activity` | Full history; filters `who`, `type`, `plant`, `period` (7/30/90), `page` |
| GET | `/growers` | Heroes roster |
| GET | `/growers/<id>` | Hero profile: level/XP, gear, growing now, grown before, actions |
| GET, POST | `/growers/<id>/customize` | Edit hero look (own hero, or admin) |
| POST | `/growers/<id>/password` | Admin sets a new password for a player |
| POST | `/growers/<id>/delete` | Move a hero to the recycle bin (own hero with `password`, or admin; never the last admin) |
| GET | `/recycle-bin` | Deleted heroes (admin) |
| POST | `/recycle-bin/<id>/restore` | Bring a hero back (admin) |
| POST | `/recycle-bin/<id>/purge` | Delete a binned hero for good; its plants and actions stay, unassigned (admin) |
| POST | `/recycle-bin/empty` | Delete every binned hero for good (admin) |
| GET | `/assets` | Plants: 3D garden + table |
| GET | `/assets/<id>` | One plant with its full history |
| GET | `/gallery` | Photos/videos grouped by date |
| GET | `/media/<path>` | One media file (guarded to stay inside `CAMERA_BASE_DIR`) |
| GET | `/stats` | Game stats (latest snapshot + history) |
| GET | `/logs` | System logs (watchdog, capture, web app, updates), refreshes every 5s |
| GET | `/healthz` | `ok` when the app and database respond (used by the watchdog and updater) |

## JSON API

### `POST /api/stats`

Logs one game-stats snapshot. Used by `webapp/game_stats.py` internally,
or callable directly (e.g. from other code/devices on the network).

**Headers:**
```
X-API-Key: <WEBAPP_API_KEY>
Content-Type: application/json
```

**Body** (all fields optional — send only what you have; omitted fields
are stored as `NULL` for that row):
```json
{
  "xp": 120,
  "time_played": 3600,
  "compost": 3.5,
  "credits": 50,
  "plant_growth": 0.82,
  "extra": "anything you want to note"
}
```

**Response:** `200 {"ok": true}` on success, `401` if `X-API-Key` is
missing or wrong.

**Example:**
```bash
curl -X POST http://<pi-ip>:8000/api/stats \
  -H "X-API-Key: $WEBAPP_API_KEY" -H "Content-Type: application/json" \
  -d '{"xp": 120, "compost": 3.5, "credits": 50}'
```

Each call inserts a new row into the `stats_log` SQLite table — it's a
log, not an upsert, so `/stats` always shows the single latest row as
"current" and the rest as history.

### `GET /api/logs`

Requires session login (log in via `/login` first in the same browser/
client — this is not the `X-API-Key` mechanism). Returns the last 150
lines of each log file:

```json
{
  "watchdog": ["2026-09-22 09:12:01 OK  latency=14ms signal=78%", "..."],
  "capture": ["2026-09-22 09:10:00 Photo #0042: saved ...", "..."],
  "webapp": ["2026-09-22 09:09:55 INFO Successful login from 10.0.0.5", "..."]
}
```

## Database schema

**`farm.db`** (`FARM_DB`, default `~/webapp/farm.db`), created and
migrated automatically by `webapp/farm_db.py`:

| Table | What it holds |
|---|---|
| `growers` | Heroes/players: `name`, `hero_class`, `appearance` (JSON), `password_hash`, `is_admin`, `last_login`, `deleted_at` / `deleted_by` (set while in the recycle bin) |
| `assets` | Plants and worm bins: `name`, `asset_type`, `variety`, `life_stage`, `grower_id` (owner) |
| `logs` | Actions: `log_type`, `asset_id` (NULL = whole garden), `grower_id` (who did it), `timestamp`, `notes`, `recipient` |
| `quantities` | Amounts attached to a log (harvest weight, pieces given away) |
| `captures` | Every photo/video the camera took |
| `web_traffic` | Data the web app moved, per `day` × `kind` (media / static / page / api) × `via` (lan / tailscale / internet): `requests`, `bytes_in`, `bytes_out`. Requests from the Pi itself aren't counted |

Action types (`log_type`): watering, pruning, fertilizing, weeding,
pest_control, feeding (worm bins), harvest, germination, transplant,
observation, delivery, planting, seeding, setup (new worm bin); older
data may also contain input and movement. A plant is "growing now"
until its stage is harvested or archived.

**`game_stats.db`** (`STATS_DB`), table `stats_log`:

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `timestamp` | TEXT | ISO 8601, set server-side at insert time |
| `xp` | INTEGER | nullable |
| `time_played` | INTEGER | nullable |
| `compost` | REAL | nullable |
| `credits` | INTEGER | nullable |
| `plant_growth` | REAL | nullable |
| `extra` | TEXT | free-form note, nullable |

Both `app.py` (`/api/stats`) and `webapp/game_stats.py` (`log_stat()`)
read/write `stats_log`.

## Environment variables

Set in `.env` at the repo root (copied from `config/.env.example` by
`install.sh`, git-ignored):

| Variable | Used by | Purpose |
|---|---|---|
| `WEBAPP_API_KEY` | `app.py` | Required `X-API-Key` header for `POST /api/stats` |
| `WEBAPP_SECRET` | `app.py` | Flask session signing key. If left as the placeholder, a random key is generated once and stored in `.flask_secret` next to `farm.db` |
| `WEBAPP_OPEN_SIGNUP` | `app.py` | `true` (default): anyone reaching the site can sign up. `false`: only logged-in players can add accounts |

`/api/logs` needs a logged-in session (returns 401 JSON otherwise);
`/healthz` and `POST /api/stats` (with the API key) work without one.

Set directly in the rendered systemd unit (`install.sh` fills these in
automatically — not normally edited by hand):

| Variable | Used by | Purpose |
|---|---|---|
| `CAMERA_BASE_DIR` | `app.py`, `logging_config.py` | Root of runtime data (default `~/camera_captures`) |
| `STATS_DB` | `app.py`, `game_stats.py` | Path to the SQLite stats DB |
