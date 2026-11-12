import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { withSshClient, execCommand } from "../lib/ssh";
import { decryptSecret, encryptSecret } from "../security/crypto";
import { audit } from "../security/audit";

const router: IRouter = Router();
const idSchema = z.object({ id: z.coerce.number().int().positive() });
const serverFields = z.object({
  name: z.string().min(1).max(191),
  host: z.string().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(22),
  username: z.string().min(1).max(191),
  authType: z.enum(["password", "privateKey"]).default("password"),
  password: z.string().max(4096).optional(),
  privateKey: z.string().max(65536).optional(),
  passphrase: z.string().max(4096).optional(),
  notes: z.string().max(4000).optional(),
});
const createSchema = serverFields.superRefine((data, ctx) => {
  if (data.authType === "password" && !data.password) ctx.addIssue({ code: "custom", path: ["password"], message: "Password authentication requires a password" });
  if (data.authType === "privateKey" && !data.privateKey) ctx.addIssue({ code: "custom", path: ["privateKey"], message: "Private-key authentication requires a private key" });
});
const updateSchema = serverFields.partial();
const trustSchema = z.object({ fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/) });
const remoteCommandSchema = z.object({
  command: z.string().min(1).max(8000).refine((value) => !value.includes("\0"), "Command cannot contain NUL characters"),
  cwd: z.string().max(4096).optional(),
});

function safe(row: any): any {
  const { password, privateKey, passphrase, pendingHostFingerprint, ...rest } = row;
  return rest;
}
function owner(req: any): number { return Number(req.user?.id ?? 0); }
async function rowFor(req: any, id: number): Promise<any | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT id, owner_id AS ownerId, name, host, port, username, auth_type AS authType,
      password, private_key AS privateKey, passphrase,
      host_fingerprint AS hostFingerprint, pending_host_fingerprint AS pendingHostFingerprint,
      status, notes, created_at AS createdAt, updated_at AS updatedAt
     FROM servers WHERE id=? AND owner_id=? LIMIT 1`,
    [id, owner(req)],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  row.password = decryptSecret(row.password);
  row.privateKey = decryptSecret(row.privateKey);
  row.passphrase = decryptSecret(row.passphrase);
  return row;
}
function sameFingerprint(a: string, b: string): boolean {
  return a.length === b.length && Buffer.from(a).equals(Buffer.from(b));
}
function shellQuote(value: string): string { return "'" + value.replace(/'/g, "'\\''") + "'"; }

router.get("/servers", async (req, res) => {
  const [rows] = await pool.query<any[]>(
    `SELECT id, owner_id AS ownerId, name, host, port, username, auth_type AS authType,
      host_fingerprint AS hostFingerprint, status, notes, created_at AS createdAt, updated_at AS updatedAt
     FROM servers WHERE owner_id=? ORDER BY created_at`,
    [owner(req)],
  );
  res.json(rows);
});

router.post("/servers", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;
  const [result] = await pool.execute<any>(
    `INSERT INTO servers (owner_id, name, host, port, username, auth_type, password, private_key, passphrase, notes, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown')`,
    [owner(req), data.name, data.host, data.port, data.username, data.authType,
      encryptSecret(data.password), encryptSecret(data.privateKey), encryptSecret(data.passphrase), data.notes ?? null],
  );
  const row = await rowFor(req, Number((result as any).insertId));
  await audit(req, "server.create", "server", row?.id ?? null, "success", { name: data.name, host: data.host });
  res.status(201).json(safe(row));
});

router.get("/servers/:id", async (req, res) => {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid server id" }); return; }
  const row = await rowFor(req, parsed.data.id);
  if (!row) { res.status(404).json({ error: "Server not found" }); return; }
  res.json(safe(row));
});

router.patch("/servers/:id", async (req, res) => {
  const parsed = idSchema.safeParse(req.params);
  const body = updateSchema.safeParse(req.body);
  if (!parsed.success || !body.success) { res.status(400).json({ error: "Invalid server update" }); return; }
  const existing = await rowFor(req, parsed.data.id);
  if (!existing) { res.status(404).json({ error: "Server not found" }); return; }
  if (body.data.authType === "password" && body.data.password === undefined && existing.authType !== "password") {
    res.status(400).json({ error: "Provide the new password when switching to password authentication" }); return;
  }
  if (body.data.authType === "privateKey" && body.data.privateKey === undefined && existing.authType !== "privateKey") {
    res.status(400).json({ error: "Provide the new private key when switching authentication methods" }); return;
  }
  const fields: string[] = [];
  const values: any[] = [];
  const map: Record<string, string> = {
    name: "name", host: "host", port: "port", username: "username", authType: "auth_type",
    password: "password", privateKey: "private_key", passphrase: "passphrase", notes: "notes",
  };
  for (const [key, value] of Object.entries(body.data)) {
    const column = map[key];
    if (!column) continue;
    fields.push(`${column}=?`);
    values.push(["password", "privateKey", "passphrase"].includes(key) ? encryptSecret(value as string | undefined) : (value ?? null));
  }
  if (body.data.host !== undefined && body.data.host !== existing.host || body.data.port !== undefined && body.data.port !== existing.port) {
    fields.push("host_fingerprint=NULL", "pending_host_fingerprint=NULL", "status='unknown'");
  }
  if (!fields.length) { res.status(400).json({ error: "No changes supplied" }); return; }
  values.push(parsed.data.id, owner(req));
  await pool.execute(`UPDATE servers SET ${fields.join(", ")}, updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`, values);
  const row = await rowFor(req, parsed.data.id);
  await audit(req, "server.update", "server", parsed.data.id, "success", { fields: Object.keys(body.data) });
  res.json(safe(row));
});

