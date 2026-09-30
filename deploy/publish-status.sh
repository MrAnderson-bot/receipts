#!/bin/sh
# Prints how publishing on the VM is going: the timer and its next runs, whether a publish is
# running now, the last few runs from the database with every step that failed, and the last
# run's journal lines that matter. Run as root on the VM; the owner calls it from the dev machine
# through deploy/publish-status.ps1. Optional first argument: now, to start a publish first.
set -u
APP_DIR=/opt/receipts
case "${1:-}" in
  now) systemctl start --no-block receipts-publish.service; echo "publish started" ;;
esac
echo "timer: $(systemctl is-active receipts-publish.timer)   publish: $(systemctl is-active receipts-publish.service)"
systemctl list-timers receipts-publish.timer --no-pager | sed -n 2p
echo "disk: $(df -h / | awk 'NR==2 {print $3 " used, " $4 " free"}')"
cd "$APP_DIR" && node -e '
  const { DatabaseSync } = require("node:sqlite");
  try {
    const db = new DatabaseSync("data/receipts.db", { readOnly: true });
    const runs = db.prepare("select started_at, finished_at, ok, saved, failed, detail from runs order by id desc limit 4").all();
    const local = (iso) => iso ? new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", hour12: false }) : "not finished";
    console.log("runs (Canberra time):");
    for (const r of runs) {
      console.log("  " + local(r.started_at) + " to " + local(r.finished_at) + ": " + r.saved + " steps done, " + r.failed + " failed");
      let steps = []; try { steps = JSON.parse(r.detail || "[]"); } catch {}
      for (const s of steps.filter((s) => !s.ok)) console.log("    FAILED " + s.source + ": " + String(s.detail).slice(0, 220));
    }
  } catch (e) { console.log("could not read the database: " + e.message); }
' 2>/dev/null
echo "journal (last run, errors and milestones):"
journalctl -u receipts-publish --no-pager -n 400 -o cat | grep -E "^\[20|FAILED|Snapshot:|Read:|rror|failed" | tail -n 25
