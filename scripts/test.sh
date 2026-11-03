#!/bin/bash
# Full verification bar (docs/DESIGN.md §10): node tests, generated rules in sync, Chrome build, then the signed
# macOS and iOS builds, each followed by the bundle check (manifest + every referenced content-script file present
# and identical to Extension/Resources). Any step failing fails the script.
#   NOSLOP_SKIP_IOS=1 scripts/test.sh     skips the iOS device build (needs the Apple provisioning portal)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "==> npm test"
# Node 22+ no longer accepts a bare directory (`node --test tests/` fails on Node 26); package.json uses the glob.
npm test
echo "==> rules.js in sync with rules.json"
npm run build:rules -- --check
echo "==> syntax check of every extension script"
find Extension/Resources -name '*.js' -print0 | xargs -0 -n1 node --check
echo "==> Chrome build (dist/chrome)"
npm run build:chrome -- --quiet
echo "==> macOS build"
scripts/build-mac.sh
echo "==> bundle check (macOS)"
node tools/check-bundle.mjs build/NoSlop.app
if [ "${NOSLOP_SKIP_IOS:-0}" = "1" ]; then
  echo "==> iOS build skipped (NOSLOP_SKIP_IOS=1)"
else
  echo "==> iOS build"
  scripts/build-ios.sh
  echo "==> bundle check (iOS)"
  node tools/check-bundle.mjs build/NoSlop-iOS.app
fi
echo "==> all green"
