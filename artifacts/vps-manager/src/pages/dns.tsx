import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, CheckCircle2, Cloud, Globe2, History, Plus, RefreshCw, RotateCcw, ShieldAlert, ShieldCheck, Trash2, TriangleAlert, ToggleLeft, ToggleRight, Wrench } from "lucide-react";

type Connection = { id: number; name: string; createdAt: string; accessibleZoneCount: number; visibleZones?: string[] };
type Zone = { id: number; zoneId: string; zoneName: string; status: string; connectionId: number };
type RecordItem = { id: string; type: string; name: string; content: string; proxied?: boolean; ttl?: number; priority?: number };
type Finding = { severity: "error" | "warning"; code: string; message: string };
type Resolver = { resolver: string; status: "answer" | "no-answer" | "error"; answers: { name: string; type: string; data: string; ttl?: number }[]; error?: string };
type HistoryEntry = { id: number; action: string; recordId: string | null; status: string; createdAt: string; before: RecordItem | null; after: RecordItem | null; rollbackable: boolean };
type PreviewChange = { operation: "create" | "update"; before: RecordItem | null; after: RecordItem };
type ImportPreview = { previewToken: string; totalRecords: number; ignoredApexNsCount: number; warnings: string[]; createCount: number; updateCount: number; unchangedCount: number; changes: PreviewChange[] };

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { ...options, credentials: "include", cache: "no-store", headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body;
}
const card = "rounded-2xl border border-amber-300/15 bg-[#111113] p-5";
const fieldClass = "min-w-0";
const recordValue = (record: RecordItem | null) => record ? `${record.type} ${record.name} → ${record.content}${record.type === "MX" ? ` (priority ${record.priority ?? 10})` : ""}, TTL ${record.ttl === 1 ? "Auto" : `${record.ttl ?? 1}s`}${record.proxied ? ", proxied" : ""}` : "(none)";

