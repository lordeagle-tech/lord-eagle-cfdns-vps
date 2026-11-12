import { isIP } from "node:net";

export type DnsImportRecord = {
  type: "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "NS";
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  proxied?: boolean;
};

const MAX_INPUT_BYTES = 512 * 1024;
const MAX_RECORDS = 1000;
const MAX_CONTENT = 4096;
const fail = (): never => { throw new Error("Invalid DNS import: check the format, fields, record data, and zone names"); };
const validName = (s: string): boolean => s.length <= 253 && !!s && s.split(".").every(x => x.length > 0 && x.length <= 63 && /^[a-z0-9_-]+$/i.test(x) && !x.startsWith("-") && !x.endsWith("-"));

function normalizeName(raw: string, zone: string, origin = zone): string {
  const zoneNorm = zone.toLowerCase().replace(/\.$/, "");
  if (!validName(zoneNorm)) return fail();
  let name = raw.trim();
  if (!name) return fail();
  if (name === "@") {
    const originNorm = origin.toLowerCase().replace(/\.$/, "");
    if (!validName(originNorm) || !(originNorm === zoneNorm || originNorm.endsWith(`.${zoneNorm}`))) return fail();
    return originNorm;
  }
  const absolute = name.endsWith(".");
  name = name.replace(/\.$/, "").toLowerCase();
  let fqdn: string;
  if (absolute) fqdn = name;
  else if (name === zoneNorm || name.endsWith(`.${zoneNorm}`)) fqdn = name;
  else fqdn = `${name}.${origin.toLowerCase().replace(/\.$/, "")}`;
  if (!validName(fqdn) || !(fqdn === zoneNorm || fqdn.endsWith(`.${zoneNorm}`))) return fail();
  return fqdn;
}

function record(typeText: string, owner: string, content: string, zone: string, origin = zone, ttl?: number, priority?: number, proxied?: boolean, bindMode = false): DnsImportRecord {
  const type = typeText.toUpperCase();
  if (!["A", "AAAA", "CNAME", "TXT", "MX", "NS"].includes(type)) return fail();
  const name = normalizeName(owner, zone, origin);
  let value = content.trim();
  if (!value || value.length > MAX_CONTENT) return fail();
  if (type === "A" && isIP(value) !== 4) return fail();
  if (type === "AAAA" && isIP(value) !== 6) return fail();
  if ((type === "CNAME" || type === "MX" || type === "NS")) {
    if (bindMode) {
      if (value === "@") value = origin.toLowerCase().replace(/\.$/, "");
      else if (!value.endsWith(".")) value = `${value}.${origin.toLowerCase().replace(/\.$/, "")}`;
      else value = value.replace(/\.$/, "");
    }
    if (!validName(value.replace(/\.$/, ""))) return fail();
  }
  if (ttl !== undefined && (!Number.isInteger(ttl) || ttl < 0 || ttl > 2147483647)) return fail();
  return { type: type as DnsImportRecord["type"], name, content: value, ...(ttl === undefined ? {} : { ttl }), ...(priority === undefined ? {} : { priority }), ...(proxied === undefined ? {} : { proxied }) };
}

function csvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') {
      if (cell.length) return fail();
      quoted = true;
    } else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(v => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (quoted) return fail();
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}

function parseCsv(input: string, zone: string): DnsImportRecord[] {
  const rows = csvRows(input);
  if (!rows.length) return fail();
  const head = rows[0].map(x => x.trim().toLowerCase());
  const headered = head.includes("type") && (head.includes("name") || head.includes("owner")) && head.includes("content");
  if (headered) {
    const allowed = new Set(["type", "name", "owner", "content", "ttl", "priority", "proxied"]);
    if (head.some((column) => !allowed.has(column)) || new Set(head).size !== head.length || head.includes("name") && head.includes("owner")) return fail();
  }
  const indexes = headered ? { name: head.indexOf("name") >= 0 ? head.indexOf("name") : head.indexOf("owner"), type: head.indexOf("type"), content: head.indexOf("content"), ttl: head.indexOf("ttl"), priority: head.indexOf("priority"), proxied: head.indexOf("proxied") } : { name: 0, type: 1, content: 2, ttl: 3, priority: 4, proxied: 5 };
  const data = headered ? rows.slice(1) : rows;
  if (!data.length || data.length > MAX_RECORDS) return fail();
  return data.map(r => {
    const get = (i: number) => i < 0 ? "" : (r[i] ?? "").trim();
    if (r.length > (headered ? head.length : 6)) return fail();
    const ttl = get(indexes.ttl) ? Number(get(indexes.ttl)) : undefined;
    const priority = get(indexes.priority) ? Number(get(indexes.priority)) : undefined;
    const rawProxied = get(indexes.proxied).toLowerCase();
    if (rawProxied && !["true", "false", "1", "0", "yes", "no"].includes(rawProxied)) return fail();
    const proxied = rawProxied ? ["true", "1", "yes"].includes(rawProxied) : undefined;
    if (get(indexes.priority) && (!Number.isInteger(priority) || priority! < 0 || priority! > 65535)) return fail();
    return record(get(indexes.type), get(indexes.name), get(indexes.content), zone, zone, ttl, priority, proxied);
  });
}

