import { Router, type Request } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { audit } from "../security/audit";

const router = Router();
const KEY_TYPE = "github_ed25519";
const OUTPUT_LIMIT = 1600;
const TEST_WINDOW_MS = 60_000;
const TEST_LIMIT = 8;
const TEST_STATUS_TTL_MS = 10 * 60_000;
const testBuckets = new Map<number, { count: number; resetAt: number }>();
const lastTestByOwner = new Map<number, {
  connected: boolean;
  tested: boolean;
  authUser: string | null;
  sshTestOutput: string;
  repo: string | null;
  repoAccessible: boolean | null;
  repoTestOutput: string | null;
  checkedAt: number;
}>();

type ExecResult = { code: number; stdout: string; stderr: string };

function execFileResult(file: string, args: string[], timeout: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 256 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const code = error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === "number"
        ? Number((error as NodeJS.ErrnoException & { code?: number }).code)
        : error ? 1 : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

function githubSshEnabled(): boolean {
  return process.env.NODE_ENV === "production" && process.env.CFDNS_ENABLE_GITHUB_SSH === "true";
}

function configuredPaths(): { keyPath: string; knownHostsPath: string } | null {
  const keyPath = process.env.GITHUB_SSH_KEY_PATH ?? "";
  const knownHostsPath = process.env.GITHUB_SSH_KNOWN_HOSTS ?? "";
  const safePath = (value: string) => path.isAbsolute(value) && /^[A-Za-z0-9_./-]+$/.test(value);
  if (!safePath(keyPath) || !safePath(knownHostsPath)) return null;
  return { keyPath, knownHostsPath };
}

async function getKeyInfo(): Promise<{
  publicKey: string;
  fingerprint: string;
} | null> {
  const paths = configuredPaths();
  if (!paths) return null;
  try {
    const [privateStat, publicStat, publicKey] = await Promise.all([
      fs.stat(paths.keyPath),
      fs.stat(`${paths.keyPath}.pub`),
      fs.readFile(`${paths.keyPath}.pub`, "utf8"),
    ]);
    if (!privateStat.isFile() || !publicStat.isFile() || (privateStat.mode & 0o077) !== 0) return null;
    const keyText = publicKey.trim();
    if (!keyText || keyText.length > 4096) return null;
    const fingerprintResult = await execFileResult("ssh-keygen", ["-lf", `${paths.keyPath}.pub`, "-E", "sha256"], 5000);
    if (fingerprintResult.code !== 0) return null;
    const fingerprint = fingerprintResult.stdout.trim().split(/\s+/)[1] ?? "";
    if (!fingerprint.startsWith("SHA256:")) return null;
    return { publicKey: keyText, fingerprint };
  } catch {
    return null;
  }
}

function takeTestToken(ownerId: number): boolean {
  const now = Date.now();
  const current = testBuckets.get(ownerId);
  if (!current || current.resetAt <= now) {
    testBuckets.set(ownerId, { count: 1, resetAt: now + TEST_WINDOW_MS });
    return true;
  }
  if (current.count >= TEST_LIMIT) return false;
  current.count += 1;
  return true;
}

function truncate(value: string): string {
  return value.trim().slice(0, OUTPUT_LIMIT);
}

function validRepoPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 201) return false;
  const parts = value.trim().split("/");
  return parts.length === 2 && parts.every((part) => /^[A-Za-z0-9_.-]{1,100}$/.test(part) && part !== "." && part !== "..");
}

