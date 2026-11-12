import { Router } from "express";
import { isIP } from "node:net";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import type { Request } from "express";
import { decryptSecret, encryptSecret } from "../security/crypto";
import { audit } from "../security/audit";
import { parseDnsImport } from "../lib/dns-import";
import { analyzeDnsHealth, checkPropagation } from "../lib/dns-diagnostics";

const router = Router();
const CF_API = "https://api.cloudflare.com/client/v4";
const RECORD_TYPES = new Set(["A", "AAAA", "CNAME", "TXT", "MX", "NS"]);
const PROXYABLE_TYPES = new Set(["A", "AAAA", "CNAME"]);

function ownerId(req: Request): number { return Number(req.user?.id ?? 0); }
function tokenFromRow(row: any): string { return decryptSecret(String(row.api_token ?? row.apiToken ?? "")) ?? ""; }

async function cf(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(`${CF_API}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok || body.success === false) {
    throw new Error(body?.errors?.[0]?.message ?? `Cloudflare request failed (${response.status})`);
  }
  return body;
}

async function connectionFor(req: Request, id: string): Promise<any | null> {
  const [rows] = await pool.query<any[]>(`SELECT * FROM cloudflare_connections WHERE id=? AND owner_id=? LIMIT 1`, [id, ownerId(req)]);
  if (!rows[0]) return null;
  return { ...rows[0], apiToken: tokenFromRow(rows[0]) };
}

async function zoneFor(req: Request, id: string): Promise<any | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT z.*, c.api_token AS apiToken
     FROM dns_zones z JOIN cloudflare_connections c ON c.id=z.connection_id
     WHERE z.id=? AND z.owner_id=? AND z.status='active' AND c.owner_id=? LIMIT 1`,
    [id, ownerId(req), ownerId(req)],
  );
  if (!rows[0]) return null;
  return { ...rows[0], apiToken: decryptSecret(String(rows[0].apiToken ?? "")) ?? "" };
}

function validDnsName(value: string): boolean {
  if (!value || value.length > 253) return false;
  return value.split(".").every((label) =>
    label.length >= 1 && label.length <= 63 && /^[a-z0-9_-]+$/i.test(label) && !label.startsWith("-") && !label.endsWith("-"),
  );
}

function recordName(input: unknown, zoneName: string): string | null {
  const name = String(input ?? "").trim().toLowerCase().replace(/\.$/, "");
  const zone = zoneName.trim().toLowerCase().replace(/\.$/, "");
  if (!name || !validDnsName(zone)) return null;
  const fqdn = name === "@" || name === zone ? zone : name.endsWith(`.${zone}`) ? name : `${name}.${zone}`;
  return validDnsName(fqdn) && (fqdn === zone || fqdn.endsWith(`.${zone}`)) ? fqdn : null;
}

