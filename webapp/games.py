"""Games on the 3D farm: the mud arena at the campfire and football in the play park.

Matches are decided here, on the station, so everyone watching sees the same
bout and the same goals, and the results can be kept as stats. The farm page
asks for the current and the next match while it shows the Campfire dance
(the mud wrestling tournament) or the Play park (football), and animates
what's decided here (/api/games/now?mode=campfire|play). A match is only
created when someone is watching, so the stats are of matches that were shown.

The campfire tournament: every hero on the farm enters. Each round they
wrestle in groups of three (a pair or a free pass when the numbers don't
divide); the winner of each group goes through. When three are left, the top
two go through; the last two wrestle for the grand victory. Then there's a
ceremony for the champion, and a new tournament begins.

Powers come from real garden work (a doocracy: those who do, grow). What
you do in the real garden matters far more than anything on the 3D farm:

- every hero starts with the same basic powers (BASE),
- each power grows with the kind of work that builds it (SKILL_WORK),
  with diminishing returns, so steady work counts more than grinding,
- levels are exponential: every level multiplies every power by
  LEVEL_POWER (level 10 is 3.5 times level 1, level 20 fourteen times),
- the fractal rhythm: the box-counting (fractal) dimension of the days you
  did real garden work, Mandelbrot's measure of how a pattern fills its
  space at every scale. Every day -> 1, every week -> about 0.6, one busy
  weekend and nothing since -> near 0. It multiplies every power
  (RHYTHM_LOW .. RHYTHM_HIGH), so showing up steadily, week after week,
  beats one big burst,
- the rhythm also puts the hero on the real axis of the Mandelbrot set
  (mandel_c()): steady gardeners sit in the calm main cardioid and fight
  with steady form; irregular ones drift out through the period-doubling
  bulbs into the chaotic tail, so their form swings from move to move
  (form_orbit(): z -> z*z + c),
- the hero's class adds a small flavour bonus to one power (CLASS_BONUS).

Nothing can be bought: there are no paid items, clothes and gear are only
looks, and nobody (not even an admin) can set powers by hand. In a bout a
move lands with the attacker's share of the two powers (contest()), so a
hero twice as strong lands two moves in three; luck keeps every move
between LUCK_FLOOR and 1 - LUCK_FLOOR. Newcomers and heroes on a losing
streak get a small spirit boost. Football compresses powers (effective())
and balances the teams, so it stays a game for everyone. Every number here
is on purpose easy to read and change.
"""
import json
import math
import random
import time
from datetime import datetime, timedelta

import farm_db
import heroes

# ---------------------------------------------------------------- powers
SKILLS = [
    ("strength", "Strength", "💪", "harvesting, planting, transplanting and pruning"),
    ("stamina", "Stamina", "🫀", "watering, and showing up on many different days"),
    ("agility", "Agility", "🤸", "weeding, pest control and spotting sprouts"),
    ("wisdom", "Wisdom", "🦉", "check-ups and fertilizing"),
    ("heart", "Heart", "💚", "feeding the worms, giving produce away and helping at events"),
]
SKILL_IDS = [s[0] for s in SKILLS]
SKILL_WORK = {                                # log type -> how much one action counts
    "strength": {"harvest": 1.0, "planting": 1.0, "transplant": 1.0, "pruning": 0.8},
    "stamina": {"watering": 1.0},
    "agility": {"weeding": 1.0, "pest_control": 1.0, "germination": 0.8},
    "wisdom": {"observation": 1.0, "fertilizing": 0.8},
    "heart": {"feeding": 1.0, "delivery": 1.5},
}
DAY_WORK = 1.5            # stamina: each different day you logged something
EVENT_WORK = 2.0          # heart: each event you checked in to, and each volunteer job you signed up for
BASE = 10                 # every hero starts here in every power
GROWTH = 4.0              # + GROWTH * log2(1 + work): 1 action ~ +4, 15 ~ +16, 100 ~ +27
LEVEL_POWER = 1.15        # exponential levels: every level multiplies every power by this (L5 x1.7, L10 x3.5, L15 x7.1, L20 x14)
CLASS_BONUS = 2           # the class's own power
CLASS_POWER = {"gardener": "stamina", "worm_tamer": "heart", "forager": "strength", "beekeeper": "wisdom", "druid": "agility"}

# the fractal rhythm (box-counting dimension of the days with real garden work)
RHYTHM_DAYS = 128         # looks at the last 128 days (a power of two, so the boxes halve neatly: 128, 64, ... 1 day)...
RHYTHM_MIN_DAYS = 16      # ...or since the hero's first action, at least 16 days
RHYTHM_LOW = 0.6          # powers x0.6 at dimension 0 (one burst)...
RHYTHM_HIGH = 1.4         # ...up to x1.4 at dimension 1 (every single day)
MANDEL_STEADY = 0.24      # mandel_c(): rhythm 1 -> c = 0.24 (inside the main cardioid, by its cusp)...
MANDEL_WILD = -1.95       # ...rhythm 0 -> c = -1.95 (the chaotic tail, just inside the set's tip at -2)
FORM_SWING = 0.25         # how far form swings from move to move out in the chaos (steady heroes: not at all)
STYLES = [                # where on the real axis (c above this) -> the fighting style it gives
    (-0.75, "steady", "Steady", "sits in the main cardioid: the same strong form every move"),
    (-1.25, "two-beat", "Two-beat", "in the period-2 bulb: a strong move, then a weaker one"),
    (-1.4012, "many-beat", "Many-beat", "in the period-doubling cascade: form in 4-, 8-, 16-move rhythms"),
    (-2.0, "wild", "Wild", "in the chaotic tail: form jumps around unpredictably, brilliant or awful"),
]