export default function DnsPage() {
  const [, zoneParams] = useRoute("/dns/zones/:zoneId");
  const zoneId = zoneParams?.zoneId;
  const [connections, setConnections] = useState<Connection[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [name, setName] = useState("Cloudflare");
  const [apiToken, setApiToken] = useState("");
  const [rotationTokens, setRotationTokens] = useState<Record<number, string>>({});
  const [recordName, setRecordName] = useState("www");
  const [recordContent, setRecordContent] = useState("");
  const [recordType, setRecordType] = useState("A");
  const [recordPriority, setRecordPriority] = useState("10");
  const [recordTtl, setRecordTtl] = useState("1");
  const [proxied, setProxied] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValues, setEditValues] = useState({ name: "", content: "", ttl: "1", priority: "10", proxied: false });
  const [importFormat, setImportFormat] = useState<"csv" | "bind">("csv");
  const [importText, setImportText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [propagationName, setPropagationName] = useState("");
  const [propagationType, setPropagationType] = useState("A");
  const [resolverResults, setResolverResults] = useState<Resolver[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  async function load() {
    setLoading(true);
    try {
      const [c, z] = await Promise.all([request("/api/dns/connections"), request("/api/dns/zones")]);
      setConnections(c);
      setZones(z);
      if (zoneId) {
        const [r, h] = await Promise.all([request(`/api/dns/zones/${zoneId}/records`), request(`/api/dns/zones/${zoneId}/history?limit=50`)]);
        setRecords(r);
        setHistory(h.entries ?? []);
        const selected = z.find((item: Zone) => String(item.id) === String(zoneId));
        if (selected && !propagationName) setPropagationName(selected.zoneName);
      } else {
        setRecords([]);
        setHistory([]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load DNS data");
    } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [zoneId]);

  async function addConnection(event: React.FormEvent) {
    event.preventDefault(); setMessage(null); setBusy(true);
    try {
      const created = await request("/api/dns/connections", { method: "POST", body: JSON.stringify({ name, apiToken }) });
      setConnections((items) => [created, ...items]); setApiToken("");
      setMessage("Cloudflare token verified. Sync zones to review the exact set visible to this credential. DNS editing requires DNS:Edit as well as Zone:Read.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Connection failed"); }
    finally { setBusy(false); }
  }
  async function rotateToken(id: number) {
    const nextToken = rotationTokens[id] ?? "";
    if (!nextToken.trim()) { setMessage("Enter a replacement Cloudflare token first."); return; }
    if (!window.confirm("Replace the encrypted Cloudflare token for this connection? The new token must be active and have Zone:Read; zone visibility will be refreshed.")) return;
    setBusy(true);
    try {
      const result = await request(`/api/dns/connections/${id}/token`, { method: "POST", body: JSON.stringify({ apiToken: nextToken }) });
      setRotationTokens((items) => ({ ...items, [id]: "" }));
      await load();
      setMessage(`Token rotated and encrypted. The new token exposes ${result.visibleZoneCount} zone(s).`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Token rotation failed"); }
    finally { setBusy(false); }
  }
  async function sync(id: number) {
    setBusy(true);
    try { await request(`/api/dns/connections/${id}/sync`, { method: "POST" }); await load(); setMessage("Zone scope refreshed from Cloudflare."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Zone sync failed"); }
    finally { setBusy(false); }
  }
  async function addRecord(event: React.FormEvent) {
    event.preventDefault(); if (!zoneId) return; setBusy(true);
    if (recordType === "NS" && !window.confirm("An NS record can change delegation for a subdomain. This does not change your registrar's authoritative nameservers. Add this delegation record?")) { setBusy(false); return; }
    try {
      const created = await request(`/api/dns/zones/${zoneId}/records`, { method: "POST", body: JSON.stringify({ type: recordType, name: recordName, content: recordContent, proxied, ttl: Number(recordTtl), ...(recordType === "MX" ? { priority: Number(recordPriority) } : {}) }) });
      setRecords((items) => [...items, created]); setRecordContent(""); setMessage("Record created. The previous and new values are in change history."); await reloadHistory();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Record creation failed"); }
    finally { setBusy(false); }
  }
  function beginEdit(record: RecordItem) {
    setEditing(record.id);
    setEditValues({ name: record.name, content: record.content, ttl: String(record.ttl ?? 1), priority: String(record.priority ?? 10), proxied: Boolean(record.proxied) });
  }
  async function saveEdit(record: RecordItem) {
    const after = { ...record, name: editValues.name, content: editValues.content, ttl: Number(editValues.ttl), priority: record.type === "MX" ? Number(editValues.priority) : record.priority, proxied: editValues.proxied };
    const nameserverWarning = record.type === "NS" ? "\n\nWarning: changing an NS record can alter subdomain delegation; registrar nameservers are not affected." : "";
    if (!window.confirm(`Review DNS change:\n\nBEFORE  ${recordValue(record)}\n\nAFTER  ${recordValue(after)}\n\nApply this change?${nameserverWarning}`)) return;
    try {
      const updated = await request(`/api/dns/zones/${zoneId}/records/${record.id}`, { method: "PATCH", body: JSON.stringify({ name: editValues.name, content: editValues.content, ttl: Number(editValues.ttl), proxied: editValues.proxied, ...(record.type === "MX" ? { priority: Number(editValues.priority) } : {}) }) });
      setRecords((items) => items.map((item) => item.id === record.id ? updated : item)); setEditing(null); setMessage("Record updated; the before/after values are available in history."); await reloadHistory();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Record update failed"); }
  }
  async function removeRecord(record: RecordItem) {
    if (!zoneId) return;
    const warning = record.type === "NS" ? "\n\nThis removes a delegated NS record and may affect that subdomain. It does not change your registrar's authoritative nameservers." : "";
    if (!window.confirm(`Delete ${record.type} ${record.name} (${record.content}) from Cloudflare? You can attempt a guarded rollback from history.${warning}`)) return;
    try { await request(`/api/dns/zones/${zoneId}/records/${record.id}`, { method: "DELETE" }); setRecords((items) => items.filter((item) => item.id !== record.id)); setMessage("Record deleted and snapshot saved in change history."); await reloadHistory(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Record deletion failed"); }
  }
  async function reloadHistory() {
    if (!zoneId) return;
    try { const result = await request(`/api/dns/zones/${zoneId}/history?limit=50`); setHistory(result.entries ?? []); }
    catch { /* history failure must not hide a completed DNS change */ }
  }
  async function exportZone(format: "csv" | "bind") {
    try {
      const response = await fetch(`/api/dns/zones/${zoneId}/export?format=${format}`, { credentials: "include", cache: "no-store" });
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error ?? "Export failed"); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `dns-export.${format}`; link.click(); URL.revokeObjectURL(url);
      const omitted = response.headers.get("x-cfdns-omitted-record-types");
      setMessage(omitted ? `Export downloaded. Unsupported record types omitted: ${omitted}.` : `${format.toUpperCase()} export downloaded.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Export failed"); }
  }
  async function previewImport() {
    if (!zoneId || !importText.trim()) { setMessage("Paste a CSV or BIND zone file first."); return; }
    setBusy(true); setPreview(null);
    try {
      const result = await request(`/api/dns/zones/${zoneId}/import/preview`, { method: "POST", body: JSON.stringify({ format: importFormat, text: importText }) });
      setPreview(result); setMessage("Preview ready. No Cloudflare changes have been made.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import preview failed"); }
    finally { setBusy(false); }
  }
  async function applyImport() {
    if (!zoneId || !preview) return;
    const includesNs = preview.changes.some((change) => change.after.type === "NS");
    const nsWarning = includesNs ? "\n\nThis import includes NS records, which can alter subdomain delegation. It does not change registrar authoritative nameservers." : "";
    const confirmed = window.confirm(`Apply this reviewed DNS import to ${selectedZone?.zoneName ?? "this zone"}?\n\nCreate: ${preview.createCount}\nUpdate: ${preview.updateCount}\nUnchanged: ${preview.unchangedCount}\n\nNo records will be deleted. The preview expires after 15 minutes and will be rejected if the zone changes.${nsWarning}`);
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await request(`/api/dns/zones/${zoneId}/import/apply`, { method: "POST", body: JSON.stringify({ format: importFormat, text: importText, previewToken: preview.previewToken }) });
      setPreview(null); await load(); setMessage(`Import complete: ${result.applied} applied, ${result.failed} failed. Each successful change is recorded in history and can be rolled back individually.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed"); }
    finally { setBusy(false); }
  }
  async function runHealth() {
    setBusy(true);
    try { const result = await request(`/api/dns/zones/${zoneId}/health`); setFindings(result.findings); setMessage(`Checked ${result.recordCount} records for common DNS issues.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Health check failed"); }
    finally { setBusy(false); }
  }
  async function runPropagation(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setResolverResults(null);
    try { const result = await request(`/api/dns/zones/${zoneId}/propagation`, { method: "POST", body: JSON.stringify({ name: propagationName, type: propagationType }) }); setResolverResults(result.results); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Propagation check failed"); }
    finally { setBusy(false); }
  }
  async function rollback(entry: HistoryEntry) {
    if (!window.confirm(`Attempt a safe rollback of this ${entry.action.replace("dns.record.", "")} operation?\n\nCurrent Cloudflare state will be compared with the recorded snapshot first. If it has changed since, the rollback will be refused.`)) return;
    try {
      await request(`/api/dns/zones/${zoneId}/history/${entry.id}/rollback`, { method: "POST", body: JSON.stringify({}) });
      await load(); setMessage("Rollback applied. Cloudflare now contains the restored DNS state.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Rollback failed"); }
  }

  const selectedZone = zones.find((zone) => String(zone.id) === String(zoneId));
  return <div className="flex-1 overflow-y-auto bg-[#0b0b0c]"><div className="mx-auto max-w-screen-xl space-y-6 px-4 py-7 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-widest text-amber-200"><Cloud className="h-3.5 w-3.5" /> Cloudflare control plane</div><h1 className="text-3xl font-black tracking-tight">DNS <span className="brand-gradient">Manager</span></h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Manage Cloudflare DNS with scoped credentials, reviewed imports, rollback history, and public-resolver checks.</p></div><Button variant="outline" onClick={() => void load()}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button></header>
    {message && <div className="rounded-xl border border-amber-200/20 bg-amber-200/5 px-4 py-3 text-sm text-amber-100">{message}</div>}

    {!zoneId ? <>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className={card}><div className="mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-amber-200" /><h2 className="font-bold">Connect Cloudflare</h2></div><p className="mb-4 text-xs text-muted-foreground">Create a token limited to the zones you need. The app verifies Zone:Read and encrypts the token at rest. Add DNS:Edit for changes; permissions are not inferred from a token label.</p><form onSubmit={addConnection} className="space-y-3"><Input className={fieldClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Connection name" /><Input className={fieldClass} value={apiToken} onChange={(event) => setApiToken(event.target.value)} type="password" autoComplete="new-password" placeholder="Cloudflare API token" required /><Button className="w-full" type="submit" disabled={busy}><Plus className="mr-2 h-4 w-4" />Verify and save</Button></form></section>
        <section className={card}><div className="mb-4 flex items-center gap-2"><Globe2 className="h-4 w-4 text-amber-200" /><h2 className="font-bold">Zones visible to these tokens</h2></div>{zones.length === 0 ? <p className="text-sm text-muted-foreground">No synced zones yet. Sync a connection to list the zones its token can see.</p> : <div className="space-y-2">{zones.map((zone) => <div key={zone.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[.02] px-3 py-3"><div className="min-w-0 flex-1"><Link href={`/dns/zones/${zone.id}`} className="font-mono text-sm hover:text-amber-200">{zone.zoneName}</Link><div className="text-[11px] text-muted-foreground">{zone.status} · connection {zone.connectionId}</div></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void sync(zone.connectionId)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Sync</Button></div>)}</div>}</section>
      </div>
      <section className={card}><h2 className="mb-4 font-bold">Saved Cloudflare credentials</h2>{connections.length === 0 ? <p className="text-sm text-muted-foreground">No Cloudflare connections yet.</p> : <div className="grid gap-3 xl:grid-cols-2">{connections.map((connection) => <div key={connection.id} className="space-y-3 rounded-xl border border-white/5 bg-white/[.02] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold">{connection.name}</div><div className="mt-1 text-xs text-muted-foreground">Secret encrypted · {connection.accessibleZoneCount ?? 0} visible zone(s)</div><div className="mt-1 break-words text-xs text-amber-100/80">{connection.visibleZones?.length ? connection.visibleZones.join(", ") : "No zone scope synced yet"}</div></div><Button size="sm" variant="outline" disabled={busy} onClick={() => void sync(connection.id)}>Refresh scope</Button></div><div className="flex flex-col gap-2 sm:flex-row"><Input type="password" autoComplete="new-password" placeholder="Replacement token" value={rotationTokens[connection.id] ?? ""} onChange={(event) => setRotationTokens((items) => ({ ...items, [connection.id]: event.target.value }))} /><Button disabled={busy || !(rotationTokens[connection.id] ?? "").trim()} onClick={() => void rotateToken(connection.id)}>Rotate token</Button></div></div>)}</div>}</section>
    </> : <>
      <div className="flex flex-wrap items-center gap-3"><Button variant="ghost" asChild><Link href="/dns"><ArrowLeft className="mr-2 h-4 w-4" />All zones</Link></Button><div><h2 className="text-xl font-bold">{selectedZone?.zoneName ?? "Zone"}</h2><p className="text-xs text-muted-foreground">Live Cloudflare records · registrar nameservers are managed at your registrar/Cloudflare account, not by this page</p></div></div>

      <section className={card}><h3 className="mb-4 font-bold">Add a DNS record</h3><form onSubmit={addRecord} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7"><select value={recordType} onChange={(event) => setRecordType(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option>A</option><option>AAAA</option><option>CNAME</option><option>TXT</option><option>MX</option><option>NS</option></select><Input value={recordName} onChange={(event) => setRecordName(event.target.value)} placeholder="Name (www or @)" required /><Input value={recordContent} onChange={(event) => setRecordContent(event.target.value)} placeholder="Content / target" required />{recordType === "MX" && <Input type="number" min="0" max="65535" value={recordPriority} onChange={(event) => setRecordPriority(event.target.value)} aria-label="MX priority" placeholder="Priority" />}<select value={recordTtl} onChange={(event) => setRecordTtl(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="1">TTL: Auto</option><option value="60">TTL: 1 minute</option><option value="300">TTL: 5 minutes</option><option value="3600">TTL: 1 hour</option><option value="14400">TTL: 4 hours</option></select><Button type="submit" disabled={busy}><Plus className="mr-2 h-4 w-4" />Add</Button><button type="button" onClick={() => setProxied((value) => !value)} className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2 lg:col-span-7">{proxied ? <ToggleRight className="h-5 w-5 text-amber-200" /> : <ToggleLeft className="h-5 w-5" />}Cloudflare proxy default {proxied ? "enabled" : "disabled"} (applies only to A/AAAA/CNAME)</button></form>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/5 pt-4"><Button size="sm" variant="outline" onClick={() => void exportZone("csv")}><ArrowDownToLine className="mr-2 h-4 w-4" />Export CSV</Button><Button size="sm" variant="outline" onClick={() => void exportZone("bind")}><ArrowDownToLine className="mr-2 h-4 w-4" />Export BIND</Button><Button size="sm" variant="outline" onClick={() => { setPreview(null); document.getElementById("dns-import")?.scrollIntoView({ behavior: "smooth" }); }}><ArrowUpFromLine className="mr-2 h-4 w-4" />Import zone data</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void runHealth()}><Wrench className="mr-2 h-4 w-4" />Run health check</Button></div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-amber-300/15 bg-[#111113]"><div className="grid grid-cols-12 gap-3 border-b border-white/5 px-4 py-3 text-[10px] uppercase tracking-widest text-muted-foreground"><div className="col-span-1">Type</div><div className="col-span-3">Name</div><div className="col-span-5">Content / target</div><div className="col-span-3 text-right">Actions</div></div>{records.length === 0 ? <div className="p-6 text-sm text-muted-foreground">No supported DNS records returned for this zone.</div> : records.map((record) => <div key={record.id} className="grid grid-cols-12 items-center gap-3 border-b border-white/5 px-4 py-3 text-sm last:border-0"><div className="col-span-1 font-mono text-amber-200">{record.type}</div><div className="col-span-3 min-w-0 truncate font-mono">{record.name}</div><div className="col-span-5 min-w-0"><div className="truncate font-mono text-muted-foreground">{record.content}</div><div className="text-[10px] text-muted-foreground">TTL {record.ttl === 1 ? "Auto" : `${record.ttl ?? 1}s`}{record.type === "MX" ? ` · priority ${record.priority ?? 10}` : ""}{record.proxied ? " · proxied" : ""}</div></div><div className="col-span-3 flex justify-end gap-1">{editing === record.id ? <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button> : <Button size="sm" variant="ghost" onClick={() => beginEdit(record)}>Edit</Button>}<Button size="icon" variant="ghost" onClick={() => void removeRecord(record)} title="Delete record"><Trash2 className="h-4 w-4 text-destructive" /></Button></div>{editing === record.id && <div className="col-span-12 grid gap-2 rounded-lg border border-amber-200/20 bg-black/20 p-3 sm:grid-cols-2 lg:grid-cols-5"><Input value={editValues.name} onChange={(event) => setEditValues((value) => ({ ...value, name: event.target.value }))} aria-label="Record name" /><Input value={editValues.content} onChange={(event) => setEditValues((value) => ({ ...value, content: event.target.value }))} aria-label="Record content" /><select value={editValues.ttl} onChange={(event) => setEditValues((value) => ({ ...value, ttl: event.target.value }))} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="1">Auto</option><option value="60">1 minute</option><option value="300">5 minutes</option><option value="3600">1 hour</option><option value="14400">4 hours</option></select>{record.type === "MX" && <Input type="number" min="0" max="65535" value={editValues.priority} onChange={(event) => setEditValues((value) => ({ ...value, priority: event.target.value }))} aria-label="MX priority" />}<Button onClick={() => void saveEdit(record)}>Review &amp; save</Button><button type="button" onClick={() => setEditValues((value) => ({ ...value, proxied: !value.proxied }))} className="flex items-center gap-2 text-xs text-muted-foreground">{editValues.proxied ? <ToggleRight className="h-5 w-5 text-amber-200" /> : <ToggleLeft className="h-5 w-5" />}Proxy {editValues.proxied ? "on" : "off"}</button></div>}</div>)}</section>

      {findings && <section className={card}><div className="mb-3 flex items-center gap-2"><Wrench className="h-4 w-4 text-amber-200" /><h3 className="font-bold">DNS health findings</h3></div>{findings.length === 0 ? <p className="flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" />No configured common issues were detected. This is a heuristic check, not a complete DNSSEC or deliverability audit.</p> : <ul className="space-y-2">{findings.map((finding, index) => <li key={`${finding.code}-${index}`} className="flex gap-2 text-sm"><TriangleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${finding.severity === "error" ? "text-red-300" : "text-amber-200"}`} /><span><b>{finding.severity.toUpperCase()}</b> · {finding.message}</span></li>)}</ul>}</section>}

      <section className={card}><div className="mb-3 flex items-center gap-2"><Globe2 className="h-4 w-4 text-amber-200" /><h3 className="font-bold">Public DNS propagation check</h3></div><p className="mb-3 text-xs text-muted-foreground">Query Google Public DNS and Cloudflare DNS over HTTPS. This checks their current answers; caching and TTLs mean resolvers may update at different times.</p><form onSubmit={runPropagation} className="grid gap-2 sm:grid-cols-[1fr_150px_auto]"><Input value={propagationName} onChange={(event) => setPropagationName(event.target.value)} placeholder="Host name (www or @)" /><select value={propagationType} onChange={(event) => setPropagationType(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">{["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA"].map((type) => <option key={type}>{type}</option>)}</select><Button type="submit" disabled={busy}>Check resolvers</Button></form>{resolverResults && <div className="mt-4 grid gap-3 md:grid-cols-2">{resolverResults.map((result) => <div key={result.resolver} className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="font-semibold capitalize">{result.resolver} DNS · {result.status}</div>{result.error && <p className="mt-1 text-xs text-red-200">{result.error}</p>}{result.answers.length ? <ul className="mt-2 space-y-1 font-mono text-xs">{result.answers.map((answer, index) => <li key={`${answer.data}-${index}`} className="break-all">{answer.data}{answer.ttl !== undefined ? ` · TTL ${answer.ttl}s` : ""}</li>)}</ul> : !result.error && <p className="mt-1 text-xs text-muted-foreground">No answer returned for this type.</p>}</div>)}</div>}</section>

      <section id="dns-import" className={card}><div className="mb-2 flex items-center gap-2"><ArrowUpFromLine className="h-4 w-4 text-amber-200" /><h3 className="font-bold">Bulk import — preview before applying</h3></div><p className="mb-3 text-xs text-muted-foreground">CSV columns: type,name,content,ttl,proxied,priority. BIND accepts common A/AAAA/CNAME/TXT/MX/NS records and $ORIGIN/$TTL. Apex SOA and authoritative NS records are managed by Cloudflare/your registrar and are not imported. Import only creates or updates; it never deletes. Unsupported types/directives (including $GENERATE) are rejected rather than silently skipped. Maximum file text: 512 KiB.</p><div className="mb-2 flex gap-2"><select value={importFormat} onChange={(event) => { setImportFormat(event.target.value as "csv" | "bind"); setPreview(null); }} className="h-10 rounded-md border border-input bg-background px-3 text-sm"><option value="csv">CSV</option><option value="bind">BIND zone file</option></select><Button variant="outline" size="sm" disabled={busy || !importText.trim()} onClick={() => void previewImport()}><ShieldCheck className="mr-2 h-4 w-4" />Preview changes</Button></div><textarea value={importText} onChange={(event) => { setImportText(event.target.value); setPreview(null); }} rows={8} maxLength={500_000} placeholder={importFormat === "csv" ? "type,name,content,ttl,proxied,priority\nA,www,203.0.113.10,300,false," : "$ORIGIN example.com.\n$TTL 3600\n@ IN A 203.0.113.10\nwww IN CNAME @"} className="w-full rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs outline-none focus:border-amber-200/50" />{preview && <div className="mt-4 space-y-3 rounded-xl border border-amber-200/20 bg-black/20 p-4"><div className="flex flex-wrap gap-3 text-sm"><span>{preview.totalRecords} records parsed</span><span className="text-emerald-300">{preview.createCount} create</span><span className="text-amber-200">{preview.updateCount} update</span><span className="text-muted-foreground">{preview.unchangedCount} unchanged</span></div>{preview.warnings?.length > 0 && <ul className="space-y-1 text-xs text-amber-100">{preview.warnings.map((warning, index) => <li key={index}>Note: {warning}</li>)}</ul>}{preview.changes.length ? <div className="max-h-96 space-y-2 overflow-auto">{preview.changes.map((change, index) => <div key={`${change.operation}-${index}`} className="rounded-lg border border-white/5 p-3 text-xs"><div className="mb-1 font-semibold uppercase tracking-wide">{change.operation} · {change.after.type} {change.after.name}</div>{change.before && <div className="text-red-200/80">Before: {recordValue(change.before)}</div>}<div className="text-emerald-200/90">After: {recordValue(change.after)}</div></div>)}</div> : <p className="text-sm text-muted-foreground">No changes are needed for these records.</p>}<Button disabled={busy || !preview.createCount && !preview.updateCount} onClick={() => void applyImport()}>Confirm &amp; apply {preview.createCount + preview.updateCount} change(s)</Button><p className="text-[11px] text-muted-foreground">Signed preview expires in 15 minutes; stale or modified source data is rejected. Every applied change is recorded separately.</p></div>}</section>

      <section className={card}><div className="mb-3 flex items-center gap-2"><History className="h-4 w-4 text-amber-200" /><h3 className="font-bold">DNS change history and rollback</h3></div><p className="mb-3 text-xs text-muted-foreground">Recent record changes are stored in the audit log. Rollback checks the live record against its saved snapshot and refuses if another change has occurred.</p>{history.length === 0 ? <p className="text-sm text-muted-foreground">No recent record changes.</p> : <div className="space-y-2">{history.map((entry) => <div key={entry.id} className="rounded-xl border border-white/5 bg-black/20 p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-semibold text-sm">{entry.action.replace("dns.record.", "").toUpperCase()} · {entry.after?.type ?? entry.before?.type ?? "DNS"} {entry.after?.name ?? entry.before?.name ?? entry.recordId}</div><div className="text-[11px] text-muted-foreground">{new Date(entry.createdAt).toLocaleString()} · {entry.status}</div></div>{entry.rollbackable && <Button size="sm" variant="outline" onClick={() => void rollback(entry)}><RotateCcw className="mr-2 h-3.5 w-3.5" />Rollback</Button>}</div><div className="mt-2 space-y-1 text-xs">{entry.before && <div className="text-red-200/80">Before: {recordValue(entry.before)}</div>}{entry.after && <div className="text-emerald-200/90">After: {recordValue(entry.after)}</div>}</div></div>)}</div>}</section>
    </>}
    <div className="flex gap-2 text-[11px] text-muted-foreground"><ShieldAlert className="h-4 w-4 shrink-0" /><span>DNS propagation checks and health findings are advisory. Changes affect live DNS immediately at Cloudflare. This panel does not change domain registration or registrar authoritative nameservers; manage those at your registrar and confirm carefully before changing them.</span></div>
  </div></div>;
}
