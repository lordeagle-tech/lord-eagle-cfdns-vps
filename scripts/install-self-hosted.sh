#!/usr/bin/env bash
set -Eeuo pipefail

# One-time bootstrap for a fresh Ubuntu/Debian VPS. Run from a clean clone:
#   sudo bash scripts/install-self-hosted.sh
# The app is deliberately run as an unprivileged service user, never as root.

APP_NAME="cfdns-manager"
APP_USER="cfdns"
APP_HOME="/var/lib/$APP_USER"
API_KEY_FILE="${APP_HOME}/.xcm_key"
GITHUB_SSH_DIR="/var/lib/cfdns-manager/ssh"
GITHUB_SSH_KEY_PATH="$GITHUB_SSH_DIR/github_ed25519"
GITHUB_SSH_KNOWN_HOSTS="$GITHUB_SSH_DIR/known_hosts"
APP_DIR="/opt/cfdns-manager"
ENV_FILE="/etc/cfdns-manager.env"
SERVICE_FILE="/etc/systemd/system/cfdns-manager.service"
NGINX_AVAILABLE="/etc/nginx/sites-available/cfdns-manager"
NGINX_ENABLED="/etc/nginx/sites-enabled/cfdns-manager"
NGINX_WS_MAP="/etc/nginx/conf.d/cfdns-manager-websocket.conf"
CREDENTIALS_FILE="/root/cfdns-manager-credentials.txt"
DB_NAME="cfdns_manager"
DB_USER="cfdns_app"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '\n==> %s\n' "$*"; }

if [[ "${EUID}" -ne 0 ]]; then
  command -v sudo >/dev/null 2>&1 || fail "Run this script as root or install sudo first."
  exec sudo -E bash "$0" "$@"
fi

[[ -t 0 ]] || fail "This installer needs an interactive terminal to collect the site domain and TLS contact email."
[[ -f "$(dirname "$(realpath "$0")")/../pnpm-lock.yaml" ]] || fail "Run this script from a clone of lordeagle-tech/lord-eagle-cfdns-vps."
[[ ! -e "$APP_DIR" ]] || fail "$APP_DIR already exists. This installer only initializes a fresh install and will not overwrite it."
[[ ! -e "$ENV_FILE" ]] || fail "$ENV_FILE already exists. Refusing to replace production credentials."
[[ ! -e "$API_KEY_FILE" ]] || fail "$API_KEY_FILE already exists. Refusing to overwrite an existing access key."
[[ ! -e "$SERVICE_FILE" && ! -e "$NGINX_AVAILABLE" && ! -e "$NGINX_WS_MAP" ]] || fail "A CFDNS Manager service or Nginx site already exists; refusing to overwrite it."

source /etc/os-release
case "${ID:-}" in
  ubuntu|debian) ;;
  *) fail "This bootstrap currently supports Ubuntu and Debian only (detected: ${PRETTY_NAME:-unknown})." ;;
esac

