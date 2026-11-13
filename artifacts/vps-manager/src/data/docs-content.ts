import {
  Activity,
  BookOpen,
  CloudUpload,
  FolderOpen,
  Github,
  Globe2,
  Server,
  Settings,
  ShieldCheck,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

type DocGroup = {
  title: string;
  items: string[];
  kind?: "steps" | "warning";
};

type DocLink = { label: string; href: string };
type DocSection = {
  id: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  links?: DocLink[];
  groups: DocGroup[];
};

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "start-here",
    title: "Start here",
    summary:
      "A practical path from first sign-in to safely using the main control-plane features.",
    icon: BookOpen,
    links: [
      { label: "Open Settings", href: "/settings" },
      { label: "Open Connections", href: "/connections" },
      { label: "Open DNS", href: "/dns" },
    ],
    groups: [
      {
        title: "First-use checklist",
        kind: "steps",
        items: [
          "Sign in with an allowlisted OAuth identity if OAuth is configured, or exchange the installer-provided administrator key for a browser session. Keep the key private; ordinary API calls use the session cookie, not the key as a general bearer token.",
          "Open Settings. Save any replacement administrator key when it is shown once, revoke sessions you do not recognize, and review the recent security activity.",
          "Add a least-privilege Cloudflare token for the zones you intend to manage. Cloudflare DNS and zone-security features require their own permissions.",
          "Add each other VPS under Connections. Test SSH and independently verify the first SHA-256 host fingerprint before trusting it. Only then use its Files, Terminal, Firewall, or Ports actions.",
          "Use Dashboard for host telemetry and service visibility. Check the feature-specific notes below before destructive DNS/file/repository actions, firewall changes, script execution, or deployments.",
        ],
      },
      {
        title: "Know which machine you are controlling",
        items: [
          "The panel can inspect the VPS that hosts the app and, separately, saved remote VPSs. A label such as “This VPS” means the manager host; a saved connection means that remote host.",
          "The installer does not create Cloudflare credentials or SSH credentials for other servers. Add those in the panel after installation, using credentials with only the permissions needed.",
          "Shared development Preview intentionally blocks several credential-backed or production-only operations. Use your own production installation for real Cloudflare, GitHub, SSH, firewall, and deployment actions.",
        ],
        kind: "warning",
      },
    ],
  },
  {
    id: "dashboard",
    title: "Dashboard and Developer Hub",
    summary:
      "Review the manager host, discovered services, repositories, and PM2 processes from the home screen.",
    icon: Activity,
    links: [
      { label: "Open Dashboard", href: "/" },
      { label: "Open Developer Hub", href: "/dev" },
    ],
    groups: [
      {
        title: "Dashboard overview",
        items: [
          "Host information includes CPU/load, memory, a selected disk, uptime, OS/kernel, network interfaces, mounts, and logged-in users when the host tools are available.",
          "Resource alerts are informational: CPU, memory, or selected disk at 80% is a warning and 90% is critical. Host details and PM2 list refresh periodically; refresh manually to request an update.",
          "PM2 cards show process state and resource use. Process detail provides logs, search and filtering, start/stop/restart, log clearing, rebuild-and-restart, and Git context when available.",
          "The dashboard can discover Nginx sites and nearby Git repositories and perform limited HTTP checks. These are server-side observations, not proof that a site is reachable from every network.",
          "Recent DNS activity shows selected audit fields; sensitive audit details are not displayed in that summary.",
        ],
      },
      {
        title: "Developer Hub",
        items: [
          "Developer Hub provides public GitHub profile/repository information, profile/social editing controls where configured, the VPS GitHub SSH-key setup widget, and a copyable self-hosting guide.",
          "The generated GitHub SSH private key stays on the VPS; copy only its public key to the target repository’s Deploy keys and test access. Keep it read-only unless that VPS must push to the repository.",
          "PM2 monitoring, Nginx discovery, GitHub availability, and host commands depend on the corresponding service or operating-system tools being installed and accessible to the app service account.",
        ],
      },
      {
        title: "Use process controls carefully",
        kind: "warning",
        items: [
          "Stop, Start, Restart, Flush Logs, Rebuild & Restart, Git pull, and cache-clearing controls can change a live service or working tree. Confirm the selected process/site and back up work before acting.",
          "Git pull can change tracked files; a first pull in an uncommitted repository can reset it to the remote default branch. Do not use it as a substitute for reviewing local changes.",
          "A missing telemetry card or unavailable PM2/Nginx section can mean the host tool is absent or a request failed—not that the server is healthy or empty.",
        ],
      },
    ],
  },
  {
    id: "connections",
    title: "VPS Connections and remote access",
    summary:
      "Save SSH profiles, trust host keys deliberately, and then use remote files or an interactive shell.",
    icon: Server,
    links: [{ label: "Manage Connections", href: "/connections" }],
    groups: [
      {
        title: "Add and test a VPS",
        kind: "steps",
        items: [
          "Enter a profile name, host/IP, SSH username, port (22 by default), and choose private-key or password authentication. Private keys can be uploaded or pasted; a key passphrase is supported.",
          "Test the connection. On first contact, compare the displayed SHA-256 host-key fingerprint with the VPS provider console or the fingerprint obtained directly on that VPS. Trust only a verified match.",
          "After the key is pinned, later actions fail closed if the remote host presents a different key. Investigate any change with the provider; reset and re-pin only after confirming a legitimate host-key replacement.",
          "When editing, blank secret fields keep the stored secret. If you change authentication type, provide its matching credential. Remove a profile when it is no longer needed.",
        ],
      },
      {
        title: "Remote Files and Terminal",
        items: [
          "The remote file browser uses SFTP and the saved account’s permissions. It can navigate paths, view supported text/media, create text files/folders, edit text, rename, and delete files or empty directories.",
          "Remote Terminal is an interactive SSH shell on that saved host. Commands run as the saved SSH username; the app does not add sudo automatically. If you saved a root account, its shell has root authority.",
          "Remote terminal sessions require an administrator and a pinned host key, allow up to two active sessions per administrator, and expire after two hours. Reconnect starts a new shell session.",
          "Real saved-host SSH actions are disabled in shared development Preview. Use a production installation and a trusted browser/network for real credentials and remote operations.",
        ],
        kind: "warning",
      },
    ],
  },
  {
    id: "files-terminal",
    title: "Files and the host Terminal",
    summary:
      "Manage files on the machine running the manager and open a persistent interactive Linux shell.",
    icon: FolderOpen,
    links: [
      { label: "Open Files", href: "/files" },
      { label: "Open Terminal", href: "/terminal" },
      { label: "Read Terms", href: "/terms" },
    ],
    groups: [
      {
        title: "File browser",
        items: [
          "The local Files page operates on the manager host. `/` represents the configured file-manager roots; self-host installation defaults to the app directory and `/var/www`. `FILE_MANAGER_ROOTS` can restrict/change the allowed roots.",
          "Browse folders, filter the current listing, preview supported text and media, create files/folders, edit and save text, rename, move, or delete. Text operations are limited to 5 MiB; binary or larger files are not editable as text.",
          "File API paths must stay inside configured roots; traversal and symlink targets outside those roots are rejected. Directory deletion is non-recursive. Destructive edits, overwrites, moves, and deletes have no in-app undo.",
        ],
      },
      {
        title: "Two terminal modes",
        items: [
          "The interactive Terminal page and Files split-pane terminal use a PTY-backed Bash shell. It supports normal keystrokes and terminal apps, resize, reconnect, and browser scrollback. Closing it ends the browser session; reconnect opens a new shell.",
          "The local terminal runs on the manager host as the unprivileged `cfdns` service account—not automatically as root. Its access is bounded by normal Linux permissions, but shell commands are not confined to the file-browser roots.",
          "The Files command panel is different: it runs one non-interactive command and returns output. It starts from the current browsing path, has a 30-second timeout, and blocks known full-screen terminal commands. Use the interactive PTY for terminal applications.",
          "Terminal sessions require administrator access and trusted origin/network checks, allow up to two active sessions per administrator, and expire after two hours. The service intentionally does not grant the web terminal root privileges.",
        ],
        kind: "warning",
      },
    ],
  },
  {
    id: "ports-firewall",
    title: "Ports and Firewall",
    summary:
      "See listening sockets and inspect limited UFW state on trusted saved VPSs.",
    icon: Waypoints,
    links: [
      { label: "Open Ports", href: "/ports" },
      { label: "Open Firewall", href: "/firewall" },
    ],
    groups: [
      {
        title: "Listening port inventory",
        items: [
          "Ports can scan the manager host or a saved, pinned VPS. The scan lists parseable TCP/UDP listening sockets, bind address and state, plus process/PID when visible; search and protocol filters narrow the display.",
          "The scan depends on Linux `ss`. Process details may be hidden without sufficient operating-system permissions.",
          "A listening socket is not proof of public reachability: UFW, cloud-provider firewalls, routing, and upstream network controls may still block traffic. The page does not configure provider firewalls.",
        ],
      },
      {
        title: "UFW controls",
        items: [
          "Firewall Control is limited to UFW status/rules on saved, fingerprint-pinned SSH hosts. It can add one inbound allow rule for a selected TCP or UDP port after exact typed confirmation.",
          "It will not enable UFW, change default policies, remove rules, or manage the manager’s own host firewall. UFW must already be active; a remote account may need narrowly scoped noninteractive sudo for the supported commands.",
          "Before changing firewall access, confirm SSH and required web ports remain permitted. A bad rule can lock you out; keep provider-console recovery available.",
        ],
        kind: "warning",
      },
      {
        title: "DDoS boundary",
        items: [
          "Host UFW cannot absorb volumetric traffic that has already reached the VPS. Use the VPS/cloud provider’s edge protection and firewall for upstream attacks.",
          "This product does not detect attacks or provide network scrubbing. Cloudflare Under Attack Mode is a separate Layer 7 browser challenge; see DNS and zone protection.",
        ],
      },
    ],
  },
  {
    id: "dns",
    title: "Cloudflare DNS and zone protection",
    summary:
      "Manage supported Cloudflare records, review changes, diagnose common issues, and optionally use Under Attack Mode.",
    icon: Globe2,
    links: [{ label: "Open DNS", href: "/dns" }],
    groups: [
      {
        title: "Records and bulk imports",
        items: [
          "Connect a scoped Cloudflare API token, verify it, and sync the zones visible to that credential. The installer does not create Cloudflare tokens.",
          "The UI supports A, AAAA, CNAME, TXT, MX, and NS record operations. Proxying is available only for A/AAAA/CNAME. DNS edits take effect at Cloudflare; review before saving or deleting.",
          "CSV and common BIND data can be exported or imported. Import creates or updates records only; it does not delete. Review the signed preview and warnings before applying. Apex SOA and authoritative apex NS are provider/registrar managed and are not imported.",
          "History stores before/after snapshots. Rollback is guarded: it checks live state and refuses when the record changed or conflicts exist; it is not an unconditional undo.",
        ],
      },
      {
        title: "Diagnostics",
        items: [
          "The health checker reports implemented heuristics such as missing apex address/alias, private or loopback targets, CNAME conflicts, and invalid/duplicate MX priorities. It is not a complete DNSSEC or email-deliverability audit.",
          "Propagation checks query Google Public DNS and Cloudflare DNS-over-HTTPS. They show those resolvers’ current answers, not global propagation or every network’s cache state.",
          "Token permissions depend on the action: DNS edits need Zone → DNS (Edit) and Zone → Zone (Read); Under Attack Mode status needs Zone → Zone Settings (Read), while changing the security level needs Zone → Zone Settings (Edit).",
        ],
      },
      {
        title: "Under Attack Mode — read before enabling",
        kind: "warning",
        items: [
          "The control changes Cloudflare’s security level to `under_attack` (or offers to restore a recorded previous level) after exact zone-name confirmation. Use only during an active Layer 7 attack, then restore the previous level.",
          "This is a temporary browser challenge, not firewall control, attack detection, or DDoS scrubbing. It can disrupt APIs, bots, analytics, and legitimate visitors. Cloudflare’s network-level DDoS mitigation operates independently.",
          "If previous audit state is unavailable, restoration defaults to `medium`. Check Cloudflare’s dashboard and incident information as the authoritative source.",
        ],
      },
    ],
  },
  {
    id: "github",
    title: "GitHub Control and Deploy Script",
    summary:
      "Manage repositories through a saved GitHub token and run a reviewed script on a trusted VPS when explicitly confirmed.",
    icon: Github,
    links: [
      { label: "GitHub Control", href: "/github-control" },
      { label: "Deploy Script", href: "/deploy-script" },
    ],
    groups: [
      {
        title: "GitHub Control",
        items: [
          "Connect your GitHub account with a classic personal access token. The project expects `repo` and `delete_repo` scopes; the API validates the token and stores an encrypted copy per administrator rather than returning it to the browser.",
          "Browse owned repositories, branches, files, and settings. Create repositories (private by default), update repository settings, or commit UTF-8 text-file changes to a selected branch.",
          "Visibility changes can expose a repository or remove access. Repository deletion is permanent from this panel and requires typing its exact name. Disconnecting removes the app’s saved token; it does not revoke the token at GitHub.",
          "Keep `APP_ENCRYPTION_KEY` backed up with the database. Losing the encryption key can make stored tokens and other saved credentials unreadable.",
        ],
      },
      {
        title: "Deploy Script workflow",
        kind: "steps",
        items: [
          "Choose a saved, pinned VPS, repository, branch/ref, and `.sh` file. Open Review and inspect every line, target, GitHub blob SHA, SHA-256, and file size.",
          "The server fetches the file again before running and rejects a changed GitHub version/checksum. Confirm the exact target using the required typed phrase and server ID.",
          "The script is staged in a private temporary directory and run on the VPS as the saved SSH username. There is no automatic sudo and no credentials are passed to the script by default. Inspect the returned exit status and bounded output.",
        ],
      },
      {
        title: "Execution risks",
        kind: "warning",
        items: [
          "Reading the script is essential: it can still install software, change files, alter DNS through its own credentials, or make irreversible changes. A checksum confirms identity, not safety.",
          "If the saved SSH username is root, the script runs as root. Prefer a least-privilege account and test on a non-production VPS first.",
          "Script deployment is production-only and disabled in shared Preview/development. It has a ten-minute run limit and depends on GitHub availability, token setup, SSH access, and a pinned host key.",
        ],
      },
    ],
  },
  {
    id: "self-hosting",
    title: "Self-hosting, updates, and recovery",
    summary:
      "Understand the installer, optional GitHub Actions deployment, health-check rollback, and root-only backups.",
    icon: CloudUpload,
    links: [
      {
        label: "GitHub Actions workflow",
        href: "https://github.com/lordeagle-tech/lord-eagle-cfdns-vps/blob/main/.github/workflows/ci-deploy.yml",
      },
      {
        label: "README and full setup guide",
        href: "https://github.com/lordeagle-tech/lord-eagle-cfdns-vps#readme",
      },
    ],
    groups: [
      {
        title: "Fresh VPS installation",
        kind: "steps",
        items: [
          "The automated bootstrap supports a clean Ubuntu/Debian VPS. Point the site’s A/AAAA DNS record at the host, allow inbound TCP 80/443, clone the repository, and run `sudo bash scripts/install-self-hosted.sh` interactively.",
          "The installer provisions required packages, Node.js/pnpm, MariaDB, Nginx and TLS; creates the unprivileged `cfdns` service; and stores the first login key in `/root/cfdns-manager-credentials.txt` with root-only permissions. Save the key securely, then remove that file.",
          "The bootstrap does not create Cloudflare tokens or other VPS credentials. Add those later through the panel with least-privilege access. Do not expose the API listener on port 3000 publicly.",
        ],
      },
      {
        title: "Optional GitHub automatic deployment",
        kind: "steps",
        items: [
          "First enable the root-owned updater on the VPS. Create a dedicated non-root SSH deploy user; authorize the Actions public key; from a project checkout run `sudo bash scripts/enable-auto-deploy.sh <deploy-user>`. Do not use root or the `cfdns` service account as the SSH login.",
          "Add repository Actions secrets: `CFDNS_DEPLOY_HOST`, `CFDNS_DEPLOY_USER`, `CFDNS_DEPLOY_SSH_KEY`, and `CFDNS_DEPLOY_HOST_FINGERPRINT`. `CFDNS_DEPLOY_PORT` is optional and defaults to 22. Never put the private key in Git or chat.",
          "Pushes to `main` run validation/typechecks/builds; pull requests validate but do not deploy. With all required secrets and VPS setup present, a successful main-branch workflow deploys that commit after checking the pinned SSH host fingerprint. Missing secrets cause deployment to be skipped.",
          "The updater builds as `cfdns`, backs up data/secrets, creates an independent root-only code rollback copy, installs the release, restarts the service, and checks `/api/healthz`. It needs free disk space roughly equal to the current app plus reserve space.",
        ],
      },
      {
        title: "Backups, restore, and schema changes",
        kind: "warning",
        items: [
          "Run `sudo bash scripts/backup-self-hosted.sh` as root to create a database/secrets backup under `/var/backups/cfdns-manager`. Archives can contain API/encryption keys and GitHub SSH private keys; keep encrypted copies off-host.",
          "Restore is interactive and replaces database/configuration state. Use `sudo bash scripts/restore-self-hosted.sh <backup-timestamp>`, verify the checksum set, and type `RESTORE` only when you intend to replace that state. Test recovery on a non-production copy.",
          "Automatic deployment does not run database migrations or schema pushes, and health-check rollback restores application code—not an incompatible database. Review schema changes as a separate operation and make/verify backups first.",
        ],
      },
    ],
  },
  {
    id: "security",
    title: "Security model and administrator responsibilities",
    summary:
      "This is an infrastructure control plane. Keep admin access, session credentials, provider tokens, and SSH permissions tightly scoped.",
    icon: ShieldCheck,
    links: [
      { label: "Open Settings", href: "/settings" },
      {
        label: "Security policy",
        href: "https://github.com/lordeagle-tech/lord-eagle-cfdns-vps/blob/main/SECURITY.md",
      },
    ],
    groups: [
      {
        title: "Authentication and data protection",
        items: [
          "Protected API features require an authorized administrator session. OAuth identities must be explicitly allowlisted when OAuth is used. The installer key is exchanged for a browser session; ordinary API routes do not accept it as a general Bearer credential.",
          "Browser sessions are stored server-side and use HttpOnly/Secure cookies. Sign-in is rate-limited using shared MariaDB state; if that limiter is unavailable, login fails closed. Browser-origin validation protects cookie-authenticated writes.",
          "Provider credentials are encrypted at rest using the configured application encryption key. Back up that key securely with the database; rotating/loss of the effective key without a migration/backup plan can make saved credentials unreadable.",
          "Settings lets administrators rotate the access key, revoke other sessions while keeping the current session, and inspect recent security activity. A replacement key is shown once; the masked key cannot be recovered later.",
          "Optional `ADMIN_IP_ALLOWLIST` restricts login to exact client IPs when configured; an empty setting disables that restriction. Confirm trusted proxy/client-IP handling before enabling it to avoid lockout.",
        ],
      },
      {
        title: "Safe operating habits",
        kind: "warning",
        items: [
          "Use HTTPS, unique strong administrator credentials, least-privilege Cloudflare tokens and SSH accounts, and a trusted browser/network. Do not use shared Preview for real credentials.",
          "Verify SSH host fingerprints through an independent channel. Review live DNS diffs, GitHub branch/repository, script contents, server target, and firewall confirmation before applying changes.",
          "Back up before destructive actions. Audit logs provide useful activity history, but they are not a complete forensic record and do not replace host/provider logs.",
          "Local shell and file actions run with the operating-system permissions of the app service account. Limit administrators to trusted people; the file browser root setting does not confine shell commands.",
        ],
      },
    ],
  },
  {
    id: "boundaries-help",
    title: "Limits and troubleshooting",
    summary:
      "Quick checks for common failures and a clear map of what the application does not control.",
    icon: Settings,
    groups: [
      {
        title: "What the panel does not do",
        kind: "warning",
        items: [
          "It does not detect attacks, provide upstream DDoS scrubbing, manage registrar/domain registration, or configure a cloud provider’s network firewall.",
          "It does not run unreviewed GitHub scripts, automatically pass stored secrets into those scripts, or add sudo to remote commands.",
          "GitHub auto-deploy does not start just because the repository changed: the VPS updater, dedicated SSH user/key, fingerprint, and required Actions secrets must all be configured first.",
          "A successful build, deployment workflow, health check, DNS resolver query, or socket scan is evidence only for that check; it does not prove every route, network, or dependent service is healthy.",
        ],
      },
      {
        title: "Troubleshooting checklist",
        items: [
          "OAuth sign-in unavailable: verify the OAuth portal/API/project configuration and administrator allowlist. Login rate-limit 503 can indicate unavailable MariaDB limiter state; blocked attempts provide `Retry-After`.",
          "Dashboard data missing: confirm required host tools, PM2, Nginx configuration, host permissions, and network/API availability. The page may suppress some telemetry errors.",
          "SSH fails: check production mode, SSH enablement, host/port, username/credential, reachability, encryption-key availability, and SFTP support. On fingerprint mismatch, verify with the provider before resetting the pin.",
          "Firewall actions fail: confirm the saved fingerprint, active UFW, exact confirmation phrase, and narrowly scoped noninteractive sudo. The panel will not activate UFW for you.",
          "DNS operations fail: verify the token, zone scope, record type/input limits, required Cloudflare permission, and preview expiry. Imports can partially fail; read the applied/failed counts.",
          "GitHub script deployment fails: verify production mode, per-admin encrypted GitHub token, reviewed `.sh` file, unchanged blob/checksum, pinned host key, target confirmation, and timeout.",
          "Automatic deployment is skipped: check all four required Actions secrets, workflow status, VPS deploy-user setup, branch `main`, and host fingerprint. After restore/deploy, separately verify health and your saved SSH/DNS access.",
        ],
      },
    ],
  },
];
