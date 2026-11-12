import { Router } from "express";
import path from "node:path";
import { z } from "zod";
import { getServerById, withSshClient, getSftp, sftpReaddir, sftpReadFile, sftpWriteFile, sftpMkdir, sftpRename, sftpStat, sftpUnlink, sftpRmdir } from "../lib/ssh";
import { audit } from "../security/audit";
import { logger } from "../lib/logger";

const router = Router();
const idSchema = z.coerce.number().int().positive();
const pathSchema = z.string().min(1).max(4096);
const MAX_FILE_SIZE = 5 * 1024 * 1024;

function remotePath(value: unknown): string | null {
  if (typeof value !== "string" || !path.posix.isAbsolute(value) || value.includes("\0")) return null;
  if (value.split("/").includes("..")) return null;
  return path.posix.normalize(value);
}
function entryType(mode: number): "directory" | "file" | "symlink" | "other" {
  const kind = mode & 0o170000;
  if (kind === 0o040000) return "directory";
  if (kind === 0o100000) return "file";
  if (kind === 0o120000) return "symlink";
  return "other";
}
function permissions(mode: number): string {
  const values = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
  const kind = mode & 0o170000;
  return `${kind === 0o040000 ? "d" : kind === 0o120000 ? "l" : "-"}${values[(mode >> 6) & 7]}${values[(mode >> 3) & 7]}${values[mode & 7]}`;
}
function serverId(req: any): number | null {
  const parsed = idSchema.safeParse(req.params.id);
  return parsed.success ? parsed.data : null;
}
async function trustedServer(req: any, res: any) {
  const id = serverId(req);
  if (!id) { res.status(400).json({ error: "Invalid server id" }); return null; }
  const server = await getServerById(id, Number(req.user?.id ?? 0));
  if (!server) { res.status(404).json({ error: "Server not found" }); return null; }
  if (!server.hostFingerprint) { res.status(409).json({ error: "Verify and trust this server's SSH host fingerprint first." }); return null; }
  return server;
}
function responseError(res: any, error: unknown, fallback: string): void {
  logger.warn({ err: error }, fallback);
  res.status(502).json({ error: fallback });
}

router.get("/servers/:id/files/list", async (req, res) => {
  const server = await trustedServer(req, res);
  if (!server) return;
  const remote = remotePath(typeof req.query.path === "string" ? req.query.path : "/");
  if (!remote) { res.status(400).json({ error: "Use an absolute remote path without traversal segments" }); return; }
  try {
    const entries = await withSshClient(server, async (client) => {
      const sftp = await getSftp(client);
      const listing = await sftpReaddir(sftp, remote);
      return listing.filter((entry) => entry.filename !== "." && entry.filename !== "..").map((entry) => {
        const filename = String(entry.filename);
        const mode = Number(entry.attrs?.mode ?? 0);
        return {
          name: filename,
          path: path.posix.join(remote, filename),
          type: entryType(mode),
          size: Number(entry.attrs?.size ?? 0),
          permissions: permissions(mode),
          modifiedAt: new Date(Number(entry.attrs?.mtime ?? 0) * 1000).toISOString(),
        };
      }).sort((a, b) => a.type === "directory" && b.type !== "directory" ? -1 : a.type !== "directory" && b.type === "directory" ? 1 : a.name.localeCompare(b.name));
    });
    res.json({ path: remote, parentPath: remote === "/" ? null : path.posix.dirname(remote), entries });
  } catch (error) { responseError(res, error, "Remote directory listing failed"); }
});

