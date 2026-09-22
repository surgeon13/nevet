# API reference

The web app runs on port 8000. All routes are relative to
`http://<pi-ip>:8000`.

## Pages (browser routes)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | none | Gallery — photos/videos grouped by date, with asset counts and storage used |
| GET | `/media/<path>` | none | Serves one media file (path-traversal guarded to stay inside `CAMERA_BASE_DIR`) |
| GET, POST | `/login` | none | Login form; POST with `password` form field |
| GET | `/logout` | none | Clears the session |
| GET | `/stats` | session login | Game stats dashboard (latest snapshot + 50-row history) |
| GET | `/logs` | session login | Live log console (watchdog/capture/webapp), auto-refreshing every 5s |

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

`webapp/game_stats.db` (SQLite), table `stats_log`:

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
read/write this same table via `STATS_DB` (env var, defaults to
`~/webapp/game_stats.db`).

## Environment variables

Set in `.env` at the repo root (copied from `config/.env.example` by
`install.sh`, git-ignored):

| Variable | Used by | Purpose |
|---|---|---|
| `WEBAPP_PASSWORD` | `app.py` | Shared login password for `/stats` and `/logs` |
| `WEBAPP_API_KEY` | `app.py` | Required `X-API-Key` header for `POST /api/stats` |
| `WEBAPP_SECRET` | `app.py` | Flask session signing key |

Set directly in the rendered systemd unit (`install.sh` fills these in
automatically — not normally edited by hand):

| Variable | Used by | Purpose |
|---|---|---|
| `CAMERA_BASE_DIR` | `app.py`, `logging_config.py` | Root of runtime data (default `~/camera_captures`) |
| `STATS_DB` | `app.py`, `game_stats.py` | Path to the SQLite stats DB |
