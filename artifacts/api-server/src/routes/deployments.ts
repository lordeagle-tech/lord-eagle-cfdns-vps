import { Router, type Request } from "express";
import https from "node:https";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { decryptSecret } from "../security/crypto";
import { audit } from "../security/audit";
import { getServerById, withSshClient, getSftp, sftpWriteFile, execCommand, type ServerRecord } from "../lib/ssh";
import { logger } from "../lib/logger";

const router = Router();
const MAX_SCRIPT_BYTES = 750_000;
const MAX_REPO_ARCHIVE_BYTES = 200_000_000;
const MAX_RUN_MS = 10 * 60 * 1000;
const MAX_INSTALL_MS = 45 * 60 * 1000;
const PROJECT_OWNER = "lordeagle-tech";
const PROJECT_REPO = "lord-eagle-cfdns-vps";
const PROJECT_INSTALLER_PATH = "scripts/install-self-hosted.sh";
const PROJECT_INSTALLER_BRANCH = "main";
const INSTALL_JOB_RETENTION_MS = 60 * 60 * 1000;
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

interface ProjectInstallResult {
  ok: boolean;
  server: { id: number; name: string; host: string; username: string };
  source: { owner: string; repo: string; path: string; ref: string; sha256: string };
  exitCode: number;
  stdout: string;
  stderr: string;
  durationLimitMs: number;
}

interface ProjectInstallJob {
  id: string;
  ownerId: number;
  serverId: number;
  createdAt: number;
  status: "running" | "completed" | "failed";
  step: "verifying-source" | "downloading-source" | "connecting-to-vps" | "running-installer";
  result?: ProjectInstallResult;
  error?: string;
}

const projectInstallJobs = new Map<string, ProjectInstallJob>();
const activeProjectInstallations = new Set<number>();

function pruneProjectInstallJobs(now = Date.now()): void {
  for (const [id, job] of projectInstallJobs) {
    if (job.status !== "running" && now - job.createdAt > INSTALL_JOB_RETENTION_MS) projectInstallJobs.delete(id);
  }
}

function validRepoPart(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && value !== "." && value !== "..";
}
function validFilePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1000 && !value.startsWith("/") && !value.includes("\\") && !/[\x00-\x1f\x7f]/.test(value) && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
function validInstallerDomain(value: unknown): value is string {
  return typeof value === "string" && value.length <= 253 && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(value);
}
function validInstallerEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function quoteShell(value: string): string { return `'${value.replace(/'/g, "'\\''")}'`; }
function equalHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, "hex"); const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function githubRequest(token: string, path: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: "api.github.com", path, method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "cfdns-manager-lord-eagle/1.0" },
    }, (response) => {
      let raw = "";
      response.on("data", (chunk: Buffer) => { raw += chunk.toString(); if (raw.length > 2_000_000) request.destroy(new Error("GitHub response too large")); });
      response.on("end", () => { try { resolve({ status: response.statusCode ?? 500, data: raw ? JSON.parse(raw) : {} }); } catch { reject(new Error("Invalid GitHub response")); } });
    });
    request.setTimeout(15_000, () => request.destroy(new Error("GitHub request timed out")));
    request.on("error", reject);
    request.end();
  });
}

