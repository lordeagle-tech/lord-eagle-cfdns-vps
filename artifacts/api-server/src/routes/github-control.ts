import { Router, type Request, type Response } from "express";
import https from "node:https";
import { pool } from "@workspace/db";
import { decryptSecret, encryptSecret } from "../security/crypto";
import { audit } from "../security/audit";

const router = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const GH_BASE = "api.github.com";
const ENV_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN2 ?? process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "";

type GithubResult = { status: number; data: any; scopes: string };
type GithubConnection = { token: string; username: string; scopes: string; source: "encrypted-settings" | "server-env" };
type BranchSummary = { name: string; protected: boolean };

function ghRequest(token: string, method: string, apiPath: string, body?: unknown): Promise<GithubResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = https.request({
      hostname: GH_BASE,
      path: apiPath,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cfdns-manager-lord-eagle/1.0",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (response) => {
      let raw = "";
      response.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
        if (raw.length > 12_000_000) request.destroy(new Error("GitHub response exceeded the allowed size"));
      });
      response.on("end", () => {
        let data: unknown = raw;
        try { data = raw ? JSON.parse(raw) : {}; } catch { /* preserve a bounded provider message */ }
        resolve({ status: response.statusCode ?? 500, data, scopes: String(response.headers["x-oauth-scopes"] ?? "") });
      });
    });
    request.setTimeout(15_000, () => request.destroy(new Error("GitHub request timed out")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function ownerId(req: Request): number { return Number(req.user?.id ?? 0); }

async function getConnection(id: number): Promise<GithubConnection | null> {
  const [rows] = await pool.query<any[]>(
    "SELECT token_encrypted AS tokenEncrypted, username, scopes FROM github_account_connections WHERE owner_id=? LIMIT 1",
    [id],
  );
  if (rows[0]?.tokenEncrypted) {
    const token = decryptSecret(String(rows[0].tokenEncrypted));
    if (token) return { token, username: String(rows[0].username), scopes: String(rows[0].scopes ?? ""), source: "encrypted-settings" };
  }
  if (ENV_TOKEN) {
    const { status, data, scopes } = await ghRequest(ENV_TOKEN, "GET", "/user");
    if (status === 200 && typeof data?.login === "string") return { token: ENV_TOKEN, username: data.login, scopes, source: "server-env" };
  }
  return null;
}

function validRepoName(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 100 && /^[A-Za-z0-9._-]+$/.test(value) && value !== "." && value !== "..";
}
function validRepoPath(owner: unknown, repo: unknown): owner is string {
  return typeof owner === "string" && typeof repo === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(owner) && /^[A-Za-z0-9_.-]{1,100}$/.test(repo) && owner !== "." && owner !== ".." && repo !== "." && repo !== "..";
}
function validRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1000 && !value.startsWith("/") && !value.includes("\\") && !/[\x00-\x1f\x7f]/.test(value) && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
function repoApiPath(owner: string, repo: string, suffix = ""): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
}
function contentsApiPath(owner: string, repo: string, filePath: string): string {
  return `${repoApiPath(owner, repo, "/contents")}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
}
function githubError(data: any): string {
  const message = typeof data?.message === "string" ? data.message : "GitHub rejected the request";
  return message.slice(0, 240);
}
function sendGithubError(res: Response, result: GithubResult): void {
  const status = result.status >= 400 && result.status <= 599 ? result.status : 502;
  res.status(status).json({ error: githubError(result.data) });
}
async function ownedConnection(req: Request, res: Response, owner: string, repo: string): Promise<GithubConnection | null> {
  if (!validRepoPath(owner, repo)) { res.status(400).json({ error: "Invalid repository path" }); return null; }
  const connection = await getConnection(ownerId(req));
  if (!connection) { res.status(503).json({ error: "Connect a GitHub account before managing repositories" }); return null; }
  if (owner.toLowerCase() !== connection.username.toLowerCase()) {
    res.status(403).json({ error: "This control panel only manages repositories owned by the connected GitHub account" });
    return null;
  }
  return connection;
}

router.get("/github/control/status", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const id = ownerId(req);
    const [rows] = await pool.query<any[]>("SELECT username, scopes FROM github_account_connections WHERE owner_id=? LIMIT 1", [id]);
    const stored = rows[0];
    const connection = await getConnection(id);
    if (!connection) {
      res.json({ configured: false, connected: false, username: null, scopes: "", source: null });
      return;
    }
    const result = await ghRequest(connection.token, "GET", "/user");
    if (result.status !== 200 || typeof result.data?.login !== "string") {
      res.json({ configured: true, connected: false, username: stored?.username ?? null, scopes: connection.scopes, source: connection.source, message: "GitHub did not accept the saved credential. Reconnect to continue." });
      return;
    }
    res.json({ configured: true, connected: true, username: result.data.login, avatarUrl: result.data.avatar_url, scopes: result.scopes || connection.scopes, source: connection.source });
  } catch {
    res.status(503).json({ error: "GitHub connection status is temporarily unavailable" });
  }
});

router.post("/github/control/connect", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (token.length < 20 || token.length > 5000 || /\s/.test(token)) { res.status(400).json({ error: "Enter a valid GitHub personal access token" }); return; }
  try {
    const profile = await ghRequest(token, "GET", "/user");
    if (profile.status !== 200 || typeof profile.data?.login !== "string") {
      res.status(401).json({ error: "GitHub could not validate that token. Check that it is active and try again." });
      return;
    }
    const encrypted = encryptSecret(token);
    if (!encrypted) { res.status(503).json({ error: "Credential encryption is not configured on this server" }); return; }
    await pool.execute(
      `INSERT INTO github_account_connections (owner_id, token_encrypted, username, scopes) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE token_encrypted=VALUES(token_encrypted), username=VALUES(username), scopes=VALUES(scopes), updated_at=CURRENT_TIMESTAMP`,
      [ownerId(req), encrypted, profile.data.login, profile.scopes],
    );
    await audit(req, "github.control.connect", "github_account", profile.data.login, "success", { scopes: profile.scopes }).catch(() => undefined);
    res.setHeader("Cache-Control", "no-store");
    res.json({ connected: true, username: profile.data.login, scopes: profile.scopes, source: "encrypted-settings" });
  } catch {
    await audit(req, "github.control.connect", "github_account", null, "failed").catch(() => undefined);
    res.status(502).json({ error: "Could not connect to GitHub or encrypt the credential" });
  }
});

router.delete("/github/control/connect", async (req, res) => {
  try {
    const connection = await getConnection(ownerId(req));
    await pool.execute("DELETE FROM github_account_connections WHERE owner_id=?", [ownerId(req)]);
    if (connection?.source === "encrypted-settings") await audit(req, "github.control.disconnect", "github_account", connection.username, "success");
    res.status(204).end();
  } catch {
    res.status(503).json({ error: "Could not remove the saved GitHub connection" });
  }
});

router.get("/github/control/repos", async (req, res) => {
  try {
    const connection = await getConnection(ownerId(req));
    if (!connection) { res.status(503).json({ error: "Connect a GitHub account first" }); return; }
    const requestedPage = Number(req.query.page ?? 1);
    const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(requestedPage, 1000)) : 1;
    const result = await ghRequest(connection.token, "GET", `/user/repos?type=owner&sort=updated&direction=desc&per_page=100&page=${page}`);
    if (result.status !== 200) { sendGithubError(res, result); return; }
    const repos = Array.isArray(result.data) ? result.data.map((repo: any) => ({
      id: repo.id, name: repo.name, fullName: repo.full_name, description: repo.description,
      private: Boolean(repo.private), htmlUrl: repo.html_url, defaultBranch: repo.default_branch,
      updatedAt: repo.updated_at, pushedAt: repo.pushed_at, stars: repo.stargazers_count,
      forks: repo.forks_count, language: repo.language, archived: Boolean(repo.archived),
    })) : [];
    res.setHeader("Cache-Control", "no-store");
    res.json({ repos, page, hasMore: page < 1000 && repos.length === 100, username: connection.username });
  } catch {
    res.status(502).json({ error: "Could not load repositories from GitHub" });
  }
});

router.post("/github/control/repos", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description : "";
  if (!validRepoName(name)) { res.status(400).json({ error: "Repository names may contain letters, numbers, dots, underscores, and hyphens (up to 100 characters)" }); return; }
  if (description.length > 350) { res.status(400).json({ error: "Description must be 350 characters or fewer" }); return; }
  const isPrivate = req.body?.private !== false;
  try {
    const connection = await getConnection(ownerId(req));
    if (!connection) { res.status(503).json({ error: "Connect a GitHub account first" }); return; }
    const result = await ghRequest(connection.token, "POST", "/user/repos", { name, description: description || null, private: isPrivate, auto_init: true });
    if (result.status < 200 || result.status >= 300) {
      await audit(req, "github.control.repo.create", "github_repo", `${connection.username}/${name}`, "failed").catch(() => undefined);
      sendGithubError(res, result); return;
    }
    await audit(req, "github.control.repo.create", "github_repo", result.data.full_name, "success", { private: isPrivate }).catch(() => undefined);
    res.status(201).json({ repo: { id: result.data.id, name: result.data.name, fullName: result.data.full_name, private: result.data.private, htmlUrl: result.data.html_url, defaultBranch: result.data.default_branch } });
  } catch {
    await audit(req, "github.control.repo.create", "github_repo", name, "failed").catch(() => undefined);
    res.status(502).json({ error: "Repository creation failed" });
  }
});

router.patch("/github/control/repos/:owner/:repo", async (req, res) => {
  const connection = await ownedConnection(req, res, req.params.owner, req.params.repo);
  if (!connection) return;
  const body: Record<string, unknown> = {};
  if (Object.hasOwn(req.body ?? {}, "name")) {
    const nextName = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!validRepoName(nextName)) { res.status(400).json({ error: "Invalid repository name" }); return; }
    body.name = nextName;
  }
  if (Object.hasOwn(req.body ?? {}, "description")) {
    if (typeof req.body.description !== "string" || req.body.description.length > 350) { res.status(400).json({ error: "Description must be 350 characters or fewer" }); return; }
    body.description = req.body.description;
  }
  if (Object.hasOwn(req.body ?? {}, "private")) {
    if (typeof req.body.private !== "boolean") { res.status(400).json({ error: "Visibility must be private or public" }); return; }
    body.private = req.body.private;
  }
  if (Object.hasOwn(req.body ?? {}, "homepage")) {
    if (typeof req.body.homepage !== "string" || req.body.homepage.length > 255 || (req.body.homepage && !/^https?:\/\//i.test(req.body.homepage))) { res.status(400).json({ error: "Homepage must be an HTTP(S) URL or empty" }); return; }
    body.homepage = req.body.homepage;
  }
  if (!Object.keys(body).length) { res.status(400).json({ error: "No repository settings were supplied" }); return; }
  try {
    const result = await ghRequest(connection.token, "PATCH", repoApiPath(req.params.owner, req.params.repo), body);
    if (result.status < 200 || result.status >= 300) { await audit(req, "github.control.repo.update", "github_repo", `${req.params.owner}/${req.params.repo}`, "failed").catch(() => undefined); sendGithubError(res, result); return; }
    await audit(req, "github.control.repo.update", "github_repo", result.data.full_name, "success", { changedFields: Object.keys(body) }).catch(() => undefined);
    res.json({ repo: { name: result.data.name, fullName: result.data.full_name, description: result.data.description, private: result.data.private, homepage: result.data.homepage, htmlUrl: result.data.html_url, defaultBranch: result.data.default_branch } });
  } catch {
    await audit(req, "github.control.repo.update", "github_repo", `${req.params.owner}/${req.params.repo}`, "failed").catch(() => undefined);
    res.status(502).json({ error: "Repository settings update failed" });
  }
});

router.delete("/github/control/repos/:owner/:repo", async (req, res) => {
  const connection = await ownedConnection(req, res, req.params.owner, req.params.repo);
  if (!connection) return;
  const expected = req.params.repo;
  if (typeof req.body?.confirmName !== "string" || req.body.confirmName !== expected) { res.status(400).json({ error: "Type the exact repository name to confirm deletion" }); return; }
  try {
    const result = await ghRequest(connection.token, "DELETE", repoApiPath(req.params.owner, req.params.repo));
    if (result.status !== 204) { await audit(req, "github.control.repo.delete", "github_repo", `${req.params.owner}/${req.params.repo}`, "failed").catch(() => undefined); sendGithubError(res, result); return; }
    await audit(req, "github.control.repo.delete", "github_repo", `${req.params.owner}/${req.params.repo}`, "success").catch(() => undefined);
    res.status(204).end();
  } catch {
    await audit(req, "github.control.repo.delete", "github_repo", `${req.params.owner}/${req.params.repo}`, "failed").catch(() => undefined);
    res.status(502).json({ error: "Repository deletion failed" });
  }
});

router.get("/github/control/repos/:owner/:repo/branches", async (req, res) => {
  const connection = await ownedConnection(req, res, req.params.owner, req.params.repo);
  if (!connection) return;
  try {
    const branches: BranchSummary[] = [];
    let truncated = false;
    for (let page = 1; page <= 20; page++) {
      const result = await ghRequest(connection.token, "GET", `${repoApiPath(req.params.owner, req.params.repo, "/branches")}?per_page=100&page=${page}`);
      if (result.status !== 200) { sendGithubError(res, result); return; }
      const current = Array.isArray(result.data) ? result.data : [];
      branches.push(...current.map((branch: any) => ({ name: branch.name, protected: Boolean(branch.protected) })));
      if (current.length < 100) break;
      if (page === 20) truncated = true;
    }
    res.json({ branches, truncated });
  } catch { res.status(502).json({ error: "Could not load repository branches" }); }
});

router.get("/github/control/repos/:owner/:repo/contents", async (req, res) => {
  const connection = await ownedConnection(req, res, req.params.owner, req.params.repo);
  if (!connection) return;
  const rawPath = typeof req.query.path === "string" ? req.query.path : "";
  const ref = typeof req.query.ref === "string" ? req.query.ref : "";
  if (rawPath && !validRelativePath(rawPath)) { res.status(400).json({ error: "Invalid repository path" }); return; }
  if (ref.length > 255 || /[\x00-\x1f\x7f]/.test(ref)) { res.status(400).json({ error: "Invalid branch name" }); return; }
  const apiPath = rawPath ? contentsApiPath(req.params.owner, req.params.repo, rawPath) : repoApiPath(req.params.owner, req.params.repo, "/contents");
  try {
    const result = await ghRequest(connection.token, "GET", `${apiPath}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
    if (result.status !== 200) { sendGithubError(res, result); return; }
    res.json({ entries: Array.isArray(result.data) ? result.data.map((item: any) => ({ name: item.name, path: item.path, type: item.type, size: item.size, sha: item.sha })) : result.data });
  } catch { res.status(502).json({ error: "Could not read repository contents" }); }
});

