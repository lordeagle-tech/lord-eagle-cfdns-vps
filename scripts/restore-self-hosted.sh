#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_DIR="/var/backups/cfdns-manager"
ENV_FILE="/etc/cfdns-manager.env"
APP_DIR="/opt/cfdns-manager"
APP_USER="cfdns"
APP_HOME="/var/lib/cfdns"
GITHUB_SSH_DIR="/var/lib/cfdns-manager/ssh"
SERVICE="cfdns-manager"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$EUID" -eq 0 ]] || fail "Run as root: sudo bash scripts/restore-self-hosted.sh <backup-timestamp>"
[[ -t 0 ]] || fail "Restore requires an interactive terminal."
[[ $# -eq 1 && "$1" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail "Pass one timestamp from filenames, for example 20261112T120000Z."
stamp="$1"
dump="$BACKUP_DIR/cfdns-manager-$stamp.sql.gz"
secrets="$BACKUP_DIR/cfdns-manager-$stamp.secrets.tar.gz"
checksums="$BACKUP_DIR/cfdns-manager-$stamp.sha256"
[[ -r "$dump" && -r "$secrets" && -r "$checksums" ]] || fail "Backup set is incomplete or missing for $stamp."
command -v mariadb >/dev/null 2>&1 || fail "Install mariadb-client first."
command -v node >/dev/null 2>&1 || fail "Node.js is required to parse the protected database URL."

(cd "$BACKUP_DIR" && sha256sum --check "$(basename "$checksums")") || fail "Backup checksum verification failed."
printf 'This will replace the CFDNS Manager database and restore its saved secrets/configuration.\n'
printf 'A pre-restore backup of the current installation will be created first.\n'
read -r -p "Type RESTORE to continue: " answer
[[ "$answer" == "RESTORE" ]] || fail "Restore cancelled."

"$SCRIPT_DIR/backup-self-hosted.sh"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
tar -xzf "$secrets" -C "$tmp_dir" --no-same-owner --no-same-permissions
[[ -r "$tmp_dir/etc/cfdns-manager.env" ]] || fail "The backup archive does not contain the app environment."

mapfile -t db_parts < <(node --input-type=commonjs - "$tmp_dir/etc/cfdns-manager.env" <<'NODE'
const fs = require('node:fs');
const line = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
if (!line) process.exit(2);
const url = new URL(line.slice('DATABASE_URL='.length));
for (const value of [url.hostname, url.port || '3306', decodeURIComponent(url.username), decodeURIComponent(url.password), url.pathname.replace(/^\//, '')]) {
  if (/[\r\n]/.test(value)) process.exit(3);
  process.stdout.write(value + '\n');
}
NODE
) || fail "Could not parse the backed-up database URL."
[[ "${#db_parts[@]}" -eq 5 ]] || fail "Backed-up database URL is incomplete."
DB_HOST="${db_parts[0]}"; DB_PORT="${db_parts[1]}"; DB_USER="${db_parts[2]}"; DB_PASSWORD="${db_parts[3]}"; DB_NAME="${db_parts[4]}"
[[ "$DB_HOST" == "127.0.0.1" || "$DB_HOST" == "localhost" ]] || fail "Refusing to restore to a non-local database."
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ && "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]] || fail "Unexpected database name or user in backup."
cnf="$tmp_dir/client.cnf"
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASSWORD" > "$cnf"
chmod 0600 "$cnf"

systemctl stop "$SERVICE"
install -o root -g root -m 0600 "$tmp_dir/etc/cfdns-manager.env" "$ENV_FILE"
if [[ -f "$tmp_dir/var/lib/cfdns/.xcm_key" ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_HOME"
  install -o "$APP_USER" -g "$APP_USER" -m 0600 "$tmp_dir/var/lib/cfdns/.xcm_key" "$APP_HOME/.xcm_key"
  rm -f "$APP_DIR/.xcm_key"
elif [[ -f "$tmp_dir/opt/cfdns-manager/.xcm_key" ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR"
  install -o "$APP_USER" -g "$APP_USER" -m 0600 "$tmp_dir/opt/cfdns-manager/.xcm_key" "$APP_DIR/.xcm_key"
  rm -f "$APP_HOME/.xcm_key"
else
  rm -f "$APP_DIR/.xcm_key"
  rm -f "$APP_HOME/.xcm_key"
fi
if [[ -f "$tmp_dir/var/lib/cfdns-manager/ssh/github_ed25519" ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$GITHUB_SSH_DIR"
  install -o "$APP_USER" -g "$APP_USER" -m 0600 "$tmp_dir/var/lib/cfdns-manager/ssh/github_ed25519" "$GITHUB_SSH_DIR/github_ed25519"
  if [[ -f "$tmp_dir/var/lib/cfdns-manager/ssh/github_ed25519.pub" ]]; then
    install -o "$APP_USER" -g "$APP_USER" -m 0644 "$tmp_dir/var/lib/cfdns-manager/ssh/github_ed25519.pub" "$GITHUB_SSH_DIR/github_ed25519.pub"
  fi
  if [[ -f "$tmp_dir/var/lib/cfdns-manager/ssh/known_hosts" ]]; then
    install -o "$APP_USER" -g "$APP_USER" -m 0644 "$tmp_dir/var/lib/cfdns-manager/ssh/known_hosts" "$GITHUB_SSH_DIR/known_hosts"
  fi
else
  printf 'No GitHub SSH key was present in this backup; leaving the current VPS key files unchanged.\n'
fi
mariadb --defaults-extra-file="$cnf" "$DB_NAME" < <(gzip -dc "$dump")
systemctl start "$SERVICE"

printf 'Restore completed. Check service health and verify a saved SSH/DNS connection before relying on the panel.\n'
systemctl --no-pager --full status "$SERVICE" || true