function validRecordContent(type: string, content: string): boolean {
  if (!content || content.length > 4096) return false;
  if (type === "A") return isIP(content) === 4;
  if (type === "AAAA") return isIP(content) === 6;
  if (["CNAME", "MX", "NS"].includes(type)) return validDnsName(content.trim().replace(/\.$/, ""));
  if (type === "TXT") return content.length <= 4096;
  return false;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type DnsSnapshot = { id?: string; type: string; name: string; content: string; ttl: number; proxied: boolean; priority?: number };
function snapshot(record: any): DnsSnapshot {
  return {
    ...(record.id ? { id: String(record.id) } : {}),
    type: String(record.type ?? "").toUpperCase(),
    name: String(record.name ?? "").toLowerCase(),
    content: String(record.content ?? ""),
    ttl: Number(record.ttl ?? 1),
    proxied: Boolean(record.proxied),
    ...(record.type === "MX" || record.priority !== undefined ? { priority: Number(record.priority ?? 10) } : {}),
  };
}
function snapshotKey(record: any): string {
  const value = snapshot(record);
  return JSON.stringify([value.type, value.name, value.content, value.ttl, value.proxied, value.priority ?? null]);
}
function importSecret(): string {
  const secret = process.env.APP_ENCRYPTION_KEY ?? process.env.MANUS_JWT_SECRET ?? process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("Import preview signing is not configured");
  return secret;
}
function signPlan(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", importSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}
function verifyPlan(token: string): any | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature || token.length > 2048) return null;
  try {
    const expected = createHmac("sha256", importSecret()).update(encoded).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object" || !Number.isFinite(payload.issuedAt) || Date.now() - payload.issuedAt > 15 * 60_000 || payload.issuedAt > Date.now() + 30_000) return null;
    return payload;
  } catch { return null; }
}
function ttlValue(value: unknown): number | null {
  const ttl = Number(value ?? 1);
  return Number.isInteger(ttl) && (ttl === 1 || (ttl >= 60 && ttl <= 86400)) ? ttl : null;
}
async function listRecords(zone: any): Promise<any[]> {
  const records: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const body = await cf(zone.apiToken, `/zones/${encodeURIComponent(zone.zone_id)}/dns_records?per_page=100&page=${page}`);
    records.push(...(body.result ?? []));
    const pages = Number(body.result_info?.total_pages ?? 1);
    if (page >= pages || !(body.result ?? []).length) return records;
  }
  throw new Error("Zone exceeds the 2,000-record operation limit; narrow the zone or use Cloudflare directly");
}
async function listZones(token: string): Promise<any[]> {
  const zones: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const body = await cf(token, `/zones?per_page=100&page=${page}`);
    zones.push(...(body.result ?? []));
    const pages = Number(body.result_info?.total_pages ?? 1);
    if (page >= pages || !(body.result ?? []).length) return zones;
  }
  throw new Error("Cloudflare account exceeds the 2,000-zone sync limit");
}
function createRecordPayload(record: any, zone: any): Record<string, unknown> {
  const type = String(record.type ?? "").toUpperCase();
  const name = recordName(record.name, zone.zone_name);
  const content = String(record.content ?? "").trim();
  const ttl = ttlValue(record.ttl);
  const priority = Number(record.priority ?? 10);
  if (type === "NS" && name === String(zone.zone_name).toLowerCase()) {
    throw new Error("Cloudflare manages apex nameservers; change delegation at the registrar or Cloudflare account");
  }
  if (!RECORD_TYPES.has(type) || !name || !validRecordContent(type, content) || ttl === null) {
    throw new Error("Import contains an unsupported or invalid DNS record");
  }
  if (type === "MX" && (!Number.isInteger(priority) || priority < 0 || priority > 65535)) {
    throw new Error("Import contains an invalid MX priority");
  }
  return {
    type, name, content, ttl,
    proxied: PROXYABLE_TYPES.has(type) && Boolean(record.proxied),
    ...(type === "MX" ? { priority } : {}),
  };
}

router.get("/dns/connections", async (req, res) => {
  const [rows] = await pool.query<any[]>(
    `SELECT c.id, c.name, c.created_at AS createdAt, COUNT(z.id) AS accessibleZoneCount
     FROM cloudflare_connections c LEFT JOIN dns_zones z ON z.connection_id=c.id AND z.owner_id=c.owner_id AND z.status='active'
     WHERE c.owner_id=? GROUP BY c.id, c.name, c.created_at ORDER BY c.created_at DESC`,
    [ownerId(req)],
  );
  const [scopeRows] = await pool.query<any[]>(`SELECT connection_id AS connectionId, zone_name AS zoneName FROM dns_zones WHERE owner_id=? AND status='active' ORDER BY zone_name`, [ownerId(req)]);
  const scopes = new Map<number, string[]>();
  for (const row of scopeRows) {
    const id = Number(row.connectionId);
    scopes.set(id, [...(scopes.get(id) ?? []), String(row.zoneName)]);
  }
  res.json(rows.map((row) => ({ ...row, accessibleZoneCount: Number(row.accessibleZoneCount), visibleZones: scopes.get(Number(row.id)) ?? [] })));
});

