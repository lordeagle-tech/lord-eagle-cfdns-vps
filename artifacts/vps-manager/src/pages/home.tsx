import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Cpu, MemoryStick, HardDrive, Activity, Clock,
  Server, RefreshCw, FolderOpen, Search, Trash2,
  Network, Users, Terminal, Layers, CheckCircle2, XCircle, AlertCircle,
  GitBranch, ExternalLink, ChevronRight, Globe, ShieldCheck, ShieldX, KeyRound, AlertTriangle, History, ArrowUpRight,
  ArrowDownToLine, Loader2,
} from "lucide-react";

interface SystemInfo {
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  platform: string;
  uptime: string;
  uptimeSeconds: number;
  cpu: {
    model: string;
    cores: number;
    loadAvg: { "1m": string; "5m": string; "15m": string };
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: string;
  };
  disk: {
    source: string;
    fstype: string;
    size: string;
    used: string;
    avail: string;
    usePercent: string;
    mountedOn: string;
  }[];
  network: { name: string; address: string; family: string }[];
  loggedUsers: string[];
}

interface Pm2Process {
  id: number;
  name: string;
  pid: number;
  status: string;
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
  interpreter: string;
  script: string;
  cwd: string;
  watch: boolean;
  nodeVersion: string;
}

interface AuditEntry {
  id: number;
  action: string;
  targetType: string;
  targetId: string | null;
  status: string;
  createdAt: string;
}