# fairness
ROOKIE_MATCHES = 5        # a hero's first matches of a game get...
ROOKIE_BOOST = 6          # ...this much extra spirit in football (added to compressed powers)...
ROOKIE_K = 1.3            # ...and this much stronger in the arena
COMEBACK_LOSSES = 3       # after this many losses in a row...
COMEBACK_BOOST = 4        # ...this much extra spirit in football...
COMEBACK_K = 1.15         # ...and this much stronger in the arena
LUCK_FLOOR = 0.1          # contest(): every move lands between 10% and 90% of the time, whoever is stronger


def _work(conn):
    """How much of each kind of work every hero has done: {grower_id: {skill: work}}."""
    out = {}
    def add(gid, skill, w):
        out.setdefault(gid, {s: 0.0 for s in SKILL_IDS})[skill] += w
    for gid, kind, n in conn.execute("SELECT grower_id, log_type, COUNT(*) FROM logs WHERE grower_id IS NOT NULL GROUP BY grower_id, log_type"):
        for skill, kinds in SKILL_WORK.items():
            if kind in kinds:
                add(gid, skill, kinds[kind] * n)
    for gid, days in conn.execute("SELECT grower_id, COUNT(DISTINCT substr(timestamp, 1, 10)) FROM logs WHERE grower_id IS NOT NULL GROUP BY grower_id"):
        add(gid, "stamina", DAY_WORK * days)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if "event_checkins" in tables:
        for gid, n in conn.execute("SELECT grower_id, COUNT(*) FROM event_checkins GROUP BY grower_id"):
            add(gid, "heart", EVENT_WORK * n)
    if "event_task_people" in tables:
        for gid, n in conn.execute("SELECT grower_id, COUNT(*) FROM event_task_people GROUP BY grower_id"):
            add(gid, "heart", EVENT_WORK * n)
    return out


