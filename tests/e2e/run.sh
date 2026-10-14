#!/usr/bin/env bash
# End-to-End-Test der echten App. Voraussetzungen (Linux):
#   sudo apt install webkit2gtk-driver xvfb
#   cargo install tauri-driver --locked
#   npx tauri build --debug --no-bundle   (im Projektordner)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
export E2E_WORK="$WORK" XDG_DATA_HOME="$WORK/xdg"
mkdir -p "$XDG_DATA_HOME"
cd "$HERE"
[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null
if [ -z "${DISPLAY:-}" ]; then
  Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 &
  XVFB=$!
  export DISPLAY=:99
  sleep 1
fi
tauri-driver --port 4444 >"$WORK/driver.log" 2>&1 &
DRIVER=$!
trap 'kill $DRIVER ${XVFB:-} 2>/dev/null || true' EXIT
sleep 2
node e2e.mjs
echo "Screenshots: $WORK/shots"
