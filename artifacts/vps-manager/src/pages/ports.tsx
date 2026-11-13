import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock3, Filter, LoaderCircle, RefreshCw, Search, Server, ShieldCheck, Waypoints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PortRow = {
  protocol: "tcp" | "udp";
  port: number;
  address: string;
  state: string;
  process: string | null;
  pid: number | null;
};
type SavedServer = { id: number; name: string; host: string; port: number; hostFingerprint?: string | null };
type ScanResult = {
  server: { id?: number; name?: string; hostname?: string; host?: string; scope: "local" | "remote" };
  ports: PortRow[];
  scannedAt: string;
  note: string;
};

const panel = "rounded-2xl border border-cyan-300/20 bg-[#10181c]/90 shadow-[0_12px_34px_rgba(0,0,0,.24)]";

export default function PortsPage() {
  const [servers, setServers] = useState<SavedServer[]>([]);
  const [selected, setSelected] = useState("local");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [protocol, setProtocol] = useState<"all" | "tcp" | "udp">("all");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetch("/api/servers")
      .then(async (response) => response.ok ? response.json() : [])
      .then((data) => setServers(Array.isArray(data) ? data : []))
      .catch(() => setServers([]));
  }, []);

  const scan = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError("");
    setResult(null);
    const path = selected === "local" ? "/api/system/ports" : `/api/servers/${encodeURIComponent(selected)}/ports`;
    try {
      const response = await fetch(path, { signal, cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Port scan failed");
      setResult(data as ScanResult);
    } catch (cause) {
      if (signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Port scan failed");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [selected, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    void scan(controller.signal);
    return () => controller.abort();
  }, [scan]);

  const filtered = useMemo(() => (result?.ports ?? []).filter((row) => {
    if (protocol !== "all" && row.protocol !== protocol) return false;
    const text = `${row.port} ${row.protocol} ${row.address} ${row.state} ${row.process ?? ""} ${row.pid ?? ""}`.toLowerCase();
    return text.includes(query.toLowerCase().trim());
  }), [result, protocol, query]);

  const serverLabel = selected === "local"
    ? result?.server?.hostname ?? "This VPS"
    : servers.find((server) => String(server.id) === selected)?.name ?? result?.server?.name ?? "Saved VPS";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-screen-xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[.18em] text-cyan-200"><Waypoints className="h-4 w-4" /> Socket inventory</div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Open <span className="text-cyan-200">Ports</span></h1>
            <p className="mt-2 text-sm text-muted-foreground">Inspect TCP and UDP sockets that are listening on this VPS or a saved, trusted SSH connection.</p>
          </div>
          <Button variant="outline" onClick={() => setRefreshKey((key) => key + 1)} disabled={loading} className="border-cyan-200/25 hover:border-cyan-200/50 hover:bg-cyan-300/10">
            {loading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Rescan
          </Button>
        </header>

        <section className={`${panel} grid gap-4 p-4 sm:grid-cols-[minmax(240px,1fr)_auto] sm:items-end sm:p-5`}>
          <label className="space-y-2 text-xs font-medium text-muted-foreground">Scan target
            <select value={selected} onChange={(event) => setSelected(event.target.value)} className="h-11 w-full rounded-lg border border-cyan-200/20 bg-[#0d1215] px-3 text-sm text-foreground outline-none focus:border-cyan-200/60 focus:ring-2 focus:ring-cyan-300/15 sm:max-w-lg">
              <option value="local">This VPS — where the manager is installed</option>
              {servers.map((server) => <option key={server.id} value={server.id} disabled={!server.hostFingerprint}>{server.name} · {server.host}{server.hostFingerprint ? "" : " · verify host key first"}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-cyan-200" /> Remote scans require a pinned SSH host key.</div>
        </section>

        {error && <div className="flex items-start gap-3 rounded-xl border border-amber-300/25 bg-amber-400/[.07] p-4 text-sm text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">Could not scan ports</p><p className="mt-1 text-amber-100/75">{error}</p>{selected !== "local" && <a href="/connections" className="mt-2 inline-block underline underline-offset-4">Review this VPS connection</a>}</div></div>}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className={`${panel} flex items-center gap-3 p-4`}><div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300/10 text-cyan-200"><Activity className="h-5 w-5" /></div><div><div className="text-2xl font-black">{loading ? "—" : result?.ports.length ?? 0}</div><div className="text-xs text-muted-foreground">Listening sockets</div></div></div>
          <div className={`${panel} flex items-center gap-3 p-4`}><div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-300/10 text-sky-200"><Server className="h-5 w-5" /></div><div className="min-w-0"><div className="truncate text-sm font-bold">{serverLabel}</div><div className="text-xs text-muted-foreground">Scan target</div></div></div>
          <div className={`${panel} flex items-center gap-3 p-4`}><div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-300/10 text-amber-200"><Clock3 className="h-5 w-5" /></div><div><div className="text-sm font-bold">{result?.scannedAt ? new Date(result.scannedAt).toLocaleTimeString() : loading ? "Scanning…" : "—"}</div><div className="text-xs text-muted-foreground">Last scan</div></div></div>
        </section>

        <section className={`${panel} overflow-hidden`}>
          <div className="flex flex-col gap-3 border-b border-cyan-200/10 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-bold">Listening sockets</h2><p className="mt-1 text-xs text-muted-foreground">{filtered.length} of {result?.ports.length ?? 0} entries</p></div>
            <div className="flex flex-wrap gap-2">
              <label className="relative min-w-[180px] flex-1 sm:flex-none"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search port or process" className="h-9 border-cyan-200/15 bg-[#0c1114] pl-9 sm:w-60" /></label>
              <label className="relative"><Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyan-100/70" /><select value={protocol} onChange={(event) => setProtocol(event.target.value as "all" | "tcp" | "udp")} className="h-9 rounded-md border border-cyan-200/15 bg-[#0c1114] pl-8 pr-3 text-xs"><option value="all">All protocols</option><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>
            </div>
          </div>
          {loading ? <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin text-cyan-200" />Scanning listening sockets…</div>
            : filtered.length === 0 ? <div className="p-12 text-center"><Waypoints className="mx-auto mb-3 h-8 w-8 text-cyan-200/60" /><p className="font-semibold">{result?.ports.length ? "No matching ports" : "No listening ports found"}</p><p className="mt-1 text-xs text-muted-foreground">{result?.ports.length ? "Adjust your search or protocol filter." : "Try a rescan, or check that `ss` is installed on the target."}</p></div>
              : <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-cyan-300/[.055] text-[10px] uppercase tracking-[.15em] text-cyan-100/75"><tr><th className="px-4 py-3">Port</th><th className="px-4 py-3">Protocol</th><th className="px-4 py-3">Bind address</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Process</th></tr></thead><tbody className="divide-y divide-white/[.06]">{filtered.map((row, index) => <tr key={`${row.protocol}-${row.port}-${row.address}-${index}`} className="transition-colors hover:bg-cyan-300/[.045]"><td className="px-4 py-3 font-mono text-base font-bold text-cyan-100">{row.port}</td><td className="px-4 py-3"><span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${row.protocol === "tcp" ? "border-cyan-200/25 bg-cyan-300/10 text-cyan-100" : "border-sky-200/25 bg-sky-300/10 text-sky-100"}`}>{row.protocol}</span></td><td className="px-4 py-3 font-mono text-xs text-foreground/80">{row.address}</td><td className="px-4 py-3 text-xs text-muted-foreground">{row.state}</td><td className="px-4 py-3 text-xs">{row.process ? <span className="font-medium">{row.process}{row.pid ? <span className="ml-1 font-mono text-muted-foreground">PID {row.pid}</span> : null}</span> : <span className="text-muted-foreground">Process not visible</span>}</td></tr>)}</tbody></table></div>}
          {result?.note && <p className="border-t border-cyan-200/10 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground"><span className="font-semibold text-amber-200">Note:</span> {result.note}</p>}
        </section>
      </div>
    </div>
  );
}
