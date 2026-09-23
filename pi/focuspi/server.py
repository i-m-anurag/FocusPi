"""FocusPi REST API (Flask served by waitress).

Endpoints (all JSON):
  GET    /api/health                 liveness check (no auth)
  GET    /api/status                 clock + active session + streak + weather + settings
  POST   /api/focus/start            {"minutes": 30, "topic_id": 2, "client_id": "..."}
  POST   /api/focus/stop             cancel the running session
  POST   /api/focus/sync             upload sessions recorded offline on the phone
  GET    /api/focus/history?limit=50 recent sessions
  GET    /api/stats?days=7           daily minutes, streak, totals, minutes per topic
  GET    /api/topics                 the learning list
  POST   /api/topics                 {"name": "System design"}
  PATCH  /api/topics/<id>            {"name": "...", "archived": true}
  DELETE /api/topics/<id>
  GET    /api/settings               OLED brightness, night dimming, daily goal
  PUT    /api/settings               change any of the above
  GET    /api/weather                cached weather
"""

import logging
import threading
import time
from datetime import datetime

from flask import Flask, jsonify, request

from . import config, db, weather

log = logging.getLogger("server")
app = Flask(__name__)


@app.after_request
def add_cors_headers(response):
    # Lets a browser (e.g. the app running on web during development) call the API.
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    return response


@app.before_request
def check_api_key():
    if request.method == "OPTIONS":
        return app.make_default_options_response()
    if not config.API_KEY or request.path == "/api/health":
        return None
    if request.headers.get("X-API-Key") != config.API_KEY:
        return jsonify(error="Invalid or missing API key"), 401
    return None


def _last_finished():
    rows = [s for s in db.history(limit=3) if s["status"] != "active"]
    return rows[0] if rows else None


@app.get("/api/health")
def health():
    return jsonify(ok=True, server_time=int(time.time()))


@app.get("/api/status")
def status():
    db.complete_due()
    now = time.time()
    return jsonify(
        server_time=int(now),
        server_time_iso=datetime.now().astimezone().isoformat(timespec="seconds"),
        focus=db.get_active(),
        last_session=_last_finished(),
        streak=db.streak(),
        today=db.daily_minutes(days=1)[0],
        topics=db.list_topics(),
        settings=db.get_settings(),
        weather=weather.current(),
        default_minutes=config.DEFAULT_MINUTES,
    )


@app.post("/api/focus/start")
def focus_start():
    db.complete_due()
    body = request.get_json(silent=True) or {}
    try:
        minutes = int(body.get("minutes", config.DEFAULT_MINUTES))
    except (TypeError, ValueError):
        return jsonify(error="minutes must be a number"), 400
    if not 1 <= minutes <= config.MAX_MINUTES:
        return jsonify(error=f"minutes must be between 1 and {config.MAX_MINUTES}"), 400
    try:
        session = db.start_session(
            minutes,
            label=str(body.get("label", "")),
            topic_id=body.get("topic_id"),
            client_id=body.get("client_id"),
        )
    except db.ActiveSessionError as e:
        return jsonify(error=str(e), focus=e.session), 409
    except db.TopicError as e:
        return jsonify(error=str(e)), 400
    log.info("Focus started: %s min %r", minutes, session["label"])
    return jsonify(focus=session, server_time=int(time.time())), 201


@app.post("/api/focus/stop")
def focus_stop():
    session = db.stop_session()
    if session is None:
        return jsonify(focus=None, stopped=None, streak=db.streak())
    log.info("Focus stopped: #%s %s", session["id"], session["status"])
    return jsonify(focus=None, stopped=session, streak=db.streak())


@app.post("/api/focus/sync")
def focus_sync():
    """Receive sessions the phone completed while it could not reach the Pi."""
    body = request.get_json(silent=True) or {}
    sessions = body.get("sessions")
    if not isinstance(sessions, list):
        return jsonify(error="sessions must be a list"), 400
    if len(sessions) > 500:
        return jsonify(error="too many sessions in one request (max 500)"), 400
    result = db.import_sessions(sessions)
    if result["imported"]:
        log.info("Synced %s offline session(s) from the phone", result["imported"])
    return jsonify(**result, streak=db.streak(), today=db.daily_minutes(days=1)[0])


@app.get("/api/focus/history")
def focus_history():
    limit = min(max(request.args.get("limit", 50, type=int), 1), 500)
    return jsonify(sessions=db.history(limit=limit))


@app.get("/api/stats")
def stats():
    db.complete_due()
    days = min(max(request.args.get("days", 7, type=int), 1), 366)
    return jsonify(
        daily=db.daily_minutes(days=days),
        streak=db.streak(),
        totals=db.totals(),
        topics=db.topic_totals(days=days),
    )


# --- Learning list ----------------------------------------------------------
@app.get("/api/topics")
def topics_list():
    include_archived = request.args.get("archived") == "1"
    return jsonify(topics=db.list_topics(include_archived=include_archived))


@app.post("/api/topics")
def topics_add():
    body = request.get_json(silent=True) or {}
    try:
        topic_id = db.add_topic(body.get("name", ""))
    except db.TopicError as e:
        return jsonify(error=str(e)), 400
    return jsonify(id=topic_id, topics=db.list_topics()), 201


@app.patch("/api/topics/<int:topic_id>")
def topics_update(topic_id):
    body = request.get_json(silent=True) or {}
    try:
        db.update_topic(topic_id, name=body.get("name"), archived=body.get("archived"))
    except db.TopicError as e:
        return jsonify(error=str(e)), 400
    return jsonify(topics=db.list_topics())


@app.delete("/api/topics/<int:topic_id>")
def topics_delete(topic_id):
    if not db.delete_topic(topic_id):
        return jsonify(error="Topic not found"), 404
    return jsonify(topics=db.list_topics())


# --- Settings ---------------------------------------------------------------
@app.get("/api/settings")
def settings_get():
    return jsonify(settings=db.get_settings())


@app.put("/api/settings")
def settings_put():
    body = request.get_json(silent=True) or {}
    try:
        settings = db.update_settings(body)
    except (TypeError, ValueError):
        return jsonify(error="Invalid settings value"), 400
    log.info("Settings updated: %s", settings)
    return jsonify(settings=settings)


@app.get("/api/weather")
def get_weather():
    return jsonify(weather=weather.current())


def _completion_loop():
    """Close sessions whose timer ran out, even if nobody is calling the API."""
    while True:
        try:
            for s in db.complete_due():
                log.info("Focus completed: #%s (%s min)", s["id"], s["planned_minutes"])
        except Exception:
            log.exception("completion loop failed")
        time.sleep(1)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    db.init_db()
    threading.Thread(target=_completion_loop, daemon=True, name="completion").start()
    threading.Thread(target=weather.run_forever, daemon=True, name="weather").start()

    from waitress import serve

    log.info("FocusPi API listening on http://%s:%s", config.HOST, config.PORT)
    serve(app, host=config.HOST, port=config.PORT, threads=4)


if __name__ == "__main__":
    main()
