import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaLoaded, setMfaLoaded] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [securityEvents, setSecurityEvents] = useState<{ id: number; sourceIp: string; failedAttempts: number; createdAt: string }[]>([]);

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

  useEffect(() => {
    fetch("/api/auth/mfa/status", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load multi-factor status");
        setMfaEnabled(Boolean(data.enabled));
      })
      .catch((error) => toast({ title: "MFA status unavailable", description: error instanceof Error ? error.message : "Could not load status.", variant: "destructive" }))
      .finally(() => setMfaLoaded(true));
  }, [toast]);

  useEffect(() => {
    fetch("/api/auth/security-events?limit=20", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load security events");
        setSecurityEvents(data.events ?? []);
      })
      .catch((error) => toast({ title: "Security alerts unavailable", description: error instanceof Error ? error.message : "Could not load recent blocks.", variant: "destructive" }));
  }, [toast]);

  async function beginMfaSetup() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/mfa/setup", { method: "POST", credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start MFA setup");
      if (!data.secret || !data.otpauthUrl) throw new Error("The server returned incomplete MFA setup details");
      setMfaSetup({ secret: data.secret, otpauthUrl: data.otpauthUrl });
      setMfaCode("");
      setRecoveryCodes(null);
    } catch (error) {
      toast({ title: "MFA setup failed", description: error instanceof Error ? error.message : "Could not start setup.", variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function enableMfa() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/mfa/enable", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: mfaCode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not enable MFA");
      setMfaEnabled(true);
      setMfaSetup(null);
      setMfaCode("");
      setRecoveryCodes(data.recoveryCodes);
      toast({ title: "Authenticator enabled", description: data.warning ?? "Save the recovery codes somewhere safe; they are shown only once.", variant: data.warning ? "destructive" : undefined });
    } catch (error) {
      toast({ title: "MFA setup failed", description: error instanceof Error ? error.message : "Could not enable MFA.", variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function disableMfa() {
    if (!window.confirm("Disable multi-factor authentication for administrator sign-in?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/mfa/disable", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: mfaCode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not disable MFA");
      setMfaEnabled(false);
      setMfaCode("");
      setRecoveryCodes(null);
      setMfaSetup(null);
      toast({ title: "Authenticator disabled" });
    } catch (error) {
      toast({ title: "Could not disable MFA", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      toast({ title: "Recovery codes copied", description: "Store them securely; each code works once." });
    } catch {
      toast({ title: "Copy unavailable", description: "Select and copy the codes manually.", variant: "destructive" });
    }
  }

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

  function readableAction(action: string) {
    return action.split(/[._]/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" · ");
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="flex-1 px-4 py-6 max-w-2xl mx-auto w-full space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight brand-gradient">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage administrator access and security</p>
        </div>

        <section className="rounded-2xl border p-4 sm:p-5 space-y-4" style={{ background: "rgba(230,173,104,.05)", borderColor: "rgba(230,173,104,.18)" }}>
          <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-300" /><span className="text-sm font-semibold">Administrator login key</span></div>
          <code className="block break-all px-3 py-3 sm:px-4 rounded-xl font-mono text-xs sm:text-sm tracking-widest bg-black/20">{loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin inline" /> : maskedKey}</code>
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

        <section className="rounded-2xl border p-5 space-y-4 bg-white/[.02] border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-300" /><span className="text-sm font-semibold">Authenticator MFA</span></div>
            <span className={`rounded-full border px-2 py-1 text-[10px] ${mfaEnabled ? "border-emerald-300/25 bg-emerald-300/[.06] text-emerald-200" : "border-white/10 bg-white/[.03] text-muted-foreground"}`}>{!mfaLoaded ? "Loading" : mfaEnabled ? "Enabled" : "Not enabled"}</span>
          </div>
          <p className="text-xs text-muted-foreground">Require a time-based authenticator code after the access key or OAuth sign-in. Recovery codes can each be used once.</p>
          {!mfaEnabled && !mfaSetup && <Button variant="outline" disabled={busy || !mfaLoaded} onClick={beginMfaSetup}>Set up authenticator</Button>}
          {mfaSetup && !mfaEnabled && <div className="space-y-3 rounded-xl border border-white/10 bg-black/[.12] p-4">
            <p className="text-xs text-muted-foreground">Add this secret to your authenticator app. Setup expires after 10 minutes.</p>
            <code className="block select-all break-all rounded-lg bg-black/30 p-3 font-mono text-sm tracking-wider">{mfaSetup.secret}</code>
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Manual setup URI</summary><code className="mt-2 block select-all break-all rounded-lg bg-black/30 p-3 font-mono text-[10px]">{mfaSetup.otpauthUrl}</code></details>
            <label htmlFor="mfa-setup-code" className="block text-xs font-medium">Enter the 6-digit code to confirm</label>
            <Input id="mfa-setup-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="Authenticator code" className="font-mono" />
            <Button disabled={busy || !mfaCode.trim()} onClick={enableMfa}>Confirm and enable MFA</Button>
          </div>}
          {mfaEnabled && <div className="space-y-3">
            <label htmlFor="mfa-disable-code" className="block text-xs font-medium">Authenticator or recovery code to disable</label>
            <Input id="mfa-disable-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} autoComplete="one-time-code" maxLength={100} placeholder="Enter your code" className="font-mono" />
            <Button variant="outline" disabled={busy || !mfaCode.trim()} onClick={disableMfa}>Disable MFA</Button>
          </div>}
          {recoveryCodes && <div className="space-y-3 rounded-xl border border-amber-300/20 bg-amber-300/[.04] p-4" role="status">
            <div><p className="text-sm font-semibold">Save these recovery codes now</p><p className="mt-1 text-xs text-muted-foreground">They will not be shown again. Each code can be used once.</p></div>
            <code className="grid grid-cols-2 gap-2 select-all rounded-lg bg-black/30 p-3 font-mono text-xs">{recoveryCodes.map((code) => <span key={code}>{code}</span>)}</code>
            <Button variant="outline" size="sm" onClick={copyRecoveryCodes} className="gap-2"><Clipboard className="w-4 h-4" />Copy recovery codes</Button>
          </div>}
        </section>

        <section className="rounded-2xl border p-5 space-y-4 bg-white/[.02] border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-amber-300" /><span className="text-sm font-semibold">Blocked sign-in alerts</span></div>
            <span className="rounded-full border border-white/10 bg-white/[.03] px-2 py-1 text-[10px] text-muted-foreground">{securityEvents.length} recent</span>
          </div>
          <p className="text-xs text-muted-foreground">Source IPs that reached the three-failure lockout threshold. Events are retained for 90 days.</p>
          {securityEvents.length ? <ul className="space-y-2">
            {securityEvents.map((event) => <li key={event.id} className="flex flex-col gap-1 rounded-xl border border-white/[.055] bg-black/[.12] p-3 sm:flex-row sm:items-center sm:justify-between">
              <div><code className="text-xs text-foreground/90">{event.sourceIp}</code><p className="mt-1 text-[10px] text-muted-foreground">{event.failedAttempts} failed attempts</p></div>
              <time className="text-[10px] text-muted-foreground/65" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
            </li>)}
          </ul> : <p className="text-xs text-muted-foreground">No recent sign-in lockouts were recorded.</p>}
        </section>

        <section className="rounded-2xl border p-5 space-y-4 bg-white/[.02] border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-300" /><span className="text-sm font-semibold">Security activity timeline</span></div>
            <span className="rounded-full border border-white/10 bg-white/[.03] px-2 py-1 text-[10px] text-muted-foreground">{auditEntries.length} recent</span>
          </div>
          <p className="text-xs text-muted-foreground">Latest 20 recorded actions, newest first. Sensitive event metadata is deliberately omitted.</p>
          {auditEntries.length ? <ol className="relative ml-2 border-l border-amber-200/15 pl-5">
            {auditEntries.map((entry) => {
              const succeeded = entry.status === "success";
              return <li key={entry.id} className="relative pb-4 last:pb-0">
                <span className="absolute -left-[25px] top-1 flex h-3 w-3 items-center justify-center rounded-full border"
                  style={{ background: succeeded ? "rgba(125,200,140,.16)" : "rgba(248,113,113,.14)", borderColor: succeeded ? "rgba(125,200,140,.4)" : "rgba(248,113,113,.42)", boxShadow: `0 0 12px ${succeeded ? "rgba(125,200,140,.11)" : "rgba(248,113,113,.1)"}` }}>
                  <span className="h-1 w-1 rounded-full" style={{ background: succeeded ? "#a9d8b0" : "#f2aaa5" }} />
                </span>
                <div className="flex flex-col gap-2 rounded-xl border border-white/[.055] bg-black/[.12] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-foreground/90">{readableAction(entry.action)}</div>
                    <div className="mt-1 truncate text-[10px] text-muted-foreground">{entry.targetType.replaceAll("_", " ")}{entry.targetId ? ` · ${entry.targetId}` : ""}</div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
                    <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                      style={{ color: succeeded ? "#a9d8b0" : "#f2aaa5", background: succeeded ? "rgba(125,200,140,.08)" : "rgba(248,113,113,.08)" }}>{entry.status}</span>
                    <time className="text-[10px] text-muted-foreground/55" dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
                  </div>
                </div>
              </li>;
            })}
          </ol> : <p className="text-xs text-muted-foreground">No recent audit entries are available.</p>}
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
