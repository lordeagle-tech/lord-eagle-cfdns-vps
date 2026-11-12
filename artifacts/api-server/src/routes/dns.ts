import { Router } from "express";
import { pool } from "@workspace/db";
import type { Request } from "express";
import { decryptSecret, encryptSecret } from "../security/crypto";
import { audit } from "../security/audit";

const router = Router();
const CF_API = "https://api.cloudflare.com/client/v4";
function ownerId(req: Request): number { return Number(req.user?.id ?? 0); }
function tokenFromRow(row: any): string { return decryptSecret(String(row.api_token ?? row.apiToken ?? "")) ?? ""; }
async function cf(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${CF_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || body.success === false) throw new Error(body?.errors?.[0]?.message ?? `Cloudflare request failed (${response.status})`);
  return body;
}
async function connectionFor(req: Request, id: string): Promise<any | null> {
  const [rows] = await pool.query<any[]>(`SELECT * FROM cloudflare_connections WHERE id=? AND owner_id=? LIMIT 1`, [id, ownerId(req)]);
  if (!rows[0]) return null; rows[0].apiToken = decryptSecret(rows[0].apiToken) ?? ""; return rows[0];
}
router.get("/dns/connections", async (req, res) => {
  const [rows] = await pool.query<any[]>(`SELECT id, name, created_at AS createdAt FROM cloudflare_connections WHERE owner_id=? ORDER BY created_at DESC`, [ownerId(req)]);
  res.json(rows);
});
router.post("/dns/connections", async (req, res) => {
  const name = String(req.body?.name ?? "Cloudflare").trim(); const apiToken = String(req.body?.apiToken ?? "").trim();
  if (!apiToken || apiToken.length < 20) { res.status(400).json({ error: "A valid Cloudflare API token is required" }); return; }
  try {
    await cf(apiToken, "/user/tokens/verify");
    const [result] = await pool.execute<any>(`INSERT INTO cloudflare_connections (owner_id, name, api_token) VALUES (?, ?, ?)`, [ownerId(req), name || "Cloudflare", encryptSecret(apiToken)]);
    const id = (result as any).insertId;
    const [rows] = await pool.query<any[]>(`SELECT id, name, created_at AS createdAt FROM cloudflare_connections WHERE id=?`, [id]);
    await audit(req, "dns.connection.create", "cloudflare_connection", id, "success", { name: name || "Cloudflare" });
    res.status(201).json(rows[0]);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Cloudflare token validation failed" }); }
});
router.delete("/dns/connections/:id", async (req, res) => {
  await pool.execute(`DELETE FROM cloudflare_connections WHERE id=? AND owner_id=?`, [req.params.id, ownerId(req)]); await audit(req, "dns.connection.delete", "cloudflare_connection", req.params.id, "success"); res.sendStatus(204);
});
router.post("/dns/connections/:id/sync", async (req, res) => {
  const connection = await connectionFor(req, req.params.id); if (!connection) { res.status(404).json({ error: "Connection not found" }); return; }
  try {
    const body = await cf(tokenFromRow(connection), "/zones?per_page=100");
    for (const zone of body.result ?? []) await pool.execute(`INSERT INTO dns_zones (owner_id, connection_id, zone_id, zone_name) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE connection_id=VALUES(connection_id), zone_name=VALUES(zone_name), status='active'`, [ownerId(req), connection.id, zone.id, zone.name]);
    const [zones] = await pool.query<any[]>(`SELECT id, zone_id AS zoneId, zone_name AS zoneName, status, connection_id AS connectionId FROM dns_zones WHERE owner_id=? ORDER BY zone_name`, [ownerId(req)]);
    res.json(zones);
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Zone sync failed" }); }
});
router.get("/dns/zones", async (req, res) => {
  const [zones] = await pool.query<any[]>(`SELECT id, zone_id AS zoneId, zone_name AS zoneName, status, connection_id AS connectionId FROM dns_zones WHERE owner_id=? ORDER BY zone_name`, [ownerId(req)]); res.json(zones);
});
async function zoneFor(req: Request, id: string): Promise<any | null> {
  const [rows] = await pool.query<any[]>(`SELECT z.*, c.api_token AS apiToken FROM dns_zones z JOIN cloudflare_connections c ON c.id=z.connection_id WHERE z.id=? AND z.owner_id=? LIMIT 1`, [id, ownerId(req)]); return rows[0] ?? null;
}
router.get("/dns/zones/:id/records", async (req, res) => {
  const zone = await zoneFor(req, req.params.id); if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  try { const body = await cf(zone.apiToken, `/zones/${zone.zone_id}/dns_records?per_page=100`); res.json(body.result ?? []); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Record lookup failed" }); }
});
router.post("/dns/zones/:id/records", async (req, res) => {
  const zone = await zoneFor(req, req.params.id); if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  const type = String(req.body?.type ?? "A").toUpperCase(); const name = String(req.body?.name ?? "").trim().toLowerCase(); const content = String(req.body?.content ?? "").trim();
  if (!name || !content || !/^[A-Z0-9]+$/.test(type)) { res.status(400).json({ error: "Record type, name, and content are required" }); return; }
  const fqdn = name === "@" || name === zone.zone_name ? zone.zone_name : name.endsWith(`.${zone.zone_name}`) ? name : `${name}.${zone.zone_name}`;
  if (!["A", "AAAA", "CNAME"].includes(type) && req.body?.proxied) { res.status(400).json({ error: `${type} records cannot be proxied` }); return; }
  try { const body = await cf(zone.apiToken, `/zones/${zone.zone_id}/dns_records`, { method: "POST", body: JSON.stringify({ type, name: fqdn, content, ttl: 1, proxied: ["A", "AAAA", "CNAME"].includes(type) && Boolean(req.body?.proxied), ...(type === "MX" ? { priority: Number(req.body?.priority ?? 10) } : {}) }) }); await audit(req, "dns.record.create", "dns_record", body.result?.id ?? null, "success", { zoneId: req.params.id, type }); res.status(201).json(body.result); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Record creation failed" }); }
});
router.patch("/dns/zones/:id/records/:recordId", async (req, res) => {
  const zone = await zoneFor(req, req.params.id); if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  const payload: Record<string, unknown> = {}; if (req.body?.content !== undefined) payload.content = String(req.body.content); if (req.body?.proxied !== undefined) payload.proxied = Boolean(req.body.proxied); if (req.body?.priority !== undefined) payload.priority = Number(req.body.priority);
  try { const body = await cf(zone.apiToken, `/zones/${zone.zone_id}/dns_records/${req.params.recordId}`, { method: "PATCH", body: JSON.stringify(payload) }); await audit(req, "dns.record.update", "dns_record", req.params.recordId, "success", { zoneId: req.params.id }); res.json(body.result); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Record update failed" }); }
});
router.delete("/dns/zones/:id/records/:recordId", async (req, res) => {
  const zone = await zoneFor(req, req.params.id); if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  try { await cf(zone.apiToken, `/zones/${zone.zone_id}/dns_records/${req.params.recordId}`, { method: "DELETE" }); await audit(req, "dns.record.delete", "dns_record", req.params.recordId, "success", { zoneId: req.params.id }); res.sendStatus(204); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Record deletion failed" }); }
});
export default router;