function githubArchiveRequest(token: string, owner: string, repo: string, ref: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const requestUrl = (url: string, redirectsLeft: number) => {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || (parsed.hostname !== "api.github.com" && parsed.hostname !== "codeload.github.com")) {
        reject(new Error("GitHub returned an unexpected archive host")); return;
      }
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cfdns-manager-lord-eagle/1.0",
      };
      if (parsed.hostname === "api.github.com") headers.Authorization = `Bearer ${token}`;
      const request = https.get({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        headers,
      }, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          if (redirectsLeft <= 0) { reject(new Error("Too many GitHub archive redirects")); return; }
          requestUrl(new URL(response.headers.location, url).toString(), redirectsLeft - 1);
          response.resume();
          return;
        }
        if (response.statusCode !== 200) { reject(new Error(`GitHub repository archive request failed (${response.statusCode ?? 500})`)); response.resume(); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_REPO_ARCHIVE_BYTES) { request.destroy(new Error("Repository archive exceeds 200 MB")); return; }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
      });
      request.setTimeout(30_000, () => request.destroy(new Error("GitHub repository archive timed out")));
      request.on("error", reject);
    };
    requestUrl(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${encodeURIComponent(ref)}`, 3);
  });
}

async function getStoredGithubToken(ownerId: number): Promise<string | null> {
  const [rows] = await pool.query<any[]>("SELECT token_encrypted AS tokenEncrypted FROM github_account_connections WHERE owner_id=? LIMIT 1", [ownerId]);
  return rows[0]?.tokenEncrypted ? decryptSecret(String(rows[0].tokenEncrypted)) : null;
}

async function getProjectInstaller(token: string, ref: string): Promise<{ content: string; blobSha: string; digest: string }> {
  const apiPath = `/repos/${PROJECT_OWNER}/${PROJECT_REPO}/contents/${PROJECT_INSTALLER_PATH}?ref=${encodeURIComponent(ref)}`;
  const result = await githubRequest(token, apiPath);
  if (result.status !== 200 || result.data?.type !== "file" || result.data?.encoding !== "base64" || typeof result.data?.content !== "string") {
    throw new Error("Could not load the fixed project installer from GitHub");
  }
  if (typeof result.data.sha !== "string" || !/^[a-f0-9]{40}$/i.test(result.data.sha)) {
    throw new Error("GitHub returned an invalid installer version");
  }
  const bytes = Buffer.from(result.data.content.replace(/\s/g, ""), "base64");
  if (bytes.length === 0 || bytes.length > MAX_SCRIPT_BYTES) throw new Error("Project installer must be between 1 byte and 750 KB");
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("Project installer is not valid UTF-8"); }
  if (content.includes("\u0000")) throw new Error("Project installer contains binary data");
  return { content, blobSha: result.data.sha, digest: createHash("sha256").update(bytes).digest("hex") };
}

async function getReviewedScript(ownerId: number, owner: string, repo: string, filePath: string, ref: string, expectedBlobSha: string, expectedDigest: string): Promise<{ content: string; digest: string }> {
  const token = await getStoredGithubToken(ownerId);
  if (!token) throw new Error("Connect an encrypted GitHub account in GitHub Control before deploying scripts");
  const profile = await githubRequest(token, "/user");
  if (profile.status !== 200 || typeof profile.data?.login !== "string" || profile.data.login.toLowerCase() !== owner.toLowerCase()) throw new Error("The selected repository owner does not match your connected GitHub account");
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const apiPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
  const result = await githubRequest(token, apiPath);
  if (result.status !== 200 || result.data?.type !== "file" || result.data?.encoding !== "base64" || typeof result.data?.content !== "string") throw new Error("GitHub could not return this file as an editable UTF-8 text file");
  if (typeof result.data.sha !== "string" || result.data.sha !== expectedBlobSha) throw new Error("The GitHub file changed after review. Reload and review it again before deploying.");
  const bytes = Buffer.from(result.data.content.replace(/\s/g, ""), "base64");
  if (bytes.length === 0 || bytes.length > MAX_SCRIPT_BYTES) throw new Error("Script must be between 1 byte and 750 KB");
  let content: string;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error("Only valid UTF-8 scripts can be deployed"); }
  if (content.includes("\u0000")) throw new Error("Binary files cannot be deployed as scripts");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (!equalHex(digest, expectedDigest)) throw new Error("Script checksum did not match the reviewed version. Review it again before deploying.");
  return { content, digest };
}

async function executeProjectInstall(
  job: ProjectInstallJob,
  req: Request,
  server: ServerRecord,
  domain: string,
  email: string,
  ref: string,
  blobSha: string,
  expectedDigest: string,
): Promise<void> {
  const target = {
    serverId: server.id,
    serverName: server.name,
    host: server.host,
    username: server.username,
    domain,
    repoOwner: PROJECT_OWNER,
    repo: PROJECT_REPO,
    filePath: PROJECT_INSTALLER_PATH,
    ref,
  };
  try {
    job.step = "verifying-source";
    const token = await getStoredGithubToken(job.ownerId);
    if (!token) throw new Error("Connect an encrypted GitHub account in GitHub Control first");
    const installer = await getProjectInstaller(token, ref);
    if (installer.blobSha !== blobSha) throw new Error("The project installer changed after review. Review it again before installing.");
    if (!equalHex(installer.digest, expectedDigest)) throw new Error("Project installer checksum did not match the reviewed version. Review it again before installing.");

    job.step = "downloading-source";
    const archive = await githubArchiveRequest(token, PROJECT_OWNER, PROJECT_REPO, ref);
    const runId = randomUUID();
    job.step = "connecting-to-vps";
    const result = await withSshClient(server, async (client) => {
      const stage = await execCommand(client, `umask 077; install -d -m 0700 -- "$HOME/.cache" && mktemp -d "$HOME/.cache/cfdns-install.XXXXXXXX"`);
      const stageDirectory = stage.stdout.trim();
      if (stage.exitCode !== 0 || !/^\/[A-Za-z0-9._/-]+$/.test(stageDirectory) || stageDirectory.includes("/../")) {
        throw new Error("Could not create a private installer staging directory on the VPS");
      }
      const archivePath = `${stageDirectory}/project-${runId}.tar.gz`;
      try {
        const sftp = await getSftp(client);
        await sftpWriteFile(sftp, archivePath, archive);
        const repoPath = `${stageDirectory}/repository`;
        const installerPath = `${repoPath}/${PROJECT_INSTALLER_PATH}`;
        const installerCommand = [
          `mkdir -m 0700 -- ${quoteShell(repoPath)}`,
          `tar --no-same-owner --no-same-permissions -xzf ${quoteShell(archivePath)} -C ${quoteShell(repoPath)} --strip-components=1`,
          `test -f ${quoteShell(`${repoPath}/package.json`)}`,
          `test -f ${quoteShell(`${repoPath}/pnpm-lock.yaml`)}`,
          `test -f ${quoteShell(installerPath)}`,
          `test "$(sha256sum -- ${quoteShell(installerPath)} | awk '{print $1}')" = ${quoteShell(installer.digest)}`,
          `cd ${quoteShell(repoPath)} && CFDNS_DOMAIN=${quoteShell(domain)} ACME_EMAIL=${quoteShell(email)} bash --noprofile --norc ${quoteShell(PROJECT_INSTALLER_PATH)}`,
        ].join(" && ");
        job.step = "running-installer";
        return await execCommand(
          client,
          `timeout --signal=TERM --kill-after=10s ${Math.floor(MAX_INSTALL_MS / 1000)}s bash -c ${quoteShell(installerCommand)}`,
          MAX_INSTALL_MS + 15_000,
          { continueOnOutputLimit: true },
        );
      } finally {
        await execCommand(client, `rm -rf -- ${quoteShell(stageDirectory)}`, 15_000).catch(() => undefined);
      }
    });
    const status = result.exitCode === 0 ? "success" : "failed";
    const projectResult: ProjectInstallResult = {
      ok: result.exitCode === 0,
      server: { id: server.id, name: server.name, host: server.host, username: server.username },
      source: { owner: PROJECT_OWNER, repo: PROJECT_REPO, path: PROJECT_INSTALLER_PATH, ref, sha256: installer.digest },
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationLimitMs: MAX_INSTALL_MS,
    };
    await audit(req, "deployment.project_install.run", "server", server.id, status, {
      ...target, sha256: installer.digest, exitCode: result.exitCode, timedOut: result.exitCode === 124,
    }).catch(() => undefined);
    job.result = projectResult;
    job.status = "completed";
  } catch (error) {
    logger.warn({ err: error, serverId: server.id, domain }, "Project installation failed");
    const message = error instanceof Error && /changed after review|checksum|Connect an encrypted|installer changed|installer checksum|valid UTF-8|binary data/.test(error.message)
      ? error.message
      : "Could not stage or start the project installer on the VPS";
    await audit(req, "deployment.project_install.run", "server", server.id, "failed", { ...target, sha256: expectedDigest }).catch(() => undefined);
    job.error = message;
    job.status = "failed";
  } finally {
    activeProjectInstallations.delete(server.id);
  }
}

router.get("/deployments/project-installer", async (req, res) => {
  const ownerId = Number(req.user?.id ?? 0);
  try {
    const token = await getStoredGithubToken(ownerId);
    if (!token) { res.status(409).json({ error: "Connect an encrypted GitHub account in GitHub Control first" }); return; }
    const head = await githubRequest(token, `/repos/${PROJECT_OWNER}/${PROJECT_REPO}/commits/${PROJECT_INSTALLER_BRANCH}`);
    const ref = head.data?.sha;
    if (head.status !== 200 || typeof ref !== "string" || !/^[a-f0-9]{40}$/i.test(ref)) {
      res.status(502).json({ error: "Could not resolve the project installer version from GitHub" }); return;
    }
    const installer = await getProjectInstaller(token, ref);
    res.json({
      owner: PROJECT_OWNER,
      repo: PROJECT_REPO,
      path: PROJECT_INSTALLER_PATH,
      ref,
      blobSha: installer.blobSha,
      sha256: installer.digest,
      size: Buffer.byteLength(installer.content, "utf8"),
      content: installer.content,
    });
  } catch (error) {
    logger.warn({ err: error }, "Could not review the fixed project installer");
    res.status(502).json({ error: error instanceof Error ? error.message : "Could not review the project installer" });
  }
});

router.post("/deployments/run-script", async (req, res) => {
  if (process.env.NODE_ENV !== "production") { res.status(403).json({ error: "Remote script execution is disabled in shared Preview and development" }); return; }
  const ownerId = Number(req.user?.id ?? 0);
  const serverId = Number(req.body?.serverId);
  const repoOwner = req.body?.repoOwner;
  const repo = req.body?.repo;
  const filePath = req.body?.filePath;
  const ref = req.body?.ref;
  const blobSha = req.body?.blobSha;
  const expectedDigest = req.body?.sha256;
  const typedConfirmation = req.body?.confirmation;
  if (!Number.isSafeInteger(serverId) || serverId <= 0 || !validRepoPart(repoOwner) || !validRepoPart(repo) || !validFilePath(filePath) || !filePath.toLowerCase().endsWith(".sh") || typeof ref !== "string" || !ref.trim() || ref.length > 255 || /[\x00-\x1f\x7f]/.test(ref) || typeof blobSha !== "string" || !/^[a-f0-9]{40}$/i.test(blobSha) || typeof expectedDigest !== "string" || !/^[a-f0-9]{64}$/i.test(expectedDigest)) {
    res.status(400).json({ error: "Choose a valid saved VPS, GitHub repository, branch, shell-script file, and reviewed checksum" }); return;
  }
  if (typedConfirmation !== `DEPLOY ${serverId}`) { res.status(400).json({ error: `Type DEPLOY ${serverId} exactly to confirm the target VPS` }); return; }

  const server = await getServerById(serverId, ownerId);
  if (!server) { res.status(404).json({ error: "Saved VPS connection was not found" }); return; }
  if (!server.hostFingerprint) { res.status(409).json({ error: "Verify and trust this VPS SSH host fingerprint before deployment" }); return; }

  const target = { serverId, serverName: server.name, host: server.host, username: server.username, repoOwner, repo, filePath, ref };
  await audit(req, "deployment.script.start", "server", serverId, "success", { ...target, sha256: expectedDigest }).catch(() => undefined);
  try {
    const { digest } = await getReviewedScript(ownerId, repoOwner, repo, filePath, ref, blobSha, expectedDigest);
    const token = await getStoredGithubToken(ownerId);
    if (!token) throw new Error("Connect an encrypted GitHub account in GitHub Control before deploying scripts");
    const archive = await githubArchiveRequest(token, repoOwner, repo, ref);
    const runId = randomUUID();
    const result = await withSshClient(server, async (client) => {
      const stage = await execCommand(client, `umask 077; mkdir -p -- "$HOME/.cache" && mktemp -d "$HOME/.cache/cfdns-deploy.XXXXXXXX"`);
      const stageDirectory = stage.stdout.trim();
      if (stage.exitCode !== 0 || !/^\/[A-Za-z0-9._/-]+$/.test(stageDirectory) || stageDirectory.includes("/../")) throw new Error("Could not create a private script staging directory on the VPS");
      const archivePath = `${stageDirectory}/repo-${runId}.tar.gz`;
      try {
        const sftp = await getSftp(client);
        await sftpWriteFile(sftp, archivePath, archive);
        const repoPath = `${stageDirectory}/repository`;
        const scriptPath = `${repoPath}/${filePath}`;
        const command = [
          `mkdir -m 0700 -- ${quoteShell(repoPath)}`,
          `tar -xzf ${quoteShell(archivePath)} -C ${quoteShell(repoPath)} --strip-components=1`,
          `test -f ${quoteShell(scriptPath)}`,
          `test "$(sha256sum -- ${quoteShell(scriptPath)} | awk '{print $1}')" = ${quoteShell(digest)}`,
          `cd ${quoteShell(repoPath)} && timeout --signal=TERM --kill-after=5s 600s bash --noprofile --norc ${quoteShell(scriptPath)}`,
        ].join(" && ");
        return await execCommand(client, command, MAX_RUN_MS + 15_000);
      } finally {
        await execCommand(client, `rm -rf -- ${quoteShell(stageDirectory)}`, 15_000).catch(() => undefined);
      }
    });
    const status = result.exitCode === 0 ? "success" : "failed";
    await audit(req, "deployment.script.run", "server", serverId, status, { ...target, sha256: digest, exitCode: result.exitCode, timedOut: result.exitCode === 124 }).catch(() => undefined);
    res.json({ ok: result.exitCode === 0, server: { id: serverId, name: server.name, host: server.host, username: server.username }, source: { owner: repoOwner, repo, path: filePath, ref, sha256: digest }, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationLimitMs: MAX_RUN_MS });
  } catch (error) {
    logger.warn({ err: error, serverId, repoOwner, repo, filePath }, "GitHub script deployment failed");
    await audit(req, "deployment.script.run", "server", serverId, "failed", { ...target, sha256: expectedDigest }).catch(() => undefined);
    const message = error instanceof Error && /changed after review|checksum|Connect an encrypted|must be between|valid UTF-8|Binary files|Verify and trust/.test(error.message) ? error.message : "Could not deploy or run this script on the VPS";
    res.status(502).json({ error: message });
  }
});

router.get("/deployments/project-install/:jobId", (req, res) => {
  pruneProjectInstallJobs();
  const jobId = req.params.jobId;
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) { res.status(400).json({ error: "Invalid installation job ID" }); return; }
  const job = projectInstallJobs.get(jobId);
  if (!job || job.ownerId !== Number(req.user?.id ?? 0)) { res.status(404).json({ error: "Installation job was not found" }); return; }
  if (job.status === "running") { res.json({ status: job.status, step: job.step }); return; }
  if (job.status === "failed") { res.json({ status: job.status, error: job.error ?? "Installation failed" }); return; }
  res.json({ status: job.status, result: job.result });
});

router.post("/deployments/install-project", async (req, res) => {
  if (process.env.NODE_ENV !== "production") { res.status(403).json({ error: "Remote installation is disabled in shared Preview and development" }); return; }
  const ownerId = Number(req.user?.id ?? 0);
  const serverId = Number(req.body?.serverId);
  const domain = req.body?.domain;
  const email = req.body?.email;
  const ref = req.body?.ref;
  const blobSha = req.body?.blobSha;
  const expectedDigest = req.body?.sha256;
  if (!Number.isSafeInteger(serverId) || serverId <= 0 ||
      !validInstallerDomain(domain) || !validInstallerEmail(email) ||
      typeof ref !== "string" || !/^[a-f0-9]{40}$/i.test(ref) ||
      typeof blobSha !== "string" || !/^[a-f0-9]{40}$/i.test(blobSha) ||
      typeof expectedDigest !== "string" || !/^[a-f0-9]{64}$/i.test(expectedDigest) ||
      req.body?.acknowledged !== true) {
    res.status(400).json({ error: "Provide a valid root VPS, domain, TLS email, reviewed installer version, and explicit acknowledgement" }); return;
  }
  if (req.body?.confirmation !== `INSTALL ${serverId}`) {
    res.status(400).json({ error: `Type INSTALL ${serverId} exactly to confirm the target VPS` }); return;
  }

  const server = await getServerById(serverId, ownerId);
  if (!server) { res.status(404).json({ error: "Saved VPS connection was not found" }); return; }
  if (server.username !== "root") { res.status(409).json({ error: "The project installer requires a saved root SSH connection; it will not elevate a non-root account" }); return; }
  if (!server.hostFingerprint) { res.status(409).json({ error: "Verify and trust this VPS SSH host fingerprint before installation" }); return; }
  pruneProjectInstallJobs();
  if (projectInstallJobs.size >= 100) { res.status(503).json({ error: "Too many recent installation jobs; wait and retry later" }); return; }
  if (activeProjectInstallations.has(serverId)) { res.status(409).json({ error: "An installation is already running on this VPS" }); return; }

  const job: ProjectInstallJob = {
    id: randomUUID(),
    ownerId,
    serverId,
    createdAt: Date.now(),
    status: "running",
    step: "verifying-source",
  };
  activeProjectInstallations.add(serverId);
  projectInstallJobs.set(job.id, job);
  await audit(req, "deployment.project_install.start", "server", serverId, "success", {
    serverName: server.name, host: server.host, username: server.username, domain,
    repoOwner: PROJECT_OWNER, repo: PROJECT_REPO, filePath: PROJECT_INSTALLER_PATH, ref, sha256: expectedDigest,
  }).catch(() => undefined);
  void executeProjectInstall(job, req, server, domain, email, ref, blobSha, expectedDigest);
  res.status(202).json({ jobId: job.id });
});

export default router;
