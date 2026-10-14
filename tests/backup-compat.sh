#!/usr/bin/env bash
# Prüft, dass Backups zwischen Desktop-App (Rust) und iPad-/Browser-Version (TypeScript)
# in beide Richtungen funktionieren.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
W="$(mktemp -d)"
trap 'rm -rf "$W"' EXIT
cd "$ROOT"
echo "1. Desktop (Rust) erstellt ein Backup"
RUST_BACKUP="$(cargo run -q -p studium-core --example backup_compat -- create "$W" tests/e2e/fixtures/folien.pdf)"
echo "   $RUST_BACKUP"
echo "2. Browser-Version prüft, stellt wieder her, arbeitet weiter und schreibt ein Backup"
RUST_BACKUP="$RUST_BACKUP" TS_BACKUP_OUT="$W/browser.studiumbackup" npx vitest run src/core/compat.test.ts
echo "3. Desktop prüft und stellt das Backup der Browser-Version wieder her"
cargo run -q -p studium-core --example backup_compat -- verify "$W/browser.studiumbackup"
OUT="$(cargo run -q -p studium-core --example backup_compat -- restore "$W/browser.studiumbackup" "$W/wiederhergestellt")"
echo "   $OUT"
[ "$OUT" = "hits=1 docs=1 file_ok=true" ] || { echo "FEHLER: unerwartetes Ergebnis"; exit 1; }
echo "Backups sind in beide Richtungen kompatibel."
