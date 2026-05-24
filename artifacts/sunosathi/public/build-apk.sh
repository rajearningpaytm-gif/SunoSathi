#!/usr/bin/env bash
###############################################################################
# SunoSathi VPS — FULL DEPLOY + APK + AAB Builder (one command does everything)
# Run on VPS:
#   curl -s <pike-url>/build-apk.sh -o /tmp/build-apk.sh && bash /tmp/build-apk.sh
###############################################################################
set -e

REPO="$HOME/SunoSathi"
KEYSTORE="$HOME/sunosathi.jks"
KEY_ALIAS="sunosathi"
KEY_PASS="rajan123"
STORE_PASS="rajan123"
SDK_ROOT="$HOME/android-sdk"
WEB_ROOT="/var/www/sunosathi/public"
DOWNLOAD_DIR="$WEB_ROOT/downloads"
PM2_API="sunosathi-api"

VERSION_NAME="${VERSION_NAME:-1.0.0}"
VERSION_CODE="${VERSION_CODE:-1}"

banner() { echo ""; echo "============================================================"; echo "  $1"; echo "============================================================"; }

###############################################################################
banner "STEP 1/10 — Check repo (skipping git reset to preserve patch.py changes)"
[ -d "$REPO" ] || { echo "ERROR: $REPO not found"; exit 1; }
cd "$REPO"
# IMPORTANT: do NOT 'git reset --hard' here. The deploy flow is:
#     patch.py  →  build-apk.sh
# patch.py writes the latest hot-fix files directly onto disk. If we then run
# `git reset --hard origin/main` we wipe those changes out and ship a stale
# APK. We only fetch (so the user can `git diff origin/main` manually) and
# build from whatever is currently on disk — patch.py is the source of truth.
git fetch origin main 2>/dev/null || echo "WARN: git fetch skipped (offline?)"

###############################################################################
banner "STEP 2/10 — Java 21"
if ! java -version 2>&1 | grep -q "21"; then
  echo "Installing Java 21..."
  sudo apt-get update -qq
  sudo apt-get install -y openjdk-21-jdk wget unzip
fi
export JAVA_HOME=$(dirname $(dirname $(readlink -f $(which java))))
java -version

###############################################################################
banner "STEP 3/10 — Android SDK (cmdline-tools + platform 34 + build-tools 34.0.0)"
export ANDROID_SDK_ROOT="$SDK_ROOT"
export ANDROID_HOME="$SDK_ROOT"
if [ ! -d "$SDK_ROOT/cmdline-tools/latest" ]; then
  mkdir -p "$SDK_ROOT/cmdline-tools"
  cd /tmp
  wget -q https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O cmdtools.zip
  unzip -q -o cmdtools.zip
  rm -rf "$SDK_ROOT/cmdline-tools/latest"
  mv cmdline-tools "$SDK_ROOT/cmdline-tools/latest"
fi
export PATH="$SDK_ROOT/cmdline-tools/latest/bin:$SDK_ROOT/platform-tools:$PATH"
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager --install "platform-tools" "platforms;android-34" "build-tools;34.0.0" >/dev/null
echo "Android SDK ready."

