#!/usr/bin/env bash
# One-time setup of the engine-room VM (Debian 12). Run as root:
#   sudo bash vm-setup.sh https://github.com/OWNER/REPO.git
#
# Installs Node 24, clones the repo to /opt/receipts, and schedules
# deploy/publish.sh every night. The site itself is served by Cloudflare
# Pages; this machine only builds and pushes it, so no ports are opened.
set -euo pipefail

REPO="${1:?usage: vm-setup.sh <git clone url>}"
APP_DIR=/opt/receipts

# The Next build needs more memory than the smallest VMs have; swap covers it.
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update -qq
apt-get install -y -qq git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y -qq nodejs

# The job runs as its own user with no login shell.
id receipts >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin receipts

if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO" "$APP_DIR"
fi
chown -R receipts:receipts "$APP_DIR"
sudo -u receipts bash -c "cd $APP_DIR && npm ci --no-audit --no-fund"

# Secrets live outside the repo. Fill these in after running this script.
if [ ! -f /etc/receipts.env ]; then
  cat > /etc/receipts.env <<'EOF'
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
PAGES_PROJECT=receipts
# Optional: gs://bucket-name for daily database backups
BACKUP_BUCKET=
EOF
  chmod 600 /etc/receipts.env
fi

cp "$APP_DIR/deploy/receipts-publish.service" "$APP_DIR/deploy/receipts-publish.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now receipts-publish.timer

echo
echo "Done. Next:"
echo "  1. Put the Cloudflare token and account id in /etc/receipts.env"
echo "  2. Run the job once by hand:  sudo systemctl start receipts-publish.service"
echo "  3. Watch it:                  journalctl -u receipts-publish -f"
echo "  Timer schedule:               systemctl list-timers receipts-publish.timer"
