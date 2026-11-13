import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type Server = { id: number; name: string; host: string; port: number; hostFingerprint?: string | null };
type Rule = { number: number; to: string; action: string; direction: string; from: string };
type Status = { available: boolean; active: boolean | null; defaultIncoming: string | null; rules: Rule[]; message?: string; server?: { id: number; name: string; host: string; sshPort: number } };

export default function FirewallPage() {
  const { toast } = useToast();
  const [servers, setServers] = useState<Server[]>([]);
  const [statuses, setStatuses] = useState<Record<number, Status>>({});
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<number | null>(null);
  const [applying, setApplying] = useState<number | null>(null);
  const [ports, setPorts] = useState<Record<number, string>>({});
  const [protocols, setProtocols] = useState<Record<number, "tcp" | "udp">>({});

  const loadServers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/servers", { credentials: "include", cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Unable to load saved VPS connections");
      setServers(Array.isArray(body) ? body : []);
    } catch (error) {
      toast({ title: "Firewall page could not load", description: error instanceof Error ? error.message : "Request failed", variant: "destructive" });
    } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { void loadServers(); }, [loadServers]);

  async function inspect(server: Server) {
    if (import.meta.env.DEV) {
      toast({ title: "Shared preview", description: "Remote SSH firewall checks are disabled in Preview. Use this screen after deploying on your own HTTPS VPS.", variant: "destructive" });
      return;
    }
    setChecking(server.id);
    try {
      const response = await fetch(`/api/servers/${server.id}/firewall`, { credentials: "include", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Could not inspect UFW");
      setStatuses((items) => ({ ...items, [server.id]: result }));
    } catch (error) {
      setStatuses((items) => ({ ...items, [server.id]: { available: false, active: null, defaultIncoming: null, rules: [], message: error instanceof Error ? error.message : "Request failed" } }));
    } finally { setChecking(null); }
  }

  async function allowPort(server: Server) {
    const rawPort = ports[server.id] ?? "";
    const port = Number(rawPort);
    const protocol = protocols[server.id] ?? "tcp";
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast({ title: "Invalid port", description: "Enter a port from 1 through 65535.", variant: "destructive" }); return;
    }
    if (import.meta.env.DEV) {
      toast({ title: "Shared preview", description: "Firewall changes are disabled in Preview.", variant: "destructive" }); return;
    }
    const expected = `ALLOW ${port}/${protocol.toUpperCase()} ON ${server.name}`;
    const typed = window.prompt(`This adds an inbound UFW allow rule on ${server.name} (${server.host}).\n\nIt does not enable UFW or remove other rules. Make sure your SSH port ${server.port} and required web ports are allowed.\n\nType exactly:\n${expected}`);
    if (typed !== expected) return;
    setApplying(server.id);
    try {
      const response = await fetch(`/api/servers/${server.id}/firewall/allow`, {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ port, protocol, confirmation: typed }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Could not apply the UFW rule");
      setStatuses((items) => ({ ...items, [server.id]: result.status }));
      toast({ title: "Firewall rule applied", description: `${port}/${protocol.toUpperCase()} allowed on ${server.name}.` });
    } catch (error) {
      toast({ title: "Firewall change failed", description: error instanceof Error ? error.message : "Request failed", variant: "destructive" });
    } finally { setApplying(null); }
  }

  return <div className="flex-1 min-h-0 overflow-y-auto bg-[#0b0b0c]">
    <div className="mx-auto max-w-screen-xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="mb-2 flex items-center gap-2"><Shield className="h-4 w-4 text-amber-200" /><span className="ops-kicker">Host protection / UFW</span></div><h1 className="text-3xl font-black tracking-tight">Firewall <span className="brand-gradient">Control</span></h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Inspect UFW on your saved VPSs and add individual inbound allow rules through pinned SSH connections.</p></div>
        <Button variant="outline" onClick={() => void loadServers()} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh hosts</Button>
      </header>

      {import.meta.env.DEV && <div className="flex gap-3 rounded-xl border border-amber-300/25 bg-amber-300/5 p-4" role="alert"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" /><div><p className="text-sm font-semibold text-amber-100">Shared preview — remote firewall operations are disabled</p><p className="mt-1 text-xs text-amber-100/70">Do not enter live VPS credentials or use this shared preview to change host firewalls. Deploy the app on your own HTTPS VPS first.</p></div></div>}

      <div className="flex gap-3 rounded-xl border border-white/10 bg-white/[.02] p-4"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" /><p className="text-xs leading-relaxed text-muted-foreground">This page supports Ubuntu/Debian UFW only; it does not mitigate DDoS attacks or replace your provider firewall. It will never enable UFW, reset policies, remove rules, or alter the panel’s own host. Keep your SSH port and required HTTP/HTTPS ports allowed before making firewall changes.</p></div>

      {loading ? <div className="animate-pulse rounded-2xl border border-white/10 p-8 text-sm text-muted-foreground">Loading saved VPS connections…</div> : servers.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 p-10 text-center"><Shield className="mx-auto mb-3 h-9 w-9 text-amber-200" /><p className="font-semibold">No saved VPS hosts</p><p className="mt-1 text-sm text-muted-foreground">Add and verify a host-key-pinned connection before inspecting its firewall.</p><Button asChild className="mt-4"><Link href="/connections">Open VPS Connections</Link></Button></div> : <div className="space-y-4">{servers.map((server) => {
        const status = statuses[server.id];
        return <article key={server.id} className="space-y-4 rounded-2xl border border-amber-300/15 bg-[#111113] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{server.name}</h2><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{server.host} · SSH {server.port} · {server.hostFingerprint ? "host key pinned" : "host key not trusted"}</p></div><Button size="sm" variant="outline" disabled={checking === server.id || import.meta.env.DEV || !server.hostFingerprint} onClick={() => void inspect(server)}>{checking === server.id ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Inspect UFW</Button></div>
          {!server.hostFingerprint && <p className="text-xs text-amber-100/80">First verify the SSH fingerprint on the Connections page.</p>}
          {status && <>
            <div className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${status.active ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-200" : status.active === false ? "border-red-500/20 bg-red-500/5 text-red-200" : "border-white/10 bg-black/20 text-muted-foreground"}`}>
              {status.active ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {status.available ? `UFW ${status.active ? "active" : "inactive"}${status.defaultIncoming ? ` · incoming default: ${status.defaultIncoming}` : ""}` : status.message ?? "UFW status unavailable"}
            </div>
            {status.available && <>
              <div className="grid gap-3 sm:grid-cols-[130px_130px_auto] sm:items-end"><label className="space-y-1 text-xs text-muted-foreground">Inbound port<Input inputMode="numeric" type="number" min="1" max="65535" placeholder="443" value={ports[server.id] ?? ""} onChange={(event) => setPorts((items) => ({ ...items, [server.id]: event.target.value }))} /></label><label className="space-y-1 text-xs text-muted-foreground">Protocol<select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" value={protocols[server.id] ?? "tcp"} onChange={(event) => setProtocols((items) => ({ ...items, [server.id]: event.target.value as "tcp" | "udp" }))}><option value="tcp">TCP</option><option value="udp">UDP</option></select></label><Button disabled={!status.active || applying === server.id || import.meta.env.DEV || !server.hostFingerprint || !(ports[server.id] ?? "")} onClick={() => void allowPort(server)}>{applying === server.id ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Add allow rule</Button></div>
              {!status.active && <p className="text-xs text-red-200/80">For safety, this interface does not turn on an inactive firewall. Activate it through a provider console or direct SSH only after preparing an access plan.</p>}
              <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current UFW rules ({status.rules.length})</h3>{status.rules.length ? <div className="overflow-x-auto rounded-xl border border-white/5"><table className="w-full min-w-[520px] text-left text-xs"><thead className="bg-white/[.03] text-muted-foreground"><tr><th className="p-2.5">#</th><th className="p-2.5">To</th><th className="p-2.5">Action</th><th className="p-2.5">Direction</th><th className="p-2.5">From</th></tr></thead><tbody>{status.rules.map((rule) => <tr key={rule.number} className="border-t border-white/5"><td className="p-2.5 font-mono">{rule.number}</td><td className="p-2.5 font-mono">{rule.to}</td><td className={`p-2.5 font-semibold ${rule.action === "ALLOW" ? "text-emerald-300" : "text-amber-200"}`}>{rule.action}</td><td className="p-2.5">{rule.direction}</td><td className="p-2.5 font-mono">{rule.from}</td></tr>)}</tbody></table></div> : <p className="text-xs text-muted-foreground">No numbered rules returned.</p>}</div>
            </>}
          </>}
        </article>;
      })}</div>}
    </div>
  </div>;
}
