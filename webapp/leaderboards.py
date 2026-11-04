"""Leaderboards: who does the most, in the real garden first.

Everything is worked out from what's already in the database (logged actions, plants, harvest weights, game
results, invites): nothing is stored, so the boards are always up to date and nothing can be faked or bought.
The main ranking is XP, and XP only comes from logging real garden work (heroes.action_xp: bigger jobs and
weighed ones, like feeding the worms, earn more); a period ranks by the XP earned in it. The other boards are
smaller top fives: most active, steadiest fractal rhythm, top harvesters, worm feeders, strongest fighters,
arena glory, top scorers and top inviters.
"""
from datetime import datetime, timedelta

import farm_db
import games
import heroes

TOP = 5                    # each small board shows this many


def _since(days):
    return (datetime.now() - timedelta(days=days)).isoformat(timespec="seconds") if days else ""


def _per_grower(conn, sql, args=()):
    return {r[0]: r[1] for r in conn.execute(sql, args) if r[0] is not None}


def rankings(days=None, me=None):
    """Every hero (not in the recycle bin) with their numbers, the main ranking (XP, or XP in the period) and
    the small boards. days: 7, 30 or None (all time)."""
    since = _since(days)
    conn = farm_db.get_conn()
    rows = conn.execute("SELECT id, name, hero_class, appearance FROM growers WHERE deleted_at IS NULL").fetchall()
    xp_all = farm_db.xp_by_grower("", conn)                  # XP: every action by its kind and weight, plus plants
    xp_now = farm_db.xp_by_grower(since, conn) if days else xp_all
    p_logs = _per_grower(conn, "SELECT grower_id, COUNT(*) FROM logs WHERE timestamp >= ? GROUP BY grower_id", (since,))
    p_days = _per_grower(conn, "SELECT grower_id, COUNT(DISTINCT substr(timestamp, 1, 10)) FROM logs WHERE timestamp >= ? GROUP BY grower_id", (since,))

    def grams_of(action):                                     # g weighed for an action in the period (harvests, worm food)
        return _per_grower(conn, """SELECT l.grower_id, SUM(CASE WHEN q.units = 'kg' THEN q.value * 1000 ELSE q.value END)
                                    FROM quantities q JOIN logs l ON l.id = q.log_id
                                    WHERE l.log_type = ? AND q.units IN ('g', 'kg') AND l.timestamp >= ? GROUP BY l.grower_id""", (action, since))
    grams, worm_g = grams_of("harvest"), grams_of("feeding")
    p_feeds = _per_grower(conn, "SELECT grower_id, COUNT(*) FROM logs WHERE log_type = 'feeding' AND timestamp >= ? GROUP BY grower_id", (since,))
    cols = {r[1] for r in conn.execute("PRAGMA table_info(growers)")}
    invited = _per_grower(conn, """SELECT invited_by, COUNT(*) FROM growers WHERE invited_by IS NOT NULL AND deleted_at IS NULL
                                   GROUP BY invited_by""") if "invited_by" in cols else {}
    P = games.all_powers(conn)
    conn.close()
    games_board = {r["id"]: r for r in games.leaderboard(days)}

    people = []
    for r in rows:
        gid = r["id"]
        prog = heroes.progress(xp=xp_all.get(gid, 0))
        pw = P.get(gid) or {}
        gb = games_board.get(gid, {})
        people.append({
            "id": gid, "name": r["name"], "level": prog["level"], "xp": prog["xp"], "next_xp": prog["next_xp"], "pct": prog["pct"],
            "rank": heroes.rank(prog["level"]),
            "xp_period": xp_now.get(gid, 0),
            "actions": p_logs.get(gid, 0), "days": p_days.get(gid, 0), "kg": round((grams.get(gid) or 0) / 1000, 1),
            "worm_kg": round((worm_g.get(gid) or 0) / 1000, 1), "feeds": p_feeds.get(gid, 0),
            "invited": invited.get(gid, 0), "rhythm": pw.get("rhythm", 0.0), "style": pw.get("style") or games.style_of(games.mandel_c(0)),
            "power": pw.get("total", 0), "powers": pw.get("powers") or {}, "level_k": pw.get("level_k", 1), "rhythm_k": pw.get("rhythm_k", games.RHYTHM_LOW),
            "glory": gb.get("glory", 0), "wins": gb.get("wins", 0), "bouts": gb.get("bouts", 0), "championships": gb.get("championships", 0),
            "goals": gb.get("goals", 0), "matches": gb.get("matches", 0), "me": gid == me,
            "appearance": heroes.hero_for_row(r)[1],
        })
    key = (lambda p: (-p["xp_period"], -p["xp"], p["name"].lower())) if days else (lambda p: (-p["xp"], p["name"].lower()))
    main = sorted(people, key=key)
    place, prev = 0, None
    for i, p in enumerate(main, 1):                    # equal scores share a place
        score = (p["xp_period"], p["xp"]) if days else p["xp"]
        if score != prev:
            place, prev = i, score
        p["place"] = place

    def top(title, emoji, value, fmt, sub=None, keep=lambda p: True, unit=""):
        rows_ = sorted((p for p in people if keep(p) and value(p)), key=lambda p: (-value(p), p["name"].lower()))
        return {"title": title, "emoji": emoji, "unit": unit,
                "rows": [{"id": p["id"], "name": p["name"], "value": fmt(value(p)), "sub": sub(p) if sub else "", "me": p["me"]} for p in rows_[:TOP]],
                "more": max(0, len(rows_) - TOP)}
    when = "this week" if days == 7 else f"last {days} days" if days else "all time"
    boards = [
        top("Most active", "🔥", lambda p: p["actions"], str, lambda p: f"on {p['days']} day{'s' if p['days'] != 1 else ''}", unit="actions"),
        top("Steadiest rhythm", "🌀", lambda p: p["rhythm"], lambda v: f"{v:.2f}", lambda p: p["style"]["name"], unit="fractal"),
        top("Top harvesters", "🧺", lambda p: p["kg"], lambda v: f"{v:g} kg", lambda p: when),
        top("Worm feeders", "🪱", lambda p: p["worm_kg"], lambda v: f"{v:g} kg",
            lambda p: f"{p['feeds']} feed{'s' if p['feeds'] != 1 else ''} · {when}"),
        top("Strongest fighters", "👊", lambda p: p["power"], str, lambda p: f"Lv {p['level']} ×{p['level_k']} · rhythm ×{p['rhythm_k']}", unit="power"),
        top("Arena glory", "🏆", lambda p: p["glory"], str,
            lambda p: f"{p['wins']} win{'s' if p['wins'] != 1 else ''}" + (f" · {p['championships']}🏆" if p["championships"] else ""), unit="glory"),
        top("Top scorers", "⚽", lambda p: p["goals"], str, lambda p: f"{p['matches']} match{'es' if p['matches'] != 1 else ''}", unit="goals"),
        top("Top inviters", "🌸", lambda p: p["invited"], str, lambda p: "friends joined", unit="joined"),
    ]
    mine = next((p for p in main if p["me"]), None)
    return {"main": main, "boards": [b for b in boards if b["rows"]], "me": mine, "count": len(main), "days": days, "when": when}


def dashboard(me=None):
    """The dashboard's little board: this week's top heroes by XP earned (all time if nobody did anything this
    week), where you are, and the arena's latest champion."""
    week = rankings(7, me)
    ranked = [p for p in week["main"] if p["xp_period"]]
    all_time = not ranked
    if all_time:
        week = rankings(None, me)
        ranked = week["main"]
    champ = games.champions(1)
    return {"top": ranked[:5], "me": week["me"], "count": week["count"], "all_time": all_time,
            "champion": champ[0]["champion"] if champ else None}