router.get("/github/control/repos/:owner/:repo/file", async (req, res) => {
  const connection = await ownedConnection(req, res, req.params.owner, req.params.repo);
  if (!connection) return;
  const filePath = typeof req.query.path === "string" ? req.query.path : "";
  const ref = typeof req.query.ref === "string" ? req.query.ref : "";
  if (!validRelativePath(filePath) || ref.length > 255 || /[\x00-\x1f\x7f]/.test(ref)) { res.status(400).json({ error: "Invalid file path or branch" }); return; }
  try {
    const result = await ghRequest(connection.token, "GET", `${contentsApiPath(req.params.owner, req.params.repo, filePath)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
    if (result.status !== 200) { sendGithubError(res, result); return; }
    if (result.data?.type !== "file" || result.data?.encoding !== "base64" || typeof result.data.content !== "string") { res.status(415).json({ error: "This path is not a supported text file" }); return; }
    const bytes = Buffer.from(result.data.content.replace(/\s/g, ""), "base64");
    if (bytes.length > 750_000) { res.status(413).json({ error: "This file is too large to edit in the browser" }); return; }
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { res.status(415).json({ error: "Only valid UTF-8 text files can be edited in the browser" }); return; }
    if (content.includes("\u0000")) { res.status(415).json({ error: "Binary files cannot be edited in the browser" }); return; }
    res.json({ file: { path: result.data.path, name: result.data.name, sha: result.data.sha, size: bytes.length, content } });
  } catch { res.status(502).json({ error: "Could not load this file from GitHub" }); }
});

router.put("/github/control/repos/:owner/:repo/file", async (req, res) => {
  const connection = await ownedConnection(req, res, req.params.owner, req.params.repo);
  if (!connection) return;
  const filePath = req.body?.path;
  const content = req.body?.content;
  const message = req.body?.message;
  const branch = req.body?.branch;
  const sha = req.body?.sha;
  if (!validRelativePath(filePath) || typeof content !== "string" || Buffer.byteLength(content, "utf8") > 750_000 || typeof message !== "string" || !message.trim() || message.length > 500 || typeof branch !== "string" || !branch.trim() || branch.length > 255 || /[\x00-\x1f\x7f]/.test(branch)) {
    res.status(400).json({ error: "Provide a valid file path, text content (up to 750 KB), commit message, and branch" }); return;
  }
  if (sha !== undefined && (typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha))) { res.status(400).json({ error: "Invalid file version; reload the file before saving" }); return; }
  try {
    const result = await ghRequest(connection.token, "PUT", contentsApiPath(req.params.owner, req.params.repo, filePath), {
      message: message.trim(), content: Buffer.from(content, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}),
    });
    if (result.status < 200 || result.status >= 300) { await audit(req, "github.control.file.commit", "github_repo", `${req.params.owner}/${req.params.repo}`, "failed", { branch, path: filePath }).catch(() => undefined); sendGithubError(res, result); return; }
    await audit(req, "github.control.file.commit", "github_repo", `${req.params.owner}/${req.params.repo}`, "success", { branch, path: filePath, commit: result.data?.commit?.sha }).catch(() => undefined);
    res.json({ commit: { sha: result.data?.commit?.sha, htmlUrl: result.data?.commit?.html_url }, file: { path: result.data?.content?.path, sha: result.data?.content?.sha } });
  } catch {
    await audit(req, "github.control.file.commit", "github_repo", `${req.params.owner}/${req.params.repo}`, "failed", { branch, path: filePath }).catch(() => undefined);
    res.status(502).json({ error: "Could not commit this file to GitHub" });
  }
});

router.delete("/github/control/repos/:owner/:repo/file", async (req, res) => {
  const connection = await ownedConnection(req, res, req.params.owner, req.params.repo);
  if (!connection) return;
  const filePath = req.body?.path;
  const message = req.body?.message;
  const branch = req.body?.branch;
  const sha = req.body?.sha;
  if (!validRelativePath(filePath) || typeof message !== "string" || !message.trim() || message.length > 500 || typeof branch !== "string" || !branch.trim() || branch.length > 255 || typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha)) { res.status(400).json({ error: "Provide a valid file version, commit message, and branch" }); return; }
  try {
    const result = await ghRequest(connection.token, "DELETE", contentsApiPath(req.params.owner, req.params.repo, filePath), { message: message.trim(), sha, branch });
    if (result.status < 200 || result.status >= 300) { await audit(req, "github.control.file.delete", "github_repo", `${req.params.owner}/${req.params.repo}`, "failed", { branch, path: filePath }).catch(() => undefined); sendGithubError(res, result); return; }
    await audit(req, "github.control.file.delete", "github_repo", `${req.params.owner}/${req.params.repo}`, "success", { branch, path: filePath }).catch(() => undefined);
    res.json({ commit: { sha: result.data?.commit?.sha, htmlUrl: result.data?.commit?.html_url } });
  } catch {
    await audit(req, "github.control.file.delete", "github_repo", `${req.params.owner}/${req.params.repo}`, "failed", { branch, path: filePath }).catch(() => undefined);
    res.status(502).json({ error: "Could not delete this file from GitHub" });
  }
});

export default router;