router.get("/servers/:id/files/read", async (req, res) => {
  const server = await trustedServer(req, res);
  if (!server) return;
  const parsed = pathSchema.safeParse(req.query.path);
  const remote = parsed.success ? remotePath(parsed.data) : null;
  if (!remote) { res.status(400).json({ error: "Use an absolute remote file path without traversal segments" }); return; }
  try {
    const result = await withSshClient(server, async (client) => {
      const sftp = await getSftp(client);
      const stat = await sftpStat(sftp, remote);
      if ((Number(stat.mode ?? 0) & 0o170000) !== 0o100000) throw new Error("Remote path is not a regular file");
      if (Number(stat.size ?? 0) > MAX_FILE_SIZE) return { content: "", isBinary: true, size: Number(stat.size) };
      const buffer = await sftpReadFile(sftp, remote);
      const isBinary = buffer.slice(0, Math.min(8192, buffer.length)).includes(0);
      return { content: isBinary ? "" : buffer.toString("utf8"), isBinary, size: buffer.length };
    });
    res.json({ path: remote, ...result });
  } catch (error) { responseError(res, error, "Remote file read failed"); }
});

router.post("/servers/:id/files/write", async (req, res) => {
  const server = await trustedServer(req, res);
  if (!server) return;
  const remote = remotePath(req.body?.path);
  const content = typeof req.body?.content === "string" ? req.body.content : null;
  if (!remote || remote === "/" || content === null) { res.status(400).json({ error: "An absolute remote file path and text content are required" }); return; }
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_SIZE) { res.status(413).json({ error: "File content exceeds the 5 MB limit" }); return; }
  try {
    await withSshClient(server, async (client) => sftpWriteFile(await getSftp(client), remote, content));
    await audit(req, "server.files.write", "server", server.id, "success", { path: remote, bytes: Buffer.byteLength(content, "utf8") });
    res.json({ ok: true });
  } catch (error) {
    await audit(req, "server.files.write", "server", server.id, "failed", { path: remote });
    responseError(res, error, "Remote file write failed");
  }
});

router.post("/servers/:id/files/mkdir", async (req, res) => {
  const server = await trustedServer(req, res);
  if (!server) return;
  const remote = remotePath(req.body?.path);
  if (!remote || remote === "/") { res.status(400).json({ error: "Choose a new absolute directory path" }); return; }
  try {
    await withSshClient(server, async (client) => sftpMkdir(await getSftp(client), remote));
    await audit(req, "server.files.mkdir", "server", server.id, "success", { path: remote });
    res.json({ ok: true });
  } catch (error) {
    await audit(req, "server.files.mkdir", "server", server.id, "failed", { path: remote }).catch(() => undefined);
    responseError(res, error, "Remote directory creation failed");
  }
});

router.post("/servers/:id/files/rename", async (req, res) => {
  const server = await trustedServer(req, res);
  if (!server) return;
  const oldPath = remotePath(req.body?.oldPath);
  const newPath = remotePath(req.body?.newPath);
  if (!oldPath || !newPath || oldPath === "/" || newPath === "/") { res.status(400).json({ error: "Choose valid absolute source and destination paths" }); return; }
  try {
    await withSshClient(server, async (client) => sftpRename(await getSftp(client), oldPath, newPath));
    await audit(req, "server.files.rename", "server", server.id, "success", { from: oldPath, to: newPath });
    res.json({ ok: true });
  } catch (error) {
    await audit(req, "server.files.rename", "server", server.id, "failed", { from: oldPath, to: newPath }).catch(() => undefined);
    responseError(res, error, "Remote rename failed");
  }
});

router.delete("/servers/:id/files/delete", async (req, res) => {
  const server = await trustedServer(req, res);
  if (!server) return;
  const remote = remotePath(typeof req.query.path === "string" ? req.query.path : "");
  if (!remote || remote === "/") { res.status(400).json({ error: "Root cannot be deleted" }); return; }
  try {
    await withSshClient(server, async (client) => {
      const sftp = await getSftp(client);
      const stat = await sftpStat(sftp, remote);
      if ((Number(stat.mode ?? 0) & 0o170000) === 0o040000) await sftpRmdir(sftp, remote);
      else await sftpUnlink(sftp, remote);
    });
    await audit(req, "server.files.delete", "server", server.id, "success", { path: remote });
    res.json({ ok: true });
  } catch (error) {
    await audit(req, "server.files.delete", "server", server.id, "failed", { path: remote }).catch(() => undefined);
    responseError(res, error, "Remote delete failed (directories must be empty)");
  }
});

export default router;
