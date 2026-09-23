# FocusPi

**A Raspberry Pi desk clock and focus timer for deep work.**

FocusPi shows the time, date and weather on a small OLED screen. When you start a focus
session from your phone:

- your **Android phone switches to Do Not Disturb, calls only**. Calls still ring; every
  other notification still arrives, but silently (no sound, vibration or pop-up).
- the countdown runs **on the phone** (in the app and as a notification) **and on the OLED**.
- the Pi records the session in **SQLite** and tracks your **daily learning streak**.

You pick what you are learning from your own **topic list**, and away from home the phone
**runs sessions offline** and uploads them the next time it reaches the Pi, so the streak
keeps counting while you travel.

<p align="center">
  <img src="docs/images/clock-running.jpg" alt="FocusPi clock on the OLED" width="45%">
  <img src="docs/images/pi-wiring.jpg" alt="Raspberry Pi wired to the OLED" width="45%">
</p>

## The app

<p align="center">
  <img src="docs/images/app-focus.png" alt="Focus tab" width="30%">
  <img src="docs/images/app-progress.png" alt="Progress tab" width="30%">
  <img src="docs/images/app-settings.png" alt="Settings tab" width="30%">
</p>

**Focus** starts a session for a topic from your list, and shows how far you are through
today's goal. **Progress** has your streak, a GitHub-style heatmap of every focus day
(tap a square for that day's minutes), minutes per topic, and recent sessions. **Settings** holds your topic list, the daily goal, OLED brightness, who may call
you during focus, and Fresh start.

## What the OLED shows

![OLED screens](docs/oled-screens.png)

## Hardware

- Raspberry Pi (any model with Wi-Fi and the 40-pin header, e.g. Zero 2 W, 3, 4 or 5)
- 128x64 I2C OLED module (SH1106 1.3" or SSD1306 0.96")
- 4 female-to-female jumper wires
- An Android phone (see [Limitations](#limitations) for iOS)

## How it works

```
 ┌──────────── Android phone ────────────┐          ┌──────────── Raspberry Pi ────────────┐
 │ React Native app (Expo)               │  Wi-Fi   │ focuspi-api  (Flask + waitress)      │
 │  • Focus / Progress / Settings tabs   │ ───────► │  • /api/focus/start|stop, /status    │
 │  • FocusDnd native module (Kotlin)    │  REST    │  • SQLite: data/focus.db             │
 │     – DND "calls only" on / restore   │ ◄─────── │  • streak + stats, weather cache     │
 │     – AlarmManager ends DND on time   │          │                                      │
 │     – countdown notification          │          │ focuspi-oled  (luma.oled)            │
 └───────────────────────────────────────┘          │  • polls the API, draws the screens  │
                                                    └──────────────────┬───────────────────┘
                                                                       │ I2C
                                                                  128x64 OLED
```

The **Pi is the source of truth**: it starts, times and records sessions and
finishes them on time even if the phone is off. The phone mirrors the Pi and
switches DND on and off. Android turns DND off at the end time by itself, even
if the app was killed or the phone rebooted.

## Folder layout

| Path | What it is |
|------|------------|
| `pi/` | Python code for the Pi: API server, OLED display, deploy script, tests |
| `pi/deploy.sh` | **Run this on the Pi** to install and start everything |
| `app/` | React Native (Expo SDK 54) Android app |
| `app/modules/focus-dnd/` | Local native module (Kotlin) that controls Do Not Disturb |
| `docs/PINOUT.md` | **OLED wiring** and what each screen shows |

---

## 1. Wire the OLED

Full details and a header diagram are in [docs/PINOUT.md](docs/PINOUT.md).

| OLED | Pi pin |
|------|--------|
| VCC  | Pin 1 (3.3V) |
| GND  | Pin 9 (GND) |
| SCL  | Pin 5 (GPIO3) |
| SDA  | Pin 3 (GPIO2) |

## 2. Deploy on the Raspberry Pi

On the Pi, clone the repo into a path **without spaces**:

```bash
git clone https://github.com/i-m-anurag/FocusPi.git ~/FocusPi
```

Then run the deploy script:

```bash
cd ~/FocusPi/pi && bash deploy.sh
```

The script:

1. installs system packages (Python, i2c-tools, fonts, SQLite),
2. enables I2C,
3. creates `focuspi.env` and asks for your **city** (weather), the **OLED driver**, and
   whether to generate an **API key**,
4. checks the timezone (streaks are counted per local day, e.g. `Asia/Kolkata`),
5. creates a Python venv and installs the requirements,
6. scans I2C so you can check the OLED is detected,
7. installs and starts two systemd services: `focuspi-api` and `focuspi-oled`,
8. prints the **Server URL** and **API key** to enter in the app.

Other commands:

```bash
bash deploy.sh status      # service status + health check
bash deploy.sh restart     # after editing focuspi.env
bash deploy.sh logs        # follow the logs
bash deploy.sh --no-oled   # API only (no screen attached)
bash deploy.sh uninstall   # remove services, keep data/
```

To update later, run `git pull`, then `bash deploy.sh` again. Your data and config are kept.

> If I2C was enabled for the first time, reboot once (`sudo reboot`).

## 3. Build and install the Android app

DND control needs native code, so the app runs as a **development build or APK, not in
Expo Go**.

**Option A: build the APK locally (fastest, no cloud queue)**

One-time setup on macOS (about 5 GB; no Android Studio needed):

```bash
brew install openjdk@17 && brew install --cask android-commandlinetools
```

```bash
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools && yes | sdkmanager --licenses && sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006"
```

Then build (the first build takes 10–20 minutes, later ones a few minutes):

```bash
cd app && npm run build:apk
```

The APK is written to `app/dist/FocusPi-<version>.apk`. Copy it to your phone and open it,
or connect the phone with USB debugging on and use `bash scripts/build-apk.sh --install`.
The script finds JDK 17 and the SDK by itself (or set `JAVA_HOME` / `ANDROID_HOME`).
This APK is signed with a debug key: fine for your own phone, not for the Play Store.

**Option B: APK via EAS (builds in the cloud)**

```bash
cd app && npm install && npx eas build -p android --profile preview
```

Install the APK from the link EAS gives you. On the free plan builds can wait in a queue.

### First launch

1. **Settings tab**: enter the Server URL (e.g. `http://192.168.1.50:5050`) and the API key
   from `deploy.sh`, then tap **Test** and **Save**.
2. **Allow Do Not Disturb access**: tap *Allow access* on the banner and enable **FocusPi**
   in the list. Without this the timer still works, but notifications aren't silenced.
3. **Allow notifications** (Android 13+ asks automatically) for the countdown notification.
4. **Exact alarms** (Settings tab, if shown): lets DND end exactly on time instead of a few
   minutes late.

Pick who can still call you: **Anyone / Contacts / Starred**, plus *repeat callers* and
*alarms*.

## How the streak works

- Every day has a **goal** (1 hour by default). Reach it and the day counts towards your streak.
- Minutes **add up across the day**: 2x30 min or 4x15 min both reach the hour.
- Completed sessions count in full. A session **stopped early** still counts its minutes if
  it lasted at least `FOCUS_PARTIAL_CREDIT_MINUTES` (default 10).
- The current streak stays alive for the whole of today. It only resets if you miss a full day.
- A session belongs to the day it **started** on (Pi local time).
- Change the goal any time under **Settings -> Daily goal** in the app. The streak is worked
  out from your history, so changing the goal re-scores past days too.

## Learning topics

Your topic list lives on the Pi. Add topics in **Settings -> What I'm learning** (or straight
from the dropdown on the Focus tab), then pick one when you start a session. The Progress tab
shows your minutes per topic. Renaming a topic updates past sessions; removing one keeps the
history but takes it out of the dropdown.

## Fresh start

**Settings -> Fresh start** deletes every session from the Pi and everything stored on the
phone, so your streak, history and totals go back to zero. Your daily goal, brightness,
server URL and API key are kept, and you choose whether to delete your topic list too. It
needs the Pi to be reachable, and it cannot be undone.

## Away from the Pi

If the Pi cannot be reached, the app says **On phone** and runs the session itself: Do Not
Disturb, the countdown and the notification all work as usual, and the session is saved on the
phone. The next time the app reaches the Pi it uploads everything automatically (a chip shows
how many sessions are waiting; tapping it syncs immediately). Each session carries an id, so a
retried sync never counts a session twice.

The OLED can only show sessions the Pi knows about, so a session that ran away from home
appears in your history and streak after it syncs, not on the screen while it runs. Adding or
renaming topics and changing settings also need the Pi.

## Configuration (`pi/focuspi.env`)

| Variable | Default | Meaning |
|----------|---------|---------|
| `FOCUS_PORT` | `5050` | API port |
| `FOCUS_API_KEY` | *(generated)* | Shared secret, sent by the app as `X-API-Key`. Empty disables it |
| `FOCUS_CITY` | `New Delhi` | City for weather (geocoded by Open-Meteo) |
| `FOCUS_LAT` / `FOCUS_LON` | | Exact coordinates (override the city) |
| `FOCUS_DEFAULT_MINUTES` | `30` | Default session length |
| `FOCUS_STREAK_MIN_MINUTES` | `60` | Starting daily goal; change it later in the app |
| `FOCUS_PARTIAL_CREDIT_MINUTES` | `10` | Minimum length for a stopped session to count |
| `FOCUS_OLED_DRIVER` | `sh1106` | `sh1106` (1.3") or `ssd1306` (0.96") |
| `FOCUS_I2C_ADDR` | `0x3C` | OLED I2C address |
| `FOCUS_OLED_ROTATE` | `0` | `2` = upside down |
| `FOCUS_24H` | `1` | `0` for a 12-hour clock |
| `FOCUS_OLED_CONTRAST` | `255` | Starting brightness (1-255); the app has a slider |
| `FOCUS_NIGHT_DIM` | `1` | Dim at night (the app can switch this on and off) |
| `FOCUS_NIGHT_START_HOUR` / `_END_HOUR` | `23` / `6` | Hours the night dimming applies |

Weather comes from [Open-Meteo](https://open-meteo.com), which is free and needs no API key.
It refreshes every 15 minutes.

## API reference

All endpoints return JSON. When `FOCUS_API_KEY` is set, send `X-API-Key: <key>` (except `/api/health`).

| Method | Path | Body / query | Returns |
|--------|------|--------------|---------|
| GET  | `/api/health` | | `{ok, server_time}` |
| GET  | `/api/status` | | `focus` (active session or null), `last_session`, `streak`, `today`, `topics`, `settings`, `weather` |
| POST | `/api/focus/start` | `{"minutes": 30, "topic_id": 2}` | `201 {focus}` · `409` if one is already running |
| POST | `/api/focus/stop` | | `{stopped, streak}` |
| POST | `/api/focus/sync` | `{"sessions": [...]}` | Upload offline sessions: `{imported, duplicates, rejected}` |
| GET  | `/api/focus/history` | `?limit=50` | `{sessions: [...]}` |
| GET  | `/api/stats` | `?days=7` | `{daily: [...], streak, totals, topics}` |
| GET  | `/api/topics` | | `{topics: [...]}` |
| POST | `/api/topics` | `{"name": "DSA"}` | `201 {id, topics}` |
| PATCH | `/api/topics/<id>` | `{"name": "...", "archived": true}` | `{topics}` |
| DELETE | `/api/topics/<id>` | | `{topics}` |
| GET / PUT | `/api/settings` | `{"oled_brightness": 120, "daily_goal_minutes": 60}` | `{settings}` |
| POST | `/api/data/reset` | `{"include_topics": false}` | Fresh start: `{deleted_sessions, deleted_topics, streak}` |
| GET  | `/api/weather` | | `{weather}` |

Quick test from any computer on your Wi-Fi:

```bash
curl -H "X-API-Key: YOUR_KEY" http://raspberrypi.local:5050/api/status
```

## Development

Pi code on a laptop (no OLED needed):

```bash
cd pi && python3 -m venv venv && venv/bin/pip install -r requirements.txt pytest
```

```bash
cd pi && venv/bin/python -m pytest tests -q
```

```bash
cd pi && FOCUS_CITY="New Delhi" venv/bin/python -m focuspi.server
```

```bash
cd pi && venv/bin/python -m focuspi.oled --preview ./preview
```

The last command renders every OLED screen to PNG files.

## Limitations

- **iOS:** Apple doesn't let apps switch Focus / DND on or off. On an iPhone the app still
  runs the timer, OLED and streak, but you'd set Focus yourself (or with a Shortcuts automation).
- **Android 15+:** DND started by an app appears as that app's own **mode** ("FocusPi") in
  Settings → Modes. It works the same way.
- Some phones (e.g. Samsung, Xiaomi) have extra battery savers. If DND ever ends late, set the
  app's battery usage to **Unrestricted**.
- The phone and Pi talk over your local Wi-Fi. The API uses plain HTTP, so keep it on your
  home network and use the API key.

## Contributing

Issues and pull requests are welcome. Before opening a PR:

1. Run the Pi tests: `cd pi && venv/bin/python -m pytest tests -q`
2. If you changed the OLED screens, check them with `venv/bin/python -m focuspi.oled --preview ./preview`
3. Keep the app building with `cd app && npx expo export -p android`

Ideas that would fit well: a physical start button on a GPIO pin, a web dashboard served by
the Pi, Pomodoro breaks, and more OLED layouts.

## License

[MIT](LICENSE)