###############################################################################
banner "STEP 3.5/10 — Node.js 22 (Capacitor requires >=22)"
NODE_MAJOR=$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
if [ -z "$NODE_MAJOR" ] || [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Current node: $(node -v 2>/dev/null || echo none). Installing Node 22 via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  # reinstall pnpm globally on new node
  sudo npm install -g pnpm@9 || npm install -g pnpm@9
fi
echo "node $(node -v)  |  npm $(npm -v)  |  pnpm $(pnpm -v 2>/dev/null || echo missing)"
if ! command -v pnpm >/dev/null 2>&1; then
  sudo npm install -g pnpm@9
fi

###############################################################################
banner "STEP 4/10 — pnpm install"
cd "$REPO"
pnpm install --no-frozen-lockfile

###############################################################################
banner "STEP 5/10 — Build Vite web app"
cd "$REPO/artifacts/sunosathi"
VITE_API_ORIGIN="https://sunosathi.rajenterprises.info" \
  pnpm run build
echo "Web build OK at: $REPO/artifacts/sunosathi/dist/public"

###############################################################################
banner "STEP 6/10 — Deploy frontend to $WEB_ROOT"
sudo mkdir -p "$WEB_ROOT"
# Preserve downloads/ folder while syncing fresh assets
sudo rsync -a --delete \
  --exclude downloads \
  --exclude .well-known \
  "$REPO/artifacts/sunosathi/dist/public/" "$WEB_ROOT/"
sudo chown -R www-data:www-data "$WEB_ROOT"
echo "Frontend deployed → https://sunosathi.rajenterprises.info"

###############################################################################
banner "STEP 7/10 — Restart API (pm2: $PM2_API)"
pm2 restart "$PM2_API" || echo "WARN: pm2 restart failed — check 'pm2 list'"
pm2 save >/dev/null 2>&1 || true

###############################################################################
banner "STEP 8/10 — Keystore (persistent at $KEYSTORE)"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair \
    -alias "$KEY_ALIAS" -keyalg RSA -keysize 2048 -validity 10000 \
    -keystore "$KEYSTORE" -storepass "$STORE_PASS" -keypass "$KEY_PASS" \
    -dname "CN=SunoSathi,O=RajEnterprises,C=IN" -noprompt
  echo ""
  echo "*** NEW KEYSTORE created at $KEYSTORE ***"
  echo "*** BACKUP THIS FILE FOREVER — agar khoya, app update nahi hoga! ***"
  echo ""
else
  echo "Using existing keystore at $KEYSTORE"
fi

###############################################################################
banner "STEP 9/10 — Capacitor sync + version bump + APK/AAB build"
cd "$REPO/artifacts/sunosathi"
npx cap sync android

cd android/app
sed -i "s/versionCode [0-9]*/versionCode $VERSION_CODE/" build.gradle
sed -i "s/versionName \"[^\"]*\"/versionName \"$VERSION_NAME\"/" build.gradle

# Inject signing config (idempotent)
SIGN_FILE="$REPO/artifacts/sunosathi/android/app/signing.gradle"
cat > "$SIGN_FILE" <<EOF
android {
    signingConfigs {
        release {
            storeFile file("$KEYSTORE")
            storePassword "$STORE_PASS"
            keyAlias "$KEY_ALIAS"
            keyPassword "$KEY_PASS"
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
EOF
APP_GRADLE="$REPO/artifacts/sunosathi/android/app/build.gradle"
grep -q "apply from: 'signing.gradle'" "$APP_GRADLE" || echo "apply from: 'signing.gradle'" >> "$APP_GRADLE"

cd "$REPO/artifacts/sunosathi/android"
chmod +x gradlew
./gradlew clean assembleRelease bundleRelease --no-daemon

APK_SRC="$REPO/artifacts/sunosathi/android/app/build/outputs/apk/release/app-release.apk"
AAB_SRC="$REPO/artifacts/sunosathi/android/app/build/outputs/bundle/release/app-release.aab"
sudo mkdir -p "$DOWNLOAD_DIR"
sudo cp "$APK_SRC" "$DOWNLOAD_DIR/SunoSathi-v${VERSION_NAME}.apk"
sudo cp "$AAB_SRC" "$DOWNLOAD_DIR/SunoSathi-v${VERSION_NAME}.aab"
sudo chown -R www-data:www-data "$DOWNLOAD_DIR"

###############################################################################
banner "STEP 10/10 — SHA-1 + SHA-256 fingerprints"
echo ""
echo "##########################################################################"
echo "#  COPY THESE FINGERPRINTS — Firebase / Play Console me daalo            #"
echo "##########################################################################"
keytool -list -v -keystore "$KEYSTORE" -alias "$KEY_ALIAS" \
  -storepass "$STORE_PASS" 2>/dev/null \
  | grep -E "SHA1:|SHA-1:|SHA256:|SHA-256:" || echo "ERROR: keytool output empty"
echo "##########################################################################"

echo ""
banner "✅  ALL DONE"
echo ""
echo "🌐 Frontend live:      https://sunosathi.rajenterprises.info"
echo "📱 APK (phone test):   https://sunosathi.rajenterprises.info/downloads/SunoSathi-v${VERSION_NAME}.apk"
echo "📦 AAB (Play Store):   https://sunosathi.rajenterprises.info/downloads/SunoSathi-v${VERSION_NAME}.aab"
echo ""
echo "⚠️  KEYSTORE BACKUP:    cp $KEYSTORE ~/sunosathi-keystore-backup.jks"
echo ""
