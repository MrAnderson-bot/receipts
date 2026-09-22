#!/usr/bin/env bash
# Nightly job on the engine-room VM: pull the latest code, store today's
# snapshot, build the site as plain files, push them to Cloudflare Pages, and
# back the database up to Cloud Storage.
#
# Settings come from /etc/receipts.env (see vm-setup.sh):
#   CLOUDFLARE_API_TOKEN   token with Cloudflare Pages edit rights
#   CLOUDFLARE_ACCOUNT_ID  the Cloudflare account
#   PAGES_PROJECT          Cloudflare Pages project name (default: receipts)
#   BACKUP_BUCKET          gs://bucket for daily copies of receipts.db (optional)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/receipts}"
cd "$APP_DIR"
# Under systemd the settings arrive via EnvironmentFile. When run by hand as
# root, read the file here; as another user it is unreadable, so say so.
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  if [ -r /etc/receipts.env ]; then set -a; . /etc/receipts.env; set +a;
  else echo "CLOUDFLARE_API_TOKEN is not set and /etc/receipts.env is not readable by $(whoami)." >&2; exit 1; fi
fi

log() { echo "[$(date -u +%FT%TZ)] $*"; }

log "Updating code"
git pull --ff-only
npm ci --no-audit --no-fund

log "Snapshot and build"
# The build fetches every source and renders every page; the VM is small, so cap Node's heap.
NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}" npm run snapshot

log "Deploying to Cloudflare Pages"
npx wrangler pages deploy out --project-name "${PAGES_PROJECT:-receipts}" --branch main --commit-dirty=true

if [ -n "${BACKUP_BUCKET:-}" ]; then
  log "Backing up the database"
  # Copy through SQLite so the write-ahead log is folded in and the copy is consistent.
  node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('data/receipts.db', { readOnly: true });
    db.exec(\"VACUUM INTO 'data/receipts-backup.db'\");
  "
  gcloud storage cp data/receipts-backup.db "$BACKUP_BUCKET/receipts-$(date -u +%F).db" --quiet
  rm -f data/receipts-backup.db
fi

log "Done"
