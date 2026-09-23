"""Run with:  venv/bin/python -m pytest tests -q"""

import time
from datetime import date, datetime, timedelta

import pytest

from focuspi import config, db


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "focus.db")
    monkeypatch.setattr(config, "API_KEY", "")
    monkeypatch.setattr(config, "STREAK_MIN_MINUTES", 60)
    db.init_db()


def ts(day, hour=10):
    return int(datetime.combine(day, datetime.min.time()).replace(hour=hour).timestamp())


def complete_on(day, minutes=60, hour=10):
    start = ts(day, hour)
    db.start_session(minutes, now=start)
    db.complete_due(now=start + minutes * 60)


def test_start_complete_cycle():
    now = int(time.time())
    s = db.start_session(30, "DSA", now=now)
    assert s["status"] == "active" and s["remaining_seconds"] == 1800
    with pytest.raises(db.ActiveSessionError):
        db.start_session(10, now=now + 5)
    assert db.complete_due(now=now + 1799) == []
    done = db.complete_due(now=now + 1800)
    assert done[0]["status"] == "completed" and done[0]["focused_seconds"] == 1800
    assert db.get_active() is None


def test_stop_early_is_cancelled_and_late_stop_is_completed():
    now = int(time.time())
    db.start_session(30, now=now)
    s = db.stop_session(now=now + 600)
    assert s["status"] == "cancelled" and s["focused_seconds"] == 600
    db.start_session(30, now=now + 700)
    s = db.stop_session(now=now + 700 + 1900)
    assert s["status"] == "completed" and s["focused_seconds"] == 1800
    assert db.stop_session() is None


# --- streak: one hour a day, adding up across sessions ----------------------
def test_day_counts_only_when_the_hour_is_reached():
    today = date(2026, 9, 22)
    complete_on(today, minutes=45)
    assert db.streak(today=today)["current"] == 0
    st = db.streak(today=today)
    assert st["today_minutes"] == 45 and st["remaining_minutes"] == 15
    complete_on(today, minutes=20, hour=14)  # 45 + 20 = 65 minutes
    st = db.streak(today=today)
    assert st["today_done"] and st["current"] == 1 and st["remaining_minutes"] == 0


def test_short_sessions_add_up_to_the_goal():
    today = date(2026, 9, 22)
    for hour in (9, 11, 13, 15):
        complete_on(today, minutes=15, hour=hour)
    assert db.streak(today=today)["current"] == 1


def test_streak_counts_consecutive_days():
    today = date(2026, 9, 22)
    for back in (0, 1, 2, 4, 5, 6, 7):
        complete_on(today - timedelta(days=back))
    st = db.streak(today=today)
    assert st["current"] == 3 and st["best"] == 4 and st["today_done"]


def test_streak_survives_until_today_ends():
    today = date(2026, 9, 22)
    complete_on(today - timedelta(days=1))
    complete_on(today - timedelta(days=2))
    st = db.streak(today=today)
    assert st["current"] == 2 and not st["today_done"]
    assert db.streak(today=today + timedelta(days=1))["current"] == 0


def test_partial_credit(monkeypatch):
    monkeypatch.setattr(config, "PARTIAL_CREDIT_MINUTES", 10)
    today = date(2026, 9, 22)
    start = ts(today)
    db.start_session(30, now=start)
    db.stop_session(now=start + 5 * 60)  # 5 min: no credit
    assert db.daily_minutes(days=1, today=today)[0]["minutes"] == 0
    db.start_session(60, now=start + 3600)
    db.stop_session(now=start + 3600 + 62 * 60)  # 62 min: counts
    assert db.streak(today=today)["current"] == 1


def test_goal_is_configurable_from_settings():
    today = date(2026, 9, 22)
    complete_on(today, minutes=30)
    assert db.streak(today=today)["current"] == 0
    db.update_settings({"daily_goal_minutes": 30})
    st = db.streak(today=today)
    assert st["goal_minutes"] == 30 and st["current"] == 1


