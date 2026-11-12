import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/footer";
import { KeyRound, Clipboard, LogOut, ShieldCheck, RefreshCw, ShieldAlert } from "lucide-react";

export default function SettingsPage() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const [maskedKey, setMaskedKey] = useState("••••••••••");
  const [oneTimeKey, setOneTimeKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [auditEntries, setAuditEntries] = useState<{ id: number; action: string; targetType: string; targetId: string | null; status: string; createdAt: string }[]>([]);

  useEffect(() => {
    fetch("/api/settings", { credentials: "include", cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setMaskedKey(data.maskedKey ?? "••••••••••"))
      .catch(() => toast({ title: "Settings unavailable", description: "Could not load security settings.", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    fetch("/api/audit/logs?limit=20", { credentials: "include", cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => setAuditEntries(data.entries ?? []))
      .catch(() => {});
  }, []);

  async function rotateKey() {
    if (!window.confirm("Rotate the administrator login key? The new key will be shown once and other browser sessions will be revoked.")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/rotate-key", { method: "POST", credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Key rotation failed");
      setOneTimeKey(data.apiKey);
      setMaskedKey(`${data.apiKey.slice(0, 4)}••••••••${data.apiKey.slice(-2)}`);
      toast({ title: "Key rotated", description: "Copy and store the new key securely. It will not be shown again." });
    } catch (error) {
      toast({ title: "Rotation failed", description: error instanceof Error ? error.message : "Could not rotate the key.", variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function revokeOtherSessions() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/sessions/revoke-others", { method: "POST", credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Session revocation failed");
      toast({ title: "Other sessions revoked", description: "This browser remains signed in." });
    } catch (error) {
      toast({ title: "Could not revoke sessions", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(oneTimeKey);
      toast({ title: "Copied", description: "Save the key in a password manager; this is the only time it is displayed." });
    } catch {
      toast({ title: "Copy unavailable", description: "Select and copy the key manually.", variant: "destructive" });
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight brand-gradient">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage administrator access and security</p>
        </div>

        <section className="rounded-2xl border p-5 space-y-4" style={{ background: "rgba(230,173,104,.05)", borderColor: "rgba(230,173,104,.18)" }}>
          <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-300" /><span className="text-sm font-semibold">Administrator login key</span></div>
          <code className="block px-4 py-3 rounded-xl font-mono text-sm tracking-widest bg-black/20">{loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin inline" /> : maskedKey}</code>
          <p className="text-xs text-muted-foreground">The key is only used to start a browser session. It cannot authenticate ordinary API requests directly.</p>
          <Button onClick={rotateKey} disabled={busy} className="gap-2 font-semibold"><KeyRound className="w-4 h-4" />{busy ? "Working…" : "Generate a new login key"}</Button>
          {oneTimeKey && <div className="space-y-2 rounded-xl border border-amber-300/30 p-4" role="status">
            <p className="text-sm font-semibold">Copy this key now — it will not be shown again.</p>
            <code className="block break-all select-all rounded-lg bg-black/30 p-3 font-mono text-xs">{oneTimeKey}</code>
            <Button variant="outline" size="sm" onClick={copyKey} className="gap-2"><Clipboard className="w-4 h-4" />Copy key</Button>
          </div>}
        </section>

        <section className="rounded-2xl border p-5 space-y-3 bg-white/[.02] border-white/10">
          <div className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-300" /><span className="text-sm font-semibold">Browser sessions</span></div>
          <p className="text-xs text-muted-foreground">Revoke every other signed-in browser while keeping this session active. Changing your login key also revokes other sessions.</p>
          <Button variant="outline" disabled={busy} onClick={revokeOtherSessions}>Revoke other sessions</Button>
        </section>

        <section className="rounded-2xl border p-5 space-y-3 bg-white/[.02] border-white/10">
          <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-300" /><span className="text-sm font-semibold">Recent security and operations activity</span></div>
          <p className="text-xs text-muted-foreground">Latest 20 recorded actions. Sensitive event metadata is deliberately not shown here.</p>
          {auditEntries.length ? <div className="divide-y divide-white/5">
            {auditEntries.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
              <span className="font-medium">{entry.action} <span className="text-muted-foreground">· {entry.targetType}{entry.targetId ? ` ${entry.targetId}` : ""}</span></span>
              <span className="text-muted-foreground">{entry.status} · {new Date(entry.createdAt).toLocaleString()}</span>
            </div>)}
          </div> : <p className="text-xs text-muted-foreground">No recent audit entries are available.</p>}
        </section>

        <section className="rounded-2xl border p-5 space-y-3 border-destructive/20 bg-destructive/[.03]">
          <p className="text-sm font-semibold text-destructive">Current session</p>
          <p className="text-xs text-muted-foreground">Logging out clears this browser’s session. The administrator key remains unchanged.</p>
          <Button variant="outline" onClick={logout} className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"><LogOut className="w-4 h-4" />Logout</Button>
        </section>
      </div>
      <Footer />
    </div>
  );
}
