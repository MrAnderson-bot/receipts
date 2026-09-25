#!/bin/sh
# Installs or updates the backfill loop on the engine-room VM. Run as root on the VM,
# from the dev machine in one short command:
#
#   gcloud compute ssh receipts-engine --zone australia-southeast1-b --tunnel-through-iap --command "sudo bash /opt/receipts/deploy/vm-install-backfill.sh"
#
# Pulls the latest main as the receipts user, installs the service unit, enables it so it
# survives a reboot, and (re)starts it. The loop itself is deploy/backfill.sh.
set -eu
APP_DIR=/opt/receipts
sudo -u receipts git -C "$APP_DIR" pull --ff-only
sudo -u receipts bash -c "cd $APP_DIR && npm ci --no-audit --no-fund"
cp "$APP_DIR/deploy/receipts-backfill.service" /etc/systemd/system/receipts-backfill.service
systemctl daemon-reload
systemctl enable receipts-backfill.service >/dev/null 2>&1
systemctl restart receipts-backfill.service
sleep 3
echo "receipts-backfill: $(systemctl is-active receipts-backfill.service)"
journalctl -u receipts-backfill --no-pager -n 5 -o cat