router.delete("/servers/:id", async (req, res) => {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid server id" }); return; }
  const [result] = await pool.execute<any>(`DELETE FROM servers WHERE id=? AND owner_id=?`, [parsed.data.id, owner(req)]);
  if (!(result as any).affectedRows) { res.status(404).json({ error: "Server not found" }); return; }
  await audit(req, "server.delete", "server", parsed.data.id, "success");
  res.sendStatus(204);
});

router.post("/servers/:id/trust-host", async (req, res) => {
  const parsedId = idSchema.safeParse(req.params);
  const parsedBody = trustSchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) { res.status(400).json({ error: "Invalid host fingerprint" }); return; }
  const row = await rowFor(req, parsedId.data.id);
  if (!row) { res.status(404).json({ error: "Server not found" }); return; }
  if (!row.pendingHostFingerprint || !sameFingerprint(row.pendingHostFingerprint, parsedBody.data.fingerprint)) {
    res.status(409).json({ error: "Fingerprint is stale. Test the connection again and verify the new fingerprint." });
    return;
  }
  await pool.execute(
    `UPDATE servers SET host_fingerprint=?, pending_host_fingerprint=NULL, status='unknown', updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`,
    [row.pendingHostFingerprint, parsedId.data.id, owner(req)],
  );
  await audit(req, "server.hostkey.trust", "server", parsedId.data.id, "success", { fingerprint: row.pendingHostFingerprint });
  res.json({ ok: true, hostFingerprint: row.pendingHostFingerprint });
});

router.post("/servers/:id/reset-host-key", async (req, res) => {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success || req.body?.confirm !== true) { res.status(400).json({ error: "Explicit host-key reset confirmation is required" }); return; }
  const row = await rowFor(req, parsed.data.id);
  if (!row) { res.status(404).json({ error: "Server not found" }); return; }
  await pool.execute(
    `UPDATE servers SET host_fingerprint=NULL, pending_host_fingerprint=NULL, status='unknown', updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`,
    [parsed.data.id, owner(req)],
  );
  await audit(req, "server.hostkey.reset", "server", parsed.data.id, "success");
  res.json({ ok: true });
});

router.post("/servers/:id/connect", async (req, res) => {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid server id" }); return; }
  const row = await rowFor(req, parsed.data.id);
  if (!row) { res.status(404).json({ error: "Server not found" }); return; }
  try {
    if (!row.hostFingerprint) {
      await withSshClient(row, async () => true, { allowUnpinned: true });
      const fingerprint = row.observedFingerprint;
      if (!fingerprint) throw new Error("The SSH server did not provide a verifiable host fingerprint");
      await pool.execute(
        `UPDATE servers SET pending_host_fingerprint=?, status='pending_trust', updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`,
        [fingerprint, parsed.data.id, owner(req)],
      );
      await audit(req, "server.connect.fingerprint", "server", parsed.data.id, "success", { state: "pending_trust", fingerprint });
      res.json({ success: false, trustRequired: true, fingerprint, message: "Compare this fingerprint with the one shown by your VPS provider before trusting it." });
      return;
    }
    const result = await withSshClient(row, async (client) => {
      const [{ stdout: os }, { stdout: uptime }, { stdout: hostname }] = await Promise.all([
        execCommand(client, "uname -o 2>/dev/null || uname -s"),
        execCommand(client, "uptime -p 2>/dev/null || uptime"),
        execCommand(client, "hostname"),
      ]);
      return { os: os.trim(), uptime: uptime.trim(), hostname: hostname.trim() };
    });
    await pool.execute(`UPDATE servers SET status='connected', updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`, [parsed.data.id, owner(req)]);
    await audit(req, "server.connect", "server", parsed.data.id, "success");
    res.json({ success: true, message: "Connection successful", serverInfo: result });
  } catch (error) {
    await pool.execute(`UPDATE servers SET status='error', updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`, [parsed.data.id, owner(req)]);
    await audit(req, "server.connect", "server", parsed.data.id, "failed");
    res.json({ success: false, message: error instanceof Error ? error.message : "Connection failed", serverInfo: null });
  }
});

router.post("/servers/:id/terminal/exec", async (req, res) => {
  const parsedId = idSchema.safeParse(req.params);
  const parsedBody = remoteCommandSchema.safeParse(req.body);
  if (!parsedId.success || !parsedBody.success) { res.status(400).json({ error: "Invalid remote command" }); return; }
  const row = await rowFor(req, parsedId.data.id);
  if (!row) { res.status(404).json({ error: "Server not found" }); return; }
  if (!row.hostFingerprint) { res.status(409).json({ error: "Verify and trust this server's SSH host fingerprint before running commands." }); return; }
  const command = parsedBody.data.cwd
    ? `cd -- ${shellQuote(parsedBody.data.cwd)} && ${parsedBody.data.command}`
    : parsedBody.data.command;
  try {
    const result = await withSshClient(row, (client) => execCommand(client, command));
    await audit(req, "server.terminal.exec", "server", parsedId.data.id, "success", { commandLength: parsedBody.data.command.length });
    res.json(result);
  } catch (error) {
    await audit(req, "server.terminal.exec", "server", parsedId.data.id, "failed", { commandLength: parsedBody.data.command.length });
    res.status(502).json({ error: "Remote command failed" });
  }
});

export default router;