# --- topics -----------------------------------------------------------------
def test_topic_crud_and_session_link():
    tid = db.add_topic("System design")
    with pytest.raises(db.TopicError):
        db.add_topic("system design")  # case-insensitive duplicate
    with pytest.raises(db.TopicError):
        db.add_topic("   ")
    s = db.start_session(30, topic_id=tid, now=ts(date(2026, 9, 22)))
    assert s["label"] == "System design" and s["topic_id"] == tid

    db.update_topic(tid, name="Sys design")
    assert db.history()[0]["label"] == "Sys design"
    assert db.list_topics()[0]["name"] == "Sys design"

    db.update_topic(tid, archived=True)
    assert db.list_topics() == []
    assert len(db.list_topics(include_archived=True)) == 1
    db.add_topic("sys design")  # re-adding un-archives
    assert len(db.list_topics()) == 1

    assert db.delete_topic(tid)
    assert db.list_topics() == []
    assert db.history()[0]["label"] == "Sys design"  # history keeps the name


def test_starting_with_a_free_text_label_links_a_matching_topic():
    tid = db.add_topic("Python")
    s = db.start_session(30, label="python")
    assert s["topic_id"] == tid and s["label"] == "Python"
    db.stop_session()
    s = db.start_session(30, label="Gardening")
    assert s["topic_id"] is None and s["label"] == "Gardening"


def test_topic_totals():
    today = date(2026, 9, 22)
    tid = db.add_topic("DSA")
    start = ts(today)
    db.start_session(30, topic_id=tid, now=start)
    db.complete_due(now=start + 1800)
    assert db.topic_totals(today=today)[0] == {"name": "DSA", "minutes": 30, "sessions": 1}


def test_topic_totals_ignore_trial_runs(monkeypatch):
    """A session stopped after a few seconds should not show up as a topic."""
    monkeypatch.setattr(config, "PARTIAL_CREDIT_MINUTES", 10)
    today = date(2026, 9, 22)
    tid = db.add_topic("Pandas")
    start = ts(today)
    db.start_session(30, topic_id=tid, now=start)
    db.stop_session(now=start + 11)  # stopped after 11 seconds
    db.start_session(30, now=start + 600)  # no topic, also abandoned
    db.stop_session(now=start + 622)
    assert db.topic_totals(today=today) == []
    assert db.list_topics()[0]["focused_minutes"] == 0

    db.start_session(30, topic_id=tid, now=start + 3600)
    db.complete_due(now=start + 3600 + 1800)
    assert db.topic_totals(today=today) == [{"name": "Pandas", "minutes": 30, "sessions": 1}]
    assert db.list_topics()[0]["focused_minutes"] == 30


# --- offline sync -----------------------------------------------------------
def offline_session(client_id, day, minutes=30, status="completed", hour=9):
    start = ts(day, hour)
    return {
        "client_id": client_id,
        "label": "Offline study",
        "planned_minutes": minutes,
        "started_at": start,
        "ended_at": start + minutes * 60,
        "focused_seconds": minutes * 60,
        "status": status,
    }


def test_import_sessions_is_idempotent():
    today = date(2026, 9, 22)
    batch = [offline_session("a", today, 40), offline_session("b", today, 20, hour=12)]
    assert db.import_sessions(batch) == {"imported": 2, "duplicates": 0, "rejected": 0}
    # A retried sync must not double-count the streak.
    assert db.import_sessions(batch) == {"imported": 0, "duplicates": 2, "rejected": 0}
    st = db.streak(today=today)
    assert st["today_minutes"] == 60 and st["current"] == 1
    assert db.history()[0]["source"] == "phone"


def test_import_rejects_bad_rows_and_clamps_time():
    today = date(2026, 9, 22)
    bad = [
        {"client_id": "", "planned_minutes": 30, "started_at": ts(today)},
        {"client_id": "x", "planned_minutes": 30, "started_at": ts(today), "status": "active"},
        {"client_id": "y", "started_at": "not-a-number", "planned_minutes": 5},
    ]
    assert db.import_sessions(bad)["rejected"] == 3
    cheat = offline_session("z", today, 30)
    cheat["focused_seconds"] = 99999  # cannot claim more than the session length
    db.import_sessions([cheat])
    assert db.history()[0]["focused_seconds"] == 1800


