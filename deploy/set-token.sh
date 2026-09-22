#!/usr/bin/env bash
# Store a new Cloudflare API token on this VM. It is typed at a prompt, so it
# never appears on a command line, in shell history or in a log. Checks the
# token with Cloudflare before saving it. Run as root:
#   sudo bash /opt/receipts/deploy/set-token.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }

read -rsp "Paste the Cloudflare API token, then press Enter: " token; echo
token="${token//[[:space:]]/}"
[ ${#token} -ge 30 ] || { echo "That doesn't look like a token (too short). Nothing changed." >&2; exit 1; }

# A token made under My Profile verifies at /user; one made under the account verifies at /accounts/{id}.
account=$(grep -o '^CLOUDFLARE_ACCOUNT_ID=.*' /etc/receipts.env | cut -d= -f2)
verify() { curl -s -H "Authorization: Bearer $token" "https://api.cloudflare.com/client/v4/$1/tokens/verify" | grep -q '"status": *"active"'; }
verify user || verify "accounts/$account" || { echo "Cloudflare did not accept that token. Nothing changed." >&2; exit 1; }

sed -i "s|^CLOUDFLARE_API_TOKEN=.*|CLOUDFLARE_API_TOKEN=$token|" /etc/receipts.env
grep -q "^CLOUDFLARE_API_TOKEN=$token\$" /etc/receipts.env || { echo "Could not update /etc/receipts.env." >&2; exit 1; }
chmod 600 /etc/receipts.env
echo "Saved and verified with Cloudflare."
echo "To prove it end to end: sudo systemctl start receipts-publish.service && sudo journalctl -u receipts-publish -n 5"
