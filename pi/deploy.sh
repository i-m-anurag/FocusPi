#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  FocusPi — Raspberry Pi deploy script
#
#  Run on the Pi from this folder (as your normal user, NOT root):
#    bash deploy.sh              install / update + (re)start services
#    bash deploy.sh --no-oled    same, but API only (no OLED attached)
#    bash deploy.sh restart      restart both services
#    bash deploy.sh status       show service status + health check
#    bash deploy.sh logs         follow logs of both services
#    bash deploy.sh uninstall    stop + remove services (keeps data/)
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$APP_DIR/focuspi.env"
API_SERVICE="focuspi-api"
OLED_SERVICE="focuspi-oled"
RUN_USER="${SUDO_USER:-$USER}"

c_green="\033[1;32m"; c_yellow="\033[1;33m"; c_red="\033[1;31m"; c_off="\033[0m"
step() { echo -e "\n${c_green}==> $*${c_off}"; }
warn() { echo -e "${c_yellow}!! $*${c_off}"; }
die()  { echo -e "${c_red}xx $*${c_off}"; exit 1; }

env_get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
env_set() {
  if grep -qE "^$1=" "$ENV_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    echo "$1=$2" >> "$ENV_FILE"
  fi
}

port() { local p; p="$(env_get FOCUS_PORT)"; echo "${p:-5050}"; }

health_check() {
  local url="http://127.0.0.1:$(port)/api/health"
  for _ in $(seq 1 15); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo -e "${c_green}API is healthy at $url${c_off}"
      return 0
    fi
    sleep 1
  done
  warn "API did not answer at $url — check: bash deploy.sh logs"
  return 1
}

cmd_status() {
  systemctl --no-pager status "$API_SERVICE" | head -5 || true
  systemctl --no-pager status "$OLED_SERVICE" 2>/dev/null | head -5 || true
  health_check || true
}

cmd_restart() {
  sudo systemctl restart "$API_SERVICE"
  if [[ -f "/etc/systemd/system/$OLED_SERVICE.service" ]]; then
    sudo systemctl restart "$OLED_SERVICE"
  fi
  health_check || true
}

cmd_logs() {
  sudo journalctl -u "$API_SERVICE" -u "$OLED_SERVICE" -f -n 50
}

cmd_uninstall() {
  step "Removing services (data in $APP_DIR/data is kept)"
  for svc in "$OLED_SERVICE" "$API_SERVICE"; do
    sudo systemctl disable --now "$svc" 2>/dev/null || true
    sudo rm -f "/etc/systemd/system/$svc.service"
  done
  sudo systemctl daemon-reload
  echo "Done."
}

