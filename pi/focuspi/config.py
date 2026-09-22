"""Runtime configuration, read from environment variables.

deploy.sh writes these into focuspi.env, which systemd loads for both
services. Every value has a sensible default so the code also runs on a laptop.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _get(name, default):
    value = os.environ.get(name, "").strip()
    return value if value else default


def _float_or_none(name):
    value = os.environ.get(name, "").strip()
    try:
        return float(value) if value else None
    except ValueError:
        return None


# --- API server -------------------------------------------------------------
HOST = _get("FOCUS_HOST", "0.0.0.0")
PORT = int(_get("FOCUS_PORT", "5050"))
# Optional shared secret. When set, the app must send it as the X-API-Key header.
API_KEY = _get("FOCUS_API_KEY", "")
DB_PATH = Path(_get("FOCUS_DB_PATH", str(BASE_DIR / "data" / "focus.db")))

# --- Focus / streak rules ---------------------------------------------------
DEFAULT_MINUTES = int(_get("FOCUS_DEFAULT_MINUTES", "30"))
MAX_MINUTES = int(_get("FOCUS_MAX_MINUTES", "240"))
# A day counts towards the streak once completed focus minutes reach this value.
STREAK_MIN_MINUTES = int(_get("FOCUS_STREAK_MIN_MINUTES", "1"))
# A cancelled session still counts its focused minutes if at least this long.
PARTIAL_CREDIT_MINUTES = int(_get("FOCUS_PARTIAL_CREDIT_MINUTES", "10"))

# --- Weather (Open-Meteo, no API key needed) --------------------------------
CITY = _get("FOCUS_CITY", "")
LAT = _float_or_none("FOCUS_LAT")
LON = _float_or_none("FOCUS_LON")
WEATHER_REFRESH_SECONDS = int(_get("FOCUS_WEATHER_REFRESH_SECONDS", "900"))

# --- OLED ---------------------------------------------------------------------
SERVER_URL = _get("FOCUS_SERVER_URL", f"http://127.0.0.1:{PORT}")
I2C_PORT = int(_get("FOCUS_I2C_PORT", "1"))
I2C_ADDR = int(_get("FOCUS_I2C_ADDR", "0x3C"), 16)
# Most 1.3" OLEDs use SH1106; most 0.96" use SSD1306.
OLED_DRIVER = _get("FOCUS_OLED_DRIVER", "sh1106").lower()
OLED_ROTATE = int(_get("FOCUS_OLED_ROTATE", "0"))  # 0..3, multiples of 90 degrees
OLED_CONTRAST = int(_get("FOCUS_OLED_CONTRAST", "255"))
# Dim the screen between these hours (24h clock). Set equal values to disable.
NIGHT_START_HOUR = int(_get("FOCUS_NIGHT_START_HOUR", "23"))
NIGHT_END_HOUR = int(_get("FOCUS_NIGHT_END_HOUR", "6"))
USE_24H = _get("FOCUS_24H", "1") == "1"
