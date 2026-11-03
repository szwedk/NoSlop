#!/bin/bash
# Installs build/NoSlop-iOS.app on the first connected iPhone via devicectl (Xcode 15+).
# Pass a device name/UDID as $1 to pick a specific one. Run scripts/build-ios.sh first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${APP:-$ROOT/build/NoSlop-iOS.app}"
[ -d "$APP" ] || { echo "missing $APP — run scripts/build-ios.sh first" >&2; exit 1; }

echo "==> connected devices"
LIST="$(mktemp -t noslop-devices).json"
xcrun devicectl list devices --json-output "$LIST" >/dev/null
xcrun devicectl list devices || true

DEVICE="${1:-}"
if [ -z "$DEVICE" ]; then
  # First connected/paired iPhone (deviceType iPhone, not an iPad/Watch).
  DEVICE="$(/usr/bin/python3 - "$LIST" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for d in data.get("result", {}).get("devices", []):
    props = d.get("hardwareProperties", {})
    conn = d.get("connectionProperties", {})
    if props.get("deviceType") == "iPhone" and conn.get("pairingState") == "paired":
        print(d.get("identifier")); break
PY
)"
fi
[ -n "$DEVICE" ] || { echo "no paired iPhone found — plug it in, unlock it and trust this Mac" >&2; exit 1; }

echo "==> installing on $DEVICE"
xcrun devicectl device install app --device "$DEVICE" "$APP"
echo ""
echo "Installed. Now enable the extension on the iPhone:"
echo "  Settings ▸ Apps ▸ Safari ▸ Extensions ▸ NoSlop ▸ Allow Extension ▸ All Websites: Allow"
echo "  (and ▸ Private Browsing if you use it). Then open instagram.com / x.com / m.youtube.com in Safari."