function fmtBytes(b: number) {
  if (b === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  progress,
  color = "#e6ad68",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  progress?: number;
  color?: string;
}) {
  return (
    <div
      className="ops-panel rounded-2xl p-5"
      style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.18)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: `${color}22` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <div className="text-2xl font-black mb-1 text-foreground">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mb-2">{sub}</div>}
      {progress !== undefined && (
        <div className="h-1.5 rounded-full mt-2" style={{ background: "rgba(255,255,255,.06)" }}>
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(100, progress)}%`,
              background: progress > 80
                ? "linear-gradient(90deg,#ff6b6b,#ff4757)"
                : "linear-gradient(90deg,#e6ad68,#f0c58f)",
            }}
          />
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pm2Processes, setPm2Processes] = useState<Pm2Process[]>([]);
  const [pm2Available, setPm2Available] = useState(false);
  const [pm2Loading, setPm2Loading] = useState(true);
  const [gitRepos, setGitRepos] = useState<{ path: string; branch: string; remote: string; lastCommit: string; dirty: boolean }[]>([]);
  const [gitLoading, setGitLoading] = useState(true);
  const [sitesList, setSitesList] = useState<{ name: string; domain: string; root: string | null; proxyPass: string | null; ssl: boolean; status: number | null; git: { branch: string; remote: string; lastCommit: string; dirty: boolean; gitRoot: string } | null }[]>([]);
  const [pullStates, setPullStates] = useState<Record<string, "idle" | "loading" | "ok" | "error">>({});
  const [pullOutputs, setPullOutputs] = useState<Record<string, string>>({});
  const [sitesLoading, setSitesLoading] = useState(true);
  const [githubSsh, setGithubSsh] = useState<{ enabled: boolean; configured: boolean; tested: boolean; connected: boolean; authUser: string | null; keys: { type: string }[] } | null>(null);
  const [githubSshLoading, setGithubSshLoading] = useState(true);
  const [dnsAudit, setDnsAudit] = useState<AuditEntry[]>([]);
  const [dnsAuditLoading, setDnsAuditLoading] = useState(true);

  const authHeaders: Record<string, string> = {};

  const fetchInfo = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const res = await fetch("/api/system/info", { headers: authHeaders });
      if (res.ok) { const data = await res.json(); setInfo(data); }
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const fetchPm2 = useCallback(async () => {
    try {
      const res = await fetch("/api/system/pm2", { headers: authHeaders });
      if (res.ok) {
        const data = await res.json() as { available: boolean; processes: Pm2Process[] };
        setPm2Available(data.available);
        setPm2Processes(data.processes);
      }
    } catch { /* ignore */ }
    setPm2Loading(false);
  }, []);

  const fetchGit = useCallback(async () => {
    try {
      const res = await fetch("/api/system/git", { headers: authHeaders });
      if (res.ok) {
        const data = await res.json() as { repos: { path: string; branch: string; remote: string; lastCommit: string; dirty: boolean }[] };
        setGitRepos(data.repos ?? []);
      }
    } catch { /* ignore */ }
    setGitLoading(false);
  }, []);

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/system/sites", { headers: authHeaders });
      if (res.ok) {
        const data = await res.json() as { sites: { name: string; domain: string; root: string | null; proxyPass: string | null; ssl: boolean; status: number | null; git: { branch: string; remote: string; lastCommit: string; dirty: boolean; gitRoot: string } | null }[] };
        setSitesList(data.sites ?? []);
      }
    } catch { /* ignore */ }
    setSitesLoading(false);
  }, []);

  const gitPull = useCallback(async (domain: string, dir: string) => {
    setPullStates((prev) => ({ ...prev, [domain]: "loading" }));
    setPullOutputs((prev) => ({ ...prev, [domain]: "" }));
    try {
      const res = await fetch("/api/system/git-pull", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      const data = await res.json() as { ok: boolean; output: string; error?: string };
      setPullStates((prev) => ({ ...prev, [domain]: data.ok ? "ok" : "error" }));
      setPullOutputs((prev) => ({ ...prev, [domain]: data.output || data.error || "" }));
      // Refresh site list after successful pull to update commit info
      if (data.ok) setTimeout(() => { fetchSites(); setPullStates((prev) => ({ ...prev, [domain]: "idle" })); }, 3000);
    } catch (e) {
      setPullStates((prev) => ({ ...prev, [domain]: "error" }));
      setPullOutputs((prev) => ({ ...prev, [domain]: String(e) }));
    }
  }, []);

  const fetchGithubSsh = useCallback(async () => {
    try {
      const res = await fetch("/api/github/ssh-key", { headers: authHeaders });
      if (res.ok) {
        const data = await res.json() as { enabled: boolean; configured: boolean; tested: boolean; connected: boolean; authUser: string | null; keys: { type: string }[] };
        setGithubSsh(data);
      }
    } catch { /* ignore */ }
    setGithubSshLoading(false);
  }, []);

  const fetchDnsAudit = useCallback(async () => {
    try {
      const res = await fetch("/api/audit/logs?limit=100", { credentials: "include", cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as { entries?: AuditEntry[] };
        setDnsAudit((data.entries ?? []).filter((entry) => entry.action.startsWith("dns.record.") || entry.action.startsWith("dns.import.")));
      }
    } catch { /* optional dashboard summary */ }
    setDnsAuditLoading(false);
  }, []);

  useEffect(() => {
    fetchInfo(false);
    fetchPm2();
    fetchGit();
    fetchSites();
    fetchGithubSsh();
    fetchDnsAudit();
    const interval = setInterval(() => { fetchInfo(true); fetchPm2(); }, 15000);
    return () => clearInterval(interval);
  }, [fetchInfo, fetchPm2, fetchGit, fetchSites, fetchGithubSsh, fetchDnsAudit]);

  useEffect(() => {
    const auditInterval = setInterval(fetchDnsAudit, 60000);
    return () => clearInterval(auditInterval);
  }, [fetchDnsAudit]);

  async function clearCache() {
    setClearing(true);
    try {
      const res = await fetch("/api/system/clear-cache", {
        method: "POST",
        headers: authHeaders,
      });
      const body = await res.json();
      toast({ title: "Cache cleared", description: body.message });
    } catch {
      toast({ title: "Failed to clear cache", variant: "destructive" });
    }
    setClearing(false);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/files?path=/&search=${encodeURIComponent(searchQuery.trim())}`);
    }
  }

  const memPct = info ? parseFloat(info.memory.usagePercent) : 0;
  const mainDisk = info?.disk.find((d) => d.mountedOn === "/") ?? info?.disk[0];
  const diskPct = mainDisk ? parseFloat(mainDisk.usePercent) : 0;
  const cpuLoad = info ? parseFloat(info.cpu.loadAvg["1m"]) / info.cpu.cores * 100 : 0;
  const resourceReadings = info ? [
    { label: "CPU load", value: cpuLoad, detail: `${cpuLoad.toFixed(1)}% of available cores` },
    { label: "Memory", value: memPct, detail: `${memPct.toFixed(1)}% used` },
    { label: `Disk${mainDisk?.mountedOn ? ` · ${mainDisk.mountedOn}` : ""}`, value: diskPct, detail: `${diskPct.toFixed(1)}% used` },
  ] : [];
  const resourceAlerts = resourceReadings.filter((reading) => reading.value >= 80);
  const recentDnsChanges = dnsAudit.slice(0, 5);

  function dnsActionLabel(action: string) {
    if (action === "dns.import.apply") return "Bulk import applied";
    if (action === "dns.import.preview") return "Import preview";
    if (action.endsWith(".create")) return "DNS record created";
    if (action.endsWith(".update")) return "DNS record updated";
    if (action.endsWith(".delete")) return "DNS record deleted";
    return "DNS change";
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "#0e1012" }}>
      {/* Hero / quick actions */}
      <div
        className="relative overflow-hidden px-6 py-8"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(230,173,104,.12) 0%, transparent 70%)",
        }}
      >
        <div className="loop-network-visual" aria-hidden="true">
          <div className="loop-network-grid" />
          <div className="loop-network-line loop-network-line-one" />
          <div className="loop-network-line loop-network-line-two" />
          <div className="loop-network-line loop-network-line-three" />
          <div className="loop-network-core">LE</div>
          <div className="loop-network-node loop-network-node-one"><span />VPS / 01</div>
          <div className="loop-network-node loop-network-node-two"><span />DNS / 02</div>
          <div className="loop-network-node loop-network-node-three"><span />SSH / 03</div>
          <div className="loop-network-caption">NETWORK / CONNECTIONS<br /><b>LIVE CONTROL PLANE</b></div>
        </div>
        <div className="max-w-screen-xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="status-pulse" />
                <span className="ops-kicker">Command center / live telemetry</span>
                <span className="text-[10px] font-mono text-muted-foreground/50">ZYNEX-OPS</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight mb-1">
                <span className="brand-gradient">Operations</span>{" "}
                <span className="text-foreground">Dashboard</span>
              </h1>
              {info && (
                <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                  <Server className="w-3.5 h-3.5" />
                  <span className="font-mono">{info.hostname}</span>
                  <span className="opacity-40">·</span>
                  <span>{info.os}</span>
                  <span className="opacity-40">·</span>
                  <Clock className="w-3.5 h-3.5" />
                  <span>Up {info.uptime}</span>
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchInfo(false)}
                disabled={refreshing}
                className="h-9 gap-1.5 text-xs border-border/50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/files")}
                className="h-9 gap-1.5 text-xs border-border/50"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Browse Files
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/terminal")}
                className="h-9 gap-1.5 text-xs border-border/50"
              >
                <Terminal className="w-3.5 h-3.5" />
                Terminal
              </Button>
              <Button
                size="sm"
                onClick={clearCache}
                disabled={clearing}
                className="h-9 gap-1.5 text-xs"
                style={{ background: "rgba(230,173,104,.2)", color: "#e6ad68", border: "1px solid rgba(230,173,104,.4)" }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {clearing ? "Clearing…" : "Clear Cache"}
              </Button>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
            <Activity className="w-3.5 h-3.5" style={{ color: "#f0c58f" }} />
            <span>Monitor the machine, ship changes, and keep every service accountable.</span>
          </div>
          <form onSubmit={handleSearch} className="flex gap-2 max-w-xl mb-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files…"
                className="pl-10 h-10 font-mono text-sm"
                style={{ background: "#15181b", borderColor: "rgba(230,173,104,.28)" }}
              />
            </div>
            <Button
              type="submit"
              disabled={!searchQuery.trim()}
              className="h-10 px-5 text-sm font-medium"
              style={{ background: "linear-gradient(135deg,#e6ad68,#f0c58f)", color: "#0e1012", border: "none" }}
            >
              Search
            </Button>
          </form>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 pb-8 space-y-8">
        {/* Top stat cards */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Cpu}
              label="CPU Load"
              value={`${Math.min(100, cpuLoad).toFixed(1)}%`}
              sub={`${info?.cpu.model ?? "—"} · ${info?.cpu.cores} cores · avg ${info?.cpu.loadAvg["1m"]} / ${info?.cpu.loadAvg["5m"]} / ${info?.cpu.loadAvg["15m"]}`}
              progress={cpuLoad}
              color="#e6ad68"
            />
            <StatCard
              icon={MemoryStick}
              label="Memory"
              value={`${info?.memory.usagePercent ?? 0}%`}
              sub={`${fmtBytes(info?.memory.used ?? 0)} used · ${fmtBytes(info?.memory.free ?? 0)} free / ${fmtBytes(info?.memory.total ?? 0)}`}
              progress={memPct}
              color="#f0c58f"
            />
            <StatCard
              icon={HardDrive}
              label="Root Disk"
              value={mainDisk?.usePercent ?? "—"}
              sub={`${mainDisk?.used ?? "?"} / ${mainDisk?.size ?? "?"} used`}
              progress={diskPct}
              color="#e6ad68"
            />
            <StatCard
              icon={Activity}
              label="Uptime"
              value={info?.uptime ?? "—"}
              sub={`Kernel ${info?.kernel ?? "—"}`}
              color="#f0c58f"
            />
          </div>
        )}

        {/* Resource alerts and recent DNS activity */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="ops-panel rounded-2xl p-5" style={{ background: "#15181b", border: `1px solid ${resourceAlerts.some((reading) => reading.value >= 90) ? "rgba(248,113,113,.28)" : resourceAlerts.length ? "rgba(230,173,104,.24)" : "rgba(230,173,104,.14)"}` }}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" style={{ color: resourceAlerts.length ? (resourceAlerts.some((reading) => reading.value >= 90) ? "#f87171" : "#e6ad68") : "#9cc9a2" }} />
                <h2 className="text-sm font-bold text-foreground">Resource alerts</h2>
              </div>
              <span className="rounded-full px-2 py-1 text-[10px] font-semibold" style={{ color: resourceAlerts.length ? (resourceAlerts.some((reading) => reading.value >= 90) ? "#f2aaa5" : "#f0c58f") : "#a9d8b0", background: resourceAlerts.length ? (resourceAlerts.some((reading) => reading.value >= 90) ? "rgba(248,113,113,.08)" : "rgba(230,173,104,.08)") : "rgba(125,200,140,.08)" }}>
                {loading ? "Checking…" : resourceAlerts.length ? `${resourceAlerts.length} active` : "All clear"}
              </span>
            </div>
            {resourceAlerts.length ? <div className="space-y-2">
              {resourceAlerts.map((reading) => {
                const critical = reading.value >= 90;
                return <div key={reading.label} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: critical ? "rgba(248,113,113,.055)" : "rgba(230,173,104,.045)", border: `1px solid ${critical ? "rgba(248,113,113,.12)" : "rgba(230,173,104,.11)"}` }}>
                  <div className="min-w-0"><div className="text-xs font-semibold text-foreground">{reading.label} · {critical ? "Critical" : "Warning"}</div><div className="mt-0.5 text-[10px] text-muted-foreground">{reading.detail} · threshold {critical ? "90%" : "80%"}</div></div>
                  <div className="font-mono text-sm font-bold" style={{ color: critical ? "#f2aaa5" : "#f0c58f" }}>{reading.value.toFixed(1)}%</div>
                </div>;
              })}
            </div> : <div className="rounded-xl px-3 py-3 text-xs text-muted-foreground" style={{ background: "rgba(125,200,140,.035)", border: "1px solid rgba(125,200,140,.08)" }}>
              {loading ? "Waiting for host telemetry…" : "CPU, memory, and root disk are below the 80% warning threshold."}
            </div>}
            <p className="mt-3 text-[10px] text-muted-foreground/45">Informational thresholds · telemetry refreshes every 15 seconds</p>
          </div>

          <div className="ops-panel rounded-2xl p-5" style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.14)" }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2"><History className="h-4 w-4" style={{ color: "#e6ad68" }} /><h2 className="text-sm font-bold text-foreground">Recent DNS changes</h2></div>
              <button onClick={() => navigate("/dns")} className="inline-flex items-center gap-1 text-[11px] text-[#e6ad68] transition-colors hover:text-[#f0c58f]">Open DNS <ArrowUpRight className="h-3 w-3" /></button>
            </div>
            {dnsAuditLoading ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 rounded-lg" />)}</div>
              : recentDnsChanges.length ? <div className="divide-y divide-white/[.045]">
                {recentDnsChanges.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0"><div className="truncate text-xs font-medium text-foreground/85">{dnsActionLabel(entry.action)}</div><div className="mt-0.5 text-[10px] text-muted-foreground/55">{entry.targetType.replaceAll("_", " ")}{entry.targetId ? ` · ${entry.targetId.slice(0, 10)}` : ""}</div></div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1"><span className="text-[10px] font-semibold" style={{ color: entry.status === "success" ? "#a9d8b0" : "#f2aaa5" }}>{entry.status}</span><time className="text-[9px] text-muted-foreground/45" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></div>
                </div>)}
              </div> : <div className="rounded-xl px-3 py-3 text-xs text-muted-foreground" style={{ background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.045)" }}>No recent DNS record changes in the audit history.</div>}
            <p className="mt-3 text-[10px] text-muted-foreground/45">Action, status, and time only; sensitive audit details are hidden.</p>
          </div>
        </section>

        {/* GitHub connection banner */}
        {!githubSshLoading && githubSsh && (
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{
              background: githubSsh.connected ? "rgba(255,255,255,.06)" : "rgba(255,177,92,.06)",
              border: `1px solid ${githubSsh.connected ? "rgba(255,255,255,.2)" : "rgba(255,177,92,.2)"}`,
            }}
          >
            {githubSsh.connected
              ? <ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: "#f0c58f" }} />
              : <ShieldX className="w-4 h-4 flex-shrink-0" style={{ color: "#ffb15c" }} />
            }
            <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
              <span className="text-sm font-semibold" style={{ color: githubSsh.connected ? "#f0c58f" : "#ffb15c" }}>
                {githubSsh.connected
                  ? "GitHub SSH: Connected"
                  : !githubSsh.enabled
                    ? "GitHub SSH: available after self-host installation"
                    : githubSsh.configured
                      ? "GitHub SSH: key ready; add it and test"
                      : "GitHub SSH: setup needed"}
              </span>
              {githubSsh.connected && githubSsh.authUser && (
                <span className="text-xs text-muted-foreground">
                  as <span className="font-mono text-foreground/70">@{githubSsh.authUser}</span>
                </span>
              )}
              {githubSsh.keys.length > 0 && (
                <span className="text-xs text-muted-foreground/50 font-mono">
                  · {githubSsh.keys.map((k) => k.type).join(", ")}
                </span>
              )}
            </div>
            <KeyRound className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/30" />
          </div>
        )}

        {/* Details row */}
        {!loading && info && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* System info */}
            <div
              className="ops-panel rounded-2xl p-5"
              style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.18)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Server className="w-4 h-4 text-lime-400" />
                <h2 className="text-sm font-bold text-foreground">System Info</h2>
              </div>
              <div className="space-y-3 text-sm">
                {[
                  ["Hostname", info.hostname],
                  ["OS", info.os],
                  ["Kernel", info.kernel],
                  ["Architecture", info.arch],
                  ["Platform", info.platform],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <span className="text-muted-foreground flex-shrink-0">{k}</span>
                    <span className="font-mono text-xs text-foreground text-right truncate">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Disk mounts */}
            <div
              className="ops-panel rounded-2xl p-5"
              style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.18)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <HardDrive className="w-4 h-4" style={{ color: "#f0c58f" }} />
                <h2 className="text-sm font-bold text-foreground">Disk Mounts</h2>
              </div>
              <div className="space-y-3">
                {info.disk.slice(0, 6).map((d, i) => {
                  const pct = parseFloat(d.usePercent) || 0;
                  return (
                    <div key={i}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-mono text-foreground">{d.mountedOn}</span>
                        <span className="text-muted-foreground">{d.used} / {d.size}</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: "rgba(255,255,255,.06)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.min(100, pct)}%`,
                            background: pct > 80
                              ? "linear-gradient(90deg,#ff6b6b,#ff4757)"
                              : "linear-gradient(90deg,#e6ad68,#f0c58f)",
                          }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">{d.usePercent} used</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Network + users */}
            <div className="space-y-4">
              <div
                className="ops-panel rounded-2xl p-5"
                style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.18)" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Network className="w-4 h-4 text-lime-400" />
                  <h2 className="text-sm font-bold text-foreground">Network</h2>
                </div>
                <div className="space-y-2">
                  {info.network.slice(0, 4).map((n, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="font-mono text-muted-foreground">{n.name}</span>
                      <span className="font-mono text-foreground">{n.address}</span>
                    </div>
                  ))}
                  {info.network.length === 0 && (
                    <p className="text-xs text-muted-foreground/50">No external interfaces</p>
                  )}
                </div>
              </div>

              <div
                className="ops-panel rounded-2xl p-5"
                style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.18)" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4" style={{ color: "#f0c58f" }} />
                  <h2 className="text-sm font-bold text-foreground">Logged Users</h2>
                </div>
                {info.loggedUsers.length === 0 ? (
                  <p className="text-xs text-muted-foreground/50">No users logged in</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {info.loggedUsers.map((u) => (
                      <span
                        key={u}
                        className="text-xs font-mono px-2 py-0.5 rounded"
                        style={{ background: "rgba(230,173,104,.15)", color: "#e6ad68" }}
                      >
                        {u}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PM2 Processes */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-4 h-4" style={{ color: "#f0c58f" }} />
            <h2 className="text-sm font-bold text-foreground">PM2 Processes</h2>
            {!pm2Loading && pm2Available && pm2Processes.length > 0 && (
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{ background: "rgba(255,255,255,.12)", color: "#f0c58f", border: "1px solid rgba(255,255,255,.2)" }}>
                {pm2Processes.length} process{pm2Processes.length !== 1 ? "es" : ""}
              </span>
            )}
          </div>

          {pm2Loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}
            </div>
          ) : !pm2Available ? (
            <div className="rounded-xl p-5 flex items-center gap-3"
              style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.15)" }}>
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-muted-foreground/50" />
              <div>
                <p className="text-sm text-muted-foreground">PM2 is not installed or not running on this server.</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">
                  Install PM2 with{" "}
                  <code className="font-mono px-1 py-0.5 rounded"
                    style={{ background: "rgba(230,173,104,.12)", color: "#ffb89f" }}>
                    npm install -g pm2
                  </code>
                </p>
              </div>
            </div>
          ) : pm2Processes.length === 0 ? (
            <div className="rounded-xl p-5 flex items-center gap-3"
              style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.15)" }}>
              <Layers className="w-5 h-5 flex-shrink-0 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No PM2 processes running.</p>
            </div>
          ) : (
            <div className="ops-panel rounded-2xl overflow-hidden"
              style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.18)" }}>
              {/* Table header */}
              <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60"
                style={{ borderBottom: "1px solid rgba(230,173,104,.1)", background: "rgba(230,173,104,.04)" }}>
                <div className="col-span-1">ID</div>
                <div className="col-span-3">Name</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-1">CPU</div>
                <div className="col-span-2">Memory</div>
                <div className="col-span-2">Restarts</div>
                <div className="col-span-1">Watch</div>
              </div>

              {pm2Processes.map((proc, idx) => {
                const isOnline = proc.status === "online";
                const isStopped = proc.status === "stopped";
                const StatusIcon = isOnline ? CheckCircle2 : isStopped ? XCircle : AlertCircle;
                const statusColor = isOnline ? "#f0c58f" : isStopped ? "#ff6b6b" : "#f59e0b";
                return (
                  <div
                    key={proc.id}
                    className="grid grid-cols-12 gap-2 px-4 py-3 text-xs items-center transition-colors hover:bg-white/[0.04] cursor-pointer group"
                    style={{ borderBottom: idx < pm2Processes.length - 1 ? "1px solid rgba(230,173,104,.08)" : "none" }}
                    onClick={() => navigate(`/pm2/${encodeURIComponent(proc.name)}`)}
                  >
                    <div className="col-span-1 text-muted-foreground font-mono">{proc.id}</div>
                    <div className="col-span-3">
                      <p className="font-semibold text-foreground truncate group-hover:text-[#ffb89f] transition-colors">{proc.name}</p>
                      <p className="text-muted-foreground/60 font-mono truncate mt-0.5">
                        {proc.script ? proc.script.split("/").pop() : proc.interpreter}
                      </p>
                    </div>
                    <div className="col-span-2 flex items-center gap-1">
                      <StatusIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: statusColor }} />
                      <span className="font-medium capitalize" style={{ color: statusColor }}>{proc.status}</span>
                    </div>
                    <div className="col-span-1 font-mono text-foreground/80">{proc.cpu.toFixed(1)}%</div>
                    <div className="col-span-2 font-mono text-foreground/80">{fmtBytes(proc.memory)}</div>
                    <div className="col-span-2 text-muted-foreground">
                      <span>{proc.restarts}</span>
                      {proc.pid > 0 && (
                        <span className="text-muted-foreground/50 ml-1">· pid {proc.pid}</span>
                      )}
                    </div>
                    <div className="col-span-1 flex items-center justify-between">
                      {proc.watch ? (
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                          style={{ background: "rgba(230,173,104,.15)", color: "#ffb89f" }}>on</span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/20 group-hover:text-[#e6ad68] transition-colors" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Deployed Sites */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-4 h-4" style={{ color: "#f0c58f" }} />
            <h2 className="text-sm font-bold text-foreground">Deployed Sites</h2>
            {!sitesLoading && sitesList.length > 0 && (
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{ background: "rgba(255,255,255,.1)", color: "#f0c58f", border: "1px solid rgba(255,255,255,.2)" }}>
                {sitesList.length} sites
              </span>
            )}
          </div>

          {sitesLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : sitesList.length === 0 ? (
            <div className="rounded-xl p-5 flex items-center gap-3"
              style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.15)" }}>
              <Globe className="w-5 h-5 flex-shrink-0 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No nginx sites found in <code className="font-mono text-xs">/etc/nginx/sites-enabled/</code></p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sitesList.map((site) => {
                const isUp = site.status !== null && site.status >= 200 && site.status < 400;
                const isDown = site.status === null || site.status >= 500;
                const statusColor = isUp ? "#f0c58f" : isDown ? "#ff6b6b" : "#f59e0b";
                const statusLabel = site.status === null ? "Timeout" : String(site.status);
                const StatusIcon = isUp ? CheckCircle2 : isDown ? XCircle : AlertCircle;
                const scheme = site.ssl ? "https" : "http";
                const url = `${scheme}://${site.domain}`;
                const type = site.proxyPass ? "Proxy" : "Static";

                return (
                  <div key={site.domain} className="ops-panel rounded-xl p-4 flex flex-col gap-3"
                    style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.15)" }}>
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 font-bold text-sm text-foreground hover:text-[#ffb89f] transition-colors truncate"
                        >
                          {site.domain}
                          <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-50" />
                        </a>
                        <span className="text-xs text-muted-foreground/50 mt-0.5">
                          {type}{site.ssl ? " · SSL" : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <StatusIcon className="w-3.5 h-3.5" style={{ color: statusColor }} />
                        <span className="text-xs font-mono font-bold" style={{ color: statusColor }}>
                          {statusLabel}
                        </span>
                      </div>
                    </div>

                    {/* Path / proxy info */}
                    {(site.root || site.git?.gitRoot) && (
                      <button
                        onClick={() => navigate(`/files?path=${encodeURIComponent(site.root ?? site.git!.gitRoot)}`)}
                        className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground/50 hover:text-[#e6ad68] transition-colors text-left truncate w-full"
                      >
                        <FolderOpen className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{site.root ?? site.git!.gitRoot}</span>
                      </button>
                    )}
                    {site.proxyPass && (
                      <span className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground/50 truncate">
                        <ChevronRight className="w-3 h-3 flex-shrink-0" />
                        {site.proxyPass}
                      </span>
                    )}

                    {/* Git info */}
                    {site.git ? (() => {
                      const ghMatch = site.git.remote.match(/github\.com[/:]([^/]+\/[^\s.]+?)(?:\.git)?$/);
                      const ghRepo = ghMatch ? ghMatch[1] : null;
                      const commitHash = site.git.lastCommit.split(" ")[0];
                      const commitMsg = site.git.lastCommit.split(" ").slice(1).join(" ").substring(0, 38);
                      const pullState = pullStates[site.domain] ?? "idle";
                      const pullOutput = pullOutputs[site.domain] ?? "";
                      return (
                        <div className="flex flex-col gap-1 pt-1 border-t border-white/5">
                          <div className="flex items-center gap-1.5">
                            <GitBranch className="w-3 h-3 flex-shrink-0" style={{ color: "#e6ad68" }} />
                            <span className="text-xs font-mono text-[#e6ad68]">{site.git.branch || "HEAD"}</span>
                            {site.git.dirty && (
                              <span className="text-[10px] font-bold px-1 rounded" style={{ background: "rgba(245,158,11,.15)", color: "#f59e0b" }}>dirty</span>
                            )}
                            <div className="ml-auto flex items-center gap-1.5">
                              {ghRepo && (
                                <a
                                  href={`https://github.com/${ghRepo}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-[#f0c58f] transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" /></svg>
                                  {ghRepo.split("/")[1]}
                                </a>
                              )}
                              {/* Pull button */}
                              <button
                                onClick={() => gitPull(site.domain, site.git!.gitRoot)}
                                disabled={pullState === "loading"}
                                title="git pull"
                                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors disabled:opacity-50"
                                style={{
                                  background: pullState === "ok" ? "rgba(255,255,255,.12)" : pullState === "error" ? "rgba(255,107,107,.12)" : "rgba(230,173,104,.12)",
                                  color: pullState === "ok" ? "#f0c58f" : pullState === "error" ? "#ff6b6b" : "#ffb89f",
                                  border: `1px solid ${pullState === "ok" ? "rgba(255,255,255,.2)" : pullState === "error" ? "rgba(255,107,107,.2)" : "rgba(230,173,104,.2)"}`,
                                }}
                              >
                                {pullState === "loading"
                                  ? <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                  : <ArrowDownToLine className="w-2.5 h-2.5" />}
                                {pullState === "loading" ? "pulling…" : pullState === "ok" ? "pulled" : pullState === "error" ? "failed" : "pull"}
                              </button>
                            </div>
                          </div>
                          {commitHash && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-mono px-1 rounded" style={{ background: "rgba(255,255,255,.08)", color: "#f0c58f" }}>{commitHash}</span>
                              <span className="text-[10px] text-muted-foreground/40 truncate">{commitMsg}</span>
                            </div>
                          )}
                          {/* Pull output */}
                          {pullOutput && (
                            <pre
                              className="text-[9px] font-mono leading-relaxed rounded p-1.5 mt-0.5 overflow-x-auto whitespace-pre-wrap"
                              style={{
                                background: "rgba(0,0,0,.4)",
                                color: pullState === "error" ? "#ff9999" : "#f0c58f",
                                border: "1px solid rgba(255,255,255,.05)",
                                maxHeight: "80px",
                              }}
                            >{pullOutput}</pre>
                          )}
                        </div>
                      );
                    })() : (
                      <div className="pt-1 border-t border-white/5">
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/25">
                          <GitBranch className="w-3 h-3" />
                          no git
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Git Repositories */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <GitBranch className="w-4 h-4" style={{ color: "#e6ad68" }} />
            <h2 className="text-sm font-bold text-foreground">Git Repositories</h2>
            {!gitLoading && gitRepos.length > 0 && (
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{ background: "rgba(230,173,104,.12)", color: "#ffb89f", border: "1px solid rgba(230,173,104,.2)" }}>
                {gitRepos.length} repo{gitRepos.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {gitLoading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
          ) : gitRepos.length === 0 ? (
            <div className="rounded-xl p-5 flex items-center gap-3"
              style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.15)" }}>
              <GitBranch className="w-5 h-5 flex-shrink-0 text-muted-foreground/30" />
              <div>
                <p className="text-sm text-muted-foreground">No git repositories found on this server.</p>
                <p className="text-xs text-muted-foreground/50 mt-0.5">
                  Scanned <code className="font-mono text-xs">/root</code>, <code className="font-mono text-xs">/home</code>, <code className="font-mono text-xs">/var/www</code>, and PM2 working directories.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {gitRepos.map((repo) => {
                const repoName = repo.path.split("/").pop() ?? repo.path;
                const isGithub = repo.remote.includes("github.com");
                const remoteDisplay = repo.remote
                  .replace(/^https?:\/\//, "")
                  .replace(/^git@/, "")
                  .replace("github.com:", "github.com/")
                  .replace(/\.git$/, "");
                return (
                  <div
                    key={repo.path}
                    className="ops-panel rounded-xl p-4 flex flex-col gap-3"
                    style={{ background: "#15181b", border: "1px solid rgba(230,173,104,.15)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: "rgba(230,173,104,.12)" }}>
                          <GitBranch className="w-4 h-4" style={{ color: "#e6ad68" }} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-foreground truncate">{repoName}</p>
                          <p className="text-xs font-mono text-muted-foreground/60 truncate">{repo.path}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {repo.dirty && (
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                            style={{ background: "rgba(245,158,11,.12)", color: "#f59e0b", border: "1px solid rgba(245,158,11,.2)" }}>
                            dirty
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs border-border/50"
                          onClick={() => navigate(`/files?path=${encodeURIComponent(repo.path)}`)}
                        >
                          <FolderOpen className="w-3 h-3" />
                          Browse
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      {repo.branch && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded font-mono"
                          style={{ background: "rgba(255,255,255,.08)", color: "#f0c58f" }}>
                          <GitBranch className="w-3 h-3" />
                          {repo.branch}
                        </span>
                      )}
                      {remoteDisplay && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded font-mono text-muted-foreground/70"
                          style={{ background: "rgba(255,255,255,.04)" }}>
                          {isGithub && <ExternalLink className="w-3 h-3" />}
                          <span className="truncate max-w-[200px]">{remoteDisplay}</span>
                        </span>
                      )}
                    </div>

                    {repo.lastCommit && (
                      <p className="text-xs font-mono text-muted-foreground/50 truncate">
                        <span className="text-muted-foreground/30">last: </span>
                        {repo.lastCommit}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

      </div>

      <Footer />
    </div>
  );
}
