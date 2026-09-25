#!/bin/sh
# Runs as root on the VM, started by deploy/push-keys.ps1. Merges the variables in
# /tmp/.env.local into /etc/receipts.env: a name already in the file is replaced,
# a new one is appended, comments and blank lines are skipped. Values are never
# printed. Cleans up the uploaded files when done.
set -eu
src=/tmp/.env.local
dst=/etc/receipts.env
[ -r "$src" ] || { echo "No $src on the VM. Run deploy/push-keys.ps1 from the project folder." >&2; exit 1; }
touch "$dst"
grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$src" | while IFS= read -r line; do
  name=${line%%=*}
  { grep -v "^$name=" "$dst" || true; echo "$line"; } > "$dst.new"
  mv "$dst.new" "$dst"
done
chmod 600 "$dst"
rm -f "$src" /tmp/vm-append-keys.sh
echo "Variables now in $dst (values hidden):"
sed 's/=.*//' "$dst"
