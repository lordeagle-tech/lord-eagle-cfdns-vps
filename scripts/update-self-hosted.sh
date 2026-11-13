#!/usr/bin/env bash
set -Eeuo pipefail

# Root-owned deployment worker installed by install-self-hosted.sh or
# enable-auto-deploy.sh. It accepts only a commit SHA and uses a fixed staging
# path populated by the authenticated GitHub Actions deploy account.
APP_NAME="cfdns-manager"
APP_USER="cfdns"
APP_HOME="/var/lib/${APP_USER}"
APP_DIR="/opt/cfdns-manager"
ENV_FILE="/etc/cfdns-manager.env"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
INCOMING_BASE="/var/tmp/cfdns-manager-deploy-"
STAGING_BASE="${APP_HOME}/auto-deploy-staging"
ROLLBACK_DIR="${APP_DIR}.rollback"
UPDATER_TARGET="/usr/local/sbin/cfdns-manager-update"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }

[[ "${EUID}" -eq 0 ]] || fail "This deployment worker must be run through its restricted sudoers entry."
COMMIT="${1:-}"
[[ "$COMMIT" =~ ^[a-f0-9]{40}$ ]] || fail "Expected exactly one 40-character lowercase Git commit SHA."
[[ "$#" -eq 1 ]] || fail "Unexpected arguments."

INCOMING_DIR="${INCOMING_BASE}${COMMIT}"
STAGING_DIR="${STAGING_BASE}/${COMMIT}"
[[ -d "$INCOMING_DIR" && ! -L "$INCOMING_DIR" ]] || fail "Expected a staged release directory at ${INCOMING_DIR}."
[[ -f "$INCOMING_DIR/package.json" && -f "$INCOMING_DIR/pnpm-lock.yaml" ]] || fail "The staged release is missing project files."
[[ -f "$INCOMING_DIR/scripts/update-self-hosted.sh" ]] || fail "The release is missing its updater source."
[[ -f "$ENV_FILE" && -f "$SERVICE_FILE" && -d "$APP_DIR" && ! -L "$APP_DIR" ]] || fail "This VPS does not have the expected self-hosted installation."
getent passwd "$APP_USER" >/dev/null || fail "The unprivileged ${APP_USER} service account is missing."
systemctl cat "$APP_NAME" >/dev/null 2>&1 || fail "The ${APP_NAME} systemd service is missing."
[[ "$(systemctl show -p User --value "$APP_NAME")" == "$APP_USER" ]] || fail "Refusing to update a service that does not run as ${APP_USER}."
[[ "$(systemctl show -p WorkingDirectory --value "$APP_NAME")" == "$APP_DIR" ]] || fail "Refusing to update an unexpected service working directory."
systemctl is-active --quiet "$APP_NAME" || fail "The existing service is not healthy/running; inspect it before deploying."
for command_name in rsync runuser pnpm curl du df; do command -v "$command_name" >/dev/null 2>&1 || fail "Required command is missing: ${command_name}."; done
[[ -f "$APP_DIR/scripts/backup-self-hosted.sh" ]] || fail "The installed database/secrets backup script is missing."

install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$STAGING_BASE"
rm -rf -- "$STAGING_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$STAGING_DIR"
rsync -a --safe-links "$INCOMING_DIR/" "$STAGING_DIR/"
chown -R "$APP_USER:$APP_USER" "$STAGING_DIR"

cleanup_on_exit() {
  local result=$?
  trap - EXIT
  if [[ -n "${UPDATER_TMP:-}" ]]; then rm -f -- "$UPDATER_TMP" || true; fi
  if [[ "${ROLLBACK_REQUIRED:-0}" == "1" && "${ROLLBACK_READY:-0}" == "1" ]]; then
    printf '\nDeployment did not pass health checks; restoring the previous application code.\n' >&2
    systemctl stop "$APP_NAME" >/dev/null 2>&1 || true
    rsync -a --delete --safe-links --checksum "$ROLLBACK_DIR/" "$APP_DIR/" || true
    systemctl start "$APP_NAME" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$STAGING_DIR" 2>/dev/null || true
  exit "$result"
}
ROLLBACK_REQUIRED=0
ROLLBACK_READY=0
trap cleanup_on_exit EXIT

