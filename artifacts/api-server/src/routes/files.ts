import { Router } from "express";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import { audit } from "../security/audit";
import {
  ListFilesQueryParams, ReadFileQueryParams, WriteFileBody, DeleteFileQueryParams,
  CreateDirectoryBody, RenameFileBody, GetRawFileQueryParams,
} from "@workspace/api-zod";

const MIME_MAP: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp",
  tiff: "image/tiff", avif: "image/avif", mp4: "video/mp4", webm: "video/webm",
  mkv: "video/x-matroska", mov: "video/quicktime", avi: "video/x-msvideo", ogv: "video/ogg",
  m4v: "video/x-m4v", flv: "video/x-flv", "3gp": "video/3gpp", mp3: "audio/mpeg",
  wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac",
  opus: "audio/opus", wma: "audio/x-ms-wma", txt: "text/plain", md: "text/plain",
  json: "application/json", xml: "application/xml", html: "text/html", css: "text/css",
  js: "text/javascript", ts: "text/plain", pdf: "application/pdf",
};
const router = Router();
const MAX_TEXT_SIZE = 5 * 1024 * 1024;

class PathAccessError extends Error {
  status = 403;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function allowedRoots(): Promise<string[]> {
  const configured = (process.env.FILE_MANAGER_ROOTS ?? process.cwd())
    .split(",").map((value) => value.trim()).filter(Boolean);
  const roots: string[] = [];
  for (const value of configured) {
    if (!path.isAbsolute(value)) continue;
    try {
      const root = await fs.realpath(value);
      if ((await fs.stat(root)).isDirectory() && !roots.includes(root)) roots.push(root);
    } catch { /* skip a configured root that is absent or inaccessible */ }
  }
  if (roots.length) return roots;
  return [await fs.realpath(process.cwd())];
}

async function nearestExisting(target: string): Promise<{ lexical: string; real: string }> {
  let current = target;
  while (true) {
    try { return { lexical: current, real: await fs.realpath(current) }; }
    catch (error: any) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function resolveManagedPath(raw: string, allowMissing = false): Promise<string> {
  if (!path.isAbsolute(raw) || raw.includes("\0") || raw.split(path.sep).includes("..")) {
    throw new PathAccessError("Path must be absolute and may not contain traversal segments");
  }
  const target = path.resolve(raw);
  const roots = await allowedRoots();
  try {
    const realTarget = await fs.realpath(target);
    if (roots.some((root) => isWithin(root, realTarget))) return realTarget;
    throw new PathAccessError("Path is outside the configured file-manager roots");
  } catch (error: any) {
    if (error instanceof PathAccessError) throw error;
    if (!allowMissing || (error?.code !== "ENOENT" && error?.code !== "ENOTDIR")) throw error;
  }

  const ancestor = await nearestExisting(target);
  const root = roots.find((candidate) => isWithin(candidate, ancestor.real));
  if (!root) throw new PathAccessError("Path is outside the configured file-manager roots");
  const suffix = path.relative(ancestor.lexical, target);
  const resolved = path.resolve(ancestor.real, suffix);
  if (!isWithin(root, resolved)) throw new PathAccessError("Path is outside the configured file-manager roots");
  return resolved;
}

async function resolveManagedEntryPath(raw: string, allowMissingParent = false): Promise<string> {
  if (!path.isAbsolute(raw) || raw.includes("\0") || raw.split(path.sep).includes("..")) {
    throw new PathAccessError("Path must be absolute and may not contain traversal segments");
  }
  const target = path.resolve(raw);
  const name = path.basename(target);
  if (!name || name === "." || name === "..") throw new PathAccessError("A file or directory path is required");
  const parent = await resolveManagedPath(path.dirname(target), allowMissingParent);
  const entry = path.join(parent, name);
  const roots = await allowedRoots();
  if (!roots.some((root) => isWithin(root, entry))) throw new PathAccessError("Path is outside the configured file-manager roots");
  return entry;
}

function entryType(mode: number): "directory" | "file" | "symlink" | "other" {
  const kind = mode & 0o170000;
  if (kind === 0o040000) return "directory";
  if (kind === 0o100000) return "file";
  if (kind === 0o120000) return "symlink";
  return "other";
}

function modeToPermString(mode: number): string {
  const types = ["---", "--x", "-w-", "-wx", "r--", "r-x", "rw-", "rwx"];
  const typeChar = (mode & 0o170000) === 0o040000 ? "d" : (mode & 0o170000) === 0o120000 ? "l" : "-";
  return `${typeChar}${types[(mode >> 6) & 7]}${types[(mode >> 3) & 7]}${types[mode & 7]}`;
}

async function toEntry(entryPath: string, name: string) {
  const stat = await fs.lstat(entryPath);
  return {
    name,
    path: entryPath,
    type: entryType(stat.mode),
    size: stat.size,
    permissions: modeToPermString(stat.mode),
    modifiedAt: stat.mtime.toISOString(),
  };
}

function failPath(res: any, error: any, fallback: string): void {
  const code = error?.code;
  if (error instanceof PathAccessError) { res.status(403).json({ error: error.message }); return; }
  if (code === "ENOENT") { res.status(404).json({ error: "Path not found" }); return; }
  if (code === "EACCES" || code === "EPERM") { res.status(403).json({ error: "Permission denied" }); return; }
  res.status(500).json({ error: fallback });
}

router.get("/files/list", async (req, res) => {
  const parsed = ListFilesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const requestedPath = parsed.data.path ?? "/";
  try {
    const roots = await allowedRoots();
    if (requestedPath === "/") {
      const entries = await Promise.all(roots.map(async (root) => toEntry(root, path.basename(root) || root)));
      res.json({ path: "/", parentPath: null, entries: entries.sort((a, b) => a.name.localeCompare(b.name)) });
      return;
    }
    const dirPath = await resolveManagedPath(requestedPath);
    const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });
    const entries = await Promise.all(dirEntries.map(async (dirent) => {
      const entryPath = path.join(dirPath, dirent.name);
      try { return await toEntry(entryPath, dirent.name); }
      catch { return { name: dirent.name, path: entryPath, type: "other" as const, size: null, permissions: "----------", modifiedAt: new Date(0).toISOString() }; }
    }));
    entries.sort((a, b) => a.type === "directory" && b.type !== "directory" ? -1 : a.type !== "directory" && b.type === "directory" ? 1 : a.name.localeCompare(b.name));
    const parentPath = roots.includes(dirPath) ? "/" : path.dirname(dirPath);
    res.json({ path: dirPath, parentPath, entries });
  } catch (error: any) { failPath(res, error, "Failed to list directory"); }
});

router.get("/files/read", async (req, res) => {
  const parsed = ReadFileQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const filePath = await resolveManagedPath(parsed.data.path);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) { res.status(400).json({ error: "Not a file" }); return; }
    if (stat.size > MAX_TEXT_SIZE) { res.json({ path: filePath, content: "", isBinary: true, size: stat.size }); return; }
    const buf = await fs.readFile(filePath);
    const isBinary = buf.slice(0, Math.min(8192, buf.length)).includes(0);
    res.json({ path: filePath, content: isBinary ? "" : buf.toString("utf8"), isBinary, size: stat.size });
  } catch (error: any) { failPath(res, error, "Failed to read file"); }
});

