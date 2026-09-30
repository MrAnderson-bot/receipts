#!/bin/sh
# Installs or updates the publish timer and service on the engine-room VM. Run as root on the VM,
# from the dev machine in one short command:
#
#   gcloud compute ssh receipts-engine --zone australia-southeast1-b --tunnel-through-iap --command "sudo bash /opt/receipts/deploy/vm-install-publish.sh"
#
# Pulls the latest main as the receipts user, installs both units, enables the timer so it survives
# a reboot, and starts one publish straight away (in the background) so the new code is live within
# about fifteen minutes rather than at the next scheduled run.
set -eu
APP_DIR=/opt/receipts
sudo -u receipts git -C "$APP_DIR" pull --ff-only
cp "$APP_DIR/deploy/receipts-publish.service" "$APP_DIR/deploy/receipts-publish.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable receipts-publish.timer >/dev/null 2>&1
systemctl restart receipts-publish.timer
systemctl start --no-block receipts-publish.service
echo "receipts-publish.timer: $(systemctl is-active receipts-publish.timer); a publish is starting now"
systemctl list-timers receipts-publish.timer --no-pager
