import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { decryptSecret, encryptSecret } from "./security/crypto";

export type GitHubKey = {
  privateKey: string;
  publicKey: string;
  fingerprint: string;
};

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

export function githubRuntimeDir(): string {
  const configured = process.env.CFDNS_RUNTIME_DIR;
  if (configured && path.isAbsolute(configured)) return configured;
  if (process.env.NODE_ENV === "production") return "/run/cfdns-manager";
  return path.join(os.tmpdir(), "cfdns-manager");
}

export function githubRuntimeKeyPath(): string {
  return path.join(githubRuntimeDir(), "github_ed25519");
}

export async function fingerprintPublicKey(publicKeyPath: string): Promise<string | null> {
  const result = await execFileResult("ssh-keygen", ["-lf", publicKeyPath, "-E", "sha256"], 5000);
  if (result.code !== 0) return null;
  const fingerprint = result.stdout.trim().split(/\s+/)[1] ?? "";
  return fingerprint.startsWith("SHA256:") ? fingerprint : null;
}

export async function loadGithubKey(): Promise<GitHubKey | null> {
  const [rows] = await pool.query<any[]>(
    "SELECT private_key_encrypted AS privateKeyEncrypted, public_key AS publicKey, fingerprint FROM github_ssh_keys WHERE id=1 LIMIT 1",
  );
  if (!rows[0]?.privateKeyEncrypted) return null;
  const privateKey = decryptSecret(String(rows[0].privateKeyEncrypted));
  if (!privateKey) return null;
  return {
    privateKey,
    publicKey: String(rows[0].publicKey ?? ""),
    fingerprint: String(rows[0].fingerprint ?? ""),
  };
}

export async function saveGithubKey(key: GitHubKey): Promise<void> {
  const encrypted = encryptSecret(key.privateKey);
  if (!encrypted) throw new Error("Credential encryption is not configured on this server");
  await pool.execute(
    `INSERT INTO github_ssh_keys (id, private_key_encrypted, public_key, fingerprint) VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE private_key_encrypted=VALUES(private_key_encrypted), public_key=VALUES(public_key), fingerprint=VALUES(fingerprint), updated_at=CURRENT_TIMESTAMP`,
    [encrypted, key.publicKey, key.fingerprint],
  );
}

export async function materializeGithubKey(): Promise<GitHubKey | null> {
  const key = await loadGithubKey();
  if (!key) return null;
  const dir = githubRuntimeDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700);
  const keyPath = githubRuntimeKeyPath();
  const privateTemp = `${keyPath}.tmp-${process.pid}`;
  const privateKey = key.privateKey.endsWith("\n") ? key.privateKey : `${key.privateKey}\n`;
  const publicKey = key.publicKey.endsWith("\n") ? key.publicKey : `${key.publicKey}\n`;
  await fs.writeFile(privateTemp, privateKey, { mode: 0o600 });
  await fs.chmod(privateTemp, 0o600);
  await fs.rename(privateTemp, keyPath);
  await fs.writeFile(`${keyPath}.pub`, publicKey, { mode: 0o644 });
  await fs.chmod(keyPath, 0o600);
  await fs.chmod(`${keyPath}.pub`, 0o644);
  return key;
}

export async function generateGithubKeypair(): Promise<GitHubKey> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cfdns-gh-"));
  try {
    const keyPath = path.join(dir, "github_ed25519");
    const comment = `cfdns-manager@${os.hostname().replace(/[^A-Za-z0-9.-]/g, "-")}`;
    const generated = await execFileResult("ssh-keygen", ["-q", "-t", "ed25519", "-C", comment, "-N", "", "-f", keyPath], 10_000);
    if (generated.code !== 0) throw new Error(generated.stderr.trim() || "ssh-keygen failed.");
    const [privateKey, publicKey, fingerprint] = await Promise.all([
      fs.readFile(keyPath, "utf8"),
      fs.readFile(`${keyPath}.pub`, "utf8"),
      fingerprintPublicKey(`${keyPath}.pub`),
    ]);
    if (!fingerprint) throw new Error("The generated key fingerprint could not be computed.");
    return { privateKey, publicKey: publicKey.trim(), fingerprint };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function bootstrapGithubKey(): Promise<void> {
  try {
    if (await loadGithubKey()) {
      await materializeGithubKey();
      return;
    }
    const legacyPath = process.env.GITHUB_SSH_KEY_PATH ?? "";
    if (!legacyPath || !path.isAbsolute(legacyPath)) return;
    const [privateStat, privateKey, publicKey] = await Promise.all([
      fs.stat(legacyPath),
      fs.readFile(legacyPath, "utf8"),
      fs.readFile(`${legacyPath}.pub`, "utf8"),
    ]);
    if (!privateStat.isFile() || (privateStat.mode & 0o077) !== 0) return;
    const fingerprint = await fingerprintPublicKey(`${legacyPath}.pub`);
    if (!fingerprint) return;
    await saveGithubKey({ privateKey, publicKey: publicKey.trim(), fingerprint });
    await materializeGithubKey();
    await fs.rm(legacyPath, { force: true });
    await fs.rm(`${legacyPath}.pub`, { force: true });
    logger.info({ fingerprint }, "Migrated GitHub SSH key into encrypted database");
  } catch (error) {
    logger.warn({ err: error }, "GitHub SSH key bootstrap skipped");
  }
}
