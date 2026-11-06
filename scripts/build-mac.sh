#!/bin/bash
# Builds the signed macOS app (Debug by default) and copies it to build/NoSlop.app.
# Signing recipe (verified): manual, "Apple Development" identity, no provisioning profile.
# The macOS targets use the team-prefixed App Group (5DDNFER638.group.com.szwedk.noslop), which macOS
# accepts without a profile; a `group.`-prefixed id would require one.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${CONFIG:-Debug}"
DD="${DERIVED_DATA:-${TMPDIR:-/tmp}/noslop-dd-mac}"
cd "$ROOT"

echo "==> xcodegen generate"
xcodegen generate >/dev/null

APP="$DD/Build/Products/$CONFIG/NoSlop-macOS.app"
rm -rf "$APP"   # never ship a stale product from an earlier build

echo "==> xcodebuild NoSlop-macOS ($CONFIG)"
LOG="$(mktemp -t noslop-mac-build)"
set +e
xcodebuild -project NoSlop.xcodeproj -scheme NoSlop-macOS -configuration "$CONFIG" \
  -derivedDataPath "$DD" \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="Apple Development" PROVISIONING_PROFILE_SPECIFIER="" \
  DEVELOPMENT_TEAM=5DDNFER638 \
  build > "$LOG" 2>&1
STATUS=$?
set -e
grep -E "error:|warning: .*\.swift|BUILD " "$LOG" || true
if [ $STATUS -ne 0 ]; then echo "xcodebuild failed (status $STATUS); full log: $LOG" >&2; exit $STATUS; fi

[ -d "$APP" ] || { echo "build failed: $APP not found" >&2; exit 1; }
mkdir -p build
rm -rf build/NoSlop.app
ditto "$APP" build/NoSlop.app
codesign --verify --deep --strict build/NoSlop.app && echo "==> signed OK"
echo "==> build/NoSlop.app"
echo "    appex: $(ls build/NoSlop.app/Contents/PlugIns/)"
echo "Open with: open build/NoSlop.app  — then Safari ▸ Settings ▸ Extensions ▸ NoSlop Extension."
