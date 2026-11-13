import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, RefreshCw, RotateCcw, Square, Play, Trash2, Search, Download, Pause, Radio,
  CheckCircle2, XCircle, AlertCircle, FolderOpen,
  FileText, Terminal, Cpu, MemoryStick, Clock, Hash,
  ChevronRight, Layers, Copy, Check, Wrench, ChevronDown, ChevronUp,
  GitBranch, GitCommit,
} from "lucide-react";

interface Pm2Detail {
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
  logFile: string;
  errorFile: string;
  execMode: string;
  createdAt: number;
}

interface Logs {
  stdout: string[];
  stderr: string[];
  outFile: string;
  errFile: string;
}

function fmtBytes(b: number) {
  if (!b) return "0 B";
  const k = 1024, sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
}

function fmtUptime(ms: number) {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

type LogTab = "combined" | "stdout" | "stderr";
type LogSeverity = "all" | "error" | "warn" | "info";

function logSeverity(entry: { line: string; type: "out" | "err" }): Exclude<LogSeverity, "all"> {
  if (entry.type === "err" || /\b(error|fatal|exception|panic)\b/i.test(entry.line)) return "error";
  if (/\b(warn|warning|deprecated)\b/i.test(entry.line)) return "warn";
  return "info";
}

function logTimestamp(line: string): string {
  const match = line.match(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (!match) return "NO TIMESTAMP";
  const value = new Date(match[0]);
  return Number.isNaN(value.getTime()) ? match[0] : value.toLocaleTimeString([], { hour12: false });
}

export default function Pm2DetailPage() {
  const { name } = useParams<{ name: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [proc, setProc] = useState<Pm2Detail | null>(null);
  const [logs, setLogs] = useState<Logs | null>(null);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [logTab, setLogTab] = useState<LogTab>("combined");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logSearch, setLogSearch] = useState("");
  const [logSeverityFilter, setLogSeverityFilter] = useState<LogSeverity>("all");
  const [logLineLimit, setLogLineLimit] = useState(100);
  const [logCopied, setLogCopied] = useState(false);
  const logsViewportRef = useRef<HTMLDivElement>(null);

  const [buildLines, setBuildLines] = useState<{ text: string; type: "info" | "output" | "error" | "done" }[]>([]);
  const [showBuildPanel, setShowBuildPanel] = useState(false);
  const buildEndRef = useRef<HTMLDivElement>(null);

  interface GitInfo { isGit: boolean; gitRoot?: string; branch?: string; remote?: string; lastCommit?: { hash: string; subject: string; author: string; ago: string }; dirty?: boolean; changedFiles?: number; }
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  const headers: Record<string, string> = {};

  const fetchProc = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/system/pm2/${encodeURIComponent(name)}`, { headers });
      if (res.ok) setProc(await res.json());
      else if (res.status === 404) navigate("/");
    } catch { /* ignore */ }
    setLoading(false);
  }, [name]);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`/api/system/pm2/${encodeURIComponent(name)}/logs?lines=${logLineLimit}`, { headers });
      if (res.ok) setLogs(await res.json());
    } catch { /* ignore */ }
    setLogsLoading(false);
  }, [name, logLineLimit]);

  useEffect(() => {
    fetchProc();
    fetchLogs();
  }, [fetchProc, fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => { fetchProc(true); fetchLogs(); }, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchProc, fetchLogs]);

  useEffect(() => {
    if (autoScroll && logsViewportRef.current) logsViewportRef.current.scrollTop = logsViewportRef.current.scrollHeight;
  }, [logs, autoScroll]);

  useEffect(() => {
    if (!proc?.cwd) return;
    fetch(`/api/system/git-info?path=${encodeURIComponent(proc.cwd)}`, { headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setGitInfo(data); })
      .catch(() => {});
  }, [proc?.cwd]);

  async function doAction(action: "restart" | "stop" | "start" | "flush") {
    setActing(action);
    try {
      const res = await fetch(`/api/system/pm2/${encodeURIComponent(name)}/${action}`, {
        method: "POST",
        headers,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Action failed");
      toast({ title: `${action.charAt(0).toUpperCase() + action.slice(1)} successful` });
      setTimeout(() => { fetchProc(true); fetchLogs(); }, 1200);
    } catch (e) {
      toast({ title: `${action} failed`, description: (e as Error).message, variant: "destructive" });
    }
    setActing(null);
  }

  async function doRebuildRestart() {
    setActing("rebuild");
    setBuildLines([]);
    setShowBuildPanel(true);
    try {
      const res = await fetch(`/api/system/pm2/${encodeURIComponent(name)}/rebuild-restart`, {
        method: "POST",
        headers,
      });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let success = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const lines = block.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.replace("event: ", "").trim();
          let data: Record<string, unknown> = {};
          try { data = JSON.parse(dataLine.replace("data: ", "")); } catch { /* skip */ }
          if (event === "output") {
            const text = String(data.text ?? "");
            text.split("\n").filter(Boolean).forEach((line) =>
              setBuildLines((prev) => [...prev, { text: line, type: "output" }])
            );
          } else if (event === "info") {
            setBuildLines((prev) => [...prev, { text: String(data.message ?? ""), type: "info" }]);
          } else if (event === "error") {
            setBuildLines((prev) => [...prev, { text: String(data.message ?? ""), type: "error" }]);
            toast({ title: "Rebuild failed", description: String(data.message ?? ""), variant: "destructive" });
          } else if (event === "done") {
            success = true;
            setBuildLines((prev) => [...prev, { text: "✓ Rebuild & restart complete", type: "done" }]);
          }
        }
        // Auto-scroll build output
        setTimeout(() => buildEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      }
      if (success) {
        toast({ title: "Rebuild & restart successful" });
        setTimeout(() => { fetchProc(true); fetchLogs(); }, 1500);
      }
    } catch (e) {
      toast({ title: "Rebuild failed", description: (e as Error).message, variant: "destructive" });
      setBuildLines((prev) => [...prev, { text: (e as Error).message, type: "error" }]);
    }
    setActing(null);
  }

  const isOnline = proc?.status === "online";
  const isStopped = proc?.status === "stopped";
  const StatusIcon = isOnline ? CheckCircle2 : isStopped ? XCircle : AlertCircle;
  const statusColor = isOnline ? "#ffd1c2" : isStopped ? "#ff6b6b" : "#f59e0b";

  const combinedLogs = [
    ...(logs?.stdout ?? []).map((l) => ({ line: l, type: "out" as const })),
    ...(logs?.stderr ?? []).map((l) => ({ line: l, type: "err" as const })),
  ].sort((a, b) => {
    const ta = a.line.match(/\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}/)?.[0] ?? "";
    const tb = b.line.match(/\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}/)?.[0] ?? "";
    return ta.localeCompare(tb);
  });

  const displayedLogs =
    logTab === "stdout" ? (logs?.stdout ?? []).map((l) => ({ line: l, type: "out" as const }))
    : logTab === "stderr" ? (logs?.stderr ?? []).map((l) => ({ line: l, type: "err" as const }))
    : combinedLogs;
  const filteredLogs = displayedLogs.filter((entry) => {
    const matchesText = !logSearch.trim() || entry.line.toLowerCase().includes(logSearch.trim().toLowerCase());
    const matchesSeverity = logSeverityFilter === "all" || logSeverity(entry) === logSeverityFilter;
    return matchesText && matchesSeverity;
  });

  function downloadLogs() {
    const content = filteredLogs.map((entry) => `[${logTimestamp(entry.line)}] [${entry.type === "err" ? "STDERR" : "STDOUT"}] ${entry.line}`).join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${String(name).replace(/[^a-z0-9._-]/gi, "_")}-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "#0b0b0c" }}>
      {/* Header */}
      <div
        className="px-6 py-6 border-b"
        style={{
          background: "radial-gradient(ellipse 80% 80% at 50% 0%, rgba(255,90,31,.1) 0%, transparent 70%)",
          borderColor: "rgba(255,90,31,.15)",
        }}
      >
        <div className="max-w-screen-xl mx-auto">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Dashboard
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(255,90,31,.15)", border: "1px solid rgba(255,90,31,.3)" }}>
                <Layers className="w-5 h-5" style={{ color: "#ff5a1f" }} />
              </div>
              <div>
                {loading ? (
                  <Skeleton className="h-7 w-40 mb-1" />
                ) : (
                  <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
                    {proc?.name ?? name}
                    <span className="flex items-center gap-1 text-sm font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}40` }}>
                      <StatusIcon className="w-3.5 h-3.5" />
                      {proc?.status ?? "—"}
                    </span>
                  </h1>
                )}
                {proc && (
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    id:{proc.id} · pid:{proc.pid || "—"} · {proc.execMode} · {proc.interpreter}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs border-border/50"
                onClick={() => { fetchProc(true); fetchLogs(); }}
                disabled={!!acting}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </Button>
              <button
                onClick={() => setAutoRefresh((v) => !v)}
                className={`h-8 px-3 rounded-md text-xs font-medium transition-colors ${autoRefresh ? "text-[#ffd1c2]" : "text-muted-foreground"}`}
                style={{
                  background: autoRefresh ? "rgba(255,255,255,.1)" : "transparent",
                  border: `1px solid ${autoRefresh ? "rgba(255,255,255,.3)" : "rgba(255,255,255,.08)"}`,
                }}
              >
                {autoRefresh ? "● Live" : "○ Paused"}
              </button>
              <Button
                size="sm"
                onClick={() => doAction("restart")}
                disabled={!!acting}
                className="h-8 gap-1.5 text-xs"
                style={{ background: "rgba(255,90,31,.2)", color: "#ffb89f", border: "1px solid rgba(255,90,31,.4)" }}
              >
                <RotateCcw className={`w-3.5 h-3.5 ${acting === "restart" ? "animate-spin" : ""}`} />
                {acting === "restart" ? "Restarting…" : "Restart"}
              </Button>
              {isOnline ? (
                <Button
                  size="sm"
                  onClick={() => doAction("stop")}
                  disabled={!!acting}
                  className="h-8 gap-1.5 text-xs"
                  style={{ background: "rgba(255,107,107,.15)", color: "#ff6b6b", border: "1px solid rgba(255,107,107,.35)" }}
                >
                  <Square className="w-3.5 h-3.5" />
                  {acting === "stop" ? "Stopping…" : "Stop"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => doAction("start")}
                  disabled={!!acting}
                  className="h-8 gap-1.5 text-xs"
                  style={{ background: "rgba(255,255,255,.15)", color: "#ffd1c2", border: "1px solid rgba(255,255,255,.35)" }}
                >
                  <Play className="w-3.5 h-3.5" />
                  {acting === "start" ? "Starting…" : "Start"}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => doAction("flush")}
                disabled={!!acting}
                variant="outline"
                className="h-8 gap-1.5 text-xs border-border/50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {acting === "flush" ? "Flushing…" : "Flush Logs"}
              </Button>
              <Button
                size="sm"
                onClick={doRebuildRestart}
                disabled={!!acting}
                className="h-8 gap-1.5 text-xs"
                style={{ background: "rgba(255,255,255,.12)", color: "#ffd1c2", border: "1px solid rgba(255,255,255,.3)" }}
              >
                <Wrench className={`w-3.5 h-3.5 ${acting === "rebuild" ? "animate-spin" : ""}`} />
                {acting === "rebuild" ? "Building…" : "Rebuild & Restart"}
              </Button>
              {buildLines.length > 0 && (
                <button
                  onClick={() => setShowBuildPanel((v) => !v)}
                  className="h-8 px-2 rounded-md text-xs font-mono text-muted-foreground/60 hover:text-foreground flex items-center gap-1 transition-colors"
                  style={{ border: "1px solid rgba(255,255,255,.08)" }}
                >
                  {showBuildPanel ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  Build output
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
        {/* Build output panel */}
        {showBuildPanel && buildLines.length > 0 && (
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,.2)", background: "#17171a" }}>
            <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.04)" }}>
              <div className="flex items-center gap-2">
                <Wrench className="w-3.5 h-3.5" style={{ color: "#ffd1c2" }} />
                <span className="text-xs font-mono font-bold" style={{ color: "#ffd1c2" }}>Build Output</span>
                {acting === "rebuild" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded animate-pulse font-medium"
                    style={{ background: "rgba(255,255,255,.12)", color: "#ffd1c2" }}>RUNNING</span>
                )}
              </div>
              <button onClick={() => setShowBuildPanel(false)} className="text-muted-foreground/40 hover:text-foreground text-xs">✕</button>
            </div>
            <div className="p-4 max-h-72 overflow-y-auto font-mono text-xs space-y-0.5">
              {buildLines.map((line, i) => (
                <div key={i} className={
                  line.type === "error" ? "text-red-400" :
                  line.type === "info" ? "text-[#ffd1c2]/80" :
                  line.type === "done" ? "text-[#ffd1c2] font-bold" :
                  "text-foreground/60"
                }>{line.text}</div>
              ))}
              <div ref={buildEndRef} />
            </div>
          </div>
        )}

        {/* Stats row */}
        {proc && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: Cpu, label: "CPU", value: `${proc.cpu.toFixed(1)}%`, color: "#ff5a1f" },
              { icon: MemoryStick, label: "Memory", value: fmtBytes(proc.memory), color: "#ffd1c2" },
              { icon: Clock, label: "Uptime", value: fmtUptime(proc.uptime), color: "#ff5a1f" },
              { icon: Hash, label: "Restarts", value: String(proc.restarts), color: "#ffd1c2" },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="rounded-xl p-4"
                style={{ background: "#111113", border: "1px solid rgba(255,90,31,.15)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-3.5 h-3.5" style={{ color }} />
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{label}</span>
                </div>
                <div className="text-xl font-black text-foreground">{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Git panel */}
        {gitInfo?.isGit && (
          <div className="rounded-2xl p-5" style={{ background: "#111113", border: "1px solid rgba(255,90,31,.18)" }}>
            <div className="flex items-center gap-2 mb-4">
              <GitBranch className="w-4 h-4" style={{ color: "#ffd1c2" }} />
              <h2 className="text-sm font-bold text-foreground">Git</h2>
              {gitInfo.dirty && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold ml-1"
                  style={{ background: "rgba(255,170,0,.12)", color: "#ffaa00", border: "1px solid rgba(255,170,0,.3)" }}>
                  {gitInfo.changedFiles} unstaged
                </span>
              )}
              {!gitInfo.dirty && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold ml-1"
                  style={{ background: "rgba(255,255,255,.1)", color: "#ffd1c2", border: "1px solid rgba(255,255,255,.25)" }}>
                  clean
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground flex-shrink-0">Branch</span>
                  <span className="font-mono text-primary truncate">{gitInfo.branch || "—"}</span>
                </div>
                <div className="flex items-start gap-2">
                  <GitCommit className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <span className="text-muted-foreground flex-shrink-0">Commit</span>
                  <div className="min-w-0">
                    <span className="font-mono text-cyan-400 mr-1.5">{gitInfo.lastCommit?.hash || "—"}</span>
                    <span className="text-foreground/80 truncate">{gitInfo.lastCommit?.subject || ""}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground flex-shrink-0">Author</span>
                  <span className="font-mono text-foreground/80 truncate">{gitInfo.lastCommit?.author || "—"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground flex-shrink-0">When</span>
                  <span className="font-mono text-foreground/80">{gitInfo.lastCommit?.ago || "—"}</span>
                </div>
                {gitInfo.remote && (
                  <div className="flex items-start gap-2">
                    <span className="text-muted-foreground flex-shrink-0">Remote</span>
                    <span className="font-mono text-foreground/60 truncate text-[10px] leading-4 mt-0.5"
                      title={gitInfo.remote}>{gitInfo.remote.replace(/^https?:\/\//, "")}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Process info + CWD files */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Process info */}
          <div className="rounded-2xl p-5"
            style={{ background: "#111113", border: "1px solid rgba(255,90,31,.18)" }}>
            <div className="flex items-center gap-2 mb-4">
              <Terminal className="w-4 h-4" style={{ color: "#ff5a1f" }} />
              <h2 className="text-sm font-bold text-foreground">Process Info</h2>
            </div>
            {loading ? (
              <div className="space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-5 rounded" />)}</div>
            ) : proc ? (
              <div className="space-y-3 text-xs">
                {[
                  ["Script", proc.script || "—"],
                  ["Working Dir", proc.cwd || "—"],
                  ["Interpreter", `${proc.interpreter}${proc.nodeVersion ? ` (${proc.nodeVersion})` : ""}`],
                  ["Exec Mode", proc.execMode],
                  ["Watch", proc.watch ? "enabled" : "disabled"],
                  ["Log File", proc.logFile || "—"],
                  ["Error File", proc.errorFile || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4">
                    <span className="text-muted-foreground flex-shrink-0 font-medium">{k}</span>
                    <span className="font-mono text-foreground text-right truncate max-w-[220px]" title={v}>{v}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* CWD files */}
          <div className="rounded-2xl p-5"
            style={{ background: "#111113", border: "1px solid rgba(255,90,31,.18)" }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4" style={{ color: "#ffd1c2" }} />
                <h2 className="text-sm font-bold text-foreground">Working Directory</h2>
              </div>
              {proc?.cwd && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs border-border/50"
                  onClick={() => navigate(`/files?path=${encodeURIComponent(proc.cwd)}`)}
                >
                  <FolderOpen className="w-3 h-3" />
                  Open
                </Button>
              )}
            </div>
            {proc?.cwd ? (
              <CwdFileList cwd={proc.cwd} headers={headers} navigate={navigate} />
            ) : (
              <p className="text-xs text-muted-foreground/50">No working directory</p>
            )}
          </div>
        </div>

        {/* Logs section */}
        <div className="group relative rounded-2xl overflow-hidden"
          style={{ background: "linear-gradient(145deg, #151719, #0d0f10 72%)", border: "1px solid rgba(230,173,104,.22)", boxShadow: "0 18px 55px rgba(0,0,0,.28), 0 0 36px rgba(230,173,104,.035)" }}>
          <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #8e5f35, #e6ad68 38%, #f0c58f 52%, #6e5034)" }} />
          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            style={{ borderBottom: "1px solid rgba(230,173,104,.12)", background: "linear-gradient(90deg, rgba(230,173,104,.075), rgba(255,255,255,.015) 58%, transparent)" }}>
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                style={{ background: "rgba(230,173,104,.11)", border: "1px solid rgba(230,173,104,.22)" }}>
                <Terminal className="w-4 h-4" style={{ color: "#e6ad68" }} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold tracking-wide text-foreground">Process logs</h2>
                  <span className="rounded-full px-2 py-0.5 font-mono text-[9px] tracking-[.14em]"
                    style={{ color: autoRefresh ? "#a9d8b0" : "#9a9389", background: autoRefresh ? "rgba(125,200,140,.09)" : "rgba(255,255,255,.045)", border: `1px solid ${autoRefresh ? "rgba(125,200,140,.18)" : "rgba(255,255,255,.08)"}` }}>
                    {autoRefresh ? "● LIVE STREAM" : "○ PAUSED"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] font-mono text-muted-foreground/60">
                  <span className="truncate">{proc?.name ?? name}</span><span>/</span><span>tail · {logLineLimit} lines per stream</span>
                  <span className="text-white/15">|</span><span>{filteredLogs.length} / {displayedLogs.length} shown</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1 rounded-xl p-1"
              style={{ background: "rgba(0,0,0,.24)", border: "1px solid rgba(255,255,255,.055)" }}>
              {(["combined", "stdout", "stderr"] as LogTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setLogTab(tab)}
                  className="h-7 px-2.5 rounded-lg text-[11px] font-medium transition-all"
                  style={{
                    background: logTab === tab ? "linear-gradient(135deg, rgba(230,173,104,.2), rgba(230,173,104,.08))" : "transparent",
                    color: logTab === tab ? "#f0c58f" : "var(--muted-foreground)",
                    border: `1px solid ${logTab === tab ? "rgba(230,173,104,.27)" : "transparent"}`,
                    boxShadow: logTab === tab ? "0 2px 10px rgba(0,0,0,.18)" : "none",
                  }}
                >
                  {tab === "combined" ? "All" : tab}
                  {tab === "stderr" && logs && logs.stderr.length > 0 && (
                    <span className="ml-1 rounded-full px-1 text-[9px] text-red-200" style={{ background: "rgba(248,113,113,.13)" }}>{logs.stderr.length}</span>
                  )}
                </button>
              ))}
              {filteredLogs.length > 0 && (
                <button
                  onClick={() => {
                    const text = filteredLogs.map((e) => `[${logTimestamp(e.line)}] [${e.type === "err" ? "STDERR" : "STDOUT"}] ${e.line}`).join("\n");
                    navigator.clipboard.writeText(text).then(() => {
                      setLogCopied(true);
                      setTimeout(() => setLogCopied(false), 2000);
                    });
                  }}
                  className="h-7 px-2.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-colors ml-1"
                  style={{
                    background: logCopied ? "rgba(125,200,140,.09)" : "rgba(255,255,255,.025)",
                    color: logCopied ? "#a9d8b0" : "var(--muted-foreground)",
                    border: `1px solid ${logCopied ? "rgba(125,200,140,.2)" : "rgba(255,255,255,.055)"}`,
                  }}
                  title="Copy all logs"
                >
                  {logCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{logCopied ? "Copied" : "Copy all"}</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:px-5"
            style={{ borderColor: "rgba(230,173,104,.09)", background: "rgba(0,0,0,.16)" }}>
            <label className="relative min-w-[180px] flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
              <input value={logSearch} onChange={(event) => setLogSearch(event.target.value)} placeholder="Search log text…"
                className="h-8 w-full rounded-lg border pl-9 pr-3 text-xs text-white/80 outline-none placeholder:text-white/30 focus:border-amber-300/40"
                style={{ background: "rgba(0,0,0,.28)", borderColor: "rgba(255,255,255,.08)" }} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-white/40">
                Severity
                <select value={logSeverityFilter} onChange={(event) => setLogSeverityFilter(event.target.value as LogSeverity)}
                  className="h-8 rounded-lg border px-2 text-xs normal-case tracking-normal text-white/75 outline-none"
                  style={{ background: "#111416", borderColor: "rgba(255,255,255,.09)" }}>
                  <option value="all">All levels</option><option value="error">Errors</option><option value="warn">Warnings</option><option value="info">Info / other</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-white/40">
                Tail
                <select value={logLineLimit} onChange={(event) => setLogLineLimit(Number(event.target.value))}
                  className="h-8 rounded-lg border px-2 text-xs normal-case tracking-normal text-white/75 outline-none"
                  style={{ background: "#111416", borderColor: "rgba(255,255,255,.09)" }}>
                  {[100, 250, 500].map((limit) => <option key={limit} value={limit}>{limit} lines</option>)}
                </select>
              </label>
              <button onClick={() => setAutoScroll((value) => !value)} aria-pressed={autoScroll}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] transition-colors"
                style={{ color: autoScroll ? "#f0c58f" : "#aaa49b", background: autoScroll ? "rgba(230,173,104,.08)" : "rgba(255,255,255,.025)", borderColor: autoScroll ? "rgba(230,173,104,.18)" : "rgba(255,255,255,.07)" }}>
                {autoScroll ? <Radio className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}{autoScroll ? "Follow" : "Hold view"}
              </button>
              <button onClick={downloadLogs} disabled={!filteredLogs.length}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] text-white/55 transition-colors hover:text-[#f0c58f] disabled:cursor-not-allowed disabled:opacity-30"
                style={{ background: "rgba(255,255,255,.025)", borderColor: "rgba(255,255,255,.07)" }}>
                <Download className="h-3.5 w-3.5" />Export
              </button>
            </div>
          </div>

          <div ref={logsViewportRef} className="relative font-mono text-xs overflow-y-auto" style={{ maxHeight: "460px", minHeight: "190px", backgroundColor: "#090b0c", backgroundImage: "linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.012) 1px, transparent 1px), radial-gradient(ellipse at 12% 0%, rgba(230,173,104,.065), transparent 48%)", backgroundSize: "28px 28px, 28px 28px, auto" }}>
            {logsLoading ? (
              <div className="p-4 space-y-1.5">
                {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-4 rounded w-full" />)}
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex min-h-[190px] flex-col items-center justify-center gap-2 px-4 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ color: "#b58b5d", background: "rgba(230,173,104,.07)", border: "1px solid rgba(230,173,104,.12)" }}><Terminal className="h-4 w-4" /></div>
                <div className="text-xs font-medium text-white/55">{displayedLogs.length ? "No lines match these filters" : "No output in this stream"}</div>
                <div className="text-[10px] text-white/30">{displayedLogs.length ? "Adjust search or severity to see more output" : "New process activity will appear here automatically"}</div>
              </div>
            ) : (
              <div className="space-y-px p-2 sm:p-3">
                {filteredLogs.map((entry, i) => (
                  <div key={`${entry.type}-${i}-${entry.line}`} className="group/line relative flex items-start gap-2 sm:gap-3 rounded-md px-2 py-1 leading-5 transition-colors hover:bg-white/[0.035]"
                    style={{ borderLeft: `2px solid ${entry.type === "err" ? "rgba(248,113,113,.62)" : "rgba(230,173,104,.18)"}` }}>
                    <span className="select-none w-7 flex-shrink-0 text-right text-white/20 tabular-nums group-hover/line:text-[#e6ad68]/65">
                      {i + 1}
                    </span>
                    <span className="hidden w-[68px] flex-shrink-0 pt-px text-[10px] tabular-nums text-white/35 sm:inline">{logTimestamp(entry.line)}</span>
                    <span className="mt-[2px] w-[48px] flex-shrink-0 rounded px-1 py-px text-center text-[9px] font-bold tracking-wide"
                      style={{ color: entry.type === "err" ? "#f2aaa5" : "#d4ad7c", background: entry.type === "err" ? "rgba(248,113,113,.08)" : "rgba(230,173,104,.07)" }}>{entry.type === "err" ? "STDERR" : "STDOUT"}</span>
                    <span className="mt-[5px] h-2 w-2 flex-shrink-0 rounded-[3px]" style={{ background: entry.type === "err" ? "#f87171" : "#c59a68", boxShadow: `0 0 8px ${entry.type === "err" ? "rgba(248,113,113,.28)" : "rgba(197,154,104,.2)"}` }} />
                    <span
                      className="min-w-0 break-all"
                      style={{ color: entry.type === "err" ? "#f2aaa5" : "rgba(235,232,225,.78)" }}
                    >
                      {entry.line}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}

function CwdFileList({
  cwd,
  headers,
  navigate,
}: {
  cwd: string;
  headers: Record<string, string>;
  navigate: (to: string) => void;
}) {
  const [files, setFiles] = useState<{ name: string; isDirectory: boolean; size: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/files/list?path=${encodeURIComponent(cwd)}`, { headers })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.entries) {
          setFiles(
            data.entries
              .slice(0, 20)
              .map((e: { name: string; type: string; size: number }) => ({
                name: e.name,
                isDirectory: e.type === "directory",
                size: e.size,
              }))
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cwd]);

  if (loading) return <div className="space-y-1.5">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-5 rounded" />)}</div>;

  if (!files.length) return <p className="text-xs text-muted-foreground/40">Directory empty or unreadable</p>;

  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground/50 font-mono mb-2 truncate">{cwd}</p>
      {files.map((f) => (
        <button
          key={f.name}
          onClick={() => navigate(`/files?path=${encodeURIComponent(cwd + "/" + f.name)}`)}
          className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.04] transition-colors text-left group"
        >
          <span className="text-base leading-none flex-shrink-0">
            {f.isDirectory ? "📁" : "📄"}
          </span>
          <span className="text-xs font-mono text-foreground truncate flex-1">{f.name}</span>
          {!f.isDirectory && (
            <span className="text-xs text-muted-foreground/40 flex-shrink-0">
              {f.size > 0 ? (f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)}M` : f.size > 1024 ? `${(f.size / 1024).toFixed(0)}K` : `${f.size}B`) : ""}
            </span>
          )}
          <ChevronRight className="w-3 h-3 text-muted-foreground/20 group-hover:text-muted-foreground/60 flex-shrink-0" />
        </button>
      ))}
      {files.length === 20 && (
        <button
          onClick={() => navigate(`/files?path=${encodeURIComponent(cwd)}`)}
          className="w-full text-xs text-muted-foreground/50 hover:text-[#ff5a1f] mt-1 text-center transition-colors"
        >
          View all files →
        </button>
      )}
    </div>
  );
}