function stripComments(input: string): string {
  let result = "", inQuote = false, esc = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (esc) { result += c; esc = false; continue; }
    if (inQuote && c === "\\") { result += c; esc = true; continue; }
    if (c === '"') { result += c; inQuote = !inQuote; continue; }
    if (!inQuote && c === ";") { while (i < input.length && input[i] !== "\n") i++; result += "\n"; }
    else result += c;
  }
  return result;
}

function tokenize(line: string): string[] {
  const out: string[] = []; let token = "", quoted = false, esc = false;
  for (const c of line) {
    if (esc) { token += c; esc = false; continue; }
    if (quoted && c === "\\") { esc = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted && /\s/.test(c)) { if (token) { out.push(token); token = ""; } }
    else token += c;
  }
  if (quoted || esc) return fail();
  if (token) out.push(token);
  return out;
}

function parseBind(input: string, zone: string): DnsImportRecord[] {
  const clean = stripComments(input);
  const logical: { text: string; inherited: boolean }[] = [];
  let buf = "", depth = 0, quote = false, escaped = false, inherited = false;
  for (const line of clean.split(/\r?\n/)) {
    const startsIndented = /^\s/.test(line);
    const trimmed = line.trim(); if (!trimmed) continue;
    if (!buf) inherited = startsIndented;
    for (const c of trimmed) { if (escaped) { escaped = false; continue; } if (quote && c === "\\") { escaped = true; continue; } if (c === '"') quote = !quote; else if (!quote && c === "(") depth++; else if (!quote && c === ")") { if (!depth) return fail(); depth--; } }
    buf += ` ${trimmed.replace(/[()]/g, " ")}`;
    if (!depth) { logical.push({ text: buf.trim(), inherited }); buf = ""; }
  }
  if (buf || depth || quote) return fail();
  let origin = zone.toLowerCase().replace(/\.$/, ""), defaultTtl = 3600;
  let previousOwner = "@";
  const records: DnsImportRecord[] = [];
  for (const line of logical) {
    if (line.text.startsWith("$")) {
      const t = tokenize(line.text);
      if (t[0].toUpperCase() === "$GENERATE") return fail();
      if (t[0].toUpperCase() === "$ORIGIN" && t.length === 2) { origin = normalizeName(t[1], zone, zone); continue; }
      if (t[0].toUpperCase() === "$TTL" && t.length === 2 && /^\d+$/.test(t[1])) { defaultTtl = Number(t[1]); continue; }
      return fail();
    }
    const t = tokenize(line.text); if (!t.length) continue;
    let i = 0, owner: string;
    if (line.inherited) owner = previousOwner;
    else owner = t[i++];
    previousOwner = owner;
    let ttl = defaultTtl;
    while (i < t.length && !/^(A|AAAA|CNAME|TXT|MX|NS|SRV|CAA|SOA)$/i.test(t[i])) {
      if (/^\d+$/.test(t[i])) ttl = Number(t[i++]);
      else if (/^(IN|CH|HS)$/i.test(t[i])) { if (t[i++].toUpperCase() !== "IN") return fail(); }
      else return fail();
    }
    if (i >= t.length) return fail();
    const type = t[i++].toUpperCase(), data = t.slice(i);
    if (type === "SOA") {
      if (data.length !== 7 || normalizeName(owner, zone, origin) !== zone.toLowerCase().replace(/\.$/, "")) return fail();
      continue; // Cloudflare manages the zone-apex SOA; the UI discloses this omission.
    }
      if (type === "SRV" || type === "CAA") return fail();
    let rec: DnsImportRecord;
    if (type === "MX") {
      if (data.length !== 2 || !/^\d+$/.test(data[0])) return fail();
      const p = Number(data[0]); if (!Number.isInteger(p) || p > 65535) return fail();
      rec = record(type, owner, data[1], zone, origin, ttl, p, undefined, true);
    } else if (type === "TXT") {
      if (!data.length) return fail();
      rec = record(type, owner, data.join(" "), zone, origin, ttl);
    } else {
      if (data.length !== 1) return fail();
      rec = record(type, owner, data[0], zone, origin, ttl, undefined, undefined, true);
    }
    records.push(rec); if (records.length > MAX_RECORDS) return fail();
  }
  if (!records.length) return fail();
  return records;
}

export function parseDnsImport(text: string, format: "csv" | "bind", zoneName: string): DnsImportRecord[] {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_INPUT_BYTES) return fail();
  if (typeof zoneName !== "string") return fail();
  if (format === "csv") return parseCsv(text, zoneName);
  if (format === "bind") return parseBind(text, zoneName);
  return fail();
}
