#!/usr/bin/env python3
"""FocusPi OLED display (128x64, SH1106 or SSD1306 over I2C).

Shows a digital clock + date + weather + streak. When a focus session is
running it switches to a big countdown with a progress bar.

The clock keeps running from the Pi's own time even if the API is down.
Data comes from the local API (/api/status), polled every 2 seconds.

OLED wiring (I2C), see docs/PINOUT.md:
  VCC -> 3.3V  (pin 1)
  GND -> GND   (pin 9)
  SCL -> GPIO3 (pin 5)
  SDA -> GPIO2 (pin 3)

Preview without hardware (writes PNGs):
  python -m focuspi.oled --preview ./preview
"""

import argparse
import logging
import os
import threading
import time
from datetime import datetime

import requests
from PIL import ImageFont

from . import config

log = logging.getLogger("oled")

W, H = 128, 64
FRAME_INTERVAL = 0.25
POLL_INTERVAL = 2.0
ROTATE_SECONDS = 5
DONE_SCREEN_SECONDS = 20
STOPPED_SCREEN_SECONDS = 5


def load_font(size, mono=False):
    name = "DejaVuSansMono-Bold.ttf" if mono else "DejaVuSans-Bold.ttf"
    extra = [os.path.join(os.environ["FOCUS_FONT_DIR"], name)] if os.environ.get("FOCUS_FONT_DIR") else []
    paths = extra + (
        [
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        ]
        if mono
        else [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            # macOS fallbacks so --preview works on a laptop
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/Library/Fonts/Arial Bold.ttf",
        ]
    )
    for path in paths:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


FONT_SM = load_font(10)
FONT_MD = load_font(12)
FONT_CLOCK = load_font(32)
FONT_TIMER = load_font(34)
FONT_TIMER_LONG = load_font(24)


# --------------------------------------------------------------------------
# Shared state filled by the poll thread
# --------------------------------------------------------------------------
state_lock = threading.Lock()
state = {"status": None, "fetched_mono": 0.0, "online": False}


def poll_thread():
    headers = {"X-API-Key": config.API_KEY} if config.API_KEY else {}
    url = f"{config.SERVER_URL}/api/status"
    while True:
        try:
            r = requests.get(url, headers=headers, timeout=3)
            r.raise_for_status()
            data = r.json()
            with state_lock:
                state["status"] = data
                state["fetched_mono"] = time.monotonic()
                state["online"] = True
        except Exception as e:
            with state_lock:
                if state["online"]:
                    log.warning("API unreachable: %s", e)
                state["online"] = False
        time.sleep(POLL_INTERVAL)


# --------------------------------------------------------------------------
# Drawing helpers
# --------------------------------------------------------------------------
def text_w(draw, text, font):
    return int(draw.textlength(text, font=font))


