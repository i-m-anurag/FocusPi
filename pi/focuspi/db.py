"""SQLite storage for learning topics, focus sessions and streaks.

All timestamps are Unix epoch seconds. `local_date` is the Pi's local calendar
date when the session started, so set the Pi's timezone correctly
(deploy.sh helps with that).

Sessions started on the phone while it was away from the Pi arrive later
through `import_sessions()`; `client_id` makes that import idempotent.
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

CREATE TABLE IF NOT EXISTS topics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
"""

# Columns added after the first release; applied to existing databases on boot.
MIGRATIONS = [
    ("sessions", "topic_id", "ALTER TABLE sessions ADD COLUMN topic_id INTEGER"),
    ("sessions", "client_id", "ALTER TABLE sessions ADD COLUMN client_id TEXT"),
    ("sessions", "source", "ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'pi'"),
]

# App-editable settings. Values are stored as text; these defaults come from the
# environment (focuspi.env) and are used until the app changes them.
SETTING_DEFAULTS = {
    "oled_brightness": lambda: config.OLED_CONTRAST,   # 1..255
    "oled_night_dim": lambda: 1 if config.NIGHT_DIM else 0,
    "daily_goal_minutes": lambda: config.STREAK_MIN_MINUTES,
}


class ActiveSessionError(Exception):
    def __init__(self, session):
        super().__init__("A focus session is already running")
        self.session = session


class TopicError(Exception):
    pass


def _connect():
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        for table, column, sql in MIGRATIONS:
            columns = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            if column not in columns:
                conn.execute(sql)
        # Partial index: many rows have no client_id, but the ones that do must be unique.
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_client "
            "ON sessions(client_id) WHERE client_id IS NOT NULL"
        )


def _local_date(ts):
    return datetime.fromtimestamp(ts).date().isoformat()


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
def get_settings():
    with _connect() as conn:
        stored = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
    out = {}
    for key, default in SETTING_DEFAULTS.items():
        raw = stored.get(key)
        try:
            out[key] = int(raw) if raw is not None else int(default())
        except (TypeError, ValueError):
            out[key] = int(default())
    out["oled_night_dim"] = bool(out["oled_night_dim"])
    return out


def update_settings(patch):
    clean = {}
    if "oled_brightness" in patch:
        clean["oled_brightness"] = max(1, min(255, int(patch["oled_brightness"])))
    if "oled_night_dim" in patch:
        clean["oled_night_dim"] = 1 if patch["oled_night_dim"] else 0
    if "daily_goal_minutes" in patch:
        clean["daily_goal_minutes"] = max(1, min(24 * 60, int(patch["daily_goal_minutes"])))
    with _lock, _connect() as conn:
        for key, value in clean.items():
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, str(value)),
            )
    return get_settings()


def daily_goal_minutes():
    return get_settings()["daily_goal_minutes"]


# ---------------------------------------------------------------------------
# Topics (the "what am I learning" list)
# ---------------------------------------------------------------------------
def list_topics(include_archived=False):
    sql = """
        SELECT t.*,
               COALESCE(SUM(CASE WHEN s.status = 'completed'
                                   OR (s.status = 'cancelled' AND s.focused_seconds >= ?)
                                 THEN s.focused_seconds END), 0) AS focused_seconds,
               COUNT(CASE WHEN s.status = 'completed' THEN 1 END) AS completed_sessions,
               MAX(s.started_at) AS last_used_at
        FROM topics t
        LEFT JOIN sessions s ON s.topic_id = t.id
        {where}
        GROUP BY t.id
        ORDER BY t.archived, last_used_at IS NULL, last_used_at DESC, t.name
    """.format(where="" if include_archived else "WHERE t.archived = 0")
    with _connect() as conn:
        rows = conn.execute(sql, (config.PARTIAL_CREDIT_MINUTES * 60,)).fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "archived": bool(r["archived"]),
            "focused_minutes": (r["focused_seconds"] or 0) // 60,
            "completed_sessions": r["completed_sessions"],
            "last_used_at": r["last_used_at"],
        }
        for r in rows
    ]


