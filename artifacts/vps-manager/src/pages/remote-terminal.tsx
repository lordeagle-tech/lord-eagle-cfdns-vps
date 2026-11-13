import { lazy, Suspense, useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, ShieldCheck, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";

type Server = { id: number; name: string; host: string; port: number; username: string; hostFingerprint?: string | null };
const InteractiveTerminal = lazy(() => import("@/components/interactive-terminal"));

async function jsonRequest(url: string): Promise<unknown> {
  const response = await fetch(url, { credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body;
}

export default function RemoteTerminalPage() {
  const [, params] = useRoute("/connections/:id/terminal");
  const serverId = params?.id ?? "";
  const [, navigate] = useLocation();
  const [server, setServer] = useState<Server | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setServer(null);
    setError("");
    if (!serverId) {
      setError("A saved VPS id is required.");
      setLoading(false);
      return () => { active = false; };
    }
    jsonRequest(`/api/servers/${encodeURIComponent(serverId)}`)
      .then((data) => { if (active) setServer(data as Server); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load this saved VPS."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [serverId]);

  const trusted = !!server?.hostFingerprint;
  const websocketPath = server ? `/api/servers/${server.id}/terminal/session` : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0b0b0c]">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-4 sm:px-6">
        <Button variant="ghost" size="icon" onClick={() => navigate("/connections")} aria-label="Back to VPS connections"><ArrowLeft className="h-4 w-4" /></Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-[#ffd1c2]"><Terminal className="h-3.5 w-3.5" /> Remote interactive SSH shell</div>
          <h1 className="truncate font-bold">{server ? `${server.name} · ${server.username}@${server.host}:${server.port}` : "Loading saved VPS…"}</h1>
        </div>
        <span className={`hidden items-center gap-1.5 text-xs sm:flex ${trusted ? "text-emerald-300" : "text-amber-300"}`}>
          <ShieldCheck className="h-4 w-4" /> {trusted ? "Host key pinned" : "Host key unverified"}
        </span>
      </header>

      {import.meta.env.DEV && <div className="mx-4 mt-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-100">Shared preview safety: live SSH shells are disabled. Deploy the panel to your own VPS to connect to saved hosts.</div>}
      {loading && <div className="p-6 text-sm text-muted-foreground">Loading saved VPS profile…</div>}
      {!loading && error && <div className="mx-4 mt-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-200">{error}</div>}
      {!loading && server && !trusted && <div className="mx-4 mt-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100">This host has not been verified. Return to <button className="underline" onClick={() => navigate("/connections")}>VPS Connections</button>, test SSH, then compare the presented SHA-256 fingerprint with your VPS provider before trusting it.</div>}
      {!import.meta.env.DEV && !loading && server && trusted && (
        <Suspense fallback={<div className="flex min-h-0 flex-1 items-center justify-center font-mono text-sm text-muted-foreground">Loading terminal…</div>}>
          <InteractiveTerminal
            key={server.id}
            websocketPath={websocketPath}
            accountNotice={`Remote shell as ${server.username}; no automatic sudo`}
            openingMessage={`Opening an interactive SSH shell on ${server.host}…`}
          />
        </Suspense>
      )}
    </div>
  );
}
