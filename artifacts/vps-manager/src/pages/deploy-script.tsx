import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, CheckCircle2, CircleX, CloudUpload, ExternalLink, FileCode2, GitBranch, Github, LoaderCircle, LockKeyhole, RefreshCw, Server, ShieldCheck, TerminalSquare } from "lucide-react";

type GithubStatus = { connected: boolean; username: string | null; source: string | null; message?: string };
type Repo = { id: number; name: string; fullName: string; htmlUrl: string; private: boolean; defaultBranch: string };
type Branch = { name: string; protected: boolean };
type ServerConnection = { id: number; name: string; host: string; username: string; port: number; hostFingerprint?: string | null; status?: string };
type ReviewedScript = { path: string; name: string; sha: string; size: number; content: string; sha256: string; ref: string };
type RunResult = { ok: boolean; server: { id: number; name: string; host: string; username: string }; source: { owner: string; repo: string; path: string; ref: string; sha256: string }; exitCode: number; stdout: string; stderr: string; durationLimitMs: number };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "include", cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function sizeLabel(size: number) { return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`; }

export default function DeployScriptPage() {
  const { toast } = useToast();
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [servers, setServers] = useState<ServerConnection[]>([]);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [serverId, setServerId] = useState("");
  const [repoName, setRepoName] = useState("");
  const [branch, setBranch] = useState("");
  const [filePath, setFilePath] = useState("");
  const [reviewed, setReviewed] = useState<ReviewedScript | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmValue, setConfirmValue] = useState("");
  const [runResult, setRunResult] = useState<RunResult | { error: string } | null>(null);
  const [typedAck, setTypedAck] = useState(false);

  const selectedServer = useMemo(() => servers.find((item) => item.id === Number(serverId)) ?? null, [servers, serverId]);
  const selectedRepo = useMemo(() => repos.find((item) => item.name === repoName) ?? null, [repos, repoName]);
  const deployConfirmation = serverId ? `DEPLOY ${serverId}` : "";
  const liveCapable = !import.meta.env.DEV;

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const [gh, hostList] = await Promise.all([
        request<GithubStatus>("/api/github/control/status"),
        request<ServerConnection[]>("/api/servers"),
      ]);
      setGithub(gh);
      setServers(Array.isArray(hostList) ? hostList : []);
      if (gh.connected) {
        const repoList = await request<{ repos: Repo[] }>("/api/github/control/repos?page=1");
        setRepos(repoList.repos ?? []);
      } else setRepos([]);
    } catch (error) {
      toast({ title: "Could not load deployment options", description: error instanceof Error ? error.message : "Check the GitHub connection and saved VPS profiles.", variant: "destructive" });
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void loadInitial(); }, [loadInitial]);

  async function chooseRepo(name: string) {
    setRepoName(name); setBranch(""); setBranches([]); setReviewed(null); setRunResult(null);
    const repo = repos.find((item) => item.name === name);
    if (!repo || !github?.username) return;
    setLoadingBranches(true);
    try {
      const result = await request<{ branches: Branch[] }>(`/api/github/control/repos/${encodeURIComponent(github.username)}/${encodeURIComponent(repo.name)}/branches`);
      setBranches(result.branches ?? []);
      setBranch(result.branches?.find((item) => item.name === repo.defaultBranch)?.name ?? result.branches?.[0]?.name ?? repo.defaultBranch);
    } catch (error) { toast({ title: "Could not load repository branches", description: error instanceof Error ? error.message : "GitHub request failed", variant: "destructive" }); }
    finally { setLoadingBranches(false); }
  }

  async function reviewScript(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedRepo || !github?.username || !branch || !filePath.trim()) return;
    setReviewing(true); setReviewed(null); setRunResult(null); setConfirmValue(""); setTypedAck(false);
    try {
      const params = new URLSearchParams({ path: filePath.trim(), ref: branch });
      const source = await request<{ file: { path: string; name: string; sha: string; size: number; content: string } }>(`/api/github/control/repos/${encodeURIComponent(github.username)}/${encodeURIComponent(selectedRepo.name)}/file?${params}`);
      if (!source.file.path.toLowerCase().endsWith(".sh")) throw new Error("Choose a shell script whose filename ends in .sh");
      const digest = await sha256(source.file.content);
      setReviewed({ ...source.file, sha256: digest, ref: branch });
      toast({ title: "Script ready for review", description: `${sizeLabel(source.file.size)} · SHA-256 ${digest.slice(0, 16)}…` });
    } catch (error) { toast({ title: "Could not review script", description: error instanceof Error ? error.message : "Check the repository path and branch.", variant: "destructive" }); }
    finally { setReviewing(false); }
  }

  async function runScript(event: React.FormEvent) {
    event.preventDefault();
    if (!reviewed || !selectedServer || !selectedRepo || !github?.username || !typedAck || confirmValue !== deployConfirmation) return;
    setRunning(true); setRunResult(null);
    try {
      const result = await request<RunResult>("/api/deployments/run-script", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId: selectedServer.id, repoOwner: github.username, repo: selectedRepo.name, filePath: reviewed.path, ref: reviewed.ref, blobSha: reviewed.sha, sha256: reviewed.sha256, confirmation: confirmValue }),
      });
      setRunResult(result);
      toast({ title: result.ok ? "Script completed" : `Script exited with code ${result.exitCode}`, description: `${selectedServer.name} · ${reviewed.path}`, variant: result.ok ? "default" : "destructive" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deployment failed";
      setRunResult({ error: message });
      toast({ title: "Script deployment failed", description: message, variant: "destructive" });
    } finally { setRunning(false); }
  }

  const hostOptions = servers.filter((item) => item.hostFingerprint);

  return <div className="flex-1 min-h-0 overflow-y-auto bg-[#0e1012]">
    <div className="mx-auto max-w-screen-xl space-y-5 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#e6ad68]"><CloudUpload className="h-3.5 w-3.5" /> Release workflow</div><h1 className="text-2xl font-black tracking-tight sm:text-3xl">Deploy a GitHub script to a VPS</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Review the exact script version, select a pinned SSH connection, and run it on that server from one place.</p></div>
        <Button variant="outline" size="sm" onClick={() => void loadInitial()} disabled={loading} className="gap-2 self-start border-white/10"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />Refresh options</Button>
      </header>

      {import.meta.env.DEV && <div className="flex gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[.05] p-4" role="alert"><LockKeyhole className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-200" /><div><p className="text-sm font-semibold text-amber-100">Shared Preview: live deployment is disabled</p><p className="mt-1 text-xs leading-relaxed text-amber-100/70">Use this page to inspect the workflow only. Do not enter real GitHub or VPS credentials here. Connect accounts and run scripts only after deploying the panel to your own HTTPS VPS.</p></div></div>}

      {!loading && !github?.connected && <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-4 text-sm text-muted-foreground">Connect a GitHub account in <a className="text-[#e6ad68] underline underline-offset-2" href="/github-control">GitHub Control</a> first.</div>}
      {!loading && github?.source === "server-env" && <div className="rounded-xl border border-amber-200/15 bg-amber-200/[.04] p-4 text-xs leading-relaxed text-amber-100">This server uses an environment-managed GitHub token. Script deployments require a per-admin encrypted GitHub connection; connect one in GitHub Control.</div>}
      {!loading && !hostOptions.length && <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-4 text-sm text-muted-foreground">No pinned VPS connections are ready. Add a server under <a className="text-[#e6ad68] underline underline-offset-2" href="/connections">VPS Connections</a>, test its SSH key, and verify the host fingerprint first.</div>}

      <form onSubmit={reviewScript} className="rounded-2xl border border-white/[.08] bg-[#15181b] p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#e6ad68]/10 text-xs font-black text-[#e6ad68]">1</span><div><h2 className="text-sm font-bold">Choose source and target</h2><p className="text-[10px] text-muted-foreground">Only repositories from your connected GitHub account can be selected.</p></div></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1.5 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Server className="h-3.5 w-3.5" />Target VPS</span><select required value={serverId} onChange={(event) => { setServerId(event.target.value); setReviewed(null); setRunResult(null); setConfirmValue(""); }} className="h-10 w-full rounded-md border border-white/10 bg-[#101214] px-3 text-xs text-foreground outline-none focus:border-[#e6ad68]/50"><option value="">Select a pinned VPS…</option>{hostOptions.map((host) => <option key={host.id} value={host.id}>{host.name} · {host.username}@{host.host}</option>)}</select></label>
          <label className="space-y-1.5 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Github className="h-3.5 w-3.5" />Repository</span><select required value={repoName} onChange={(event) => void chooseRepo(event.target.value)} disabled={!repos.length} className="h-10 w-full rounded-md border border-white/10 bg-[#101214] px-3 text-xs text-foreground outline-none focus:border-[#e6ad68]/50"><option value="">Select repository…</option>{repos.map((repo) => <option key={repo.id} value={repo.name}>{repo.fullName}{repo.private ? " · private" : ""}</option>)}</select></label>
          <label className="space-y-1.5 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" />Branch / ref</span><select required value={branch} onChange={(event) => { setBranch(event.target.value); setReviewed(null); setRunResult(null); }} disabled={!branches.length || loadingBranches} className="h-10 w-full rounded-md border border-white/10 bg-[#101214] px-3 text-xs text-foreground outline-none focus:border-[#e6ad68]/50"><option value="">{loadingBranches ? "Loading branches…" : "Select branch…"}</option>{branches.map((item) => <option key={item.name} value={item.name}>{item.name}{item.protected ? " · protected" : ""}</option>)}</select></label>
          <label className="space-y-1.5 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><FileCode2 className="h-3.5 w-3.5" />Script path in repository</span><Input required value={filePath} onChange={(event) => { setFilePath(event.target.value); setReviewed(null); setRunResult(null); }} placeholder="scripts/deploy.sh" className="h-10 font-mono text-xs" /></label>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="max-w-2xl text-[10px] leading-relaxed text-muted-foreground">The script is fetched again from GitHub at execution time and must still match the reviewed GitHub blob and SHA-256. Supported file size: up to 750 KB.</p><Button type="submit" disabled={reviewing || !github?.connected || !branch || !filePath.trim()} className="gap-2 bg-[#e6ad68] text-[#14110e] hover:bg-[#f0c58f]">{reviewing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Review script</Button></div>
      </form>

      {reviewed && selectedServer && selectedRepo && <section className="space-y-4 rounded-2xl border border-[#e6ad68]/20 bg-[#15181b] p-4 sm:p-5">
        <div className="flex items-start gap-3"><span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#e6ad68]/10 text-xs font-black text-[#e6ad68]">2</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-bold">Review exact script before execution</h2><span className="rounded-full border border-emerald-200/15 bg-emerald-200/[.05] px-2 py-0.5 text-[9px] text-emerald-100">GitHub blob verified</span></div><p className="mt-1 break-all text-[10px] text-muted-foreground"><a href={`${selectedRepo.htmlUrl}/blob/${encodeURIComponent(reviewed.ref)}/${reviewed.path.split("/").map(encodeURIComponent).join("/")}`} target="_blank" rel="noopener noreferrer" className="text-[#e6ad68] hover:underline">{selectedRepo.fullName}/{reviewed.path} · {reviewed.ref} <ExternalLink className="inline h-3 w-3" /></a> · {sizeLabel(reviewed.size)}</p><p className="mt-1 break-all font-mono text-[9px] text-muted-foreground/70">GitHub blob {reviewed.sha} · SHA-256 {reviewed.sha256}</p></div></div>
        <pre className="max-h-[420px] overflow-auto rounded-xl border border-white/[.07] bg-[#0d0f10] p-3 font-mono text-[10px] leading-relaxed text-foreground/85"><code>{reviewed.content}</code></pre>
        <div className="grid gap-3 rounded-xl border border-amber-200/15 bg-amber-200/[.035] p-4 md:grid-cols-2">
          <div className="flex gap-2.5"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-200" /><div><h3 className="text-xs font-semibold text-amber-100">This runs executable code on the VPS</h3><p className="mt-1 text-[10px] leading-relaxed text-amber-100/70">Read every line. It runs as <code>{selectedServer.username}</code> on <code>{selectedServer.name} ({selectedServer.host})</code>, with that account’s permissions. The panel will not add <code>sudo</code> or prompt for a password. If the saved SSH account is root, the script runs as root.</p></div></div>
          <div className="flex gap-2.5"><LockKeyhole className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-200" /><div><h3 className="text-xs font-semibold text-amber-100">Execution safeguards</h3><p className="mt-1 text-[10px] leading-relaxed text-amber-100/70">Rechecks the GitHub file before transfer, stages it in a private temporary directory, pins the SSH host key, deletes the staged file afterward, logs the deployment event, and stops after 10 minutes. Script side effects remain the script’s responsibility.</p></div></div>
        </div>

        {!liveCapable ? <p className="rounded-lg border border-amber-200/15 bg-amber-200/[.04] p-3 text-xs text-amber-100">Execution is disabled in shared Preview and development. The workflow is for your self-hosted HTTPS installation.</p> : <form onSubmit={runScript} className="space-y-3 rounded-xl border border-white/[.07] bg-black/[.12] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-red-300/[.08] text-[10px] font-black text-red-200">3</span>Confirm the exact target to run this script</div>
          <label className="block space-y-1.5 text-[10px] text-muted-foreground">Type <code className="text-amber-100">{deployConfirmation}</code> to confirm, then acknowledge that the script can change this server.<Input autoComplete="off" value={confirmValue} onChange={(event) => setConfirmValue(event.target.value)} placeholder={deployConfirmation} className="h-9 max-w-sm font-mono text-xs" /></label>
          <label className="flex items-start gap-2 text-[10px] leading-relaxed text-muted-foreground"><input type="checkbox" checked={typedAck} onChange={(event) => setTypedAck(event.target.checked)} className="mt-0.5 accent-amber-400" />I reviewed the script above and understand it will execute on this VPS with the selected SSH account’s permissions.</label>
          <Button type="submit" disabled={running || !typedAck || confirmValue !== deployConfirmation} className="gap-2 bg-red-700 text-white hover:bg-red-600">{running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <TerminalSquare className="h-4 w-4" />}{running ? "Running on VPS…" : "Deploy and run script"}</Button>
        </form>}
      </section>}

      {runResult && <section className="rounded-2xl border border-white/[.08] bg-[#15181b] p-4 sm:p-5"><div className="flex items-center gap-2">{"error" in runResult ? <CircleX className="h-4 w-4 text-red-300" /> : runResult.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <CircleX className="h-4 w-4 text-red-300" />}<h2 className="text-sm font-bold">{"error" in runResult ? "Deployment failed" : runResult.ok ? "Script completed" : `Script exited with code ${runResult.exitCode}`}</h2></div>{"error" in runResult ? <p className="mt-2 text-xs text-red-200">{runResult.error}</p> : <><p className="mt-1 text-[10px] text-muted-foreground">{runResult.server.username}@{runResult.server.host} · {runResult.source.owner}/{runResult.source.repo}/{runResult.source.path} · SHA-256 {runResult.source.sha256}</p><div className="mt-4 grid gap-3 lg:grid-cols-2">{([['Standard output', runResult.stdout], ['Standard error', runResult.stderr]] as const).map(([title, value]) => <div key={title}><h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3><pre className="max-h-72 min-h-20 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/[.06] bg-[#0d0f10] p-3 font-mono text-[10px] leading-relaxed">{value || "(empty)"}</pre></div>)}</div></>}</section>}

      <div className="flex items-start gap-2 text-[10px] leading-relaxed text-muted-foreground/55"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />Deployment uses only the GitHub token and VPS SSH credential already saved to this authenticated account. No credentials are passed to the script by default.</div>
    </div>
  </div>;
}