def test_offline_session_links_to_a_topic_by_name():
    today = date(2026, 9, 22)
    tid = db.add_topic("Math")
    s = offline_session("m1", today)
    s["label"] = "math"
    db.import_sessions([s])
    assert db.history()[0]["topic_id"] == tid


# --- settings ---------------------------------------------------------------
def test_settings_defaults_and_clamping():
    s = db.get_settings()
    assert s["daily_goal_minutes"] == 60 and s["oled_brightness"] == config.OLED_CONTRAST
    s = db.update_settings({"oled_brightness": 900, "oled_night_dim": False})
    assert s["oled_brightness"] == 255 and s["oled_night_dim"] is False
    assert db.update_settings({"oled_brightness": 0})["oled_brightness"] == 1


# --- API --------------------------------------------------------------------
@pytest.fixture
def client():
    from focuspi import server

    return server.app.test_client()


def test_api_flow(client):
    assert client.get("/api/status").json["focus"] is None
    tid = client.post("/api/topics", json={"name": "Math"}).json["id"]
    assert client.post("/api/topics", json={"name": "Math"}).status_code == 400

    r = client.post("/api/focus/start", json={"minutes": 25, "topic_id": tid, "client_id": "c1"})
    assert r.status_code == 201 and r.json["focus"]["label"] == "Math"
    assert client.post("/api/focus/start", json={"minutes": 5}).status_code == 409
    assert client.post("/api/focus/start", json={"minutes": 0}).status_code == 400
    assert client.get("/api/status").json["focus"]["planned_minutes"] == 25
    assert client.post("/api/focus/stop").json["stopped"]["status"] == "cancelled"

    status = client.get("/api/status").json
    assert status["settings"]["daily_goal_minutes"] == 60
    assert [t["name"] for t in status["topics"]] == ["Math"]
    assert len(client.get("/api/stats?days=7").json["daily"]) == 7

    assert client.patch(f"/api/topics/{tid}", json={"name": "Maths"}).json["topics"][0]["name"] == "Maths"
    assert client.delete(f"/api/topics/{tid}").json["topics"] == []
    assert client.delete(f"/api/topics/{tid}").status_code == 404


def test_api_sync_and_settings(client):
    today = date.today()
    batch = {"sessions": [offline_session("s1", today, 70)]}
    r = client.post("/api/focus/sync", json=batch)
    assert r.json["imported"] == 1 and r.json["streak"]["current"] == 1
    assert client.post("/api/focus/sync", json=batch).json["duplicates"] == 1
    assert client.post("/api/focus/sync", json={"sessions": "nope"}).status_code == 400

    r = client.put("/api/settings", json={"oled_brightness": 120, "daily_goal_minutes": 90})
    assert r.json["settings"] == {"oled_brightness": 120, "oled_night_dim": True,
                                  "daily_goal_minutes": 90}
    assert client.get("/api/settings").json["settings"]["oled_brightness"] == 120


def test_reset_data(client):
    today = date.today()
    tid = db.add_topic("DSA")
    start = ts(today)
    db.start_session(60, topic_id=tid, now=start)
    db.complete_due(now=start + 3600)
    db.update_settings({"oled_brightness": 90})
    assert db.streak(today=today)["current"] == 1

    r = client.post("/api/data/reset", json={})
    assert r.json["deleted_sessions"] == 1 and r.json["deleted_topics"] == 0
    assert db.history() == []
    assert db.streak(today=today)["current"] == 0
    assert db.totals()["focused_minutes"] == 0
    assert [t["name"] for t in db.list_topics()] == ["DSA"]  # topics kept by default
    assert db.get_settings()["oled_brightness"] == 90  # settings kept

    r = client.post("/api/data/reset", json={"include_topics": True})
    assert r.json["deleted_topics"] == 1 and db.list_topics() == []


def test_api_key(client, monkeypatch):
    monkeypatch.setattr(config, "API_KEY", "secret")
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/status").status_code == 401
    assert client.get("/api/status", headers={"X-API-Key": "secret"}).status_code == 200
