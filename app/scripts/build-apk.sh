#!/bin/bash
# Build an installable Android APK locally (no EAS / cloud queue).
#
#   bash scripts/build-apk.sh            release APK (standalone, recommended)
#   bash scripts/build-apk.sh --install  also install it on a USB-connected phone
#   bash scripts/build-apk.sh --clean    regenerate the android/ folder first
#
# Needs: JDK 17 and the Android SDK (platform 36, build-tools 36.0.0, NDK 27.1).
# See the README section "Build the APK locally" for a one-time setup.
#
# The release APK is signed with the debug key from Expo's template. That is
# fine for installing on your own phone, not for publishing on the Play Store.

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

INSTALL=0
CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    --clean) CLEAN=1 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ---- Locate JDK 17 -------------------------------------------------------------
if [[ -z "${JAVA_HOME:-}" ]]; then
  for candidate in \
    "$(/usr/libexec/java_home -v 17 2>/dev/null || true)" \
    "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" \
    "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" \
    "/usr/lib/jvm/java-17-openjdk-amd64" \
    "/usr/lib/jvm/java-17-openjdk-arm64"; do
    if [[ -n "$candidate" && -x "$candidate/bin/java" ]]; then
      export JAVA_HOME="$candidate"
      break
    fi
  done
fi
[[ -n "${JAVA_HOME:-}" ]] || { echo "JDK 17 not found. Install it (macOS: brew install openjdk@17)."; exit 1; }

# ---- Locate the Android SDK ----------------------------------------------------
if [[ -z "${ANDROID_HOME:-}" ]]; then
  for candidate in \
    "${ANDROID_SDK_ROOT:-}" \
    "$HOME/Library/Android/sdk" \
    "/opt/homebrew/share/android-commandlinetools" \
    "$HOME/Android/Sdk"; do
    if [[ -n "$candidate" && -d "$candidate/platforms" ]]; then
      export ANDROID_HOME="$candidate"
      break
    fi
  done
fi
[[ -n "${ANDROID_HOME:-}" ]] || { echo "Android SDK not found. Set ANDROID_HOME (see README)."; exit 1; }
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

echo "JAVA_HOME    = $JAVA_HOME"
echo "ANDROID_HOME = $ANDROID_HOME"

# ---- Build -----------------------------------------------------------------------
[[ -d node_modules ]] || npm install

if [[ $CLEAN -eq 1 || ! -d android ]]; then
  npx expo prebuild --platform android --clean --no-install
fi
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# Only build for real phones (arm) to roughly halve the build time.
(cd android && ./gradlew assembleRelease \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a \
  --no-daemon)

APK_SRC="android/app/build/outputs/apk/release/app-release.apk"
VERSION="$(node -p "require('./app.json').expo.version")"
mkdir -p dist
APK="dist/FocusPi-$VERSION.apk"
cp "$APK_SRC" "$APK"
echo ""
echo "APK ready: $APP_DIR/$APK ($(du -h "$APK" | cut -f1))"

if [[ $INSTALL -eq 1 ]]; then
  adb install -r "$APK"
  echo "Installed on the connected phone."
else
  echo "Copy it to your phone and open it, or connect via USB and run:"
  echo "  adb install -r $APK"
fi
