/** DNS record fields consumed by the diagnostics helper. */
export interface DnsRecord {
  name: string;
  type: string;
  content: string;
  priority?: number | string | null;
}

export type FindingSeverity = "error" | "warning";

export interface Finding {
  severity: FindingSeverity;
  code: string;
  message: string;
}

export interface ResolverResult {
  resolver: "google" | "cloudflare";
  status: "answer" | "no-answer" | "error";
  answers: Array<{ name: string; type: string; data: string; ttl?: number }>;
  error?: string;
}

const QTYPE_CODES: Readonly<Record<string, number>> = {
  A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16,
  AAAA: 28, SRV: 33, DNAME: 39, CAA: 257,
};
const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const RESOLVERS = [
  { resolver: "google" as const, endpoint: "https://dns.google/resolve" },
  { resolver: "cloudflare" as const, endpoint: "https://cloudflare-dns.com/dns-query" },
] as const;

function canonicalName(name: string): string {
  return name.trim().replace(/\.$/, "").toLowerCase();
}

function isValidFqdn(name: string): boolean {
  const normalized = canonicalName(name);
  if (normalized.length < 1 || normalized.length > 253 || !normalized.includes(".")) return false;
  return normalized.split(".").every((label) =>
    label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
  );
}

function isIPv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isPrivateOrLoopback(address: string): boolean {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (isIPv4(value)) {
    const [a, b] = value.split(".").map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
  }
  if (value.includes(":")) {
    const compact = value.replace(/%.*$/, "");
    if (compact === "::" || compact === "::1") return true;
    if (/^f[cd]/.test(compact)) return true; // Unique-local fc00::/7
    if (/^fe[89ab]/.test(compact)) return true; // Link-local fe80::/10
    const mapped = compact.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateOrLoopback(mapped[1]);
  }
  return false;
}

/** Return actionable issues found in the supplied zone records. */
export function analyzeDnsHealth(zoneName: string, records: DnsRecord[]): Finding[] {
  const findings: Finding[] = [];
  const zone = canonicalName(zoneName);
  const apex = records.filter((record) => canonicalName(record.name) === zone);
  const apexAddress = apex.some((record) => ["A", "AAAA"].includes(record.type.toUpperCase()));
  const apexAlias = apex.some((record) => record.type.toUpperCase() === "CNAME");
  if (!apexAddress && !apexAlias) {
    findings.push({ severity: "warning", code: "APEX_NO_ADDRESS", message: `Apex ${zoneName} has no A, AAAA, or CNAME record; add an address or provider-supported alias.` });
  }

  for (const record of records) {
    const type = record.type.toUpperCase();
    if ((type === "A" || type === "AAAA") && isPrivateOrLoopback(record.content)) {
      findings.push({ severity: "error", code: "PRIVATE_ADDRESS", message: `${record.name} ${type} points to private or loopback address ${record.content}; use a publicly reachable target.` });
    }
  }

  const names = new Map<string, DnsRecord[]>();
  for (const record of records) {
    const key = canonicalName(record.name);
    names.set(key, [...(names.get(key) ?? []), record]);
  }
  for (const [name, grouped] of names) {
    const cnames = grouped.filter((record) => record.type.toUpperCase() === "CNAME");
    if (cnames.length > 1) {
      findings.push({ severity: "error", code: "MULTIPLE_CNAME", message: `${name} has multiple CNAME records; keep exactly one canonical target.` });
    }
    if (cnames.length > 0 && grouped.some((record) => record.type.toUpperCase() !== "CNAME")) {
      findings.push({ severity: "error", code: "CNAME_CONFLICT", message: `${name} has a CNAME alongside other record types; remove the conflicting records.` });
    }
  }

  const mxRecords = records.filter((record) => record.type.toUpperCase() === "MX");
  const priorities = new Set<number>();
  for (const record of mxRecords) {
    const priority = typeof record.priority === "number" ? record.priority : Number(record.priority);
    if (record.priority === undefined || record.priority === null || record.priority === "" ||
        !Number.isInteger(priority) || priority < 0 || priority > 65535) {
      findings.push({ severity: "error", code: "INVALID_MX_PRIORITY", message: `MX record for ${record.name} has a missing or invalid priority; use an integer from 0 to 65535.` });
    } else if (priorities.has(priority)) {
      findings.push({ severity: "warning", code: "DUPLICATE_MX_PRIORITY", message: `Multiple MX records use priority ${priority}; use distinct priorities when defining ordered failover.` });
    } else {
      priorities.add(priority);
    }
  }
  return findings;
}

async function readLimitedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("Resolver response exceeded size limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Resolver response exceeded size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Query Google and Cloudflare DoH JSON APIs, returning an independent result per resolver. */
export async function checkPropagation(name: string, type: string): Promise<ResolverResult[]> {
  const qname = canonicalName(name);
  const qtype = type.toUpperCase();
  if (!isValidFqdn(name)) throw new TypeError("name must be a valid fully-qualified domain name");
  if (!Object.prototype.hasOwnProperty.call(QTYPE_CODES, qtype)) throw new TypeError("Unsupported DNS query type");

  return Promise.all(RESOLVERS.map(async ({ resolver, endpoint }): Promise<ResolverResult> => {
    const url = new URL(endpoint);
    url.searchParams.set("name", qname);
    url.searchParams.set("type", String(QTYPE_CODES[qtype]));
    try {
      const response = await fetch(url, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Resolver returned HTTP ${response.status}`);
      const payload: unknown = JSON.parse(await readLimitedResponse(response));
      if (!payload || typeof payload !== "object" || !Array.isArray((payload as { Answer?: unknown }).Answer)) {
        return { resolver, status: "no-answer", answers: [] };
      }
      const answers = ((payload as { Answer: unknown[] }).Answer).flatMap((item): ResolverResult["answers"] => {
        if (!item || typeof item !== "object") return [];
        const answer = item as { name?: unknown; type?: unknown; data?: unknown; TTL?: unknown };
        if (typeof answer.data !== "string") return [];
        const answerType = typeof answer.type === "number"
          ? Object.keys(QTYPE_CODES).find((key) => QTYPE_CODES[key] === answer.type) ?? String(answer.type)
          : String(answer.type ?? "");
        return [{
          name: typeof answer.name === "string" ? answer.name : qname,
          type: answerType,
          data: answer.data,
          ...(typeof answer.TTL === "number" ? { ttl: answer.TTL } : {}),
        }];
      });
      return { resolver, status: answers.length ? "answer" : "no-answer", answers };
    } catch (error) {
      return {
        resolver,
        status: "error",
        answers: [],
        error: error instanceof Error ? error.message : "Resolver request failed",
      };
    }
  }));
}
