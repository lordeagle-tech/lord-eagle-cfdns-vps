import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  CircleCheck, CircleX, FolderOpen, KeyRound, LoaderCircle, LockKeyhole, Pencil,
  PlugZap, Plus, RefreshCw, Server, ShieldCheck, Terminal, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type AuthType = "password" | "privateKey";
type Connection = {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  status: string;
  hostFingerprint?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
};
type HostInfo = { hostname: string; os: string; uptime: string };
type TestResult = { success: boolean; message: string; serverInfo: HostInfo | null; trustRequired?: boolean; fingerprint?: string };
type Draft = {
  name: string;
  host: string;
  port: string;
  username: string;
  authType: AuthType;
  password: string;
  privateKey: string;
  passphrase: string;
  notes: string;
};

const emptyDraft = (): Draft => ({
  name: "", host: "", port: "22", username: "", authType: "privateKey",
  password: "", privateKey: "", passphrase: "", notes: "",
});
const isKeyAuth = (value: string): boolean => value === "privateKey" || value === "key";
const inputClass = "bg-[#111113] border-white/10 focus-visible:ring-[#ff5a1f]/40";

export default function ConnectionsPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [servers, setServers] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [privateKeyFilename, setPrivateKeyFilename] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});

  const authHeaders: Record<string, string> = {};

  const loadServers = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/servers", { headers: authHeaders });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Could not load saved connections.");
      setServers(Array.isArray(body) ? body : []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load saved connections.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadServers(); }, [loadServers]);

  function openNewForm() {
    setEditing(null);
    setDraft(emptyDraft());
    setPrivateKeyFilename("");
    setShowForm(true);
  }

  function openEditForm(server: Connection) {
    setEditing(server);
    setDraft({
      ...emptyDraft(),
      name: server.name,
      host: server.host,
      port: String(server.port),
      username: server.username,
      authType: server.authType === "password" ? "password" : "privateKey",
      notes: server.notes ?? "",
    });
    setPrivateKeyFilename("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setDraft(emptyDraft());
    setPrivateKeyFilename("");
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function handlePrivateKeyUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (import.meta.env.DEV) {
      toast({ title: "Preview mode", description: "Do not load real private keys in the shared preview. Upload keys after production deployment.", variant: "destructive" });
      input.value = "";
      return;
    }
    if (file.size > 64 * 1024) {
      toast({ title: "Key file is too large", description: "Choose a private-key file under 64 KB.", variant: "destructive" });
      input.value = "";
      return;
    }
    try {
      const contents = (await file.text()).replace(/^\uFEFF/, "");
      if (!/-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/.test(contents)) {
        throw new Error("Choose an OpenSSH or PEM private-key file.");
      }
      setField("privateKey", contents);
      setPrivateKeyFilename(file.name);
      toast({ title: "Private key loaded", description: "It stays in this form and is sent only when you save the connection." });
    } catch (error) {
      toast({ title: "Could not read private key", description: error instanceof Error ? error.message : "Choose a valid OpenSSH/PEM key file.", variant: "destructive" });
    } finally {
      input.value = "";
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (import.meta.env.DEV) {
      toast({ title: "Preview mode", description: "Live VPS credentials can only be saved after deploying the panel on your own VPS.", variant: "destructive" });
      return;
    }
    const hasCredential = draft.authType === "password" ? !!draft.password.trim() : !!draft.privateKey.trim();
    const authChanged = !!editing && (editing.authType === "password") !== (draft.authType === "password");
    if ((!editing || authChanged) && !hasCredential) {
      toast({ title: "Authentication is required", description: "Enter the password or private key for this connection.", variant: "destructive" });
      return;
    }

    const payload: Record<string, unknown> = {
      name: draft.name.trim(),
      host: draft.host.trim(),
      port: Number(draft.port),
      username: draft.username.trim(),
      authType: draft.authType,
      notes: draft.notes.trim(),
    };
    // Blank secret fields are omitted while editing, preserving the encrypted value already stored.
    if (draft.password.trim()) payload.password = draft.password;
    if (draft.privateKey.trim()) payload.privateKey = draft.privateKey;
    if (draft.passphrase.trim()) payload.passphrase = draft.passphrase;

    setSaving(true);
    try {
      const response = await fetch(editing ? `/api/servers/${editing.id}` : "/api/servers", {
        method: editing ? "PATCH" : "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "Could not save this connection.");
      toast({ title: editing ? "Connection updated" : "Connection saved", description: "The server credential was stored securely." });
      closeForm();
      await loadServers();
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : "Could not save this connection.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection(server: Connection) {
    if (import.meta.env.DEV) {
      toast({ title: "Preview mode", description: "SSH tests are disabled in this shared sandbox preview. Test connections after production deployment.", variant: "destructive" });
      return;
    }
    setTestingId(server.id);
    try {
      const response = await fetch(`/api/servers/${server.id}/connect`, {
        method: "POST",
        headers: authHeaders,
        credentials: "include",
      });
      let result = await response.json() as TestResult;
      if (!response.ok) throw new Error(result.message || "Connection test failed.");
      if (result.trustRequired && result.fingerprint) {
        setTestResults((current) => ({ ...current, [server.id]: result }));
        setServers((current) => current.map((item) => item.id === server.id ? { ...item, status: "pending_trust" } : item));
        const confirmed = window.confirm(
          `First-contact SSH host fingerprint for ${server.host}:\n\n${result.fingerprint}\n\nCompare this exact SHA-256 fingerprint with your VPS provider console or the matching ssh-keygen fingerprint on that VPS before trusting it. If it does not match, choose Cancel.\n\nTrust this host key?`,
        );
        if (!confirmed) {
          toast({ title: "Host key not trusted", description: "No remote commands were run. Verify the fingerprint, then test again." });
          return;
        }
        const trustResponse = await fetch(`/api/servers/${server.id}/trust-host`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ fingerprint: result.fingerprint }),
        });
        const trustBody = await trustResponse.json().catch(() => ({}));
        if (!trustResponse.ok) throw new Error(trustBody?.error || "Could not trust the host key.");
        setServers((current) => current.map((item) => item.id === server.id ? { ...item, hostFingerprint: trustBody.hostFingerprint, status: "unknown" } : item));
        const retryResponse = await fetch(`/api/servers/${server.id}/connect`, {
          method: "POST", headers: authHeaders, credentials: "include",
        });
        result = await retryResponse.json() as TestResult;
        if (!retryResponse.ok) throw new Error(result.message || "Connection test failed after host-key verification.");
      }
      setTestResults((current) => ({ ...current, [server.id]: result }));
      setServers((current) => current.map((item) => item.id === server.id ? { ...item, status: result.success ? "connected" : "error" } : item));
      toast({
        title: result.success ? "SSH connection verified" : "SSH connection failed",
        description: result.success ? `${result.serverInfo?.hostname || server.host} responded.` : result.message,
        variant: result.success ? "default" : "destructive",
      });
    } catch (error) {
      const result: TestResult = { success: false, message: error instanceof Error ? error.message : "Connection test failed.", serverInfo: null };
      setTestResults((current) => ({ ...current, [server.id]: result }));
      setServers((current) => current.map((item) => item.id === server.id ? { ...item, status: "error" } : item));
      toast({ title: "SSH connection failed", description: result.message, variant: "destructive" });
    } finally {
      setTestingId(null);
    }
  }

  async function removeConnection(server: Connection) {
    if (!window.confirm(`Remove ${server.name} and delete its saved SSH credentials?`)) return;
    setDeletingId(server.id);
    try {
      const response = await fetch(`/api/servers/${server.id}`, { method: "DELETE", headers: authHeaders });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || "Could not remove this connection.");
      }
      setServers((current) => current.filter((item) => item.id !== server.id));
      setTestResults((current) => { const next = { ...current }; delete next[server.id]; return next; });
      toast({ title: "Connection removed", description: "Its saved credential was deleted from the app database." });
    } catch (error) {
      toast({ title: "Remove failed", description: error instanceof Error ? error.message : "Could not remove this connection.", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  async function resetHostKey(server: Connection) {
    const confirmed = window.confirm(`Clear the saved SSH host-key pin for ${server.name}? The next test will show a new fingerprint, and no remote commands will run until you verify it again.`);
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/servers/${server.id}/reset-host-key`, {
        method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify({ confirm: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Could not reset the host-key pin.");
      setServers((current) => current.map((item) => item.id === server.id ? { ...item, hostFingerprint: null, status: "unknown" } : item));
      setTestResults((current) => { const next = { ...current }; delete next[server.id]; return next; });
      toast({ title: "Host-key pin cleared", description: "Test SSH again and compare the new fingerprint before accepting it." });
    } catch (error) {
      toast({ title: "Could not reset pin", description: error instanceof Error ? error.message : "Request failed.", variant: "destructive" });
    }
  }

  const connectedCount = servers.filter((server) => server.status === "connected").length;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto" style={{ background: "#0b0b0c" }}>
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="status-pulse" />
              <span className="ops-kicker">SSH vault / host profiles</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight"><span className="brand-gradient">VPS Connections</span></h1>
            <p className="text-sm text-muted-foreground mt-1">Save and test SSH access for the other servers you manage.</p>
          </div>
          <Button onClick={openNewForm} className="gap-2 self-start sm:self-auto" style={{ background: "linear-gradient(135deg,#ff5a1f,#ffd1c2)", color: "#0b0b0c" }}>
            <Plus className="w-4 h-4" /> Add VPS
          </Button>
        </header>

        {import.meta.env.DEV && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 flex gap-3" role="alert">
            <LockKeyhole className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-200">Shared preview — do not enter real server credentials</p>
              <p className="text-xs text-amber-100/70 mt-1">This page is running in the Manus sandbox with a temporary login key. Saving host credentials and outbound SSH tests are disabled here. Use this preview to inspect the layout; add real VPS credentials only after deployment on your own VPS.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl border p-4" style={{ background: "#111113", borderColor: "rgba(255,90,31,.18)" }}>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Saved hosts</div>
            <div className="mt-2 text-2xl font-black">{loading ? "—" : servers.length}</div>
          </div>
          <div className="rounded-2xl border p-4" style={{ background: "#111113", borderColor: "rgba(255,90,31,.18)" }}>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Connected</div>
            <div className="mt-2 text-2xl font-black text-emerald-400">{loading ? "—" : connectedCount}</div>
          </div>
          <div className="rounded-2xl border p-4 flex items-center gap-3" style={{ background: "rgba(255,90,31,.05)", borderColor: "rgba(255,90,31,.18)" }}>
            <ShieldCheck className="w-5 h-5 text-[#ff5a1f] shrink-0" />
            <p className="text-xs text-muted-foreground">Saved passwords and SSH keys are encrypted server-side and are never returned to this page.</p>
          </div>
        </div>

        {showForm && (
          <section className="rounded-2xl border p-4 sm:p-6 space-y-5" style={{ background: "#111113", borderColor: "rgba(255,90,31,.3)" }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-bold text-lg">{editing ? "Edit host profile" : "Add a VPS connection"}</h2>
                <p className="text-xs text-muted-foreground mt-1">Credentials stay in this form until saved; they are not stored in browser storage.</p>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={closeForm} aria-label="Close form"><X className="w-4 h-4" /></Button>
            </div>

            <form onSubmit={handleSave} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="space-y-1.5 text-xs text-muted-foreground">Connection name
                  <Input required maxLength={191} className={inputClass} placeholder="production-web-01" value={draft.name} onChange={(e) => setField("name", e.target.value)} />
                </label>
                <label className="space-y-1.5 text-xs text-muted-foreground">Hostname or IP
                  <Input required maxLength={255} className={`${inputClass} font-mono`} placeholder="vps.example.com" value={draft.host} onChange={(e) => setField("host", e.target.value)} />
                </label>
                <label className="space-y-1.5 text-xs text-muted-foreground">SSH username
                  <Input required maxLength={191} className={`${inputClass} font-mono`} placeholder="ubuntu" value={draft.username} onChange={(e) => setField("username", e.target.value)} />
                </label>
                <label className="space-y-1.5 text-xs text-muted-foreground">SSH port
                  <Input required type="number" min={1} max={65535} className={`${inputClass} font-mono`} value={draft.port} onChange={(e) => setField("port", e.target.value)} />
                </label>
                <label className="space-y-1.5 text-xs text-muted-foreground sm:col-span-2">Authentication method
                  <select className={`w-full h-10 rounded-md border px-3 text-sm text-foreground ${inputClass}`} value={draft.authType} onChange={(e) => setField("authType", e.target.value as AuthType)}>
                    <option value="privateKey">SSH private key (recommended)</option>
                    <option value="password">SSH password</option>
                  </select>
                </label>
              </div>

              {draft.authType === "privateKey" ? (
                <div className="grid grid-cols-1 gap-4">
                  <label className="block space-y-1.5 text-xs text-muted-foreground">Upload a PEM / OpenSSH key
                    <Input type="file" accept=".pem,.key,.priv" disabled={import.meta.env.DEV} className={`${inputClass} file:mr-3 file:rounded-md file:border-0 file:bg-[#ff5a1f]/15 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-[#ffd1c2]`} onChange={handlePrivateKeyUpload} />
                    <span className="block text-[11px] opacity-70">Maximum 64 KB. The file is read in your browser; it is not uploaded until you save. {privateKeyFilename && <span className="text-[#ffd1c2]">Loaded: {privateKeyFilename}</span>}</span>
                  </label>
                  <label className="space-y-1.5 text-xs text-muted-foreground">SSH private key
                    <Textarea
                      autoComplete="off"
                      spellCheck={false}
                      className={`${inputClass} min-h-36 font-mono text-xs`}
                      placeholder={editing ? "Leave blank to keep the currently saved key" : "Paste the private key for this host here"}
                      value={draft.privateKey}
                      onChange={(e) => setField("privateKey", e.target.value)}
                    />
                  </label>
                  <label className="space-y-1.5 text-xs text-muted-foreground">Key passphrase <span className="opacity-60">(optional)</span>
                    <Input autoComplete="new-password" type="password" className={inputClass} placeholder={editing ? "Leave blank to keep the saved passphrase" : "Only if the key is encrypted"} value={draft.passphrase} onChange={(e) => setField("passphrase", e.target.value)} />
                  </label>
                </div>
              ) : (
                <label className="block space-y-1.5 text-xs text-muted-foreground">SSH password
                  <Input autoComplete="new-password" type="password" className={inputClass} placeholder={editing ? "Leave blank to keep the saved password" : "Password for this host"} value={draft.password} onChange={(e) => setField("password", e.target.value)} />
                </label>
              )}

              <label className="block space-y-1.5 text-xs text-muted-foreground">Notes <span className="opacity-60">(optional)</span>
                <Textarea maxLength={4000} className={`${inputClass} min-h-20`} placeholder="Environment, purpose, or access notes" value={draft.notes} onChange={(e) => setField("notes", e.target.value)} />
              </label>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 flex gap-2.5">
                <LockKeyhole className="w-4 h-4 text-[#ffd1c2] shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">Secrets are encrypted in the server database with <code>APP_ENCRYPTION_KEY</code>. Back up that key with the database. Use a dedicated least-privilege SSH account where possible; never paste credentials into chat.</p>
              </div>
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <Button type="button" variant="outline" onClick={closeForm}>Cancel</Button>
                <Button type="submit" disabled={saving || import.meta.env.DEV} className="gap-2" style={{ background: "linear-gradient(135deg,#ff5a1f,#ffd1c2)", color: "#0b0b0c" }}>
                  {saving ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  {import.meta.env.DEV ? "Use production install to save" : saving ? "Saving…" : editing ? "Save changes" : "Save connection"}
                </Button>
              </div>
            </form>
          </section>
        )}

        {loadError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-sm text-red-300">{loadError}</p>
            <Button size="sm" variant="outline" onClick={() => void loadServers()}><RefreshCw className="w-3.5 h-3.5 mr-2" /> Retry</Button>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Saved VPS hosts</h2>
            <p className="text-xs text-muted-foreground mt-1">Connection profiles are private to your signed-in account.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void loadServers()} disabled={loading} aria-label="Refresh connections">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-white/10 p-8 text-sm text-muted-foreground animate-pulse">Loading saved connections…</div>
        ) : servers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.015] p-8 sm:p-12 text-center">
            <Server className="w-10 h-10 mx-auto mb-3 text-[#ff5a1f]" />
            <h3 className="font-semibold">No VPS connections yet</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-5">Add another Linux server to save its SSH access profile here.</p>
            {!showForm && <Button onClick={openNewForm} className="gap-2"><Plus className="w-4 h-4" /> Add your first VPS</Button>}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {servers.map((server) => {
              const result = testResults[server.id];
              const connected = server.status === "connected";
              return (
                <article key={server.id} className="rounded-2xl border p-4 sm:p-5 space-y-4" style={{ background: "#111113", borderColor: connected ? "rgba(52,211,153,.24)" : "rgba(255,255,255,.08)" }}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: connected ? "rgba(52,211,153,.1)" : "rgba(255,90,31,.1)" }}>
                      <Server className={`w-5 h-5 ${connected ? "text-emerald-400" : "text-[#ff5a1f]"}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold truncate">{server.name}</h3>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider ${connected ? "bg-emerald-500/10 text-emerald-300" : server.status === "error" ? "bg-red-500/10 text-red-300" : "bg-white/5 text-muted-foreground"}`}>
                          {server.status || "unknown"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground font-mono mt-1 break-all">{server.username}@{server.host}:{server.port}</p>
                    </div>
                    {isKeyAuth(server.authType) ? <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" /> : <LockKeyhole className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Auth: {isKeyAuth(server.authType) ? "SSH key" : "Password"}</span>
                    {server.notes && <span className="truncate max-w-full" title={server.notes}>{server.notes}</span>}
                  </div>

                  <p className="text-[11px] text-muted-foreground break-all">
                    {server.hostFingerprint ? <>Host key pinned: <code className="text-emerald-300">{server.hostFingerprint}</code></> : "SSH host key not verified"}
                  </p>

                  {result && (
                      <div className={`rounded-xl border p-3 text-xs ${result.success ? "border-emerald-500/20 bg-emerald-500/5" : result.trustRequired ? "border-amber-400/30 bg-amber-400/5" : "border-red-500/20 bg-red-500/5"}`}>
                      <div className="flex items-center gap-2 font-semibold">
                        {result.success ? <CircleCheck className="w-4 h-4 text-emerald-400" /> : <CircleX className="w-4 h-4 text-red-400" />}
                        {result.success ? "SSH handshake successful" : result.trustRequired ? "Verify host key before trusting" : "SSH connection failed"}
                      </div>
                      {result.success && result.serverInfo ? <p className="mt-2 text-muted-foreground">{result.serverInfo.hostname} · {result.serverInfo.os} · up {result.serverInfo.uptime}</p> : <p className="mt-2 text-amber-100/80 break-words">{result.message}{result.fingerprint && <><br /><code className="select-all">{result.fingerprint}</code></>}</p>}
                    </div>
                  )}

                  <div className="flex flex-wrap justify-end gap-2 border-t border-white/5 pt-3">
                    {!import.meta.env.DEV && server.hostFingerprint && <>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/connections/${server.id}/terminal`)} className="gap-1.5"><Terminal className="w-3.5 h-3.5" /> Terminal</Button>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/connections/${server.id}/files`)} className="gap-1.5"><FolderOpen className="w-3.5 h-3.5" /> Files</Button>
                      <Button size="sm" variant="ghost" onClick={() => void resetHostKey(server)} className="gap-1.5">Reset host pin</Button>
                    </>}
                    <Button size="sm" variant="outline" onClick={() => void testConnection(server)} disabled={testingId === server.id || import.meta.env.DEV} className="gap-1.5">
                      {testingId === server.id ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <PlugZap className="w-3.5 h-3.5" />}
                      {testingId === server.id ? "Testing…" : "Test SSH"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEditForm(server)} className="gap-1.5"><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => void removeConnection(server)} disabled={deletingId === server.id} className="gap-1.5 text-red-300 hover:text-red-200">
                      {deletingId === server.id ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Remove
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
