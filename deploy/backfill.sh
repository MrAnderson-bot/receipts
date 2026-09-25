#!/usr/bin/env bash
# The backfill loop on the engine-room VM: fills history into data/receipts.db one financial year
# at a time, newest first, until every year in UNITS is done, then exits. Runs as the receipts
# user under receipts-backfill.service (see vm-install-backfill.sh). Plan: docs/backfill.md.
#
# Each pass runs `npm run backfill -- <unit> --minutes N`, which is resumable: a unit that stops
# at its time budget carries on from its cursor on the next pass. Between passes the loop waits
# while the nightly publish is running or about to start, so the two never contend for the
# database or for node_modules (publish.sh runs `npm ci`).
#
# Settings (environment, all optional):
#   BACKFILL_UNITS    space-separated unit ids; default: contracts for every financial year since 2007-08
#   BACKFILL_MINUTES  time budget per pass (default 10)
#   BACKFILL_PAUSE    seconds between passes (default 20): the API is asked politely, not hammered
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/receipts}"
cd "$APP_DIR"
MINUTES="${BACKFILL_MINUTES:-10}"
PAUSE="${BACKFILL_PAUSE:-20}"

log() { echo "[$(date -u +%FT%TZ)] $*"; }

# Newest financial year first. AusTender's record starts in July 2007.
default_units() {
  local y
  for y in $(seq 2025 -1 2007); do
    printf 'contracts:FY%d-%02d ' "$y" "$(( (y + 1) % 100 ))"
  done
}
UNITS="${BACKFILL_UNITS:-$(default_units)}"

# The publish runs at 04:30 Canberra time and takes about 15 minutes. Don't start a pass while it
# is active, or in the half hour around its start, so a pass never overlaps `npm ci` or the build.
publish_window() {
  local hm
  hm=$(TZ=Australia/Sydney date +%H%M)
  [ "$hm" -ge 0420 ] && [ "$hm" -le 0500 ]
}
wait_for_publish() {
  while systemctl is-active --quiet receipts-publish.service || publish_window; do
    log "publish running or due; waiting"
    sleep 120
  done
}

# Status of a unit from the progress table: done, running, failed, or empty when never started.
status_of() {
  node -e "
    const { DatabaseSync } = require('node:sqlite');
    try {
      const db = new DatabaseSync('data/receipts.db', { readOnly: true });
      const r = db.prepare('select status from backfill_progress where unit = ?').get(process.argv[1]);
      console.log(r ? r.status : '');
    } catch { console.log(''); }
  " "$1" 2>/dev/null
}

log "backfill loop: units: $UNITS"
for unit in $UNITS; do
  while true; do
    s=$(status_of "$unit")
    if [ "$s" = "done" ]; then log "$unit: done"; break; fi
    wait_for_publish
    log "$unit: pass (${MINUTES} min budget)"
    if ! npm run --silent backfill -- "$unit" --minutes "$MINUTES"; then
      # A failed pass (network, API) is retried after a longer wait; the cursor is kept.
      log "$unit: pass failed; retrying in 10 minutes"
      sleep 600
      continue
    fi
    sleep "$PAUSE"
  done
done
log "backfill loop: every unit done"
