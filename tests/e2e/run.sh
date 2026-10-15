#!/usr/bin/env bash
# End-to-End-Test der echten App. Voraussetzungen (Linux):
#   sudo apt install webkit2gtk-driver xvfb
#   cargo install tauri-driver --locked
#   npx tauri build --debug --no-bundle   (im Projektordner)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
cd "$HERE"
[ -d node_modules ] || npm install --no-audit --no-fund >/dev/null
if [ -z "${DISPLAY:-}" ]; then
  Xvfb :99 -screen 0 1440x900x24 >/dev/null 2>&1 &
  XVFB=$!
  export DISPLAY=:99
  sleep 1
fi
DRIVER=""
trap 'kill $DRIVER ${XVFB:-} 2>/dev/null || true' EXIT
STATUS=0
# Jede Testdatei bekommt einen eigenen, frischen Datenordner. Der Treiber wird
# danach gestartet, damit die App den Datenordner (XDG_DATA_HOME) erbt.
for t in ${E2E_TESTS:-e2e.mjs e2e-phase3.mjs e2e-ki.mjs}; do
  echo "== $t"
  export E2E_WORK="$WORK/${t%.mjs}" XDG_DATA_HOME="$WORK/${t%.mjs}/xdg"
  mkdir -p "$XDG_DATA_HOME"
  tauri-driver --port 4444 >"$E2E_WORK/driver.log" 2>&1 &
  DRIVER=$!
  sleep 2
  node "$t" || STATUS=1
  kill $DRIVER 2>/dev/null || true
  wait $DRIVER 2>/dev/null || true
done
echo "Screenshots: $WORK/*/shots*"
exit $STATUS
