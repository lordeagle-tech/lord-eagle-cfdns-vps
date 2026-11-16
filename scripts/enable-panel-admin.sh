#!/usr/bin/env bash
set -Eeuo pipefail

# Grants the panel's built-in terminal administrative access on this VPS.
# This removes the systemd privilege sandbox and gives the service account
# passwordless sudo, so anyone with the panel login key effectively owns the box.
# Run only on a host where that trade-off is acceptable.

APP_USER="cfdns"
SERVICE_FILE="/etc/systemd/system/cfdns-manager.service"
SUDOERS_FILE="/etc/sudoers.d/cfdns-manager"
SERVICE_NAME="cfdns-manager"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || fail "Run this script as root or install sudo first."
  exec sudo -E bash "$0" "$@"
fi

[[ -f "$SERVICE_FILE" ]] || fail "$SERVICE_FILE not found. Is CFDNS Manager installed on this VPS?"
id "$APP_USER" >/dev/null 2>&1 || fail "The '$APP_USER' service account does not exist."

info "Backing up the current service unit"
backup="${SERVICE_FILE}.bak-$(date -u +%Y%m%dT%H%M%SZ)"
cp -a "$SERVICE_FILE" "$backup"
printf 'Backup: %s\n' "$backup"

info "Relaxing the systemd sandbox for panel administration"
sed -i -E '/^(NoNewPrivileges|ProtectSystem|ProtectHome|ProtectKernelTunables|ProtectKernelModules|ProtectKernelLogs|ProtectControlGroups|ProtectClock|RestrictSUIDSGID|LockPersonality|PrivateTmp|PrivateDevices|ReadWritePaths)=/d' "$SERVICE_FILE"
if ! grep -q '^RuntimeDirectory=' "$SERVICE_FILE"; then
  sed -i "/^\[Service\]/a RuntimeDirectory=cfdns-manager\nRuntimeDirectoryMode=0700" "$SERVICE_FILE"
fi

info "Granting passwordless sudo to ${APP_USER}"
umask 077
printf '%s ALL=(ALL) NOPASSWD: ALL\n' "$APP_USER" > "$SUDOERS_FILE"
chmod 0440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

info "Reloading and restarting ${SERVICE_NAME}"
systemctl daemon-reload
systemctl restart "$SERVICE_NAME"

info "Done. Open a new panel terminal tab; sudo is available as ${APP_USER}."
printf 'Revert by restoring %s, deleting %s, then: systemctl daemon-reload && systemctl restart %s\n' "$backup" "$SUDOERS_FILE" "$SERVICE_NAME"