router.post("/dns/connections", async (req, res) => {
  const name = String(req.body?.name ?? "Cloudflare").trim().slice(0, 191);
  const apiToken = String(req.body?.apiToken ?? "").trim();
  if (!apiToken || apiToken.length < 20 || apiToken.length > 4096) {
    res.status(400).json({ error: "A valid Cloudflare API token is required" });
    return;
  }
  try {
    await cf(apiToken, "/user/tokens/verify");
    await cf(apiToken, "/zones?per_page=1");
    const visibleZones = await listZones(apiToken);
    const [result] = await pool.execute<any>(
      `INSERT INTO cloudflare_connections (owner_id, name, api_token) VALUES (?, ?, ?)`,
      [ownerId(req), name || "Cloudflare", encryptSecret(apiToken)],
    );
    const id = (result as any).insertId;
    for (const zone of visibleZones) {
      await pool.execute(
        `INSERT INTO dns_zones (owner_id, connection_id, zone_id, zone_name, status) VALUES (?, ?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE connection_id=VALUES(connection_id), zone_name=VALUES(zone_name), status='active'`,
        [ownerId(req), id, zone.id, zone.name],
      );
    }
    const [rows] = await pool.query<any[]>(
      `SELECT id, name, created_at AS createdAt FROM cloudflare_connections WHERE id=? AND owner_id=?`,
      [id, ownerId(req)],
    );
    await audit(req, "dns.connection.create", "cloudflare_connection", id, "success", { name: name || "Cloudflare", visibleZoneCount: visibleZones.length });
    res.status(201).json({ ...rows[0], accessibleZoneCount: visibleZones.length, visibleZones: visibleZones.map((zone) => String(zone.name)) });
  } catch (error) {
    await audit(req, "dns.connection.create", "cloudflare_connection", null, "failed", { name }).catch(() => undefined);
    res.status(400).json({ error: errorText(error, "Cloudflare token validation failed") });
  }
});

router.delete("/dns/connections/:id", async (req, res) => {
  await pool.execute(`DELETE FROM dns_zones WHERE connection_id=? AND owner_id=?`, [req.params.id, ownerId(req)]);
  await pool.execute(`DELETE FROM cloudflare_connections WHERE id=? AND owner_id=?`, [req.params.id, ownerId(req)]);
  await audit(req, "dns.connection.delete", "cloudflare_connection", req.params.id, "success");
  res.sendStatus(204);
});

router.post("/dns/connections/:id/token", async (req, res) => {
  const connection = await connectionFor(req, req.params.id);
  if (!connection) { res.status(404).json({ error: "Connection not found" }); return; }
  const apiToken = String(req.body?.apiToken ?? "").trim();
  if (apiToken.length < 20 || apiToken.length > 4096) { res.status(400).json({ error: "A valid Cloudflare API token is required" }); return; }
  let zones: any[];
  try {
    await cf(apiToken, "/user/tokens/verify");
    await cf(apiToken, "/zones?per_page=1");
    zones = await listZones(apiToken);
  } catch {
    await audit(req, "dns.connection.token.rotate", "cloudflare_connection", req.params.id, "failed").catch(() => undefined);
    res.status(400).json({ error: "Token verification failed. Check that it is active and has Zone:Read access." });
    return;
  }
  await pool.execute(`UPDATE cloudflare_connections SET api_token=? WHERE id=? AND owner_id=?`, [encryptSecret(apiToken), req.params.id, ownerId(req)]);
  await pool.execute(`UPDATE dns_zones SET status='unavailable' WHERE connection_id=? AND owner_id=?`, [req.params.id, ownerId(req)]);
  for (const zone of zones) {
    await pool.execute(
      `INSERT INTO dns_zones (owner_id, connection_id, zone_id, zone_name, status) VALUES (?, ?, ?, ?, 'active')
       ON DUPLICATE KEY UPDATE connection_id=VALUES(connection_id), zone_name=VALUES(zone_name), status='active'`,
      [ownerId(req), connection.id, zone.id, zone.name],
    );
  }
  await audit(req, "dns.connection.token.rotate", "cloudflare_connection", req.params.id, "success", { visibleZoneCount: zones.length });
  res.json({ ok: true, visibleZoneCount: zones.length });
});

router.post("/dns/connections/:id/sync", async (req, res) => {
  const connection = await connectionFor(req, req.params.id);
  if (!connection) { res.status(404).json({ error: "Connection not found" }); return; }
  try {
    const zonesFromCloudflare = await listZones(connection.apiToken);
    await pool.execute(`UPDATE dns_zones SET status='unavailable' WHERE connection_id=? AND owner_id=?`, [connection.id, ownerId(req)]);
    for (const zone of zonesFromCloudflare) {
      await pool.execute(
        `INSERT INTO dns_zones (owner_id, connection_id, zone_id, zone_name)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE connection_id=VALUES(connection_id), zone_name=VALUES(zone_name), status='active'`,
        [ownerId(req), connection.id, zone.id, zone.name],
      );
    }
    const [zones] = await pool.query<any[]>(
      `SELECT id, zone_id AS zoneId, zone_name AS zoneName, status, connection_id AS connectionId
       FROM dns_zones WHERE owner_id=? AND status='active' ORDER BY zone_name`,
      [ownerId(req)],
    );
    await audit(req, "dns.zone.sync", "cloudflare_connection", req.params.id, "success", { visibleZoneCount: zonesFromCloudflare.length });
    res.json(zones);
  } catch (error) {
    await audit(req, "dns.zone.sync", "cloudflare_connection", req.params.id, "failed").catch(() => undefined);
    res.status(400).json({ error: errorText(error, "Zone sync failed") });
  }
});

