# Security Policy

## Supported Versions

Only the latest release of CFDNS MANAGER receives security fixes.

| Version | Supported |
|---|---|
| latest (`main`) | Yes |
| older tags | No |

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

If you discover a security issue, please report it through one of the following channels:

1. **Company Support**: [company@lordeagle.co.ke](mailto:company@lordeagle.co.ke)
2. **Company Support** (for urgent issues): [company@lordeagle.co.ke](mailto:company@lordeagle.co.ke)

Include the following in your report:

- A clear description of the vulnerability
- Steps to reproduce (proof-of-concept if available)
- The potential impact and affected versions
- Any suggested mitigations

---

## Response Timeline

| Stage | Target |
|---|---|
| Acknowledgement | Within 48 hours |
| Initial assessment | Within 5 business days |
| Fix or workaround | Within 14 days for critical issues |
| Public disclosure | Coordinated with reporter after fix is released |

---

## Scope

The following are **in scope** for responsible disclosure:

- Authentication bypass or API key leakage
- Remote code execution or privilege escalation
- Path traversal beyond intended filesystem access
- Cross-site scripting (XSS) in the file viewer or terminal output
- Denial-of-service vulnerabilities

The following are **out of scope**:

- Attacks that require physical access to the host
- Social engineering
- Issues in third-party dependencies that have upstream fixes available
- Self-hosted deployments where the user has misconfigured their own environment (e.g. binding to `0.0.0.0` without a firewall)

---

## Disclosure Policy

We follow a coordinated disclosure model. We ask that you:

1. Give us a reasonable time to investigate and patch the issue before public disclosure.
2. Avoid exploiting the vulnerability or accessing data beyond what is necessary to demonstrate it.
3. Not disclose the vulnerability to others until a fix has been released.

We will publicly acknowledge your contribution in the release notes (unless you prefer to remain anonymous).

---

## Security Design Notes

- CFDNS MANAGER is designed to run on a **trusted private network** or behind a reverse proxy with TLS.
- The `API_KEY` should be treated as a secret — use an environment variable or secrets manager, never hard-code it.
- The terminal panel (`POST /api/terminal/exec`) executes commands as the user running the Node.js process. Restrict access accordingly.