function sshArgs(keyPath: string, knownHostsPath: string): string[] {
  return [
    "-T",
    "-i", keyPath,
    "-o", "IdentitiesOnly=yes",
    "-o", "BatchMode=yes",
    "-o", "PreferredAuthentications=publickey",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${knownHostsPath}`,
    "-o", "ConnectTimeout=8",
    "git@github.com",
  ];
}

function gitSshCommand(keyPath: string, knownHostsPath: string): string {
  return [
    "ssh",
    `-i ${keyPath}`,
    "-o IdentitiesOnly=yes",
    "-o BatchMode=yes",
    "-o PreferredAuthentications=publickey",
    "-o StrictHostKeyChecking=yes",
    `-o UserKnownHostsFile=${knownHostsPath}`,
    "-o ConnectTimeout=8",
  ].join(" ");
}

async function testConnection(req: Request, repo: string | null) {
  const paths = configuredPaths();
  const key = await getKeyInfo();
  if (!paths || !key) {
    return { status: 409, body: { error: "The dedicated GitHub SSH key is not ready on this VPS." } };
  }
  try {
    await fs.access(paths.knownHostsPath);
  } catch {
    return { status: 503, body: { error: "GitHub host keys are not installed. Re-run the self-host installer or restore the known_hosts file." } };
  }

  const sshResult = await execFileResult("ssh", sshArgs(paths.keyPath, paths.knownHostsPath), 12_000);
  const sshOutput = truncate(`${sshResult.stdout}\n${sshResult.stderr}`);
  const connected = /successfully authenticated/i.test(sshOutput);
  let repoAccessible: boolean | null = null;
  let repoTestOutput: string | null = null;

  if (connected && repo) {
    const gitResult = await execFileResult("git", [
      "-c", `core.sshCommand=${gitSshCommand(paths.keyPath, paths.knownHostsPath)}`,
      "ls-remote", `git@github.com:${repo}.git`,
    ], 20_000);
    repoAccessible = gitResult.code === 0;
    repoTestOutput = repoAccessible
      ? (gitResult.stdout.trim() ? "Repository access verified." : "SSH authenticated; the selected repository is empty or has no advertised refs.")
      : truncate(`${gitResult.stderr}\n${gitResult.stdout}`) || "GitHub SSH authenticated, but this key cannot read the selected repository.";
  }

  const result = {
    connected,
    tested: true,
    authUser: sshOutput.match(/Hi (.+?)!/i)?.[1] ?? null,
    sshTestOutput: sshOutput || (sshResult.code === 0 ? "SSH test completed." : "GitHub did not accept the SSH key."),
    repo,
    repoAccessible,
    repoTestOutput,
  };
  await audit(req, "github.ssh_key.test", "github_ssh", repo, connected && (repoAccessible !== false) ? "success" : "failed", {
    connected,
    repo,
    repoAccessible,
  });
  const ownerId = Number(req.user?.id ?? 0);
  if (ownerId) lastTestByOwner.set(ownerId, { ...result, checkedAt: Date.now() });
  return { status: 200, body: result };
}

router.get("/github/ssh-key", async (req, res) => {
  const enabled = githubSshEnabled();
  const key = enabled ? await getKeyInfo() : null;
  const ownerId = Number(req.user?.id ?? 0);
  const previousTest = enabled && key ? lastTestByOwner.get(ownerId) : undefined;
  const recentTest = previousTest && Date.now() - previousTest.checkedAt < TEST_STATUS_TTL_MS ? previousTest : undefined;
  res.json({
    enabled,
    configured: Boolean(key),
    keys: key ? [{ type: KEY_TYPE, publicKey: key.publicKey, fingerprint: key.fingerprint }] : [],
    connected: recentTest?.connected ?? false,
    tested: recentTest?.tested ?? false,
    authUser: recentTest?.authUser ?? null,
    sshTestOutput: recentTest?.sshTestOutput ?? "",
    repo: recentTest?.repo ?? null,
    repoAccessible: recentTest?.repoAccessible ?? null,
    repoTestOutput: recentTest?.repoTestOutput ?? null,
  });
});

router.post("/github/ssh-key/generate", async (req, res) => {
  if (!githubSshEnabled()) return res.status(403).json({ error: "GitHub SSH setup is available only on an enabled production VPS." });
  const paths = configuredPaths();
  if (!paths) return res.status(503).json({ error: "GitHub SSH key paths are not configured on this VPS." });
  try {
    const parent = path.dirname(paths.keyPath);
    await fs.mkdir(parent, { recursive: true, mode: 0o700 });
    await fs.chmod(parent, 0o700);
    try {
      await fs.access(paths.keyPath);
      return res.status(409).json({ error: "A GitHub SSH key already exists. It will not be overwritten." });
    } catch { /* no private key at the configured path */ }
    try {
      await fs.access(`${paths.keyPath}.pub`);
      return res.status(409).json({ error: "A public key already exists without its private key. Refusing to replace or pair keys automatically." });
    } catch { /* no public key at the configured path */ }

    const comment = `cfdns-manager@${os.hostname().replace(/[^A-Za-z0-9.-]/g, "-")}`;
    const generated = await execFileResult("ssh-keygen", ["-q", "-t", "ed25519", "-C", comment, "-N", "", "-f", paths.keyPath], 10_000);
    if (generated.code !== 0) throw new Error(truncate(generated.stderr) || "ssh-keygen failed.");
    await fs.chmod(paths.keyPath, 0o600);
    await fs.chmod(`${paths.keyPath}.pub`, 0o644);
    const key = await getKeyInfo();
    if (!key) throw new Error("The new key could not be validated. Check the service account's file permissions.");
    const ownerId = Number(req.user?.id ?? 0);
    if (ownerId) lastTestByOwner.delete(ownerId);
    await audit(req, "github.ssh_key.generate", "github_ssh", KEY_TYPE, "success");
    res.status(201).json({
      enabled: true,
      configured: true,
      keys: [{ type: KEY_TYPE, publicKey: key.publicKey, fingerprint: key.fingerprint }],
      connected: false,
      tested: false,
      authUser: null,
      sshTestOutput: "",
      repo: null,
      repoAccessible: null,
      repoTestOutput: null,
    });
  } catch (error) {
    await audit(req, "github.ssh_key.generate", "github_ssh", KEY_TYPE, "failed");
    res.status(500).json({ error: "Could not generate GitHub SSH key." });
  }
});

router.post("/github/ssh-key/test", async (req, res) => {
  if (!githubSshEnabled()) return res.status(403).json({ error: "GitHub SSH testing is available only on an enabled production VPS." });
  const ownerId = Number(req.user?.id ?? 0);
  if (!takeTestToken(ownerId)) return res.status(429).json({ error: "Too many SSH tests. Wait one minute before trying again." });
  const rawRepo = typeof req.body?.repo === "string" ? req.body.repo.trim() : "";
  if (rawRepo && !validRepoPath(rawRepo)) return res.status(400).json({ error: "Enter a GitHub repository as owner/repository." });
  try {
    const result = await testConnection(req, rawRepo || null);
    res.status(result.status).json(result.body);
  } catch (error) {
    await audit(req, "github.ssh_key.test", "github_ssh", rawRepo || null, "failed");
    res.status(500).json({ error: "GitHub SSH test failed." });
  }
});

export default router;