def fractal_dimension(offsets, window):
    """Box-counting dimension of a set of days (offsets 0 .. window-1, window a power of two): cover the window with
    boxes of 1, 2, 4 ... window days, count the boxes N(s) with at least one day in them, and fit the slope of
    log N(s) against log(window / s). A line filled every day -> 1, one single day -> 0, every 7th day -> ~0.6."""
    pts = {o for o in offsets if 0 <= o < window}
    if not pts:
        return 0.0
    xs, ys, s = [], [], 1
    while s <= window:
        xs.append(math.log2(window / s))
        ys.append(math.log2(len({o // s for o in pts})))
        s *= 2
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return max(0.0, min(1.0, slope))


def rhythm_window(days_since_first):
    """The fractal window: the days since the hero's first action, rounded up to a power of two, 16 .. 128."""
    w = RHYTHM_MIN_DAYS
    while w < min(RHYTHM_DAYS, days_since_first + 1):
        w *= 2
    return w


def rhythm_mult(rhythm):
    return RHYTHM_LOW + (RHYTHM_HIGH - RHYTHM_LOW) * max(0.0, min(1.0, rhythm or 0))


def level_mult(level):
    return LEVEL_POWER ** (max(1, level) - 1)


def mandel_c(rhythm):
    """Where a rhythm puts a hero on the real axis of the Mandelbrot set (all of it inside the set: the orbit stays bounded)."""
    r = max(0.0, min(1.0, rhythm or 0))
    return round(MANDEL_WILD + (MANDEL_STEADY - MANDEL_WILD) * r, 4)


def style_of(c):
    for edge, sid, name, blurb in STYLES:
        if c > edge:
            return {"id": sid, "name": name, "blurb": blurb}
    return {"id": STYLES[-1][1], "name": STYLES[-1][2], "blurb": STYLES[-1][3]}


def form_orbit(c, n, rnd):
    """A bout's worth of form (n moves) from the orbit of z -> z*z + c: it settles first, then every move takes the next
    point. Steady heroes' orbits sit still on a fixed point (form 1 every move); further out the orbit alternates,
    cascades and finally goes chaotic. Centred on the orbit's average, so the swing never adds strength on average."""
    beta = (1 + math.sqrt(max(0.0, 1 - 4 * c))) / 2          # the orbit stays inside [-beta, beta]
    z = rnd.uniform(-0.05, 0.05)
    for _ in range(48):
        z = z * z + c
    pts = []
    for _ in range(n):
        z = z * z + c
        if abs(z) > 2:                                         # (can't happen inside the set; just in case of rounding)
            z = rnd.uniform(-beta, beta)
        pts.append(z)
    mean = sum(pts) / len(pts)
    return [round(1 + FORM_SWING * (x - mean) / beta, 3) for x in pts]


def powers_from(work, level, hero_class, rhythm=0.0):
    """The five powers for some amount of work, a level, a class and a fractal rhythm (all whole numbers).
    (base work power) x LEVEL_POWER^(level - 1) x rhythm multiplier."""
    k = level_mult(level) * rhythm_mult(rhythm)
    out = {}
    for s in SKILL_IDS:
        v = BASE + GROWTH * math.log2(1 + (work or {}).get(s, 0))
        if CLASS_POWER.get(hero_class) == s:
            v += CLASS_BONUS
        out[s] = int(round(v * k))
    return out


def _rhythms(conn):
    """{grower_id: (rhythm, window)}: the fractal dimension of the days each hero did real garden work (logged
    something, or checked in to an event) in their window."""
    today = datetime.now().date()
    since = (today - timedelta(days=RHYTHM_DAYS)).isoformat()
    days, first = {}, {}
    for gid, d in conn.execute("SELECT grower_id, substr(MIN(timestamp), 1, 10) FROM logs WHERE grower_id IS NOT NULL GROUP BY grower_id"):
        first[gid] = d
    for gid, d in conn.execute("""SELECT DISTINCT grower_id, substr(timestamp, 1, 10) FROM logs
                                  WHERE grower_id IS NOT NULL AND timestamp >= ?""", (since,)):
        days.setdefault(gid, set()).add(d)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    if "event_checkins" in tables:
        for gid, d in conn.execute("SELECT DISTINCT grower_id, substr(at, 1, 10) FROM event_checkins WHERE at >= ?", (since,)):
            days.setdefault(gid, set()).add(d)
            if not first.get(gid) or d < first[gid]:
                first[gid] = d
    out = {}
    for gid, ds in days.items():
        try:
            offs = [(today - datetime.strptime(d, "%Y-%m-%d").date()).days for d in ds]
            start = datetime.strptime(first.get(gid) or min(ds), "%Y-%m-%d").date()
        except (TypeError, ValueError):
            continue
        w = rhythm_window((today - start).days)
        out[gid] = (round(fractal_dimension(offs, w), 3), w)
    return out


def all_powers(conn=None):
    """{grower_id: {"powers": {...}, "level": n, "work": {...}}} for every hero who isn't in the recycle bin."""
    own = conn is None
    conn = conn or farm_db.get_conn()
    work = _work(conn)
    rhythm = _rhythms(conn)
    out = {}
    for r in conn.execute("""SELECT g.id, g.hero_class,
                                    (SELECT COUNT(*) FROM assets a WHERE a.grower_id = g.id) AS asset_count,
                                    (SELECT COUNT(*) FROM logs l WHERE l.grower_id = g.id) AS log_count,
                                    (SELECT COUNT(*) FROM logs l WHERE l.grower_id = g.id AND l.log_type = 'harvest') AS harvest_count
                             FROM growers g WHERE g.deleted_at IS NULL"""):
        level = heroes.progress(r["asset_count"], r["log_count"], r["harvest_count"])["level"]
        w = work.get(r["id"], {s: 0.0 for s in SKILL_IDS})
        rh, win = rhythm.get(r["id"], (0.0, RHYTHM_MIN_DAYS))
        c = mandel_c(rh)
        pw = powers_from(w, level, r["hero_class"], rh)
        out[r["id"]] = {"powers": pw, "level": level, "work": {k: round(v, 1) for k, v in w.items()},
                        "rhythm": rh, "window": win, "c": c, "style": style_of(c),
                        "level_k": round(level_mult(level), 2), "rhythm_k": round(rhythm_mult(rh), 2),
                        "total": sum(pw.values())}
    if own:
        conn.close()
    return out


def powers(grower_id):
    return all_powers().get(grower_id)


def effective(power):
    """Football's compression: 10 -> 30, 20 -> 48, 40 -> 70, 70 -> 90, 300 -> 149 (it stays a game for everyone)."""
    return 30 * math.log2(1 + max(0, power) / 10)


def contest(attack, defence):
    """The chance that a move lands: the attacker's share of the two powers (equals 50%, twice as strong 67%, ten
    times 91%), always between LUCK_FLOOR and 1 - LUCK_FLOOR."""
    p = attack / (attack + defence) if attack + defence > 0 else 0.5
    return min(1 - LUCK_FLOOR, max(LUCK_FLOOR, p))


def _mix(p, weights):
    return sum(p[k] * w for k, w in weights.items())


# ---------------------------------------------------------------- the mud arena (campfire)
ARENA = {"slot": 32, "lead": 7, "intro": 3.5, "fight": 16.0, "outro": 4.5}
CEREMONY = {"lead": 1, "length": 14}
ARENA_STYLES = {
    # the powers it uses, time between moves, chance of a big move (a throw that knocks someone flat), the moves
    "mud": {"name": "Mud wrestling", "uses": {"strength": 0.25, "stamina": 0.25, "agility": 0.2, "wisdom": 0.1, "heart": 0.2},
            "cd": (0.9, 1.7), "big": 0.24, "move": "grab", "bigmove": "throw"},
}
PLURAL = {"punch": "punches", "push": "pushes", "strike": "strikes", "grab": "grabs"}
DOWN_TIME = 1.4           # a hero thrown flat is out for this long
SLIP_CHANCE = 0.08        # each move might end on your back in the mud
GLORY = {"points": 1, "advanced": 5, "finals": 10, "championships": 25}   # the arena's ranking: points plus going through

# ---------------------------------------------------------------- football
FOOTBALL = {"slot": 60, "lead": 6, "play": 48}
FOOTBALL_USES = {"shoot": {"strength": 0.6, "wisdom": 0.4}, "keep": {"wisdom": 0.5, "agility": 0.5},
                 "run": {"agility": 0.5, "stamina": 0.5}, "team": {"heart": 0.5, "wisdom": 0.5}}
ROSTER_MAX = 20           # the farm shows up to this many heroes (app.FARM_MAX_HEROES)

STAT_NAMES = {
    "bouts": "Bouts", "wins": "Wins", "draws": "Draws", "losses": "Losses", "points": "Points",
    "punches": "Punches", "punches_landed": "Punches landed", "pushes": "Pushes", "pushes_landed": "Pushes landed",
    "strikes": "Strikes", "strikes_landed": "Strikes landed", "grabs": "Grabs", "grabs_landed": "Grabs landed",
    "throws": "Throws", "knockdowns": "Knockdowns", "knocked_down": "Knocked down", "dodges": "Dodges", "slips": "Slips",
    "matches": "Matches", "match_wins": "Match wins", "match_draws": "Match draws", "match_losses": "Match losses",
    "goals": "Goals", "assists": "Assists", "shots": "Shots", "on_target": "On target", "saves": "Saves", "conceded": "Goals let in",
    "advanced": "Rounds won", "finals": "Finals", "championships": "Grand victories", "runner_up": "Runner-up",
}


def _now():
    return time.time()


def _iso(epoch):
    return datetime.fromtimestamp(epoch).isoformat(timespec="seconds")


def _roster(conn):
    """The heroes the farm shows (the most recently logged in first), as a list of ids."""
    rows = conn.execute("SELECT id FROM growers WHERE deleted_at IS NULL ORDER BY COALESCE(last_login, '') DESC, id").fetchall()
    return [r[0] for r in rows[:ROSTER_MAX]]


def _busy(conn, game, start, end):
    """Who's already playing the other game at any time between start and end."""
    other = "football" if game == "arena" else "arena"
    rows = conn.execute("""SELECT p.grower_id FROM game_players p JOIN game_matches m ON m.id = p.match_id
                           WHERE m.game = ? AND m.slot_start < ? AND m.slot_end > ?""", (other, end, start)).fetchall()
    return {r[0] for r in rows}


def _recent_count(conn, game, since):
    return dict(conn.execute("""SELECT p.grower_id, COUNT(*) FROM game_players p JOIN game_matches m ON m.id = p.match_id
                                WHERE m.game = ? AND m.slot_start >= ? GROUP BY p.grower_id""", (game, since)).fetchall())


def _spirit(conn, game, gid):
    """Fair-play boosts: a newcomer's first matches, and a hero who lost several in a row."""
    rows = conn.execute("""SELECT p.result FROM game_players p JOIN game_matches m ON m.id = p.match_id
                           WHERE m.game = ? AND p.grower_id = ? ORDER BY m.slot_start DESC LIMIT ?""",
                        (game, gid, max(ROOKIE_MATCHES, COMEBACK_LOSSES))).fetchall()
    boost, why = 0, []
    if len(rows) < ROOKIE_MATCHES:
        boost += ROOKIE_BOOST
        why.append("rookie")
    if len(rows) >= COMEBACK_LOSSES and all(r[0] == "lost" for r in rows[:COMEBACK_LOSSES]):
        boost += COMEBACK_BOOST
        why.append("comeback")
    return boost, why


def _pick(conn, game, slot_start, slot_end, n, rnd):
    roster = _roster(conn)
    busy = _busy(conn, game, slot_start, slot_end)
    free = [g for g in roster if g not in busy]
    played = _recent_count(conn, game, slot_start - 7 * 86400)
    order = sorted(free, key=lambda g: (played.get(g, 0), rnd.random()))    # whoever played least lately goes first
    return order[:n], len(free)


def _names(conn, ids):
    if not ids:
        return {}
    q = ",".join("?" * len(ids))
    return {r[0]: r[1] for r in conn.execute(f"SELECT id, name FROM growers WHERE id IN ({q})", list(ids))}


def _store(conn, game, slot, slot_start, slot_end, start, end, style, data, winner, players, stats, tournament=None, rnd_no=None):
    cur = conn.execute("""INSERT OR IGNORE INTO game_matches (game, slot, slot_start, slot_end, starts_at, ends_at, style, data, winner, created_at,
                                                               tournament_id, round)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                       (game, slot, slot_start, slot_end, _iso(start), _iso(end), style, json.dumps(data), winner, _iso(_now()),
                        tournament, rnd_no))
    if not cur.rowcount:          # someone else just made this one
        return None
    mid = cur.lastrowid
    conn.executemany("INSERT INTO game_players (match_id, grower_id, side, power, result) VALUES (?, ?, ?, ?, ?)",
                     [(mid, p["id"], p["side"], p["power"], p["result"]) for p in players])
    conn.executemany("INSERT INTO game_stats (match_id, grower_id, stat, value) VALUES (?, ?, ?, ?)",
                     [(mid, gid, k, v) for gid, st in stats.items() for k, v in st.items() if v])
    return mid


def arena_bout(fighters, style, rnd):
    """Decide a bout. fighters: [{"id", "eff", "agility", "c"}] (c: the hero's point on the Mandelbrot set's real axis).
    Returns (events, stats per id). Times are seconds from the start of the bout (the intro at 0, the fight at ARENA["intro"])."""
    st = ARENA_STYLES[style]
    t0, t1 = ARENA["intro"], ARENA["intro"] + ARENA["fight"]
    move = st["move"]
    many = PLURAL[move]
    S = {f["id"]: {"points": 0, many: 0, many + "_landed": 0, "throws": 0, "knockdowns": 0, "knocked_down": 0, "dodges": 0, "slips": 0} for f in fighters}
    nxt = {f["id"]: t0 + rnd.uniform(0.3, 1.2) for f in fighters}
    down = {f["id"]: 0.0 for f in fighters}
    by = {f["id"]: f for f in fighters}
    form = {f["id"]: form_orbit(f.get("c", MANDEL_STEADY), 40, rnd) for f in fighters}   # each move takes the orbit's next point
    step = {f["id"]: 0 for f in fighters}
    def now_form(g):
        return form[g][min(step[g], len(form[g]) - 1)]
    events = []
    while True:
        ready = [g for g in nxt if nxt[g] < t1 - 0.6]
        if not ready:
            break
        a = min(ready, key=lambda g: nxt[g])
        t = nxt[a]
        if t < down[a]:
            nxt[a] = down[a] + 0.25
            continue
        targets = [g for g in by if g != a and t >= down[g] + 0.2]
        if not targets:
            nxt[a] = t + 0.5
            continue
        if style == "mud" and rnd.random() < SLIP_CHANCE:            # whoops
            S[a]["slips"] += 1
            down[a] = t + 1.3
            events.append({"t": round(t, 2), "a": a, "m": "slip", "r": "slip", "p": 0})
            nxt[a] = t + 1.7
            continue
        d = rnd.choice(targets)
        S[a][many] += 1
        ea, ed = by[a]["eff"] * now_form(a), by[d]["eff"] * now_form(d)
        step[a] += 1
        if rnd.random() < contest(ea, ed):
            big = rnd.random() < st["big"] * (0.75 + 0.5 * ea / (ea + ed))
            pts = 3 if big else 1
            S[a]["points"] += pts
            S[a][many + "_landed"] += 1
            m = st["bigmove"] if big else move
            if big:
                S[a]["knockdowns"] += 1
                S[d]["knocked_down"] += 1
                down[d] = t + DOWN_TIME
                if m == "throw":
                    S[a]["throws"] += 1
            events.append({"t": round(t, 2), "a": a, "d": d, "m": m, "r": "ko" if big else "hit", "p": pts})
        else:
            S[d]["dodges"] += 1
            events.append({"t": round(t, 2), "a": a, "d": d, "m": move, "r": "dodge", "p": 0})
        quick = 1.15 - 0.3 * min(1, by[a]["agility"] / 120)
        nxt[a] = t + rnd.uniform(*st["cd"]) * quick
    return events, S


def _rank(S, rnd):
    """Who did best in a bout: points, then moves landed, then fewest times thrown, then luck (a tournament needs a winner)."""
    order = list(S)
    rnd.shuffle(order)
    return sorted(order, key=lambda g: (-S[g]["points"], -S[g].get("grabs_landed", 0), S[g].get("knocked_down", 0)))


def _groups(field, rnd, byes_so_far):
    """Split a round's field: groups of three, plus one pair (two left over) or one free pass (one left over)."""
    f = list(field)
    rnd.shuffle(f)
    if len(f) <= 3:
        return [f], []
    byes = []
    if len(f) % 3 == 1:                               # the free pass goes to whoever had the fewest
        pick = min(f, key=lambda g: (byes_so_far.count(g), rnd.random()))
        f.remove(pick)
        byes.append(pick)
    groups = []
    if len(f) % 3 == 2:
        groups.append(f[:2])
        f = f[2:]
    groups += [f[k:k + 3] for k in range(0, len(f), 3)]
    return groups, byes


def _tournament(conn):
    """The tournament that's on (or None)."""
    return conn.execute("SELECT * FROM game_tournaments WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1").fetchone()


def _active(conn):
    return {r[0] for r in conn.execute("SELECT id FROM growers WHERE deleted_at IS NULL")}


def _arena(conn, slot):
    """Make what happens in this campfire slot: the next bout of the tournament, the champion's ceremony, or a new tournament."""
    slot_start = slot * ARENA["slot"]
    slot_end = slot_start + ARENA["slot"]
    for _ in range(12):                               # (a few steps: start a round, skip an emptied group, finish...)
        t = _tournament(conn)
        if not t:
            last = conn.execute("SELECT * FROM game_tournaments ORDER BY id DESC LIMIT 1").fetchone()
            if last and last["champion_id"] and not conn.execute(
                    "SELECT 1 FROM game_matches WHERE tournament_id = ? AND style = 'ceremony'", (last["id"],)).fetchone():
                return _ceremony(conn, slot, slot_start, slot_end, last)
            field = _roster(conn)
            if len(field) < 2:
                return None
            conn.execute("INSERT INTO game_tournaments (started_at, field, state, rounds) VALUES (?, ?, ?, 0)",
                         (_iso(slot_start), json.dumps(field), json.dumps({"rounds": []})))
            continue
        made = _next_bout(conn, slot, slot_start, slot_end, t)
        if made != "again":
            return made
    return None


def _next_bout(conn, slot, slot_start, slot_end, t):
    state = json.loads(t["state"])
    rounds = state["rounds"]
    rnd = random.Random(f"tournament:{t['id']}:{len(rounds)}")
    alive = _active(conn)
    if rounds:
        r = rounds[-1]
        played = conn.execute("SELECT data FROM game_matches WHERE tournament_id = ? AND round = ? AND style != 'ceremony' ORDER BY slot",
                              (t["id"], len(rounds))).fetchall()
        if len(played) < len(r["groups"]):
            group = [g for g in r["groups"][len(played)] if g in alive]
            if len(group) < 2:                        # not enough left in this group: they go through
                r["byes"] += group
                r["groups"][len(played)] = []
                r["groups"] = [g for g in r["groups"] if g] or []
                conn.execute("UPDATE game_tournaments SET state = ? WHERE id = ?", (json.dumps(state), t["id"]))
                return "again"
            return _bout(conn, slot, slot_start, slot_end, t, len(rounds), len(played), group, len(r["field"]), rnd)
        through = [g for g in r["byes"] if g in alive]
        for row in played:
            through += [g for g in json.loads(row[0])["advance"] if g in alive]
    else:
        through = [g for g in json.loads(t["field"]) if g in alive]
    if len(through) <= 1:                             # a champion
        return _finish(conn, t, through[0] if through else None)
    byes_so_far = [g for rr in rounds for g in rr["byes"]]
    groups, byes = _groups(through, rnd, byes_so_far)
    rounds.append({"field": through, "groups": groups, "byes": byes})
    conn.execute("UPDATE game_tournaments SET state = ?, rounds = ? WHERE id = ?", (json.dumps(state), len(rounds), t["id"]))
    return "again"


def _bout(conn, slot, slot_start, slot_end, t, rnd_no, k, group, field_size, rnd):
    style = "mud"
    st = ARENA_STYLES[style]
    P = all_powers(conn)
    names = _names(conn, group)
    fighters = []
    for c, gid in enumerate(group):
        pw = P.get(gid) or {"powers": powers_from({}, 1, None), "level": 1, "rhythm": 0.0, "c": mandel_c(0)}
        boost, why = _spirit(conn, "arena", gid)
        spirit_k = (ROOKIE_K if "rookie" in why else 1) * (COMEBACK_K if "comeback" in why else 1)
        fighters.append({"id": gid, "name": names.get(gid, "?"), "corner": c, "level": pw["level"],
                         "eff": round(_mix(pw["powers"], st["uses"]) * spirit_k, 1), "spirit": why,
                         "agility": pw["powers"]["agility"], "rhythm": pw.get("rhythm", 0.0), "c": pw.get("c", mandel_c(0)),
                         "style": style_of(pw.get("c", mandel_c(0)))["id"]})
    events, S = arena_bout(fighters, style, rnd)
    order = _rank(S, rnd)
    stage = "final" if field_size == 2 else "semi" if field_size == 3 else "group"
    advance = order[:2] if field_size == 3 else order[:1]
    result = {g: "won" if g == order[0] else "lost" for g in S}
    for g, s_ in S.items():
        s_["bouts"] = 1
        s_[{"won": "wins", "lost": "losses"}[result[g]]] = 1
        if g in advance and stage != "final":
            s_["advanced"] = 1
        if stage == "final":
            s_["finals"] = 1
    start = slot_start + ARENA["lead"]
    end = start + ARENA["intro"] + ARENA["fight"] + ARENA["outro"]
    state = json.loads(t["state"])
    data = {"style": style, "name": st["name"], "tournament": t["id"], "round": rnd_no, "bout": k + 1,
            "bouts": len(state["rounds"][rnd_no - 1]["groups"]), "field": field_size, "stage": stage,
            "start": start, "end": end, "fighters": [{k2: f[k2] for k2 in ("id", "name", "corner", "level", "eff", "spirit", "rhythm", "style")} for f in fighters],
            "events": events, "points": {str(g): s_["points"] for g, s_ in S.items()}, "winner": str(order[0]), "advance": advance}
    players = [{"id": f["id"], "side": f["corner"], "power": f["eff"], "result": result[f["id"]]} for f in fighters]
    return _store(conn, "arena", slot, slot_start, slot_end, start, end, style, data, str(order[0]), players, S, t["id"], rnd_no)


def _finish(conn, t, champion):
    """The last bout is decided: the tournament is over (it shows as over once the final has been played)."""
    final = conn.execute("""SELECT * FROM game_matches WHERE tournament_id = ? AND style != 'ceremony' ORDER BY slot DESC LIMIT 1""",
                         (t["id"],)).fetchone()
    runner = None
    if final:
        d = json.loads(final["data"])
        others = [f["id"] for f in d["fighters"] if f["id"] != champion]
        runner = others[0] if d.get("stage") == "final" and others else None
        conn.executemany("INSERT OR IGNORE INTO game_stats (match_id, grower_id, stat, value) VALUES (?, ?, ?, 1)",
                         [(final["id"], g, k) for g, k in ((champion, "championships"), (runner, "runner_up")) if g])
    conn.execute("UPDATE game_tournaments SET ended_at = ?, champion_id = ?, runner_up_id = ? WHERE id = ?",
                 (final["ends_at"] if final else _iso(_now()), champion, runner, t["id"]))
    return "again"


def _ceremony(conn, slot, slot_start, slot_end, t):
    names = _names(conn, [g for g in (t["champion_id"], t["runner_up_id"]) if g])
    start = slot_start + CEREMONY["lead"]
    end = start + CEREMONY["length"]
    data = {"style": "ceremony", "tournament": t["id"], "start": start, "end": end, "champion": t["champion_id"],
            "champion_name": names.get(t["champion_id"], "?"), "runner_up": t["runner_up_id"], "runner_up_name": names.get(t["runner_up_id"]),
            "field": len(json.loads(t["field"])), "rounds": t["rounds"], "fighters": [], "events": []}
    return _store(conn, "arena", slot, slot_start, slot_end, start, end, "ceremony", data, str(t["champion_id"]), [], {}, t["id"], None)


def football_match(teams, rnd):
    """Decide a match. teams: two lists of {"id", "shoot", "keep", "run", "team"} (the keeper last when a team has 3+).
    Returns (events, stats per id, score). Times are seconds from kick-off."""
    keepers = [t[-1]["id"] if len(t) >= 3 else None for t in teams]
    S = {p["id"]: {"shots": 0, "on_target": 0, "goals": 0, "assists": 0, "saves": 0, "conceded": 0} for t in teams for p in t}
    strength = [sum(p["run"] + p["team"] for p in t) / max(1, len(t)) for t in teams]
    score, events = [0, 0], []
    t = rnd.uniform(2.5, 5.0)
    while t < FOOTBALL["play"] - 3:
        side = 0 if rnd.random() < 0.5 + 0.25 * math.tanh((strength[0] - strength[1]) / 30) else 1
        mine, theirs = teams[side], teams[1 - side]
        field = [p for p in mine if p["id"] != keepers[side]] or mine
        shooter = rnd.choices(field, weights=[p["shoot"] for p in field])[0]
        mates = [p for p in field if p["id"] != shooter["id"]]
        assist = rnd.choices(mates, weights=[p["team"] for p in mates])[0] if mates and rnd.random() < 0.55 else None
        keeper = next((p for p in theirs if p["id"] == keepers[1 - side]), None)
        S[shooter["id"]]["shots"] += 1
        chance = 0.38 + 0.22 * math.tanh((shooter["shoot"] - (keeper["keep"] if keeper else 30)) / 30)
        roll = rnd.random()
        ev = {"t": round(t, 2), "team": side, "by": shooter["id"]}
        if roll < chance:
            ev["type"] = "goal"
            score[side] += 1
            S[shooter["id"]]["goals"] += 1
            S[shooter["id"]]["on_target"] += 1
            if assist:
                ev["assist"] = assist["id"]
                S[assist["id"]]["assists"] += 1
            if keeper:
                S[keeper["id"]]["conceded"] += 1
        elif keeper and rnd.random() < 0.6:
            ev["type"] = "save"
            ev["keeper"] = keeper["id"]
            S[shooter["id"]]["on_target"] += 1
            S[keeper["id"]]["saves"] += 1
        else:
            ev["type"] = "miss"
        events.append(ev)
        t += rnd.uniform(4.5, 8.0)
    return events, S, score, keepers


def _football(conn, slot):
    slot_start = slot * FOOTBALL["slot"]
    slot_end = slot_start + FOOTBALL["slot"]
    rnd = random.Random(f"football:{slot}")
    free = [g for g in _roster(conn) if g not in _busy(conn, "football", slot_start, slot_end)]
    want = min(8, max(2, round(len(_roster(conn)) * 0.4)))
    picked, _ = _pick(conn, "football", slot_start, slot_end, want, rnd)
    if len(picked) < 2 or len(free) < 2:
        return
    P = all_powers(conn)
    names = _names(conn, picked)
    players = []
    for gid in picked:
        pw = P.get(gid, {"powers": powers_from({}, 1, None), "level": 1})
        boost, why = _spirit(conn, "football", gid)
        p = {k: round(effective(_mix(pw["powers"], w)) + boost, 1) for k, w in FOOTBALL_USES.items()}
        p.update({"id": gid, "name": names.get(gid, "?"), "level": pw["level"], "spirit": why})
        players.append(p)
    # balanced teams: the strongest overall first, picked in turns A B B A A B ...
    players.sort(key=lambda p: -(p["shoot"] + p["keep"] + p["run"] + p["team"]))
    teams = [[], []]
    for k, p in enumerate(players):
        teams[[0, 1, 1, 0][k % 4]].append(p)
    for tm in teams:                                   # the best keeper in goal (last in the list) when there are 3+
        if len(tm) >= 3:
            kp = max(tm, key=lambda p: p["keep"])
            tm.remove(kp)
            tm.append(kp)
    events, S, score, keepers = football_match(teams, rnd)
    winner = "draw" if score[0] == score[1] else str(0 if score[0] > score[1] else 1)
    result = {}
    for side, tm in enumerate(teams):
        for p in tm:
            r = "draw" if winner == "draw" else ("won" if winner == str(side) else "lost")
            result[p["id"]] = r
            S[p["id"]]["matches"] = 1
            S[p["id"]][{"won": "match_wins", "draw": "match_draws", "lost": "match_losses"}[r]] = 1
    start = slot_start + FOOTBALL["lead"]
    end = start + FOOTBALL["play"]
    data = {"start": start, "end": end, "score": score, "keepers": keepers, "events": events, "winner": winner,
            "teams": [[{k: p[k] for k in ("id", "name", "level", "shoot", "keep", "spirit")} for p in tm] for tm in teams]}
    rows = [{"id": p["id"], "side": side, "power": round((p["shoot"] + p["keep"] + p["run"] + p["team"]) / 4, 1), "result": result[p["id"]]}
            for side, tm in enumerate(teams) for p in tm]
    _store(conn, "football", slot, slot_start, slot_end, start, end, None, data, winner, rows, S)


MAKERS = {"arena": (_arena, ARENA), "football": (_football, FOOTBALL)}
MODES = {"campfire": "arena", "play": "football"}


def _match_view(row):
    d = json.loads(row["data"])
    d.update({"id": row["id"], "game": row["game"], "slot": row["slot"]})
    return d


def now_playing(now=None, mode="play"):
    """The current and the next match of the activity's game (made if they don't exist yet): the campfire's mud
    tournament or the play park's football. Matches are only made while someone watches that activity."""
    now = now or _now()
    game = MODES.get(mode, "football")
    make, T = MAKERS[game]
    conn = farm_db.get_conn()
    slot = int(now // T["slot"])
    for s_ in (slot, slot + 1):
        if not conn.execute("SELECT 1 FROM game_matches WHERE game = ? AND slot = ?", (game, s_)).fetchone():
            make(conn, s_)
            conn.commit()
    rows = conn.execute("SELECT * FROM game_matches WHERE game = ? AND slot IN (?, ?) ORDER BY slot", (game, slot, slot + 1)).fetchall()
    out = [_match_view(r) for r in rows]
    t = conn.execute("SELECT * FROM game_tournaments ORDER BY id DESC LIMIT 1").fetchone() if game == "arena" else None
    conn.close()
    res = {"now": now, "mode": mode, "arena": out if game == "arena" else [], "football": out if game == "football" else [],
           "timing": {"arena": ARENA, "football": FOOTBALL, "ceremony": CEREMONY}}
    if t:
        res["tournament"] = {"id": t["id"], "field": len(json.loads(t["field"])), "rounds": t["rounds"]}
    return res


def participants(now=None):
    """Who plays in the current and next matches (the farm makes sure they're on it)."""
    now = now or _now()
    conn = farm_db.get_conn()
    rows = conn.execute("""SELECT DISTINCT p.grower_id FROM game_players p JOIN game_matches m ON m.id = p.match_id
                           WHERE m.slot_end > ? AND m.slot_start < ?""", (now, now + 60)).fetchall()
    conn.close()
    return [r[0] for r in rows]


# ---------------------------------------------------------------- stats
def _since(days):
    return (datetime.now() - timedelta(days=days)).isoformat(timespec="seconds") if days else ""


def hero_stats(grower_id, days=None):
    """All of a hero's game stats (finished matches only): {stat: total}."""
    conn = farm_db.get_conn()
    rows = conn.execute("""SELECT s.stat, SUM(s.value) FROM game_stats s JOIN game_matches m ON m.id = s.match_id
                           WHERE s.grower_id = ? AND m.ends_at <= ? AND m.starts_at >= ? GROUP BY s.stat""",
                        (grower_id, _iso(_now()), _since(days))).fetchall()
    conn.close()
    return {r[0]: r[1] for r in rows}


def leaderboard(days=None):
    """Every hero's totals: [{"id", "name", stats...}], finished matches only, heroes in the recycle bin left out."""
    conn = farm_db.get_conn()
    rows = conn.execute("""SELECT s.grower_id, g.name, s.stat, SUM(s.value) FROM game_stats s
                           JOIN game_matches m ON m.id = s.match_id JOIN growers g ON g.id = s.grower_id
                           WHERE g.deleted_at IS NULL AND m.ends_at <= ? AND m.starts_at >= ?
                           GROUP BY s.grower_id, s.stat""", (_iso(_now()), _since(days))).fetchall()
    conn.close()
    by = {}
    for gid, name, stat, v in rows:
        by.setdefault(gid, {"id": gid, "name": name})[stat] = v
    out = list(by.values())
    for r in out:
        landed = sum(r.get(k, 0) for k in ("punches_landed", "pushes_landed", "strikes_landed", "grabs_landed"))
        thrown = sum(r.get(k, 0) for k in ("punches", "pushes", "strikes", "grabs"))
        r["landed"], r["moves"] = landed, thrown
        r["accuracy"] = round(100 * landed / thrown) if thrown else None
        r["glory"] = sum(r.get(k, 0) * w for k, w in GLORY.items())
    return out


def glory(stats):
    return sum((stats or {}).get(k, 0) * w for k, w in GLORY.items())


def champions(limit=10):
    """Finished tournaments, newest first: the champion, the runner-up, how many entered."""
    conn = farm_db.get_conn()
    rows = conn.execute("""SELECT t.*, c.name AS champion, r.name AS runner_up FROM game_tournaments t
                           LEFT JOIN growers c ON c.id = t.champion_id LEFT JOIN growers r ON r.id = t.runner_up_id
                           WHERE t.ended_at IS NOT NULL AND t.ended_at <= ? AND t.champion_id IS NOT NULL
                           ORDER BY t.id DESC LIMIT ?""", (_iso(_now()), limit)).fetchall()
    conn.close()
    return [dict(r) | {"entered": len(json.loads(r["field"]))} for r in rows]


def bracket():
    """The tournament that's on (or the last one): its rounds, the groups, and who went through so far
    (only bouts that have been played: no spoilers)."""
    conn = farm_db.get_conn()
    t = conn.execute("SELECT * FROM game_tournaments ORDER BY id DESC LIMIT 1").fetchone()
    if not t:
        conn.close()
        return None
    now = _iso(_now())
    names = {r[0]: r[1] for r in conn.execute("SELECT id, name FROM growers")}
    played = {}
    for m in conn.execute("SELECT * FROM game_matches WHERE tournament_id = ? AND style != 'ceremony' AND ends_at <= ?", (t["id"], now)):
        d = json.loads(m["data"])
        played[(d["round"], d["bout"])] = d
    rounds = []
    for i, r in enumerate(json.loads(t["state"])["rounds"], 1):
        groups = []
        for k, g in enumerate(r["groups"], 1):
            d = played.get((i, k))
            groups.append({"names": [names.get(x, "?") for x in g], "ids": g, "played": bool(d),
                           "advance": d["advance"] if d else [], "points": d["points"] if d else {}})
        rounds.append({"n": i, "field": len(r["field"]), "groups": groups, "byes": [names.get(x, "?") for x in r["byes"]]})
    done = bool(t["ended_at"] and t["ended_at"] <= now)
    conn.close()
    return {"id": t["id"], "entered": len(json.loads(t["field"])), "rounds": rounds, "done": done,
            "champion": names.get(t["champion_id"]) if done else None, "runner_up": names.get(t["runner_up_id"]) if done else None,
            "started": t["started_at"]}


def records(board):
    """A few fun records from the leaderboard (each: title, hero, value)."""
    out = []
    def best(key, title, unit=""):
        rows = [r for r in board if r.get(key)]
        if rows:
            r = max(rows, key=lambda x: x[key])
            out.append({"title": title, "name": r["name"], "id": r["id"], "value": f"{r[key]}{unit}"})
    best("championships", "🏆 Most grand victories")
    best("glory", "✨ Most glory")
    best("throws", "🤼 Most throws")
    best("dodges", "💨 Best dodger", " dodges")
    best("slips", "🫠 Slipperiest", " slips")
    best("goals", "⚽ Top scorer", " goals")
    best("saves", "🧤 Safest hands", " saves")
    conn = farm_db.get_conn()
    row = conn.execute("""SELECT s.grower_id, g.name, MAX(s.value) FROM game_stats s JOIN game_matches m ON m.id = s.match_id
                          JOIN growers g ON g.id = s.grower_id WHERE s.stat = 'points' AND m.game = 'arena' AND m.ends_at <= ?
                          AND g.deleted_at IS NULL""", (_iso(_now()),)).fetchone()
    conn.close()
    if row and row[2]:
        out.append({"title": "💥 Biggest bout", "name": row[1], "id": row[0], "value": f"{row[2]} points"})
    return out


def recent_matches(limit=12, grower_id=None):
    conn = farm_db.get_conn()
    if grower_id:
        rows = conn.execute("""SELECT m.* FROM game_matches m JOIN game_players p ON p.match_id = m.id
                               WHERE p.grower_id = ? AND m.ends_at <= ? ORDER BY m.slot_start DESC LIMIT ?""",
                            (grower_id, _iso(_now()), limit)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM game_matches WHERE ends_at <= ? ORDER BY slot_start DESC LIMIT ?", (_iso(_now()), limit)).fetchall()
    conn.close()
    return [_match_view(r) | {"starts_at": r["starts_at"]} for r in rows]


def totals():
    conn = farm_db.get_conn()
    now = _iso(_now())
    row = {g: conn.execute("SELECT COUNT(*) FROM game_matches WHERE game = ? AND ends_at <= ?", (g, now)).fetchone()[0] for g in ("arena", "football")}
    row["goals"] = conn.execute("""SELECT COALESCE(SUM(s.value), 0) FROM game_stats s JOIN game_matches m ON m.id = s.match_id
                                   WHERE s.stat = 'goals' AND m.ends_at <= ?""", (now,)).fetchone()[0]
    conn.close()
    return row
