"""Current weather from Open-Meteo (free, no API key).

Location comes from FOCUS_LAT/FOCUS_LON, or is geocoded once from FOCUS_CITY.
"""

import logging
import threading
import time

import requests

from . import config

log = logging.getLogger("weather")

# WMO weather interpretation codes -> (short text, icon key used by the OLED)
WMO = {
    0: ("Clear", "clear"),
    1: ("Mostly clear", "clear"),
    2: ("Partly cloudy", "partly"),
    3: ("Overcast", "cloud"),
    45: ("Fog", "fog"),
    48: ("Rime fog", "fog"),
    51: ("Light drizzle", "rain"),
    53: ("Drizzle", "rain"),
    55: ("Heavy drizzle", "rain"),
    56: ("Freezing drizzle", "rain"),
    57: ("Freezing drizzle", "rain"),
    61: ("Light rain", "rain"),
    63: ("Rain", "rain"),
    65: ("Heavy rain", "rain"),
    66: ("Freezing rain", "rain"),
    67: ("Freezing rain", "rain"),
    71: ("Light snow", "snow"),
    73: ("Snow", "snow"),
    75: ("Heavy snow", "snow"),
    77: ("Snow grains", "snow"),
    80: ("Rain showers", "rain"),
    81: ("Rain showers", "rain"),
    82: ("Violent showers", "rain"),
    85: ("Snow showers", "snow"),
    86: ("Snow showers", "snow"),
    95: ("Thunderstorm", "storm"),
    96: ("Thunderstorm", "storm"),
    99: ("Thunderstorm", "storm"),
}

_state_lock = threading.Lock()
_state = {"weather": None, "location": None}


def _resolve_location():
    if config.LAT is not None and config.LON is not None:
        return {"lat": config.LAT, "lon": config.LON, "name": config.CITY or "Home"}
    if not config.CITY:
        return None
    r = requests.get(
        "https://geocoding-api.open-meteo.com/v1/search",
        params={"name": config.CITY, "count": 1, "language": "en", "format": "json"},
        timeout=10,
    )
    r.raise_for_status()
    results = r.json().get("results") or []
    if not results:
        log.warning("City %r not found by geocoder", config.CITY)
        return None
    top = results[0]
    return {"lat": top["latitude"], "lon": top["longitude"], "name": top.get("name", config.CITY)}


def fetch_once():
    with _state_lock:
        location = _state["location"]
    if location is None:
        location = _resolve_location()
        if location is None:
            return None
        with _state_lock:
            _state["location"] = location

    r = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": location["lat"],
            "longitude": location["lon"],
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,"
                       "weather_code,wind_speed_10m,is_day",
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "forecast_days": 1,
            "timezone": "auto",
        },
        timeout=10,
    )
    r.raise_for_status()
    data = r.json()
    cur = data["current"]
    daily = data.get("daily", {})
    code = int(cur.get("weather_code", 0))
    text, icon = WMO.get(code, ("Unknown", "cloud"))
    is_day = bool(cur.get("is_day", 1))
    if icon in ("clear", "partly") and not is_day:
        icon = "night" if icon == "clear" else "night_partly"

    def first(key):
        values = daily.get(key) or [None]
        return values[0]

    weather = {
        "city": location["name"],
        "temperature": round(cur["temperature_2m"]),
        "feels_like": round(cur.get("apparent_temperature", cur["temperature_2m"])),
        "humidity": cur.get("relative_humidity_2m"),
        "wind_kmh": round(cur.get("wind_speed_10m") or 0),
        "code": code,
        "text": text,
        "icon": icon,
        "is_day": is_day,
        "high": round(first("temperature_2m_max")) if first("temperature_2m_max") is not None else None,
        "low": round(first("temperature_2m_min")) if first("temperature_2m_min") is not None else None,
        "rain_chance": first("precipitation_probability_max"),
        "updated_at": int(time.time()),
    }
    with _state_lock:
        _state["weather"] = weather
    return weather


def current():
    with _state_lock:
        return dict(_state["weather"]) if _state["weather"] else None


def run_forever():
    while True:
        try:
            if fetch_once() is None:
                log.info("No weather location configured (set FOCUS_CITY or FOCUS_LAT/LON)")
                time.sleep(3600)
                continue
            time.sleep(config.WEATHER_REFRESH_SECONDS)
        except Exception as e:  # network blips are normal; retry soon
            log.warning("Weather fetch failed: %s", e)
            time.sleep(60)