router.get("/dns/zones", async (req, res) => {
  const [zones] = await pool.query<any[]>(
    `SELECT id, zone_id AS zoneId, zone_name AS zoneName, status, connection_id AS connectionId
     FROM dns_zones WHERE owner_id=? AND status='active' ORDER BY zone_name`,
    [ownerId(req)],
  );
  res.json(zones);
});

router.get("/dns/zones/:id/records", async (req, res) => {
  const zone = await zoneFor(req, req.params.id);
  if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  try {
    res.json(await listRecords(zone));
  } catch (error) {
    res.status(400).json({ error: errorText(error, "Record lookup failed") });
  }
});

router.post("/dns/zones/:id/records", async (req, res) => {
  const zone = await zoneFor(req, req.params.id);
  if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  const type = String(req.body?.type ?? "A").toUpperCase();
  const name = recordName(req.body?.name, zone.zone_name);
  const content = String(req.body?.content ?? "").trim();
  const priority = Number(req.body?.priority ?? 10);
  const ttl = ttlValue(req.body?.ttl);
  if (!RECORD_TYPES.has(type) || !name || !validRecordContent(type, content) || ttl === null) {
    res.status(400).json({ error: "Use a supported record type, a name inside this zone, and valid content for that type" });
    return;
  }
  if (type === "NS" && name === String(zone.zone_name).toLowerCase()) {
    res.status(400).json({ error: "Cloudflare manages apex nameservers; change delegation at the registrar or Cloudflare account" });
    return;
  }
  if (type === "MX" && (!Number.isInteger(priority) || priority < 0 || priority > 65535)) {
    res.status(400).json({ error: "MX priority must be an integer from 0 to 65535" });
    return;
  }
  const proxied = PROXYABLE_TYPES.has(type) && Boolean(req.body?.proxied);
  try {
    const body = await cf(zone.apiToken, `/zones/${encodeURIComponent(zone.zone_id)}/dns_records`, {
      method: "POST",
      body: JSON.stringify({
        type, name, content, ttl, proxied,
        ...(type === "MX" ? { priority } : {}),
      }),
    });
    await audit(req, "dns.record.create", "dns_record", body.result?.id ?? null, "success", { zoneId: req.params.id, before: null, after: snapshot(body.result) });
    res.status(201).json(body.result);
  } catch (error) {
    await audit(req, "dns.record.create", "dns_record", null, "failed", { zoneId: req.params.id, type }).catch(() => undefined);
    res.status(400).json({ error: errorText(error, "Record creation failed") });
  }
});

