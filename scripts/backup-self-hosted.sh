#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="/etc/cfdns-manager.env"
KEY_FILE="/var/lib/cfdns/.xcm_key"
LEGACY_KEY_FILE="/opt/cfdns-manager/.xcm_key"
GITHUB_SSH_DIR="/var/lib/cfdns-manager/ssh"
BACKUP_DIR="/var/backups/cfdns-manager"
DB_USER="cfdns_app"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$EUID" -eq 0 ]] || fail "Run as root: sudo bash scripts/backup-self-hosted.sh"
[[ -r "$ENV_FILE" ]] || fail "Missing $ENV_FILE; this does not look like a self-hosted install."
command -v mariadb-dump >/dev/null 2>&1 || command -v mysqldump >/dev/null 2>&1 || fail "Install mariadb-client or mysqldump first."
command -v node >/dev/null 2>&1 || fail "Node.js is required to parse the protected database URL."

umask 077
install -d -o root -g root -m 0700 "$BACKUP_DIR"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mapfile -t db_parts < <(node --input-type=commonjs - "$ENV_FILE" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
if (!line) process.exit(2);
const url = new URL(line.slice('DATABASE_URL='.length));
for (const value of [url.hostname, url.port || '3306', decodeURIComponent(url.username), decodeURIComponent(url.password), url.pathname.replace(/^\//, '')]) {
  if (/[\r\n]/.test(value)) process.exit(3);
  process.stdout.write(value + '\n');
}
NODE
) || fail "Could not read database connection details from $ENV_FILE."
[[ "${#db_parts[@]}" -eq 5 ]] || fail "Database URL is incomplete."
DB_HOST="${db_parts[0]}"
DB_PORT="${db_parts[1]}"
DB_USER="${db_parts[2]}"
DB_PASSWORD="${db_parts[3]}"
DB_NAME="${db_parts[4]}"
[[ "$DB_HOST" == "127.0.0.1" || "$DB_HOST" == "localhost" ]] || fail "Refusing to back up a non-local database from this host."
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ && "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]] || fail "Unexpected database name or user in database URL."

cnf="$tmp_dir/client.cnf"
printf '[client]\nhost=%s\nport=%s\nuser=%s\npassword=%s\n' "$DB_HOST" "$DB_PORT" "$DB_USER" "$DB_PASSWORD" > "$cnf"
chmod 0600 "$cnf"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump_tmp="$tmp_dir/database.sql.gz"
secret_tmp="$tmp_dir/secrets.tar.gz"
dump_path="$BACKUP_DIR/cfdns-manager-$stamp.sql.gz"
secret_path="$BACKUP_DIR/cfdns-manager-$stamp.secrets.tar.gz"

if command -v mariadb-dump >/dev/null 2>&1; then
  mariadb-dump --defaults-extra-file="$cnf" --single-transaction --routines --events "$DB_NAME" | gzip -9 > "$dump_tmp"
else
  mysqldump --defaults-extra-file="$cnf" --single-transaction --routines --events "$DB_NAME" | gzip -9 > "$dump_tmp"
fi

secret_files=(etc/cfdns-manager.env)
if [[ -f "$KEY_FILE" ]]; then secret_files+=(var/lib/cfdns/.xcm_key); fi
if [[ -f "$LEGACY_KEY_FILE" ]]; then secret_files+=(opt/cfdns-manager/.xcm_key); fi
for file in github_ed25519 github_ed25519.pub known_hosts; do
  if [[ -f "$GITHUB_SSH_DIR/$file" ]]; then secret_files+=("var/lib/cfdns-manager/ssh/$file"); fi
done
tar -C / -czf "$secret_tmp" "${secret_files[@]}"
install -o root -g root -m 0600 "$dump_tmp" "$dump_path"
install -o root -g root -m 0600 "$secret_tmp" "$secret_path"
(
  cd "$BACKUP_DIR"
  sha256sum "$(basename "$dump_path")" "$(basename "$secret_path")" > "cfdns-manager-$stamp.sha256"
  chmod 0600 "cfdns-manager-$stamp.sha256"
)
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'cfdns-manager-*' -mtime +14 -delete
printf 'Backup complete (root-only):\n  %s\n  %s\n' "$dump_path" "$secret_path"
printf 'Store an encrypted off-host copy. The secret archive may contain API/encryption keys and the GitHub SSH private key.\n'