DOMAIN="${CFDNS_DOMAIN:-}"
EMAIL="${ACME_EMAIL:-}"
if [[ -z "$DOMAIN" ]]; then read -r -p "Domain for the panel (its DNS A/AAAA record must point to this VPS): " DOMAIN; fi
if [[ -z "$EMAIL" ]]; then read -r -p "Email for Let's Encrypt certificate notices: " EMAIL; fi
DOMAIN="${DOMAIN,,}"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || fail "Enter a valid fully-qualified domain name."
[[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail "Enter a valid email address."
if systemctl is-active --quiet apache2; then fail "Apache is active on this VPS. Stop and plan the existing web-server configuration before enabling Nginx."; fi
if [[ -d /etc/nginx ]] && grep -R -F "server_name $DOMAIN" /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null; then
  fail "Nginx already has a site for $DOMAIN. Refusing to replace an existing domain configuration."
fi

SOURCE_DIR="$(cd "$(dirname "$(realpath "$0")")/.." && pwd)"
[[ -f "$SOURCE_DIR/package.json" && -f "$SOURCE_DIR/pnpm-lock.yaml" ]] || fail "The project source or pnpm lockfile is missing."

info "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git openssh-client rsync nginx mariadb-server certbot python3-certbot-nginx build-essential python3

info "Installing Node.js 22 from the signed NodeSource repository"
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
chmod 0644 /etc/apt/keyrings/nodesource.gpg
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( node_major >= 20 )) || fail "Node.js 20 or newer is required; found $(node --version)."
corepack enable
corepack prepare pnpm@10.18.0 --activate

info "Preparing an unprivileged application account and local database"
getent group "$APP_USER" >/dev/null || groupadd --system "$APP_USER"
getent passwd "$APP_USER" >/dev/null || useradd --system --gid "$APP_USER" --home-dir "$APP_HOME" --create-home --shell /usr/sbin/nologin "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_HOME"
install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$GITHUB_SSH_DIR"

info "Generating a VPS-local GitHub SSH key and pinning GitHub host keys"
if [[ ! -e "$GITHUB_SSH_KEY_PATH" && ! -e "$GITHUB_SSH_KEY_PATH.pub" ]]; then
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" ssh-keygen -q -t ed25519 -C "cfdns-manager@${DOMAIN}" -N "" -f "$GITHUB_SSH_KEY_PATH"
elif [[ ! -f "$GITHUB_SSH_KEY_PATH" || ! -f "$GITHUB_SSH_KEY_PATH.pub" ]]; then
  fail "A partial GitHub SSH key already exists at $GITHUB_SSH_KEY_PATH; refusing to replace it."
fi
chown "$APP_USER:$APP_USER" "$GITHUB_SSH_KEY_PATH" "$GITHUB_SSH_KEY_PATH.pub"
chmod 0600 "$GITHUB_SSH_KEY_PATH"
chmod 0644 "$GITHUB_SSH_KEY_PATH.pub"
curl -fsSL --max-time 20 -H 'Accept: application/vnd.github+json' https://api.github.com/meta \
  | node -e 'let raw="";process.stdin.setEncoding("utf8");process.stdin.on("data",(chunk)=>raw+=chunk);process.stdin.on("end",()=>{try{const keys=JSON.parse(raw).ssh_keys;if(!Array.isArray(keys)||keys.length===0)throw new Error();const lines=keys.filter((key)=>typeof key==="string"&&/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+)/.test(key)).map((key)=>`github.com ${key}`);if(!lines.length)throw new Error();process.stdout.write(lines.join("\n")+"\n")}catch{console.error("Could not obtain GitHub SSH host keys from the authenticated HTTPS metadata endpoint.");process.exit(1)}})' \
  > "$GITHUB_SSH_KNOWN_HOSTS"
chown "$APP_USER:$APP_USER" "$GITHUB_SSH_KNOWN_HOSTS"
chmod 0644 "$GITHUB_SSH_KNOWN_HOSTS"

systemctl enable --now mariadb
DB_PASSWORD="$(openssl rand -hex 24)"
API_KEY="$(openssl rand -hex 32)"
APP_ENCRYPTION_KEY="$(openssl rand -hex 32)"
printf '%s\n' "$API_KEY" > "$API_KEY_FILE"
chown "$APP_USER:$APP_USER" "$API_KEY_FILE"
chmod 0600 "$API_KEY_FILE"
mariadb <<SQL
CREATE DATABASE ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

info "Installing project files and building the production app"
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
rsync -a --exclude='.git' --exclude='.env' --exclude='.env.*' --exclude='node_modules' --exclude='**/node_modules' --exclude='artifacts/*/dist' "$SOURCE_DIR/" "$APP_DIR/"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
install -o root -g root -m 0750 "$APP_DIR/scripts/update-self-hosted.sh" /usr/local/sbin/cfdns-manager-update
runuser -u "$APP_USER" -- env HOME="$APP_HOME" bash -lc 'cd /opt/cfdns-manager && pnpm install --frozen-lockfile && pnpm --filter @workspace/vps-manager run build && pnpm --filter @workspace/api-server run build'

info "Writing root-managed app configuration and systemd service"
umask 077
cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
APP_ORIGIN=https://${DOMAIN}
SESSION_COOKIE_SAME_SITE=lax
APP_ALLOWED_ORIGINS=
CFDNS_ENABLE_SSH=true
CFDNS_ENABLE_GITHUB_SSH=true
GITHUB_SSH_KEY_PATH=${GITHUB_SSH_KEY_PATH}
GITHUB_SSH_KNOWN_HOSTS=${GITHUB_SSH_KNOWN_HOSTS}
ADMIN_EMAILS=
ADMIN_OPEN_IDS=
ADMIN_IP_ALLOWLIST=
API_KEY_FILE=${API_KEY_FILE}
FILE_MANAGER_ROOTS=/var/www,/opt/cfdns-manager
DATABASE_URL=mysql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:3306/${DB_NAME}
APP_ENCRYPTION_KEY=${APP_ENCRYPTION_KEY}
EOF
chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"
cat > "$CREDENTIALS_FILE" <<EOF
CFDNS Manager initial admin login
URL: https://${DOMAIN}/
Login key: ${API_KEY}

Keep this file secret. Delete it after saving the login key in a password manager.
Cloudflare API tokens and SSH credentials for additional VPSs are not generated by this installer; add them later from the panel using least-privilege credentials.
EOF
chmod 0600 "$CREDENTIALS_FILE"
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=CFDNS Manager self-hosted control panel
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
Environment=HOME=${APP_HOME}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node --enable-source-maps artifacts/api-server/dist/index.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=read-only
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
RestrictSUIDSGID=true
LockPersonality=true
UMask=0077
ReadWritePaths=${APP_DIR} ${APP_HOME} ${GITHUB_SSH_DIR} /var/www

[Install]
WantedBy=multi-user.target
EOF
chmod 0644 "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable --now "$APP_NAME"

info "Configuring Nginx and requesting HTTPS"
cat > "$NGINX_WS_MAP" <<'NGINX_MAP'
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
NGINX_MAP
chmod 0644 "$NGINX_WS_MAP"
cat > "$NGINX_AVAILABLE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_read_timeout 3600;
    }
}
NGINX
ln -s "$NGINX_AVAILABLE" "$NGINX_ENABLED"
nginx -t
systemctl enable --now nginx
systemctl reload nginx
certbot --nginx --non-interactive --agree-tos --redirect --email "$EMAIL" -d "$DOMAIN"

info "Waiting for the app health endpoint"
ready=0
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/healthz >/dev/null; then ready=1; break; fi
  sleep 1
done
(( ready == 1 )) || { systemctl status "$APP_NAME" --no-pager || true; fail "The app did not become healthy. Inspect: journalctl -u $APP_NAME -n 100"; }

cat <<EOF

Installation complete.
Panel URL: https://${DOMAIN}/
Initial admin login key: ${API_KEY}
A root-only copy is saved at: ${CREDENTIALS_FILE}

The API listens only on 127.0.0.1:3000 behind Nginx/TLS and runs as the unprivileged '${APP_USER}' user. The dashboard reads local system information from this VPS. A dedicated Ed25519 GitHub key was generated on the VPS; its private half stays in ${GITHUB_SSH_DIR} and the panel exposes only its public key. The built-in terminal and file manager are limited to that service account's OS permissions; this installer does not grant root shell access.

Before using the panel, confirm your provider firewall allows inbound TCP 80 and 443 and does not expose TCP 3000. Ensure the domain A/AAAA record points to this VPS. To inspect service logs: journalctl -u ${APP_NAME} -f
EOF