def add_topic(name, now=None):
    name = (name or "").strip()[:60]
    if not name:
        raise TopicError("Topic name cannot be empty")
    now = int(now if now is not None else time.time())
    with _lock, _connect() as conn:
        existing = conn.execute("SELECT * FROM topics WHERE name = ?", (name,)).fetchone()
        if existing is not None:
            if existing["archived"]:
                # Re-adding an archived topic simply brings it back.
                conn.execute("UPDATE topics SET archived = 0 WHERE id = ?", (existing["id"],))
                return existing["id"]
            raise TopicError(f"'{name}' is already in your list")
        cur = conn.execute(
            "INSERT INTO topics (name, created_at) VALUES (?, ?)", (name, now)
        )
        return cur.lastrowid


def update_topic(topic_id, name=None, archived=None):
    with _lock, _connect() as conn:
        row = conn.execute("SELECT * FROM topics WHERE id = ?", (topic_id,)).fetchone()
        if row is None:
            raise TopicError("Topic not found")
        if name is not None:
            name = name.strip()[:60]
            if not name:
                raise TopicError("Topic name cannot be empty")
            clash = conn.execute(
                "SELECT id FROM topics WHERE name = ? AND id != ?", (name, topic_id)
            ).fetchone()
            if clash is not None:
                raise TopicError(f"'{name}' is already in your list")
            conn.execute("UPDATE topics SET name = ? WHERE id = ?", (name, topic_id))
            # Keep past sessions readable with the new name.
            conn.execute("UPDATE sessions SET label = ? WHERE topic_id = ?", (name, topic_id))
        if archived is not None:
            conn.execute(
                "UPDATE topics SET archived = ? WHERE id = ?", (1 if archived else 0, topic_id)
            )
    return True


def delete_topic(topic_id):
    """Remove a topic. Past sessions keep their label text for history."""
    with _lock, _connect() as conn:
        conn.execute("UPDATE sessions SET topic_id = NULL WHERE topic_id = ?", (topic_id,))
        cur = conn.execute("DELETE FROM topics WHERE id = ?", (topic_id,))
    return cur.rowcount > 0


def _resolve_topic(conn, topic_id, label):
    """Returns (topic_id, label). Accepts an id, a name, or nothing."""
    if topic_id is not None:
        row = conn.execute("SELECT * FROM topics WHERE id = ?", (topic_id,)).fetchone()
        if row is None:
            raise TopicError("Topic not found")
        return row["id"], row["name"]
    label = (label or "").strip()[:60]
    if not label:
        return None, ""
    row = conn.execute("SELECT * FROM topics WHERE name = ?", (label,)).fetchone()
    return (row["id"], row["name"]) if row else (None, label)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
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


