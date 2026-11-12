import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, LoaderCircle, Send, ShieldCheck, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";

type Server = { id: number; name: string; host: string; port: number; username: string; hostFingerprint?: string | null };
type Entry = { command: string; cwd: string; stdout: string; stderr: string; exitCode: number };

async function jsonRequest(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, credentials: "include", headers: { ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body;
}

export default function RemoteTerminalPage() {
  const [, params] = useRoute("/connections/:id/terminal");
  const serverId = params?.id ?? "";
  const [, navigate] = useLocation();
  const [server, setServer] = useState<Server | null>(null);
  const [cwd, setCwd] = useState("/");
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!serverId) return;
    jsonRequest(`/api/servers/${encodeURIComponent(serverId)}`)
      .then((data) => setServer(data as Server))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load server"))
      .finally(() => setLoading(false));
  }, [serverId]);

  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [history]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const submitted = command.trim();
    if (!submitted || !serverId || running) return;
    setRunning(true);
    setError("");
    setCommand("");
    const isCd = /^cd(?:\s|$)/.test(submitted);
    try {
      const result = await jsonRequest(`/api/servers/${encodeURIComponent(serverId)}/terminal/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: isCd ? `${submitted} && pwd` : submitted, cwd }),
      });
      let stdout = String(result.stdout ?? "");
      if (isCd && Number(result.exitCode) === 0 && stdout.trim()) {
        const lines = stdout.replace(/\n$/, "").split("\n");
        const nextCwd = lines.pop() ?? "";
        if (nextCwd.startsWith("/")) setCwd(nextCwd);
        stdout = lines.join("\n");
      }
      setHistory((entries) => [...entries, { command: submitted, cwd, stdout, stderr: String(result.stderr ?? ""), exitCode: Number(result.exitCode ?? 0) }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Remote command failed");
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  }

  const trusted = !!server?.hostFingerprint;
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: "#0b0b0c" }}>
      <header className="px-4 sm:px-6 py-4 border-b border-white/10 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/connections")} aria-label="Back to connections"><ArrowLeft className="w-4 h-4" /></Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-[#ffd1c2]"><Terminal className="w-3.5 h-3.5" /> Remote SSH terminal</div>
          <h1 className="font-bold truncate">{server ? `${server.name} · ${server.username}@${server.host}:${server.port}` : "Loading VPS…"}</h1>
        </div>
        <span className={`hidden sm:flex items-center gap-1.5 text-xs ${trusted ? "text-emerald-300" : "text-amber-300"}`}>
          <ShieldCheck className="w-4 h-4" /> {trusted ? "Host key pinned" : "Host key unverified"}
        </span>
      </header>

      {import.meta.env.DEV && <div className="mx-4 mt-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-100">Shared preview safety: live SSH commands are disabled. Deploy to your own production VPS to use the remote terminal.</div>}
      {error && <div className="mx-4 mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-200">{error}</div>}
      {!loading && server && !trusted && <div className="mx-4 mt-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100">This host has not been verified. Return to <button className="underline" onClick={() => navigate("/connections")}>VPS Connections</button>, test SSH, and compare the presented fingerprint with your provider before accepting it.</div>}

      <div ref={outputRef} className="flex-1 min-h-0 overflow-auto p-4 sm:p-6 font-mono text-xs sm:text-sm" aria-live="polite">
        {loading && <div className="text-muted-foreground">Loading server profile…</div>}
        {!loading && history.length === 0 && trusted && <div className="text-muted-foreground">Connected to <span className="text-[#ffd1c2]">{server?.host}</span>. Commands run as the saved SSH user. Keep them least-privileged.</div>}
        {history.map((entry, index) => (
          <div key={`${index}-${entry.command}`} className="mb-5">
            <div className="text-emerald-300 break-all"><span className="text-muted-foreground">{entry.cwd}</span> $ {entry.command}</div>
            {entry.stdout && <pre className="mt-1 whitespace-pre-wrap break-words text-white/80">{entry.stdout}</pre>}
            {entry.stderr && <pre className="mt-1 whitespace-pre-wrap break-words text-amber-200/80">{entry.stderr}</pre>}
            {entry.exitCode !== 0 && <div className="mt-1 text-red-300">exit code {entry.exitCode}</div>}
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="p-3 sm:p-4 border-t border-white/10 flex gap-2 bg-[#111113]">
        <label htmlFor="remote-command" className="sr-only">Remote command</label>
        <div className="hidden sm:flex items-center px-2 text-xs text-emerald-300 font-mono">{cwd} $</div>
        <input
          id="remote-command" ref={inputRef} value={command} onChange={(event) => setCommand(event.target.value)}
          disabled={loading || running || !trusted || import.meta.env.DEV} autoComplete="off" spellCheck={false}
          className="flex-1 min-w-0 h-10 rounded-md border border-white/10 bg-black px-3 font-mono text-sm outline-none focus:border-[#ff5a1f]/50 disabled:opacity-50"
          placeholder={trusted ? "Type a command…" : "Verify the server host key first"}
        />
        <Button type="submit" disabled={loading || running || !trusted || !command.trim() || import.meta.env.DEV} aria-label="Run command">
          {running ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </form>
    </div>
  );
}