info "Building commit ${COMMIT} as the unprivileged ${APP_USER} account"
build_command="cd '${STAGING_DIR}' && pnpm install --frozen-lockfile && pnpm --filter @workspace/vps-manager run build && pnpm --filter @workspace/api-server run build"
runuser -u "$APP_USER" -- env HOME="$APP_HOME" bash -lc "$build_command"

info "Creating a root-only database and secrets backup"
bash "$APP_DIR/scripts/backup-self-hosted.sh"

if [[ -e "$ROLLBACK_DIR" || -L "$ROLLBACK_DIR" ]]; then
  [[ -d "$ROLLBACK_DIR" && ! -L "$ROLLBACK_DIR" ]] || fail "Refusing to replace an unexpected rollback path."
  [[ "$(stat -c '%U' "$ROLLBACK_DIR")" == "root" ]] || fail "The existing rollback directory is not root-owned."
  rm -rf -- "$ROLLBACK_DIR"
fi
snapshot_bytes="$(du -sb "$APP_DIR" | awk '{print $1}')"
available_bytes="$(df -B1 --output=avail "$APP_DIR" | tail -n 1 | tr -d '[:space:]')"
[[ "$snapshot_bytes" =~ ^[0-9]+$ && "$available_bytes" =~ ^[0-9]+$ ]] || fail "Could not calculate free space for the rollback copy."
required_bytes=$((snapshot_bytes + 67108864))
(( available_bytes >= required_bytes )) || fail "Not enough free disk space for an independent rollback copy; at least ${required_bytes} bytes must be available."
install -d -o root -g root -m 0700 "$ROLLBACK_DIR"
if ! rsync -aH --safe-links "$APP_DIR/" "$ROLLBACK_DIR/"; then
  rm -rf -- "$ROLLBACK_DIR"
  fail "Could not create the independent rollback copy; the running service was not changed."
fi
chown root:root "$ROLLBACK_DIR"
chmod 0700 "$ROLLBACK_DIR"
ROLLBACK_READY=1

info "Installing built code while preserving the existing environment and private state"
ROLLBACK_REQUIRED=1
systemctl stop "$APP_NAME"
rsync -a --safe-links --chown="${APP_USER}:${APP_USER}" \
  --exclude='.git/' --exclude='.env' --exclude='.env.*' --exclude='.xcm_key' \
  --exclude='node_modules/' --exclude='dist/' \
  "$STAGING_DIR/" "$APP_DIR/"

# Replace generated dependency trees exactly, but leave unrelated app files alone.
while IFS= read -r -d '' staged_modules; do
  relative_path="${staged_modules#"${STAGING_DIR}/"}"
  live_modules="${APP_DIR}/${relative_path}"
  install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$live_modules"
  rsync -a --delete --safe-links --chown="${APP_USER}:${APP_USER}" \
    "${staged_modules}/" "${live_modules}/"
done < <(find "$STAGING_DIR" -type d -name node_modules -prune -print0)

# Replace generated bundles so removed/stale hashed assets do not linger.
for staged_dist in "$STAGING_DIR"/artifacts/*/dist; do
  [[ -d "$staged_dist" ]] || continue
  relative_path="${staged_dist#"${STAGING_DIR}/"}"
  live_dist="${APP_DIR}/${relative_path}"
  [[ ! -L "$live_dist" ]] || fail "Refusing to replace a symlinked build output: ${live_dist}."
  rm -rf -- "$live_dist"
  install -d -o "$APP_USER" -g "$APP_USER" -m 0755 "$live_dist"
  rsync -a --delete --safe-links --chown="${APP_USER}:${APP_USER}" \
    "${staged_dist}/" "${live_dist}/"
done

info "Starting the updated service and checking its health endpoint"
systemctl start "$APP_NAME"
ready=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:3000/api/healthz >/dev/null; then ready=1; break; fi
  sleep 1
done
(( ready == 1 )) || fail "New release failed its health check; previous code will be restored. Inspect the service journal directly on the VPS."
UPDATER_TMP="$(mktemp /usr/local/sbin/.cfdns-manager-update.XXXXXX)"
install -o root -g root -m 0750 "$STAGING_DIR/scripts/update-self-hosted.sh" "$UPDATER_TMP"
mv -f -- "$UPDATER_TMP" "$UPDATER_TARGET"
UPDATER_TMP=""
ROLLBACK_REQUIRED=0

info "Deployment of ${COMMIT} succeeded; previous code is retained at ${ROLLBACK_DIR} until the next successful deployment."