router.post("/files/write", async (req, res) => {
  const parsed = WriteFileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { path: rawPath, content } = parsed.data;
  if (Buffer.byteLength(content, "utf8") > MAX_TEXT_SIZE) { res.status(413).json({ error: "File content exceeds the 5 MB limit" }); return; }
  try {
    const filePath = await resolveManagedPath(rawPath, true);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const verifiedPath = await resolveManagedPath(filePath, true);
    await fs.writeFile(verifiedPath, content, { encoding: "utf8", mode: 0o600 });
    await audit(req, "files.write", "file", verifiedPath, "success", { bytes: Buffer.byteLength(content, "utf8") }).catch(() => undefined);
    res.json({ ok: true });
  } catch (error: any) {
    await audit(req, "files.write", "file", rawPath, "failed").catch(() => undefined);
    failPath(res, error, "Failed to write file");
  }
});

router.delete("/files/delete", async (req, res) => {
  const parsed = DeleteFileQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const filePath = await resolveManagedEntryPath(parsed.data.path);
    const roots = await allowedRoots();
    if (roots.includes(filePath)) { res.status(400).json({ error: "Configured file-manager roots cannot be deleted" }); return; }
    const stat = await fs.lstat(filePath);
    if (stat.isDirectory()) await fs.rm(filePath, { recursive: parsed.data.recursive ?? false });
    else await fs.unlink(filePath);
    await audit(req, "files.delete", "file", filePath, "success", { directory: stat.isDirectory() }).catch(() => undefined);
    res.json({ ok: true });
  } catch (error: any) {
    await audit(req, "files.delete", "file", parsed.data.path, "failed").catch(() => undefined);
    failPath(res, error, "Failed to delete");
  }
});

router.post("/files/mkdir", async (req, res) => {
  const parsed = CreateDirectoryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const dirPath = await resolveManagedPath(parsed.data.path, true);
    await fs.mkdir(dirPath, { recursive: true });
    await resolveManagedPath(dirPath);
    await audit(req, "files.mkdir", "directory", dirPath, "success").catch(() => undefined);
    res.json({ ok: true });
  } catch (error: any) {
    await audit(req, "files.mkdir", "directory", parsed.data.path, "failed").catch(() => undefined);
    failPath(res, error, "Failed to create directory");
  }
});

router.post("/files/rename", async (req, res) => {
  const parsed = RenameFileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const oldPath = await resolveManagedEntryPath(parsed.data.oldPath);
    const newPath = await resolveManagedEntryPath(parsed.data.newPath, true);
    const roots = await allowedRoots();
    if (roots.includes(oldPath)) { res.status(400).json({ error: "Configured file-manager roots cannot be moved" }); return; }
    await fs.mkdir(path.dirname(newPath), { recursive: true });
    await resolveManagedEntryPath(newPath, true);
    await fs.rename(oldPath, newPath);
    await audit(req, "files.rename", "file", oldPath, "success", { to: newPath }).catch(() => undefined);
    res.json({ ok: true });
  } catch (error: any) {
    await audit(req, "files.rename", "file", parsed.data.oldPath, "failed", { to: parsed.data.newPath }).catch(() => undefined);
    failPath(res, error, "Failed to rename or move");
  }
});

router.get("/files/raw", async (req, res) => {
  const parsed = GetRawFileQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const filePath = await resolveManagedPath(parsed.data.path);
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) { res.status(400).json({ error: "Not a file" }); return; }
    const ext = path.extname(filePath).slice(1).toLowerCase();
    res.setHeader("Content-Type", MIME_MAP[ext] ?? "application/octet-stream");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    const stream = createReadStream(filePath);
    stream.on("error", (err) => {
      if (!res.headersSent) res.status(500).json({ error: "File stream failed" });
      else res.destroy(err);
    });
    stream.pipe(res);
  } catch (error: any) { failPath(res, error, "Failed to read raw file"); }
});

export default router;
