# CFDNS Manager

<div align="center">

**A modern DNS and VPS operations console for people who run real infrastructure.**

[![Build](https://img.shields.io/badge/build-passing-00ff41?style=for-the-badge&labelColor=0d1117)](https://github.com/lordeagle-tech/lord-eagle-cfdns-vps)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-00f5ff?style=for-the-badge&labelColor=0d1117)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-a855f7?style=for-the-badge&labelColor=0d1117)](https://react.dev/)
[![License](https://img.shields.io/badge/license-MIT-00ff41?style=for-the-badge&labelColor=0d1117)](LICENSE)

**Built by [Lord Eagle](https://github.com/lordeagle-tech) · [Zynex Tech](https://website.lordeagle.tech)**

</div>

> Understand the attack. Improve the defense. Operate your DNS, servers, and deployments from one focused control plane.

CFDNS Manager combines Cloudflare DNS operations with direct VPS administration in a single web service. It is designed for self-hosted infrastructure teams, developers, and operators who need fast visibility without switching between five dashboards.

## What it does

### DNS control

- Connect Cloudflare accounts securely.
- Discover zones and inspect DNS records.
- Create, update, delete, and proxy DNS records.
- Toggle Cloudflare proxying and record TTL settings.
- Inspect the Cloudflare zone security level and explicitly enable/restore Under Attack Mode during an active Layer 7 attack.
- Review DNS health, resolver propagation, import previews, and reversible record history.
- Audit destructive DNS actions.

### VPS operations

- Add and manage Linux servers over SSH/SFTP after explicit SSH host-key verification.
- Inspect UFW status and add a single confirmed inbound TCP/UDP allow rule on a saved, host-key-pinned VPS.
- Inspect CPU, memory, disks, network interfaces, uptime, and logged-in users.
- Browse, read, write, rename, move, and delete remote files.
- Use an in-browser terminal with a persistent working directory.
- Monitor and control PM2 processes.
- Inspect deployed sites, SSL status, Git branches, and deployment paths.
- Pull a deployed Git working tree from the dashboard.

### Public-service foundations

- Cookie-backed administrator sessions; the local key is accepted only to exchange it for a browser session.
- Encrypted storage for SSH, Cloudflare, and other provider credentials.
- Audit records for account, server, and DNS activity.
- MySQL-compatible managed database schema for users, sessions, servers, zones, links, and audit logs.
- One Express service serving the API and built React application.
- Route manifest and health endpoint ready for managed deployment.

## Interface direction

The UI follows the Zynex Tech profile language: near-black operations surfaces, electric green for healthy/active states, cyan for live network data, and restrained purple for secondary actions. The dashboard is organized as an operations console rather than a marketing page: command bar first, telemetry second, actionable infrastructure tables next.

## Repository

This project lives at:

- **GitHub:** [lordeagle-tech/lord-eagle-cfdns-vps](https://github.com/lordeagle-tech/lord-eagle-cfdns-vps)
- **Builder:** [Lord Eagle](https://github.com/lordeagle-tech)
- **Brand:** [Zynex Tech](https://website.lordeagle.tech)

## Quick start

### Requirements

- Node.js 20+
- pnpm 9+
- MySQL-compatible database for the managed/API deployment
- SSH access to the VPS machines you want to manage
- Cloudflare API token with only the zone/account permissions you need

### Install

```bash
git clone https://github.com/lordeagle-tech/lord-eagle-cfdns-vps.git
cd lord-eagle-cfdns-vps
pnpm install
```

### Configure

Copy the environment template and replace every placeholder:

```bash
cp .env.example .env
```

```env
PORT=3000
DATABASE_URL=mysql://user:password@host:3306/database
APP_ENCRYPTION_KEY=replace-with-a-long-random-secret
# Optional for self-hosted local fallback when OAuth is unavailable.
API_KEY=replace-with-a-long-random-access-key
```

Never commit `.env`. Use a long random encryption key; rotating it without a migration plan will make previously stored provider credentials unreadable.

### Development

```bash
pnpm --filter @workspace/api-server run dev &
pnpm --filter @workspace/vps-manager run dev
```

The API runs on the configured server port and the Vite frontend runs on its development port. The frontend proxies `/api` requests to the API during development.

### Production build

```bash
pnpm --filter @workspace/vps-manager run build
pnpm --filter @workspace/api-server run build
PORT=3000 NODE_ENV=production node --enable-source-maps artifacts/api-server/dist/index.mjs
```

The unified service serves the built frontend, `/api` endpoints, `/api/healthz`, and `/manus-routes.json` from one listener.

### Self-hosted VPS bootstrap

For a fresh Ubuntu or Debian VPS, point the panel domain's DNS A/AAAA record at the server and allow inbound TCP 80/443 in the provider firewall. Clone this repository on the VPS and run the installer:

```bash
git clone https://github.com/lordeagle-tech/lord-eagle-cfdns-vps.git
cd lord-eagle-cfdns-vps
sudo bash scripts/install-self-hosted.sh
```

The installer prompts for the domain and certificate email, installs Node.js, MariaDB, Nginx, OpenSSH client and a Let's Encrypt certificate, builds the app, creates a local database, and generates a random admin login key and encryption key. It also creates a dedicated Ed25519 GitHub SSH key on the VPS and retrieves GitHub's SSH host keys through the HTTPS GitHub metadata API for strict host verification. The GitHub private key stays in `/var/lib/cfdns-manager/ssh/` with service-account-only permissions; the GitHub key setup API exposes only its public half. It binds the API to `127.0.0.1:3000` behind Nginx/TLS and runs it as the unprivileged `cfdns` service account. The initial login key is shown once and saved in `/root/cfdns-manager-credentials.txt` with root-only permissions. Keep it in a password manager, then remove that file.

To connect that VPS to GitHub, sign in to the deployed panel and open **Developer Hub → VPS → GitHub Connection**. Copy the displayed public key, enter the target repository as `owner/repository`, then open its GitHub **Settings → Deploy keys** page and add the key. Keep the deploy key read-only unless this VPS must push to that repository. Return to the panel and run the test; it verifies both SSH authentication and read access to the selected repository. The GitHub key setup API returns only the public key; authorized local terminal commands run as the same service account and should be available only to trusted admins. On an existing manual installation, configure `CFDNS_ENABLE_GITHUB_SSH=true`, `GITHUB_SSH_KEY_PATH`, and `GITHUB_SSH_KNOWN_HOSTS`, ensure the service can write the configured key directory, and restart it before using the panel's generate-key fallback.

For account-level repository management, open **GitHub Control** and connect once with a GitHub classic personal access token scoped to `repo` and `delete_repo`. Use HTTPS to access the panel, choose an expiration date, and never paste the token into chat or commit it to the repository. The panel validates the token against GitHub, stores an AES-256-GCM encrypted copy per administrator in MariaDB, and never returns the token to the browser; disconnect removes this stored copy but does not revoke the token at GitHub. Keep `APP_ENCRYPTION_KEY` backed up securely: losing it prevents decryption. The control panel lists repositories owned by the connected GitHub account, creates repositories private by default, edits repository settings, browses branches/files, and commits text-file changes directly to the selected branch. Repository deletion requires typing its exact name, file removal creates a GitHub commit, and all repository/file mutations are recorded in the audit log. This credential grants broad repository authority; only trusted panel admins should be allowed to use it, and the token should be revoked in GitHub when no longer needed.

To run a reviewed repository script on a saved VPS, open **Deploy Script**, select a pinned SSH connection, repository, branch and `.sh` file, then inspect the complete script and its SHA-256 before confirming the VPS ID. At execution, the server re-fetches the GitHub file and refuses to run it if its blob or checksum changed. It transfers the script into a private temporary directory on the target VPS, executes it as the saved SSH username (without automatic `sudo`), returns bounded output, and records the operation in the audit log. The remote run is limited to ten minutes. Scripts can still make irreversible changes, install software or trigger DNS/provider operations: review every line, use a least-privilege SSH account and test on a non-production VPS first. No environment secrets are passed into the script automatically, and the workflow is disabled in shared Preview/development. Use the existing **DNS** page separately to manage Cloudflare records; DNS changes are not inferred or applied automatically by a script deployment.

The dashboard can inspect the VPS running the API without SSH-ing into itself. The local terminal and file manager run with the `cfdns` account's operating-system permissions; the installer deliberately does not grant a public web terminal root access. The local file browser is limited to `FILE_MANAGER_ROOTS` (the installer defaults to the app directory and `/var/www`). The service's private state directory, including its API-key file, and the dedicated GitHub private-key directory are outside those roots. This is an application path boundary, not a substitute for Linux permissions: terminal commands run as the service user and can access anything that user can access.

The installer does not create Cloudflare API tokens or SSH credentials for other VPSs—add those separately in the panel with only the permissions required. On first SSH test, the app displays the host's SHA-256 fingerprint and runs no remote commands until you confirm it. Compare it with your VPS provider's console or the host public-key fingerprint on the VPS; never accept an unexpected change. After it is pinned, remote terminal, SFTP, and firewall actions verify the same fingerprint on every connection. This is a one-time bootstrap for a fresh host; it refuses to overwrite an existing install or domain configuration.

The DNS zone page can read Cloudflare's `security_level`; tokens need **Zone → Zone Settings → Read** for status. The emergency Under Attack Mode control also needs **Zone → Zone Settings → Edit**. Cloudflare's automatic DDoS mitigation runs independently; the app does not detect attacks or provide network scrubbing. Under Attack Mode is a temporary Layer 7 challenge, may disrupt APIs, bots, analytics, and legitimate visitors, and should be enabled only during a real attack. The app asks you to type the exact zone name, records the previous security level in the audit log, and offers to restore it; if prior audit state is unavailable, restoration defaults to `medium`. Review Cloudflare's dashboard and incident status as the authoritative source.

The **Firewall Control** page is limited to UFW on saved, pinned SSH hosts. It reads status and numbered rules, and can add one inbound `allow PORT/tcp` or `allow PORT/udp` rule after typing an exact confirmation. It will not enable UFW, change default policies, remove rules, or alter the panel's own firewall. If the remote SSH account is not root, it needs narrowly configured noninteractive sudo permission for the status and specific allow operations; do not grant broad `NOPASSWD: ALL` just to make the panel work. Configure these permissions directly on the remote host after confirming console access and provider firewall rules. Keep SSH and application ports allowed; a bad firewall change can lock you out. For volumetric or provider-edge attacks, use your VPS/cloud provider's protection and firewall controls—host UFW cannot absorb upstream DDoS traffic.

The API key and encryption key are distinct: protect both, and back up the encryption key with the database. The installer keeps its environment file root-only and stores the API key separately under `/var/lib/cfdns/.xcm_key` with service-account-only permissions. The systemd service runs unprivileged with a private filesystem view; writable paths are limited to the app directory, private service data, its dedicated GitHub SSH directory, and `/var/www`, subject to normal Linux permissions. Browser login exchanges the access key for a Secure, HttpOnly session cookie; ordinary API routes reject bearer API keys. In **Settings**, generate a replacement key (shown once) or revoke other browser sessions. Key rotation revokes other sessions while preserving the current browser. Keep `.env.example` as a template only—it contains placeholders, not deployment credentials.

For additional login protection, set `ADMIN_IP_ALLOWLIST` in `/etc/cfdns-manager.env` to one or more exact client IP addresses separated by commas, then restart `cfdns-manager`. Leave it empty to disable this optional restriction. The allowlist uses the client address forwarded by the installer-managed Nginx proxy; do not expose the app port directly or trust forwarding headers from an untrusted proxy. Login attempts are rate-limited in MariaDB across restarts and app processes. Security headers, including a restrictive Content Security Policy, are sent by the application; validate any custom reverse proxy or external assets against that policy before adding exceptions.

#### Back up and restore

The installer includes root-only backup and restore scripts. A backup contains a compressed database plus the environment, optional rotated API-key file, and the dedicated GitHub SSH key material needed to preserve GitHub access and decrypt stored SSH/Cloudflare credentials. It is stored under `/var/backups/cfdns-manager` with mode `0600`; keep an encrypted copy off the VPS, because the secrets archive contains private keys and other sensitive material.

```bash
cd /opt/cfdns-manager
sudo bash scripts/backup-self-hosted.sh
ls -1 /var/backups/cfdns-manager
sudo bash scripts/restore-self-hosted.sh 20261112T120000Z
```

Restore verifies the checksum, creates a fresh pre-restore backup, and requires you to type `RESTORE` before replacing the app configuration and database. Test the recovery procedure on a non-production copy before relying on it. Losing the encryption key without a compatible backup can make saved provider credentials unreadable.

## Project layout

```text
.
├── artifacts/
│   ├── api-server/          # Express API, auth, SSH, Cloudflare, audit, and static serving
│   └── vps-manager/         # React/Vite operations console
├── lib/
│   ├── db/                  # Drizzle schema and MySQL connection
│   ├── api-client-react/    # API client and React Query hooks
│   ├── api-spec/            # OpenAPI source
│   └── api-zod/             # Zod contracts
├── drizzle/                 # Database migration SQL
├── public/                  # Route manifest and project metadata
├── Dockerfile               # One-service production image
├── plan.md                  # Product and design record
└── TODO.md                  # Outcome checklist
```

## Security model

CFDNS Manager is an infrastructure tool. Treat it like production access:

- Protected API routes require an administrator role and a browser session. OAuth accounts must be explicitly allowlisted with `ADMIN_EMAILS` or `ADMIN_OPEN_IDS`; the generated local access key is only a bootstrap/session-exchange credential, not a general API bearer token.
- Configure `ADMIN_IP_ALLOWLIST` when the administrator's client IP is stable; values are exact IP addresses, comma-separated. Verify the client IP through the trusted reverse proxy before enabling it to avoid locking yourself out.
- Sign-in attempts are rate-limited using MariaDB-backed state. The app fails closed for login if that protection store is unavailable.
- Use Settings to rotate the generated access key and revoke other browser sessions. Save the one-time displayed key in a password manager; the current session remains active after rotation.
- Set `APP_ORIGIN` to the exact HTTPS panel origin. CORS and cookie-authenticated writes use the configured origin; add only trusted extra origins to `APP_ALLOWED_ORIGINS`.
- SSH host fingerprints are SHA-256 pinned only after user confirmation. If a host key changes, investigate first and deliberately re-pin it.
- Use a dedicated, least-privilege SSH account and keep its Linux permissions narrow; remote terminal and SFTP access inherit that account's authority.
- Use least-privilege Cloudflare tokens.
- Use a dedicated SSH key per environment where practical.
- Keep `APP_ENCRYPTION_KEY`, database credentials, and API keys outside Git.
- Keep backups root-only, encrypt off-host copies, and periodically test restore.
- Require explicit confirmation before destructive file and DNS operations.
- Review audit records when investigating account or infrastructure changes.
- Only connect servers and domains you own or are authorized to administer.

For responsible disclosure, see [SECURITY.md](SECURITY.md) or contact [company@lordeagle.co.ke](mailto:company@lordeagle.co.ke).

## Connect with Lord Eagle

- [Website](https://website.lordeagle.tech)
- [GitHub](https://github.com/lordeagle-tech)
- [WhatsApp](https://wa.me/254114879633)
- [Telegram](https://t.me/Eagle1591)
- [Instagram](https://instagram.com/eagle.254)
- [Company Support](mailto:company@lordeagle.co.ke)

## Contributing and license

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. CFDNS Manager is released under the [MIT License](LICENSE).

<div align="center">

**Research systems. Secure what matters.**

</div>