def draw_centered(draw, y, text, font, fill="white", dx=0):
    x = max(0, (W - text_w(draw, text, font)) // 2) + dx
    draw.text((x, y), text, fill=fill, font=font)


def draw_cloud(draw, x, y, fill="white"):
    # ~12x7 cloud with its top-left at (x, y)
    draw.ellipse((x + 1, y + 2, x + 6, y + 7), fill=fill)
    draw.ellipse((x + 4, y, x + 10, y + 6), fill=fill)
    draw.rectangle((x + 3, y + 4, x + 11, y + 7), fill=fill)
    draw.ellipse((x + 8, y + 3, x + 12, y + 7), fill=fill)


def draw_weather_icon(draw, x, y, icon):
    """12x12 icon with its top-left at (x, y)."""
    cx, cy = x + 6, y + 6
    if icon == "clear":
        draw.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill="white")
        for dx, dy in ((0, -6), (0, 6), (-6, 0), (6, 0), (-4, -4), (4, 4), (-4, 4), (4, -4)):
            draw.point((cx + dx, cy + dy), fill="white")
            draw.point((cx + dx * 5 // 6, cy + dy * 5 // 6), fill="white")
    elif icon in ("night", "night_partly"):
        draw.ellipse((x + 1, y + 1, x + 10, y + 10), fill="white")
        draw.ellipse((x + 4, y - 1, x + 13, y + 8), fill="black")
        if icon == "night_partly":
            draw_cloud(draw, x + 2, y + 5)
    elif icon == "partly":
        draw.ellipse((x + 5, y, x + 11, y + 6), outline="white")
        draw_cloud(draw, x, y + 4)
    elif icon == "cloud":
        draw_cloud(draw, x, y + 2)
    elif icon == "rain":
        draw_cloud(draw, x, y)
        for i in range(3):
            draw.line((x + 3 + i * 3, y + 9, x + 2 + i * 3, y + 11), fill="white")
    elif icon == "snow":
        draw_cloud(draw, x, y)
        for i in range(3):
            draw.point((x + 3 + i * 3, y + 10), fill="white")
            draw.point((x + 4 + i * 3, y + 11), fill="white")
    elif icon == "storm":
        draw_cloud(draw, x, y)
        draw.line((x + 7, y + 7, x + 5, y + 10, x + 8, y + 10, x + 6, y + 12), fill="white")
    elif icon == "fog":
        for i in range(4):
            draw.line((x + (i % 2), y + 2 + i * 3, x + 11 - (i % 2), y + 2 + i * 3), fill="white")


def draw_flame(draw, x, y):
    """Small 8x10 streak flame."""
    draw.polygon([(x + 4, y), (x + 8, y + 6), (x + 6, y + 10), (x + 2, y + 10), (x, y + 6)], fill="white")
    draw.polygon([(x + 4, y + 5), (x + 5, y + 8), (x + 3, y + 8)], fill="black")


def fmt_clock(now):
    if config.USE_24H:
        return now.strftime("%H:%M"), ""
    return now.strftime("%I:%M").lstrip("0"), now.strftime("%p")


def fmt_duration(seconds):
    seconds = max(0, int(seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def bottom_lines(status, online):
    """Lines that rotate along the bottom of the clock screen."""
    if not online or not status:
        return ["Server offline"]
    lines = []
    w = status.get("weather")
    if w:
        hl = f" {w['high']}/{w['low']}°" if w.get("high") is not None else ""
        lines.append(f"{w['text']}{hl}")
        if w.get("humidity") is not None:
            lines.append(f"Hum {w['humidity']}%  Wind {w['wind_kmh']}km/h")
    streak = status.get("streak") or {}
    done = streak.get("today_minutes", 0)
    goal = streak.get("goal_minutes", 0)
    progress = f"{done}/{goal}m today" if goal else f"{done}m today"
    lines.append(f"@streak {streak.get('current', 0)}d   {progress}")
    return lines


def draw_clock_screen(draw, now, status, online):
    # Shift everything by up to 1px each minute to reduce OLED burn-in.
    shift = (now.minute % 3) - 1

    # Top row: date (left) + weather (right)
    draw.text((0 + shift, 0), now.strftime("%a %d %b"), fill="white", font=FONT_SM)
    w = status.get("weather") if status else None
    if w:
        temp = f"{w['temperature']}°C"
        tw = text_w(draw, temp, FONT_SM)
        draw.text((W - tw + shift - 1, 0), temp, fill="white", font=FONT_SM)
        draw_weather_icon(draw, W - tw - 15 + shift, 0, w.get("icon", "cloud"))
    elif not online:
        draw.text((W - 22 + shift, 0), "--°", fill="white", font=FONT_SM)

    # Big time with seconds
    hhmm, ampm = fmt_clock(now)
    secs = now.strftime("%S")
    big_w = text_w(draw, hhmm, FONT_CLOCK)
    small_w = max(text_w(draw, secs, FONT_SM), text_w(draw, ampm, FONT_SM) if ampm else 0)
    x = (W - big_w - small_w - 3) // 2 + shift
    draw.text((x, 12), hhmm, fill="white", font=FONT_CLOCK)
    sx = x + big_w + 3
    if ampm:
        draw.text((sx, 18), ampm, fill="white", font=FONT_SM)
    draw.text((sx, 32), secs, fill="white", font=FONT_SM)

    # Rotating bottom line
    lines = bottom_lines(status, online)
    line = lines[int(time.time() // ROTATE_SECONDS) % len(lines)]
    draw.line((0, 50, W - 1, 50), fill="white")
    if line.startswith("@streak"):
        rest = line[len("@streak "):]
        total = 11 + text_w(draw, rest, FONT_SM)
        lx = (W - total) // 2 + shift
        draw_flame(draw, lx, 53)
        draw.text((lx + 11, 52), rest, fill="white", font=FONT_SM)
    else:
        draw_centered(draw, 52, line, FONT_SM, dx=shift)


def draw_focus_screen(draw, now, focus, remaining, online):
    # Header: inverted FOCUS badge + wall clock
    badge_w = text_w(draw, "FOCUS", FONT_SM) + 5
    draw.rectangle((0, 0, badge_w, 11), fill="white")
    draw.text((3, 0), "FOCUS", fill="black", font=FONT_SM)
    hhmm, ampm = fmt_clock(now)
    clock = f"{hhmm}{(' ' + ampm) if ampm else ''}"
    clock_w = text_w(draw, clock, FONT_SM)
    draw.text((W - clock_w, 0), clock, fill="white", font=FONT_SM)
    label = (focus.get("label") or "").strip()
    if label:
        max_w = W - badge_w - clock_w - 8
        while label and text_w(draw, label, FONT_SM) > max_w:
            label = label[:-1]
        draw.text((badge_w + 4, 0), label, fill="white", font=FONT_SM)

    # Big countdown
    text = fmt_duration(remaining)
    font = FONT_TIMER if len(text) <= 5 else FONT_TIMER_LONG
    y = 12 if font is FONT_TIMER else 17
    draw_centered(draw, y, text, font)

    # Progress bar
    total = max(1, focus.get("total_seconds", 1))
    done = min(1.0, max(0.0, 1 - remaining / total))
    draw.rectangle((0, 54, W - 1, 63), outline="white")
    fill_w = int((W - 5) * done)
    if fill_w > 0:
        draw.rectangle((2, 56, 2 + fill_w, 61), fill="white")
    if not online:
        # little hollow dot = API unreachable (timer keeps counting locally)
        draw.ellipse((W - 8, 14, W - 3, 19), outline="white")


def draw_goal_bar(draw, y, done, goal):
    """Thin bar showing progress towards the daily goal."""
    if not goal:
        return
    draw.rectangle((0, y, W - 1, y + 5), outline="white")
    filled = int((W - 4) * min(1.0, done / goal))
    if filled > 0:
        draw.rectangle((2, y + 2, 1 + filled, y + 3), fill="white")


def draw_done_screen(draw, session, streak):
    # Check mark in a circle
    draw.ellipse((2, 2, 26, 26), outline="white", width=2)
    draw.line((8, 14, 12, 20, 21, 8), fill="white", width=3)
    draw.text((32, 1), "Session", fill="white", font=FONT_MD)
    draw.text((32, 14), "complete!", fill="white", font=FONT_MD)

    minutes = session.get("planned_minutes", 0)
    done = streak.get("today_minutes", 0)
    goal = streak.get("goal_minutes", 0)
    draw_centered(draw, 30, f"+{minutes}m today {done}/{goal}m" if goal else f"+{minutes} min focused", FONT_SM)
    draw_goal_bar(draw, 43, done, goal)

    if streak.get("today_done"):
        days = streak.get("current", 0)
        rest = f"Streak {days} day{'' if days == 1 else 's'}"
    else:
        rest = f"{streak.get('remaining_minutes', 0)} min to goal"
    total = 11 + text_w(draw, rest, FONT_SM)
    lx = (W - total) // 2
    draw_flame(draw, lx, 52)
    draw.text((lx + 11, 51), rest, fill="white", font=FONT_SM)


def draw_stopped_screen(draw, session):
    draw_centered(draw, 10, "Focus stopped", FONT_MD)
    focused = session.get("focused_seconds", 0) // 60
    draw_centered(draw, 30, f"{focused} min focused", FONT_SM)
    draw_centered(draw, 46, "Take a break :)", FONT_SM)


def draw_frame(draw, now, status, online, elapsed_since_fetch):
    """Pick and draw the right screen for the current state."""
    status = status or {}
    focus = status.get("focus")
    if focus:
        remaining = focus.get("remaining_seconds", 0) - elapsed_since_fetch
        if remaining > 0:
            draw_focus_screen(draw, now, focus, remaining, online)
            return

    last = status.get("last_session")
    server_time = status.get("server_time")
    if last and server_time and last.get("ended_at"):
        age = server_time + elapsed_since_fetch - last["ended_at"]
        if last["status"] == "completed" and age < DONE_SCREEN_SECONDS:
            draw_done_screen(draw, last, status.get("streak") or {})
            return
        if last["status"] == "cancelled" and age < STOPPED_SCREEN_SECONDS:
            draw_stopped_screen(draw, last)
            return

    draw_clock_screen(draw, now, status, online)


# --------------------------------------------------------------------------
# Main loop
# --------------------------------------------------------------------------
def is_night(hour):
    start, end = config.NIGHT_START_HOUR, config.NIGHT_END_HOUR
    if start == end:
        return False
    return start <= hour or hour < end if start > end else start <= hour < end


def render_loop(device):
    from luma.core.render import canvas

    contrast = None
    while True:
        now = datetime.now()
        with state_lock:
            status = state["status"]
            online = state["online"]
            fetched = state["fetched_mono"]
        elapsed = time.monotonic() - fetched if fetched else 0

        focus_running = bool(status and status.get("focus"))
        # Brightness comes from the app (stored on the Pi); fall back to the env value.
        settings = (status or {}).get("settings") or {}
        level = int(settings.get("oled_brightness", config.OLED_CONTRAST))
        dim_at_night = settings.get("oled_night_dim", config.NIGHT_DIM)
        want = min(20, level) if dim_at_night and is_night(now.hour) and not focus_running else level
        if want != contrast:
            device.contrast(want)
            contrast = want

        with canvas(device) as draw:
            draw_frame(draw, now, status, online, elapsed)
        time.sleep(FRAME_INTERVAL)


def make_device():
    from luma.core.interface.serial import i2c
    from luma.oled.device import sh1106, ssd1306

    serial = i2c(port=config.I2C_PORT, address=config.I2C_ADDR)
    driver = sh1106 if config.OLED_DRIVER == "sh1106" else ssd1306
    return driver(serial, width=W, height=H, rotate=config.OLED_ROTATE)


def show_message(device, lines):
    from luma.core.render import canvas

    with canvas(device) as draw:
        for i, line in enumerate(lines):
            draw_centered(draw, 8 + i * 16, line, FONT_MD)


def preview(out_dir):
    """Render sample screens to PNG files (no hardware needed)."""
    from pathlib import Path

    from PIL import Image, ImageDraw

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    now = datetime(2026, 9, 22, 16, 45, 32)
    base = {
        "server_time": 1000,
        "weather": {"temperature": 29, "text": "Partly cloudy", "icon": "partly", "high": 32,
                    "low": 25, "humidity": 70, "wind_kmh": 9},
        "streak": {"current": 6, "today_minutes": 45, "goal_minutes": 60,
                   "remaining_minutes": 15, "today_done": False},
        "today": {"minutes": 45},
        "settings": {"oled_brightness": 255, "oled_night_dim": True},
    }
    focus = {"label": "DSA practice", "remaining_seconds": 1499, "total_seconds": 1800,
             "planned_minutes": 30}
    done = {"status": "completed", "ended_at": 995, "planned_minutes": 30, "focused_seconds": 1800}
    stopped = {"status": "cancelled", "ended_at": 998, "planned_minutes": 30, "focused_seconds": 780}
    cases = {
        "clock": (base, True),
        "clock_offline": ({}, False),
        "focus": ({**base, "focus": focus}, True),
        "focus_long": ({**base, "focus": {**focus, "label": "", "remaining_seconds": 4000,
                                          "total_seconds": 5400}}, True),
        "done": ({**base, "last_session": done}, True),
        "stopped": ({**base, "last_session": stopped}, True),
    }
    icons = ["clear", "partly", "cloud", "rain", "snow", "storm", "fog", "night", "night_partly"]
    for name, (status, online) in cases.items():
        img = Image.new("1", (W, H))
        draw_frame(ImageDraw.Draw(img), now, status, online, 0)
        img.convert("L").resize((W * 4, H * 4), Image.NEAREST).save(out / f"{name}.png")
    img = Image.new("1", (W, H))
    d = ImageDraw.Draw(img)
    for i, icon in enumerate(icons):
        draw_weather_icon(d, 2 + (i % 6) * 20, 4 + (i // 6) * 20, icon)
    img.convert("L").resize((W * 4, H * 4), Image.NEAREST).save(out / "icons.png")
    print(f"Wrote previews to {out.resolve()}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", metavar="DIR", help="render sample screens to PNGs and exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

    if args.preview:
        preview(args.preview)
        return

    device = make_device()
    show_message(device, ["FocusPi", "Starting..."])
    threading.Thread(target=poll_thread, daemon=True, name="poll").start()
    try:
        render_loop(device)
    except KeyboardInterrupt:
        show_message(device, ["Bye!"])


if __name__ == "__main__":
    main()