router.patch("/dns/zones/:id/records/:recordId", async (req, res) => {
  const zone = await zoneFor(req, req.params.id);
  if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  const payload: Record<string, unknown> = {};
  try {
    const current = await cf(zone.apiToken, `/zones/${encodeURIComponent(zone.zone_id)}/dns_records/${encodeURIComponent(req.params.recordId)}`);
    const type = String(current.result?.type ?? "").toUpperCase();
    if (!RECORD_TYPES.has(type)) { res.status(400).json({ error: "Unsupported DNS record type" }); return; }
    const before = snapshot(current.result);
    if (req.body?.name !== undefined) {
      const name = recordName(req.body.name, zone.zone_name);
      if (!name) { res.status(400).json({ error: "Record name must be valid and inside this zone" }); return; }
      if (type === "NS" && name === String(zone.zone_name).toLowerCase()) { res.status(400).json({ error: "Cloudflare manages apex nameservers; change delegation at the registrar or Cloudflare account" }); return; }
      payload.name = name;
    }
    if (req.body?.content !== undefined) {
      const content = String(req.body.content).trim();
      if (!validRecordContent(type, content)) { res.status(400).json({ error: "Invalid content for this DNS record type" }); return; }
      payload.content = content;
    }
    if (req.body?.ttl !== undefined) {
      const ttl = ttlValue(req.body.ttl);
      if (ttl === null) { res.status(400).json({ error: "TTL must be Auto or an integer from 60 to 86400" }); return; }
      payload.ttl = ttl;
    }
    if (req.body?.proxied !== undefined) {
      if (Boolean(req.body.proxied) && !PROXYABLE_TYPES.has(type)) {
        res.status(400).json({ error: `${type} records cannot be proxied` });
        return;
      }
      payload.proxied = PROXYABLE_TYPES.has(type) && Boolean(req.body.proxied);
    }
    if (req.body?.priority !== undefined) {
      const priority = Number(req.body.priority);
      if (type !== "MX" || !Number.isInteger(priority) || priority < 0 || priority > 65535) {
        res.status(400).json({ error: "Priority is only supported for MX records and must be 0 through 65535" });
        return;
      }
      payload.priority = priority;
    }
    if (Object.keys(payload).length === 0) { res.status(400).json({ error: "No valid record fields supplied" }); return; }
    const body = await cf(zone.apiToken, `/zones/${encodeURIComponent(zone.zone_id)}/dns_records/${encodeURIComponent(req.params.recordId)}`, {
      method: "PATCH", body: JSON.stringify(payload),
    });
    await audit(req, "dns.record.update", "dns_record", req.params.recordId, "success", { zoneId: req.params.id, before, after: snapshot(body.result) });
    res.json(body.result);
  } catch (error) {
    await audit(req, "dns.record.update", "dns_record", req.params.recordId, "failed", { zoneId: req.params.id }).catch(() => undefined);
    res.status(400).json({ error: errorText(error, "Record update failed") });
  }
});

router.delete("/dns/zones/:id/records/:recordId", async (req, res) => {
  const zone = await zoneFor(req, req.params.id);
  if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  try {
    const current = await cf(zone.apiToken, `/zones/${encodeURIComponent(zone.zone_id)}/dns_records/${encodeURIComponent(req.params.recordId)}`);
    if (!current.result) { res.status(404).json({ error: "DNS record not found" }); return; }
    await cf(zone.apiToken, `/zones/${encodeURIComponent(zone.zone_id)}/dns_records/${encodeURIComponent(req.params.recordId)}`, { method: "DELETE" });
    await audit(req, "dns.record.delete", "dns_record", req.params.recordId, "success", { zoneId: req.params.id, before: snapshot(current.result), after: null });
    res.sendStatus(204);
  } catch (error) {
    await audit(req, "dns.record.delete", "dns_record", req.params.recordId, "failed", { zoneId: req.params.id }).catch(() => undefined);
    res.status(400).json({ error: errorText(error, "Record deletion failed") });
  }
});

function planImport(zone: any, imported: any[], currentRecords: any[]) {
  const unique = new Map<string, any>();
  for (const item of imported) {
    const payload = createRecordPayload(item, zone);
    const key = `${payload.type}|${payload.name}|${payload.content}|${payload.priority ?? ""}`;
    if (unique.has(key) && snapshotKey(unique.get(key)) !== snapshotKey(payload)) {
      throw new Error("Import contains duplicate records with conflicting TTL or proxy settings");
    }
    if (!unique.has(key)) unique.set(key, payload);
  }
  const plan: { operation: "create" | "update"; before: DnsSnapshot | null; after: Record<string, unknown> }[] = [];
  const unchanged: DnsSnapshot[] = [];
  for (const after of unique.values()) {
    const sameName = currentRecords.filter((record) => record.type === after.type && record.name === after.name);
    const exact = sameName.find((record) => snapshotKey(record) === snapshotKey(after));
    if (exact) { unchanged.push(snapshot(exact)); continue; }
    if (sameName.length === 1) plan.push({ operation: "update", before: snapshot(sameName[0]), after });
    else plan.push({ operation: "create", before: null, after });
  }
  return { plan, unchanged };
}

