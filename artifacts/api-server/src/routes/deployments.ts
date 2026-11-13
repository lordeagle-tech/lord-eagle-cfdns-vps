import { Router } from "express";
import https from "node:https";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { decryptSecret } from "../security/crypto";
import { audit } from "../security/audit";
import { getServerById, withSshClient, getSftp, sftpWriteFile, execCommand } from "../lib/ssh";
import { logger } from "../lib/logger";

const router = Router();
const MAX_SCRIPT_BYTES = 750_000;
const MAX_RUN_MS = 10 * 60 * 1000;
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

function validRepoPart(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && value !== "." && value !== "..";
}
function validFilePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1000 && !value.startsWith("/") && !value.includes("\\") && !/[\x00-\x1f\x7f]/.test(value) && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
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

async function getStoredGithubToken(ownerId: number): Promise<string | null> {
  const [rows] = await pool.query<any[]>("SELECT token_encrypted AS tokenEncrypted FROM github_account_connections WHERE owner_id=? LIMIT 1", [ownerId]);
  return rows[0]?.tokenEncrypted ? decryptSecret(String(rows[0].tokenEncrypted)) : null;
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
    const { content, digest } = await getReviewedScript(ownerId, repoOwner, repo, filePath, ref, blobSha, expectedDigest);
    const runId = randomUUID();
    const result = await withSshClient(server, async (client) => {
      const stage = await execCommand(client, `umask 077; mkdir -p -- "$HOME/.cache" && mktemp -d "$HOME/.cache/cfdns-deploy.XXXXXXXX"`);
      const stageDirectory = stage.stdout.trim();
      if (stage.exitCode !== 0 || !/^\/[A-Za-z0-9._/-]+$/.test(stageDirectory) || stageDirectory.includes("/../")) throw new Error("Could not create a private script staging directory on the VPS");
      const tempPath = `${stageDirectory}/script-${runId}.sh`;
      try {
        const sftp = await getSftp(client);
        await sftpWriteFile(sftp, tempPath, content);
        const command = `chmod 700 -- ${quoteShell(tempPath)} && timeout --signal=TERM --kill-after=5s 600s bash --noprofile --norc ${quoteShell(tempPath)}`;
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

export default router;