cmd_install() {
  local with_oled=1
  [[ "${1:-}" == "--no-oled" ]] && with_oled=0

  [[ "$(id -u)" -eq 0 && -z "${SUDO_USER:-}" ]] && die "Run as your normal user (the script uses sudo itself)."

  echo "╔══════════════════════════════════════════╗"
  echo "║   FocusPi — Raspberry Pi deploy      ║"
  echo "╚══════════════════════════════════════════╝"
  echo "App dir : $APP_DIR"
  echo "User    : $RUN_USER"

  # 1. System packages ----------------------------------------------------
  step "[1/7] Installing system packages"
  sudo apt-get update -y
  sudo apt-get install -y \
    python3 python3-pip python3-venv \
    i2c-tools sqlite3 curl \
    fonts-dejavu-core \
    libjpeg-dev zlib1g-dev libfreetype6-dev

  # 2. I2C ------------------------------------------------------------------
  if [[ $with_oled -eq 1 ]]; then
    step "[2/7] Enabling I2C"
    if command -v raspi-config >/dev/null; then
      sudo raspi-config nonint do_i2c 0 || warn "Could not enable I2C automatically — use: sudo raspi-config"
    else
      warn "raspi-config not found — enable I2C manually"
    fi
    sudo usermod -aG i2c,gpio "$RUN_USER" 2>/dev/null || true
  else
    step "[2/7] Skipping I2C (--no-oled)"
  fi

  # 3. Config file ------------------------------------------------------------
  step "[3/7] Configuration ($ENV_FILE)"
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$APP_DIR/focuspi.env.example" "$ENV_FILE"
    if [[ -t 0 ]]; then
      read -rp "City for weather [$(env_get FOCUS_CITY)]: " city
      [[ -n "$city" ]] && env_set FOCUS_CITY "$city"
      read -rp "OLED driver: sh1106 (1.3\") or ssd1306 (0.96\") [$(env_get FOCUS_OLED_DRIVER)]: " drv
      [[ -n "$drv" ]] && env_set FOCUS_OLED_DRIVER "$drv"
      read -rp "Protect the API with a key? (recommended) [Y/n]: " usekey
      if [[ ! "$usekey" =~ ^[Nn] ]]; then
        env_set FOCUS_API_KEY "$(python3 -c 'import secrets; print(secrets.token_urlsafe(16))')"
      fi
    fi
    echo "Created $ENV_FILE (edit it any time, then: bash deploy.sh restart)"
  else
    echo "Keeping existing $ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"

  # Timezone matters: the streak is counted per local calendar day.
  local tz
  tz="$(timedatectl show -p Timezone --value 2>/dev/null || echo unknown)"
  echo "Pi timezone: $tz"
  if [[ -t 0 && ( "$tz" == "Etc/UTC" || "$tz" == "UTC" ) ]]; then
    read -rp "Timezone looks like UTC. Enter yours (e.g. Asia/Kolkata) or leave empty: " newtz
    [[ -n "$newtz" ]] && sudo timedatectl set-timezone "$newtz" && echo "Timezone set to $newtz"
  fi

  # 4. Python venv ---------------------------------------------------------
  step "[4/7] Python virtualenv + dependencies"
  [[ -d "$APP_DIR/venv" ]] || python3 -m venv "$APP_DIR/venv"
  "$APP_DIR/venv/bin/pip" install --upgrade pip -q
  "$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt" -q
  mkdir -p "$APP_DIR/data"

  # 5. OLED conflicts --------------------------------------------------------
  if [[ $with_oled -eq 1 ]]; then
    step "[5/7] Checking the OLED"
    # Only one program can drive the screen at a time.
    local other
    for other in water-tank-oled; do
      if systemctl is-active --quiet "$other" 2>/dev/null; then
        warn "$other.service is running and may drive the same I2C screen."
        if [[ -t 0 ]]; then
          read -rp "Stop and disable it so FocusPi can use the OLED? [Y/n]: " stopwt
          if [[ ! "$stopwt" =~ ^[Nn] ]]; then sudo systemctl disable --now "$other"; fi
        fi
      fi
    done
    local i2c_port
    i2c_port="$(env_get FOCUS_I2C_PORT)"
    echo "I2C scan on bus ${i2c_port:-1} (expect 3c or 3d):"
    sudo i2cdetect -y "${i2c_port:-1}" || warn "i2cdetect failed (reboot may be needed after enabling I2C)"
  else
    step "[5/7] Skipping OLED checks"
  fi

  # 6. systemd services ---------------------------------------------------------
  step "[6/7] Installing systemd services"
  sudo tee "/etc/systemd/system/$API_SERVICE.service" >/dev/null <<EOL
[Unit]
Description=FocusPi API (focus timer, streaks, weather)
After=network-online.target time-sync.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=PYTHONUNBUFFERED=1
ExecStart="$APP_DIR/venv/bin/python" -m focuspi.server
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOL

  if [[ $with_oled -eq 1 ]]; then
    sudo tee "/etc/systemd/system/$OLED_SERVICE.service" >/dev/null <<EOL
[Unit]
Description=FocusPi OLED display
After=$API_SERVICE.service
Wants=$API_SERVICE.service

[Service]
Type=simple
User=$RUN_USER
SupplementaryGroups=i2c
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=PYTHONUNBUFFERED=1
ExecStart="$APP_DIR/venv/bin/python" -m focuspi.oled
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOL
  fi

  sudo systemctl daemon-reload
  sudo systemctl enable "$API_SERVICE" >/dev/null
  sudo systemctl restart "$API_SERVICE"
  if [[ $with_oled -eq 1 ]]; then
    sudo systemctl enable "$OLED_SERVICE" >/dev/null
    sudo systemctl restart "$OLED_SERVICE"
  fi

  # 7. Verify -------------------------------------------------------------------
  step "[7/7] Health check"
  health_check || true

  local ip key
  ip="$(hostname -I | awk '{print $1}')"
  key="$(env_get FOCUS_API_KEY)"
  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  Deployed! Enter these in the app's Settings tab:    ║"
  echo "╚══════════════════════════════════════════════════════╝"
  echo "  Server URL : http://$ip:$(port)"
  echo "  API key    : ${key:-(none)}"
  echo ""
  echo "  bash deploy.sh status | restart | logs | uninstall"
  if [[ $with_oled -eq 1 ]] && ! ls /dev/i2c-* >/dev/null 2>&1; then
    warn "No /dev/i2c-* yet — reboot the Pi once to activate I2C: sudo reboot"
  fi
}

case "${1:-install}" in
  install|--no-oled) cmd_install "${1:-}" ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  uninstall) cmd_uninstall ;;
  *) die "Unknown command: $1 (use: install | --no-oled | restart | status | logs | uninstall)" ;;
esac
