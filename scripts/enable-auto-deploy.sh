#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="cfdns-manager"
APP_DIR="/opt/cfdns-manager"
UPDATER_SOURCE="$(cd "$(dirname "$(realpath "$0")")" && pwd)/update-self-hosted.sh"
UPDATER_TARGET="/usr/local/sbin/cfdns-manager-update"
SUDOERS_TARGET="/etc/sudoers.d/cfdns-manager-auto-deploy"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

if [[ "${EUID}" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || fail "Run as root or install sudo first."
  exec sudo -E bash "$0" "$@"
fi

DEPLOY_USER="${1:-}"
[[ "$#" -eq 1 ]] || fail "Usage: sudo bash scripts/enable-auto-deploy.sh <dedicated-ssh-login-user>"
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || fail "Use a simple Linux account name for the deploy user."
[[ "$DEPLOY_USER" != "root" && "$DEPLOY_USER" != "cfdns" ]] || fail "Use a separate, non-root SSH login account (not root or cfdns)."
getent passwd "$DEPLOY_USER" >/dev/null || fail "The Linux user '${DEPLOY_USER}' does not exist. Create it and install the GitHub Actions public key in its authorized_keys first."
DEPLOY_SHELL="$(getent passwd "$DEPLOY_USER" | cut -d: -f7)"
[[ -x "$DEPLOY_SHELL" && "$DEPLOY_SHELL" != "/usr/sbin/nologin" && "$DEPLOY_SHELL" != "/sbin/nologin" && "$DEPLOY_SHELL" != "/bin/false" ]] || fail "The deploy user needs a working SSH command shell."
[[ -f "$UPDATER_SOURCE" ]] || fail "Missing updater source: ${UPDATER_SOURCE}. Run this from a project checkout containing the updater."
[[ -f /etc/cfdns-manager.env && -d "$APP_DIR" ]] || fail "This VPS does not appear to have a self-hosted CFDNS Manager installation."
systemctl cat "$APP_NAME" >/dev/null 2>&1 || fail "The ${APP_NAME} systemd service is missing."

install -o root -g root -m 0750 "$UPDATER_SOURCE" "$UPDATER_TARGET"

sudoers_tmp="$(mktemp /etc/sudoers.d/.cfdns-manager-auto-deploy.XXXXXX)"
trap 'rm -f -- "$sudoers_tmp"' EXIT
printf '%s ALL=(root) NOPASSWD: %s *\n' "$DEPLOY_USER" "$UPDATER_TARGET" > "$sudoers_tmp"
chmod 0440 "$sudoers_tmp"
visudo -cf "$sudoers_tmp" >/dev/null || fail "The generated sudoers rule did not validate."
mv -f -- "$sudoers_tmp" "$SUDOERS_TARGET"
trap - EXIT

printf 'Automatic deployment is enabled for SSH user %s.\n' "$DEPLOY_USER"
printf 'That account may run only the root-owned validated updater through sudo.\n'
printf 'Add its matching private key to GitHub Actions secret CFDNS_DEPLOY_SSH_KEY; do not commit or paste the private key into chat.\n'
printf 'The public key must already be present in ~%s/.ssh/authorized_keys.\n' "$DEPLOY_USER"
