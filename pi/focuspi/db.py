"""SQLite storage for focus sessions and streak calculation.

All timestamps are Unix epoch seconds. `local_date` is the Pi's local calendar
date when the session started, so set the Pi's timezone correctly
(deploy.sh helps with that).
"""

import sqlite3
import threading
import time
from datetime import date, datetime, timedelta

from . import config

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    label            TEXT    NOT NULL DEFAULT '',
    planned_minutes  INTEGER NOT NULL,
    started_at       INTEGER NOT NULL,
    ends_at          INTEGER NOT NULL,
    ended_at         INTEGER,
    status           TEXT    NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
    focused_seconds  INTEGER NOT NULL DEFAULT 0,
    local_date       TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(local_date);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
"""


class ActiveSessionError(Exception):
    def __init__(self, session):
        super().__init__("A focus session is already running")
        self.session = session


def _connect():
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)


def _local_date(ts):
    return datetime.fromtimestamp(ts).date().isoformat()


def _row_to_session(row, now=None):
    if row is None:
        return None
    now = int(now if now is not None else time.time())
    s = dict(row)
    if s["status"] == "active":
        s["remaining_seconds"] = max(0, s["ends_at"] - now)
        s["elapsed_seconds"] = max(0, now - s["started_at"])
    else:
        s["remaining_seconds"] = 0
        s["elapsed_seconds"] = s["focused_seconds"]
    s["total_seconds"] = s["planned_minutes"] * 60
    return s


def get_active(now=None):
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM sessions WHERE status = 'active' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return _row_to_session(row, now)


def start_session(minutes, label="", now=None):
    now = int(now if now is not None else time.time())
    with _lock, _connect() as conn:
        active = conn.execute(
            "SELECT * FROM sessions WHERE status = 'active' LIMIT 1"
        ).fetchone()
        if active is not None:
            raise ActiveSessionError(_row_to_session(active, now))
        cur = conn.execute(
            """INSERT INTO sessions (label, planned_minutes, started_at, ends_at, status, local_date)
               VALUES (?, ?, ?, ?, 'active', ?)""",
            (label, minutes, now, now + minutes * 60, _local_date(now)),
        )
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _row_to_session(row, now)


def stop_session(now=None):
    """Cancel the running session. Returns the stopped session, or None."""
    now = int(now if now is not None else time.time())
    with _lock, _connect() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE status = 'active' LIMIT 1").fetchone()
        if row is None:
            return None
        if now >= row["ends_at"]:
            # Stop arrived after the timer already ran out: that's a completion.
            status, focused, ended = "completed", row["planned_minutes"] * 60, row["ends_at"]
        else:
            status, focused, ended = "cancelled", max(0, now - row["started_at"]), now
        conn.execute(
            "UPDATE sessions SET status = ?, focused_seconds = ?, ended_at = ? WHERE id = ?",
            (status, focused, ended, row["id"]),
        )
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (row["id"],)).fetchone()
    return _row_to_session(row, now)


def complete_due(now=None):
    """Mark every active session whose timer has run out as completed."""
    now = int(now if now is not None else time.time())
    with _lock, _connect() as conn:
        rows = conn.execute(
            "SELECT id FROM sessions WHERE status = 'active' AND ends_at <= ?", (now,)
        ).fetchall()
        for r in rows:
            conn.execute(
                """UPDATE sessions
                   SET status = 'completed', focused_seconds = planned_minutes * 60, ended_at = ends_at
                   WHERE id = ?""",
                (r["id"],),
            )
        done = [
            conn.execute("SELECT * FROM sessions WHERE id = ?", (r["id"],)).fetchone() for r in rows
        ]
    return [_row_to_session(r, now) for r in done]


def get_session(session_id, now=None):
    with _connect() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    return _row_to_session(row, now)


def history(limit=50, now=None):
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_row_to_session(r, now) for r in rows]


_CREDIT_SQL = """
    SELECT local_date,
           SUM(CASE WHEN status = 'completed'
                      OR (status = 'cancelled' AND focused_seconds >= ?)
                    THEN focused_seconds ELSE 0 END) AS seconds,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
    FROM sessions
    WHERE status != 'active' {where}
    GROUP BY local_date
"""


def _daily_totals(where="", params=()):
    sql = _CREDIT_SQL.format(where=where)
    with _connect() as conn:
        rows = conn.execute(sql, (config.PARTIAL_CREDIT_MINUTES * 60, *params)).fetchall()
    return {r["local_date"]: {"seconds": r["seconds"] or 0, "completed": r["completed"] or 0} for r in rows}


def daily_minutes(days=7, today=None):
    today = today or date.today()
    start = today - timedelta(days=days - 1)
    totals = _daily_totals("AND local_date >= ?", (start.isoformat(),))
    out = []
    for i in range(days):
        d = (start + timedelta(days=i)).isoformat()
        t = totals.get(d, {"seconds": 0, "completed": 0})
        minutes = t["seconds"] // 60
        out.append({
            "date": d,
            "minutes": minutes,
            "completed_sessions": t["completed"],
            "counts_for_streak": minutes >= config.STREAK_MIN_MINUTES,
        })
    return out


def streak(today=None):
    """Current and best streak of consecutive learning days.

    The current streak stays alive through today even before today's first
    session: it counts back from today if today qualifies, else from yesterday.
    """
    today = today or date.today()
    totals = _daily_totals()
    good = sorted(
        date.fromisoformat(d)
        for d, t in totals.items()
        if t["seconds"] // 60 >= config.STREAK_MIN_MINUTES
    )
    good_set = set(good)

    today_done = today in good_set
    cursor = today if today_done else today - timedelta(days=1)
    current = 0
    while cursor in good_set:
        current += 1
        cursor -= timedelta(days=1)

    best, run, prev = 0, 0, None
    for d in good:
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        best = max(best, run)
        prev = d

    return {
        "current": current,
        "best": best,
        "today_done": today_done,
        "total_days": len(good),
        "min_minutes": config.STREAK_MIN_MINUTES,
    }


def totals():
    with _connect() as conn:
        row = conn.execute(
            """SELECT COUNT(*) AS sessions,
                      COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed,
                      COALESCE(SUM(focused_seconds), 0) AS seconds
               FROM sessions WHERE status != 'active'"""
        ).fetchone()
    return {
        "sessions": row["sessions"],
        "completed_sessions": row["completed"],
        "focused_minutes": row["seconds"] // 60,
    }
