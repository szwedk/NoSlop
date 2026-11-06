#!/bin/bash
# Builds the signed iOS device app (Debug by default), exports build/NoSlop-iOS.app and build/NoSlop-iOS.ipa.
# Signing (verified): automatic, App Store Connect API key for -allowProvisioningUpdates.
#
# The App Groups capability (group.com.szwedk.noslop) needs the developer portal to issue a new profile.
# If the portal refuses (e.g. "PLA Update available: ... must agree to the latest Program License Agreement"),
# the account holder has to accept the agreement at https://developer.apple.com/account and re-run.
# Escape hatch for a sideload in the meantime: NOSLOP_NO_APP_GROUP=1 builds WITHOUT the App Group entitlement
# (app <-> extension settings sync is then off; both fall back to their own UserDefaults).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${CONFIG:-Debug}"
DD="${DERIVED_DATA:-${TMPDIR:-/tmp}/noslop-dd-ios}"
KEY_PATH="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_83Z56LMU9Y.p8}"
KEY_ID="${ASC_KEY_ID:-83Z56LMU9Y}"
ISSUER_ID="${ASC_ISSUER_ID:-d14468ee-5a66-4a45-9936-74e3e096cae5}"
cd "$ROOT"

echo "==> xcodegen generate"
xcodegen generate >/dev/null

EXTRA=()
if [ "${NOSLOP_NO_APP_GROUP:-0}" = "1" ]; then
  echo "==> NOSLOP_NO_APP_GROUP=1: building without the App Group entitlement (no app<->extension sync)"
  EXTRA+=("CODE_SIGN_ENTITLEMENTS=App/iOS/NoSlop-NoAppGroup.entitlements")
fi

echo "==> xcodebuild NoSlop-iOS ($CONFIG, generic/platform=iOS)"
LOG="$(mktemp -t noslop-ios-build)"
set +e
xcodebuild -project NoSlop.xcodeproj -scheme NoSlop-iOS -configuration "$CONFIG" \
  -derivedDataPath "$DD" -destination generic/platform=iOS \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID" \
  ${EXTRA[@]+"${EXTRA[@]}"} build > "$LOG" 2>&1
STATUS=$?
set -e
grep -E "error:|warning: .*\.swift|BUILD " "$LOG" || true
if [ $STATUS -ne 0 ]; then
  if grep -q "PLA Update available" "$LOG"; then
    echo "" >&2
    echo "Provisioning blocked: Apple requires the account holder to accept the latest Program License Agreement" >&2
    echo "at https://developer.apple.com/account before a profile with App Groups can be issued." >&2
    echo "Sideload without sync in the meantime: NOSLOP_NO_APP_GROUP=1 scripts/build-ios.sh" >&2
  fi
  echo "full log: $LOG" >&2
  exit $STATUS
fi

APP="$DD/Build/Products/$CONFIG-iphoneos/NoSlop-iOS.app"
[ -d "$APP" ] || { echo "build failed: $APP not found" >&2; exit 1; }
mkdir -p build
rm -rf build/NoSlop-iOS.app build/NoSlop-iOS.ipa build/Payload
ditto "$APP" build/NoSlop-iOS.app
mkdir -p build/Payload
ditto build/NoSlop-iOS.app build/Payload/NoSlop-iOS.app
( cd build && zip -qry NoSlop-iOS.ipa Payload )
rm -rf build/Payload
echo "==> build/NoSlop-iOS.app and build/NoSlop-iOS.ipa"
echo "    appex: $(ls build/NoSlop-iOS.app/PlugIns/)"
echo "Install on a connected iPhone with scripts/install-iphone.sh"