function filterCloudflareManaged(imported: any[], zone: any) {
  const apex = String(zone.zone_name).toLowerCase();
  const ignoredApexNs = imported.filter((item) => item.type === "NS" && recordName(item.name, zone.zone_name) === apex).length;
  return { records: imported.filter((item) => !(item.type === "NS" && recordName(item.name, zone.zone_name) === apex)), ignoredApexNs };
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

router.get("/dns/zones/:id/export", async (req, res) => {
  const zone = await zoneFor(req, req.params.id);
  if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  const format = String(req.query.format ?? "csv").toLowerCase();
  if (format !== "csv" && format !== "bind") { res.status(400).json({ error: "Choose CSV or BIND format" }); return; }
  try {
    const records = await listRecords(zone);
    const included = records.filter((record) => RECORD_TYPES.has(String(record.type).toUpperCase()));
    const omitted = [...new Set(records.map((record) => String(record.type).toUpperCase()).filter((type) => !RECORD_TYPES.has(type)))].sort();
    if (omitted.length) res.setHeader("X-CFDNS-Omitted-Record-Types", omitted.join(","));
    const text = format === "csv"
      ? ["type,name,content,ttl,proxied,priority", ...included.map((record) => [record.type, record.name, record.content, record.ttl, Boolean(record.proxied), record.priority ?? ""].map(csvCell).join(","))].join("\r\n") + "\r\n"
      : [
          `$ORIGIN ${zone.zone_name}.`, "$TTL 3600", "; Cloudflare TTL 1 (Auto) is represented by the default TTL here.",
          ...(omitted.length ? [`; Omitted unsupported record types: ${omitted.join(", ")}`] : []),
          ...included.map((record) => {
            const name = record.name === zone.zone_name ? "@" : record.name;
            const ttl = Number(record.ttl) === 1 ? "" : ` ${Number(record.ttl)}`;
            const priority = record.type === "MX" ? ` ${Number(record.priority ?? 10)}` : "";
            const content = record.type === "TXT" ? `"${String(record.content).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : String(record.content);
            return `${name}${ttl} IN ${record.type}${priority} ${content}`;
          }),
        ].join("\n") + "\n";
    const stem = String(zone.zone_name).replace(/[^a-z0-9.-]/gi, "_");
    res.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${stem}.${format === "csv" ? "csv" : "zone"}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(text);
  } catch (error) { res.status(502).json({ error: errorText(error, "DNS export failed") }); }
});

router.post("/dns/zones/:id/import/preview", async (req, res) => {
  const zone = await zoneFor(req, req.params.id);
  if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  const format = req.body?.format;
  const text = req.body?.text;
  if ((format !== "csv" && format !== "bind") || typeof text !== "string") { res.status(400).json({ error: "Provide CSV or BIND text to preview" }); return; }
  try {
    const parsedRecords = parseDnsImport(text, format, zone.zone_name);
    const { records: imported, ignoredApexNs } = filterCloudflareManaged(parsedRecords, zone);
    const current = await listRecords(zone);
    const { plan, unchanged } = planImport(zone, imported, current);
    const sourceHash = createHash("sha256").update(`${format}\n${text}`).digest("hex");
    const planHash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
    const previewToken = signPlan({ ownerId: ownerId(req), zoneId: String(req.params.id), format, sourceHash, planHash, issuedAt: Date.now() });
    const warnings = format === "bind" ? ["BIND zone-apex SOA records are ignored because Cloudflare manages the SOA."] : [];
    if (ignoredApexNs) warnings.push(`${ignoredApexNs} zone-apex NS record(s) were ignored; change authoritative nameservers at your registrar or Cloudflare account.`);
    res.setHeader("Cache-Control", "no-store");
    res.json({ previewToken, totalRecords: parsedRecords.length, ignoredApexNsCount: ignoredApexNs, warnings, createCount: plan.filter((item) => item.operation === "create").length, updateCount: plan.filter((item) => item.operation === "update").length, unchangedCount: unchanged.length, changes: plan.slice(0, 1000) });
  } catch (error) {
    await audit(req, "dns.import.preview", "dns_zone", req.params.id, "failed").catch(() => undefined);
    res.status(400).json({ error: errorText(error, "DNS import preview failed") });
  }
});

router.post("/dns/zones/:id/import/apply", async (req, res) => {
  const zone = await zoneFor(req, req.params.id);
  if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  const format = req.body?.format;
  const text = req.body?.text;
  const signed = verifyPlan(String(req.body?.previewToken ?? ""));
  if (!signed || signed.ownerId !== ownerId(req) || signed.zoneId !== String(req.params.id) || signed.format !== format || typeof text !== "string") {
    res.status(400).json({ error: "Import preview expired or invalid. Preview the file again." }); return;
  }
  try {
    if (createHash("sha256").update(`${format}\n${text}`).digest("hex") !== signed.sourceHash) {
      res.status(400).json({ error: "Import source changed after preview. Preview it again." }); return;
    }
    const parsedRecords = parseDnsImport(text, format, zone.zone_name);
    const { records: imported } = filterCloudflareManaged(parsedRecords, zone);
    const current = await listRecords(zone);
    const { plan } = planImport(zone, imported, current);
    if (createHash("sha256").update(JSON.stringify(plan)).digest("hex") !== signed.planHash) {
      res.status(409).json({ error: "DNS records changed after preview. Refresh and review a new diff." }); return;
    }
    const results: { operation: string; name: string; success: boolean; error?: string }[] = [];
    for (const item of plan) {
      try {
        const path = `/zones/${encodeURIComponent(zone.zone_id)}/dns_records${item.operation === "update" ? `/${encodeURIComponent(String(item.before?.id))}` : ""}`;
        const response = await cf(zone.apiToken, path, { method: item.operation === "update" ? "PATCH" : "POST", body: JSON.stringify(item.after) });
        const after = snapshot(response.result);
        await audit(req, `dns.record.${item.operation}`, "dns_record", after.id ?? null, "success", { zoneId: req.params.id, before: item.before, after });
        results.push({ operation: item.operation, name: String(item.after.name), success: true });
      } catch (error) {
        results.push({ operation: item.operation, name: String(item.after.name), success: false, error: errorText(error, "Cloudflare rejected the record") });
      }
    }
    const failed = results.filter((item) => !item.success).length;
    await audit(req, "dns.import.apply", "dns_zone", req.params.id, failed ? "failed" : "success", { attempted: results.length, failed });
    res.status(failed ? 207 : 200).json({ applied: results.length - failed, failed, results });
  } catch (error) { res.status(400).json({ error: errorText(error, "DNS import apply failed") }); }
});

router.get("/dns/zones/:id/health", async (req, res) => {
  const zone = await zoneFor(req, req.params.id);
  if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  try {
    const records = await listRecords(zone);
    res.setHeader("Cache-Control", "no-store");
    res.json({ zoneName: zone.zone_name, recordCount: records.length, findings: analyzeDnsHealth(zone.zone_name, records) });
  } catch (error) { res.status(502).json({ error: errorText(error, "DNS health check failed") }); }
});

router.post("/dns/zones/:id/propagation", async (req, res) => {
  const zone = await zoneFor(req, req.params.id);
  if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  const name = recordName(req.body?.name, zone.zone_name);
  const type = String(req.body?.type ?? "A").toUpperCase();
  if (!name) { res.status(400).json({ error: "Query name must be a valid name inside this zone" }); return; }
  try {
    const results = await checkPropagation(name, type);
    res.setHeader("Cache-Control", "no-store");
    res.json({ name, type, results });
  } catch (error) { res.status(400).json({ error: errorText(error, "Propagation check failed") }); }
});

router.get("/dns/zones/:id/history", async (req, res) => {
  const zone = await zoneFor(req, req.params.id);
  if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  const rawLimit = Number(req.query.limit ?? 50);
  const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 50;
  const [rows] = await pool.query<any[]>(
    `SELECT id, action, target_id AS targetId, status, metadata, created_at AS createdAt
     FROM audit_logs WHERE owner_id=? AND target_type='dns_record'
       AND action IN ('dns.record.create','dns.record.update','dns.record.delete')
       AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.zoneId'))=?
     ORDER BY id DESC LIMIT ?`, [ownerId(req), String(req.params.id), limit],
  );
  const entries = rows.map((row) => {
    let metadata: any = {};
    try { metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata ?? {}; } catch { /* hide invalid metadata */ }
    const before = metadata.before ?? null;
    const after = metadata.after ?? null;
    const hasSnapshot = row.action === "dns.record.create" ? Boolean(after) : row.action === "dns.record.delete" ? Boolean(before) : Boolean(before && after);
    return { id: row.id, action: row.action, recordId: row.targetId, status: row.status, createdAt: row.createdAt, before, after, rollbackable: row.status === "success" && hasSnapshot };
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({ entries });
});

router.post("/dns/zones/:id/history/:entryId/rollback", async (req, res) => {
  const zone = await zoneFor(req, req.params.id);
  if (!zone) { res.status(404).json({ error: "Zone not found" }); return; }
  const entryId = Number(req.params.entryId);
  if (!Number.isSafeInteger(entryId) || entryId < 1) { res.status(400).json({ error: "Invalid history entry" }); return; }
  const [rows] = await pool.query<any[]>(
    `SELECT id, action, target_id AS targetId, status, metadata FROM audit_logs
     WHERE id=? AND owner_id=? AND target_type='dns_record' LIMIT 1`, [entryId, ownerId(req)],
  );
  const row = rows[0];
  if (!row || row.status !== "success" || !["dns.record.create", "dns.record.update", "dns.record.delete"].includes(row.action)) {
    res.status(404).json({ error: "Rollback entry not found or no longer eligible" }); return;
  }
  let metadata: any;
  try { metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata; } catch { metadata = null; }
  if (!metadata || String(metadata.zoneId) !== String(req.params.id)) { res.status(404).json({ error: "Rollback entry not found for this zone" }); return; }
  const before: DnsSnapshot | null = metadata.before ?? null;
  const after: DnsSnapshot | null = metadata.after ?? null;
  if (row.action === "dns.record.update" && (!before || !after) || row.action === "dns.record.create" && !after || row.action === "dns.record.delete" && !before) {
    res.status(409).json({ error: "This history entry has no reversible record snapshot" }); return;
  }
  try {
    const records = await listRecords(zone);
    const current = records.find((record) => String(record.id) === String(row.targetId));
    if (row.action === "dns.record.create") {
      if (!current || snapshotKey(current) !== snapshotKey(after)) { res.status(409).json({ error: "Record has changed since this history entry; rollback was not applied" }); return; }
      await cf(zone.apiToken, `/zones/${encodeURIComponent(zone.zone_id)}/dns_records/${encodeURIComponent(String(row.targetId))}`, { method: "DELETE" });
      await audit(req, "dns.record.delete", "dns_record", row.targetId, "success", { zoneId: req.params.id, reversesEntryId: entryId, before: after, after: null });
      res.json({ ok: true, message: "Created record removed" });
      return;
    }
    if (row.action === "dns.record.update") {
      if (!current || snapshotKey(current) !== snapshotKey(after)) { res.status(409).json({ error: "Record has changed since this history entry; rollback was not applied" }); return; }
      const restored = await cf(zone.apiToken, `/zones/${encodeURIComponent(zone.zone_id)}/dns_records/${encodeURIComponent(String(row.targetId))}`, { method: "PATCH", body: JSON.stringify({ type: before!.type, name: before!.name, content: before!.content, ttl: before!.ttl, proxied: before!.proxied, ...(before!.type === "MX" ? { priority: before!.priority ?? 10 } : {}) }) });
      await audit(req, "dns.record.update", "dns_record", row.targetId, "success", { zoneId: req.params.id, reversesEntryId: entryId, before: after, after: snapshot(restored.result) });
      res.json({ ok: true, message: "Previous record values restored", record: restored.result });
      return;
    }
    if (current) { res.status(409).json({ error: "A record now occupies this name and ID; rollback was not applied" }); return; }
    const sameOwnerName = records.filter((record) => String(record.name).toLowerCase() === String(before!.name).toLowerCase());
    const duplicate = sameOwnerName.some((record) => String(record.type).toUpperCase() === before!.type && String(record.content) === before!.content && (before!.type !== "MX" || Number(record.priority ?? 10) === Number(before!.priority ?? 10)));
    const cnameConflict = before!.type === "CNAME" && sameOwnerName.length > 0 || sameOwnerName.some((record) => String(record.type).toUpperCase() === "CNAME");
    if (duplicate || cnameConflict) { res.status(409).json({ error: "A conflicting record now exists at this name; rollback was not applied" }); return; }
    const restored = await cf(zone.apiToken, `/zones/${encodeURIComponent(zone.zone_id)}/dns_records`, { method: "POST", body: JSON.stringify(createRecordPayload(before, zone)) });
    await audit(req, "dns.record.create", "dns_record", restored.result?.id ?? null, "success", { zoneId: req.params.id, reversesEntryId: entryId, before: null, after: snapshot(restored.result) });
    res.json({ ok: true, message: "Deleted record recreated", record: restored.result });
  } catch (error) { res.status(502).json({ error: errorText(error, "DNS rollback failed") }); }
});

export default router;
