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
- Audit destructive DNS actions.

### VPS operations

- Add and manage Linux servers over SSH/SFTP.
- Inspect CPU, memory, disks, network interfaces, uptime, and logged-in users.
- Browse, read, write, rename, move, and delete remote files.
- Use an in-browser terminal with a persistent working directory.
- Monitor and control PM2 processes.
- Inspect deployed sites, SSL status, Git branches, and deployment paths.
- Pull a deployed Git working tree from the dashboard.

### Public-service foundations

- Cookie-backed Manus OAuth sessions with a clearly labeled local API-key fallback.
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

- Use least-privilege Cloudflare tokens.
- Use a dedicated SSH key per environment where practical.
- Keep `APP_ENCRYPTION_KEY`, database credentials, and API keys outside Git.
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