def start_session(minutes, label="", topic_id=None, client_id=None, now=None):
    now = int(now if now is not None else time.time())
    with _lock, _connect() as conn:
        active = conn.execute(
            "SELECT * FROM sessions WHERE status = 'active' LIMIT 1"
        ).fetchone()
        if active is not None:
            raise ActiveSessionError(_row_to_session(active, now))
        topic_id, label = _resolve_topic(conn, topic_id, label)
        cur = conn.execute(
            """INSERT INTO sessions
                 (label, topic_id, planned_minutes, started_at, ends_at, status, local_date, client_id, source)
               VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 'pi')""",
            (label, topic_id, minutes, now, now + minutes * 60, _local_date(now), client_id),
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


def import_sessions(sessions):
    """Store finished sessions the phone recorded while it was offline.

    Re-sending the same session is harmless: `client_id` is unique, so an
    interrupted sync can simply be retried.
    """
    imported, duplicates, rejected = 0, 0, 0
    with _lock, _connect() as conn:
        for s in sessions:
            try:
                client_id = str(s["client_id"]).strip()[:64]
                started_at = int(s["started_at"])
                planned = max(1, min(config.MAX_MINUTES, int(s["planned_minutes"])))
                focused = max(0, int(s.get("focused_seconds", 0)))
                status = s.get("status", "completed")
                if not client_id or status not in ("completed", "cancelled"):
                    rejected += 1
                    continue
                focused = min(focused, planned * 60)
                ended_at = int(s.get("ended_at") or started_at + focused)
                topic_id, label = _resolve_topic(conn, s.get("topic_id"), s.get("label"))
            except (KeyError, TypeError, ValueError, TopicError):
                rejected += 1
                continue
            cur = conn.execute(
                """INSERT OR IGNORE INTO sessions
                     (label, topic_id, planned_minutes, started_at, ends_at, ended_at,
                      status, focused_seconds, local_date, client_id, source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'phone')""",
                (label, topic_id, planned, started_at, started_at + planned * 60, ended_at,
                 status, focused, _local_date(started_at), client_id),
            )
            if cur.rowcount:
                imported += 1
            else:
                duplicates += 1
    return {"imported": imported, "duplicates": duplicates, "rejected": rejected}


def history(limit=50, now=None):
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [_row_to_session(r, now) for r in rows]


# ---------------------------------------------------------------------------
# Streaks and stats
# ---------------------------------------------------------------------------
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


def daily_minutes(days=7, today=None, goal=None):
    today = today or date.today()
    goal = goal or daily_goal_minutes()
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
            "goal_minutes": goal,
            "counts_for_streak": minutes >= goal,
        })
    return out


def streak(today=None):
    """Current and best streak of days that reached the daily goal.

    The current streak stays alive through today even before today's goal is
    reached: it counts back from today if today qualifies, else from yesterday.
    """
    today = today or date.today()
    goal = daily_goal_minutes()
    totals = _daily_totals()
    good = sorted(
        date.fromisoformat(d) for d, t in totals.items() if t["seconds"] // 60 >= goal
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

    today_minutes = totals.get(today.isoformat(), {"seconds": 0})["seconds"] // 60
    return {
        "current": current,
        "best": best,
        "today_done": today_done,
        "total_days": len(good),
        "goal_minutes": goal,
        "today_minutes": today_minutes,
        "remaining_minutes": max(0, goal - today_minutes),
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


def reset_data(include_topics=False):
    """Fresh start: delete every session (and optionally the topic list).

    Settings such as brightness and the daily goal are kept.
    """
    with _lock, _connect() as conn:
        sessions = conn.execute("SELECT COUNT(*) AS n FROM sessions").fetchone()["n"]
        conn.execute("DELETE FROM sessions")
        topics = 0
        if include_topics:
            topics = conn.execute("SELECT COUNT(*) AS n FROM topics").fetchone()["n"]
            conn.execute("DELETE FROM topics")
        else:
            conn.execute("UPDATE topics SET archived = 0")
    return {"deleted_sessions": sessions, "deleted_topics": topics}


def topic_totals(days=30, today=None):
    """Minutes per topic over the last N days, for the Progress screen."""
    today = today or date.today()
    start = (today - timedelta(days=days - 1)).isoformat()
    with _connect() as conn:
        rows = conn.execute(
            """SELECT COALESCE(NULLIF(label, ''), 'No topic') AS name,
                      SUM(CASE WHEN status = 'completed'
                                 OR (status = 'cancelled' AND focused_seconds >= ?)
                               THEN focused_seconds ELSE 0 END) AS seconds,
                      COUNT(CASE WHEN status = 'completed'
                                   OR (status = 'cancelled' AND focused_seconds >= ?)
                                 THEN 1 END) AS sessions
               FROM sessions
               WHERE status != 'active' AND local_date >= ?
               GROUP BY name
               HAVING seconds >= 60
               ORDER BY seconds DESC""",
            (config.PARTIAL_CREDIT_MINUTES * 60, config.PARTIAL_CREDIT_MINUTES * 60, start),
        ).fetchall()
    return [
        {"name": r["name"], "minutes": r["seconds"] // 60, "sessions": r["sessions"]} for r in rows
    ]
