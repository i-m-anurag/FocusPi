"""Run with:  venv/bin/python -m pytest tests -q"""

import time
from datetime import date, datetime, timedelta

import pytest

from focuspi import config, db


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "focus.db")
    monkeypatch.setattr(config, "API_KEY", "")
    db.init_db()


def ts(day, hour=10):
    return int(datetime.combine(day, datetime.min.time()).replace(hour=hour).timestamp())


def complete_on(day, minutes=30):
    start = ts(day)
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
    assert db.streak(today=today)["current"] == 0
    db.start_session(30, now=start + 3600)
    db.stop_session(now=start + 3600 + 12 * 60)  # 12 min: credit
    assert db.streak(today=today)["current"] == 1
    assert db.daily_minutes(days=1, today=today)[0]["minutes"] == 12


def test_api_flow(monkeypatch):
    from focuspi import server

    client = server.app.test_client()
    assert client.get("/api/status").json["focus"] is None
    r = client.post("/api/focus/start", json={"minutes": 25, "label": "Math"})
    assert r.status_code == 201 and r.json["focus"]["label"] == "Math"
    assert client.post("/api/focus/start", json={"minutes": 5}).status_code == 409
    assert client.post("/api/focus/start", json={"minutes": 0}).status_code == 400
    assert client.get("/api/status").json["focus"]["planned_minutes"] == 25
    r = client.post("/api/focus/stop")
    assert r.json["stopped"]["status"] == "cancelled"
    assert len(client.get("/api/stats?days=7").json["daily"]) == 7
    assert len(client.get("/api/focus/history").json["sessions"]) == 1


def test_api_key(monkeypatch):
    from focuspi import server

    monkeypatch.setattr(config, "API_KEY", "secret")
    client = server.app.test_client()
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/status").status_code == 401
    assert client.get("/api/status", headers={"X-API-Key": "secret"}).status_code == 200
