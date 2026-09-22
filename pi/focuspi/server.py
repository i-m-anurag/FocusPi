"""FocusPi REST API (Flask served by waitress).

Endpoints (all JSON):
  GET  /api/health                 liveness check (no auth)
  GET  /api/status                 clock + active focus session + streak + weather
  POST /api/focus/start            {"minutes": 30, "label": "DSA"}
  POST /api/focus/stop             cancel the running session
  GET  /api/focus/history?limit=50 recent sessions
  GET  /api/stats?days=7           daily minutes, streak, totals
  GET  /api/weather                cached weather
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
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
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
    label = str(body.get("label", "")).strip()[:60]
    try:
        session = db.start_session(minutes, label)
    except db.ActiveSessionError as e:
        return jsonify(error=str(e), focus=e.session), 409
    log.info("Focus started: %s min %r", minutes, label)
    return jsonify(focus=session, server_time=int(time.time())), 201


@app.post("/api/focus/stop")
def focus_stop():
    session = db.stop_session()
    if session is None:
        return jsonify(focus=None, stopped=None, streak=db.streak())
    log.info("Focus stopped: #%s %s", session["id"], session["status"])
    return jsonify(focus=None, stopped=session, streak=db.streak())


@app.get("/api/focus/history")
def focus_history():
    limit = min(max(request.args.get("limit", 50, type=int), 1), 500)
    return jsonify(sessions=db.history(limit=limit))


@app.get("/api/stats")
def stats():
    db.complete_due()
    days = min(max(request.args.get("days", 7, type=int), 1), 366)
    return jsonify(daily=db.daily_minutes(days=days), streak=db.streak(), totals=db.totals())


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
