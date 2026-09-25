#!/bin/sh
# Prints how the backfill on the VM is going. Run as root on the VM; the owner calls it from the
# dev machine through deploy/backfill-status.ps1. Optional first argument: stop | start, to pause
# or resume the loop before printing.
set -u
APP_DIR=/opt/receipts
case "${1:-}" in
  stop) systemctl stop receipts-backfill.service ;;
  start) systemctl start receipts-backfill.service ;;
esac
echo "loop: $(systemctl is-active receipts-backfill.service)"
echo "disk: $(df -h / | awk 'NR==2 {print $3 " used, " $4 " free"}')"
echo "database: $(ls -l "$APP_DIR/data/receipts.db" | awk '{printf "%.0f MB", $5 / 1048576}')"
cd "$APP_DIR" && node -e '
  const { DatabaseSync } = require("node:sqlite");
  try {
    const db = new DatabaseSync("data/receipts.db", { readOnly: true });
    const rows = db.prepare("select unit, status, rows_added, calls, substr(coalesce(cursor, \"\"), 1, 10) cursor, substr(coalesce(finished, started, \"\"), 1, 16) at from backfill_progress order by started desc").all();
    console.log("units:");
    for (const r of rows) console.log("  " + r.unit + "  " + r.status + "  " + r.rows_added + " rows  " + r.calls + " calls  cursor " + r.cursor + "  " + r.at);
    console.log("contract releases stored: " + db.prepare("select count(*) n from contract_releases").get().n);
  } catch (e) { console.log("no progress table yet: " + e.message); }
' 2>/dev/null
echo "log:"
journalctl -u receipts-backfill --no-pager -n 6 -o cat
