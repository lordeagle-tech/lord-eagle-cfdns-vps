import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Github, GitBranch, LockKeyhole, Plus, RefreshCw, Search, ShieldCheck, ShieldAlert, Trash2, File, Folder, ArrowUp, Save, Loader2, X, ChevronRight, Globe2, Star, GitFork, RotateCcw, KeyRound, FilePlus2, CloudUpload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Footer } from "@/components/footer";
import { useToast } from "@/hooks/use-toast";

type GithubStatus = { configured: boolean; connected: boolean; username: string | null; scopes: string; source: "encrypted-settings" | "server-env" | null; avatarUrl?: string; message?: string };
type Repository = { id: number; name: string; fullName: string; description: string | null; private: boolean; htmlUrl: string; defaultBranch: string; updatedAt?: string; pushedAt?: string | null; stars?: number; forks?: number; language?: string | null; archived?: boolean; homepage?: string | null };
type Branch = { name: string; protected: boolean };
type RepoEntry = { name: string; path: string; type: "file" | "dir"; size?: number; sha: string };
type OpenFile = { path: string; name: string; sha: string | null; size: number };

const TOKEN_HELP_URL = "https://github.com/settings/tokens/new?scopes=repo,delete_repo&description=CFDNS%20Manager";

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "include", cache: "no-store", ...init });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GithubControlPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [connectionToken, setConnectionToken] = useState("");
  const [repos, setRepos] = useState<Repository[]>([]);
  const [repoPage, setRepoPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchTruncated, setBranchTruncated] = useState(false);
  const [contentsPath, setContentsPath] = useState("");
  const [contents, setContents] = useState<RepoEntry[]>([]);
  const [contentsLoading, setContentsLoading] = useState(false);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [draft, setDraft] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [repoCreating, setRepoCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoDescription, setNewRepoDescription] = useState("");
  const [newRepoPrivate, setNewRepoPrivate] = useState(true);
  const [settingsName, setSettingsName] = useState("");
  const [settingsDescription, setSettingsDescription] = useState("");
  const [settingsPrivate, setSettingsPrivate] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [showDeleteRepo, setShowDeleteRepo] = useState(false);
  const [deleteRepoText, setDeleteRepoText] = useState("");
  const [newFilePath, setNewFilePath] = useState("");
  const repositorySelectionRef = useRef(0);
  const branchesRequestRef = useRef(0);
  const contentsRequestRef = useRef(0);
  const fileRequestRef = useRef(0);

  const refreshStatus = useCallback(async () => {
    const next = await apiRequest<GithubStatus>("/api/github/control/status");
    setStatus(next);
    return next;
  }, []);

  const loadRepos = useCallback(async (page = 1, append = false) => {
    setRepoLoading(true);
    try {
      const result = await apiRequest<{ repos: Repository[]; page: number; hasMore: boolean }>(`/api/github/control/repos?page=${page}`);
      setRepos((previous) => append ? [...previous, ...result.repos] : result.repos);
      setRepoPage(result.page);
      setHasMore(result.hasMore);
    } catch (error) {
      toast({ title: "Could not load repositories", description: error instanceof Error ? error.message : "GitHub request failed", variant: "destructive" });
    } finally { setRepoLoading(false); }
  }, [toast]);

  const loadContents = useCallback(async (repo: Repository, branch: string, path: string, selection = repositorySelectionRef.current, preserveOpenFile = false) => {
    const requestId = ++contentsRequestRef.current;
    fileRequestRef.current += 1;
    setContentsLoading(true);
    setContentsPath(path);
    setFileLoading(false);
    if (!preserveOpenFile) setOpenFile(null);
    try {
      const query = new URLSearchParams({ ref: branch });
      if (path) query.set("path", path);
      const result = await apiRequest<{ entries: RepoEntry[] }>(`/api/github/control/repos/${encodeURIComponent(status?.username ?? "")}/${encodeURIComponent(repo.name)}/contents?${query}`);
      if (selection !== repositorySelectionRef.current || requestId !== contentsRequestRef.current) return;
      setContents(Array.isArray(result.entries) ? result.entries : []);
    } catch (error) {
      if (selection !== repositorySelectionRef.current || requestId !== contentsRequestRef.current) return;
      setContents([]);
      toast({ title: "Could not open this folder", description: error instanceof Error ? error.message : "GitHub request failed", variant: "destructive" });
    } finally { if (selection === repositorySelectionRef.current && requestId === contentsRequestRef.current) setContentsLoading(false); }
  }, [status?.username, toast]);

  const loadBranches = useCallback(async (repo: Repository, selection = repositorySelectionRef.current) => {
    const requestId = ++branchesRequestRef.current;
    setBranchLoading(true);
    try {
      const owner = status?.username ?? "";
      const result = await apiRequest<{ branches: Branch[]; truncated?: boolean }>(`/api/github/control/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo.name)}/branches`);
      if (selection !== repositorySelectionRef.current || requestId !== branchesRequestRef.current) return;
      const list = result.branches ?? [];
      setBranches(list);
      setBranchTruncated(Boolean(result.truncated));
      const branch = list.find((item) => item.name === repo.defaultBranch)?.name ?? list[0]?.name ?? repo.defaultBranch;
      setSelectedBranch(branch);
      if (branch) await loadContents(repo, branch, "", selection);
    } catch (error) {
      if (selection !== repositorySelectionRef.current || requestId !== branchesRequestRef.current) return;
      setBranches([]);
      toast({ title: "Could not load branches", description: error instanceof Error ? error.message : "GitHub request failed", variant: "destructive" });
    } finally { if (selection === repositorySelectionRef.current && requestId === branchesRequestRef.current) setBranchLoading(false); }
  }, [status?.username, loadContents, toast]);

  const refreshPage = useCallback(async () => {
    setPageLoading(true);
    try {
      const next = await refreshStatus();
      if (next.connected) await loadRepos(1, false);
      else { setRepos([]); setSelectedRepo(null); }
    } catch (error) {
      toast({ title: "GitHub Control unavailable", description: error instanceof Error ? error.message : "Could not contact the API", variant: "destructive" });
    } finally { setPageLoading(false); }
  }, [refreshStatus, loadRepos, toast]);

  useEffect(() => { void refreshPage(); }, [refreshPage]);

  const visibleRepos = useMemo(() => {
    const query = repoQuery.trim().toLowerCase();
    return query ? repos.filter((repo) => `${repo.name} ${repo.description ?? ""}`.toLowerCase().includes(query)) : repos;
  }, [repos, repoQuery]);

  async function connectGithub(event: React.FormEvent) {
    event.preventDefault();
    if (!connectionToken.trim()) return;
    setBusy(true);
    try {
      const result = await apiRequest<{ connected: boolean; username: string; scopes: string }>("/api/github/control/connect", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: connectionToken.trim() }),
      });
      setConnectionToken("");
      toast({ title: `Connected as ${result.username}`, description: "The credential is encrypted on this server and will not be sent back to the browser." });
      await refreshPage();
    } catch (error) {
      toast({ title: "GitHub connection failed", description: error instanceof Error ? error.message : "Could not validate this token", variant: "destructive" });
    } finally { setBusy(false); }
  }

  async function disconnectGithub() {
    if (!window.confirm("Remove the encrypted GitHub credential saved for this administrator? This will not revoke the token on GitHub.")) return;
    setBusy(true);
    try {
      await apiRequest<void>("/api/github/control/connect", { method: "DELETE" });
      setSelectedRepo(null);
      setRepos([]);
      await refreshStatus();
      toast({ title: "Saved GitHub connection removed", description: "Revoke the token separately in GitHub if you no longer need it." });
    } catch (error) { toast({ title: "Could not remove connection", description: error instanceof Error ? error.message : "Request failed", variant: "destructive" }); }
    finally { setBusy(false); }
  }

  async function createRepository(event: React.FormEvent) {
    event.preventDefault();
    setRepoCreating(true);
    try {
      const result = await apiRequest<{ repo: Repository }>("/api/github/control/repos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newRepoName.trim(), description: newRepoDescription, private: newRepoPrivate }),
      });
      setRepos((previous) => [result.repo, ...previous]);
      setNewRepoName(""); setNewRepoDescription(""); setNewRepoPrivate(true); setShowCreate(false);
      toast({ title: "Repository created", description: `${result.repo.fullName} is ready with an initial README.` });
      void selectRepository(result.repo);
    } catch (error) { toast({ title: "Repository was not created", description: error instanceof Error ? error.message : "GitHub request failed", variant: "destructive" }); }
    finally { setRepoCreating(false); }
  }

  async function selectRepository(repo: Repository) {
    const selection = ++repositorySelectionRef.current;
    contentsRequestRef.current += 1;
    fileRequestRef.current += 1;
    setSelectedRepo(repo);
    setContents([]); setBranches([]); setOpenFile(null); setContentsPath(""); setSelectedBranch("");
    setBranchTruncated(false);
    setSettingsName(repo.name); setSettingsDescription(repo.description ?? ""); setSettingsPrivate(repo.private);
    await loadBranches(repo, selection);
  }

  async function changeBranch(branch: string) {
    setSelectedBranch(branch);
    if (selectedRepo) await loadContents(selectedRepo, branch, "");
  }

  async function openEntry(entry: RepoEntry) {
    if (!selectedRepo || !selectedBranch) return;
    if (entry.type === "dir") { await loadContents(selectedRepo, selectedBranch, entry.path); return; }
    const selection = repositorySelectionRef.current;
    const requestId = ++fileRequestRef.current;
    setFileLoading(true);
    try {
      const query = new URLSearchParams({ path: entry.path, ref: selectedBranch });
      const result = await apiRequest<{ file: OpenFile & { content: string } }>(`/api/github/control/repos/${encodeURIComponent(status?.username ?? "")}/${encodeURIComponent(selectedRepo.name)}/file?${query}`);
      if (selection !== repositorySelectionRef.current || requestId !== fileRequestRef.current) return;
      setOpenFile({ path: result.file.path, name: result.file.name, sha: result.file.sha, size: result.file.size });
      setDraft(result.file.content);
      setCommitMessage(`Update ${result.file.path}`);
      setNewFilePath("");
    } catch (error) { if (selection === repositorySelectionRef.current && requestId === fileRequestRef.current) toast({ title: "Could not load file", description: error instanceof Error ? error.message : "GitHub request failed", variant: "destructive" }); }
    finally { if (selection === repositorySelectionRef.current && requestId === fileRequestRef.current) setFileLoading(false); }
  }

  function startNewFile() {
    const path = newFilePath.trim().replace(/^\/+/, "");
    if (!path || !selectedRepo || !selectedBranch) return;
    setOpenFile({ path, name: path.split("/").pop() ?? path, sha: null, size: 0 });
    setDraft(""); setCommitMessage(`Add ${path}`); setNewFilePath("");
  }

  async function saveFile(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedRepo || !openFile || !selectedBranch) return;
    setFileSaving(true);
    try {
      const result = await apiRequest<{ commit: { sha: string; htmlUrl: string }; file: { path: string; sha: string } }>(`/api/github/control/repos/${encodeURIComponent(status?.username ?? "")}/${encodeURIComponent(selectedRepo.name)}/file`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: openFile.path, content: draft, message: commitMessage, branch: selectedBranch, ...(openFile.sha ? { sha: openFile.sha } : {}) }),
      });
      setOpenFile((previous) => previous ? { ...previous, sha: result.file.sha, size: new TextEncoder().encode(draft).length } : previous);
      setCommitMessage(`Update ${openFile.path}`);
      toast({ title: "Commit pushed to GitHub", description: result.commit.htmlUrl ? `Commit ${result.commit.sha.slice(0, 7)} created.` : "The file was committed to the selected branch." });
      await loadContents(selectedRepo, selectedBranch, contentsPath, repositorySelectionRef.current, true);
    } catch (error) { toast({ title: "Could not push file update", description: error instanceof Error ? error.message : "GitHub request failed", variant: "destructive" }); }
    finally { setFileSaving(false); }
  }

  async function deleteFile() {
    if (!selectedRepo || !openFile?.sha || !selectedBranch) return;
    const message = window.prompt(`Delete ${openFile.path} from ${selectedRepo.fullName} (${selectedBranch})? Enter a commit message:`);
    if (!message?.trim()) return;
    if (!window.confirm(`Confirm deletion of ${openFile.path} from branch ${selectedBranch}.`)) return;
    setFileSaving(true);
    try {
      await apiRequest(`/api/github/control/repos/${encodeURIComponent(status?.username ?? "")}/${encodeURIComponent(selectedRepo.name)}/file`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: openFile.path, sha: openFile.sha, branch: selectedBranch, message }),
      });
      setOpenFile(null); setDraft("");
      await loadContents(selectedRepo, selectedBranch, contentsPath);
      toast({ title: "File deletion committed", description: `${openFile.path} was removed from the selected branch.` });
    } catch (error) { toast({ title: "Could not delete file", description: error instanceof Error ? error.message : "GitHub request failed", variant: "destructive" }); }
    finally { setFileSaving(false); }
  }

  async function saveRepositorySettings(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedRepo) return;
    if (settingsPrivate !== selectedRepo.private && !window.confirm(`Change ${selectedRepo.fullName} to ${settingsPrivate ? "private" : "public"}? ${settingsPrivate ? "Access for others may be removed." : "Anyone may be able to see the repository contents."}`)) return;
    setSettingsSaving(true);
    try {
      const owner = status?.username ?? "";
      const result = await apiRequest<{ repo: Repository }>(`/api/github/control/repos/${encodeURIComponent(owner)}/${encodeURIComponent(selectedRepo.name)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: settingsName.trim(), description: settingsDescription, private: settingsPrivate }),
      });
      const updated = { ...selectedRepo, ...result.repo } as Repository;
      setSelectedRepo(updated);
      setRepos((previous) => previous.map((repo) => repo.id === updated.id ? updated : repo));
      setSettingsName(updated.name); setSettingsDescription(updated.description ?? ""); setSettingsPrivate(updated.private);
      toast({ title: "Repository settings saved", description: updated.fullName });
    } catch (error) { toast({ title: "Could not update repository", description: error instanceof Error ? error.message : "GitHub request failed", variant: "destructive" }); }
    finally { setSettingsSaving(false); }
  }

  async function deleteRepository(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedRepo || deleteRepoText !== selectedRepo.name) return;
    setBusy(true);
    try {
      await apiRequest<void>(`/api/github/control/repos/${encodeURIComponent(status?.username ?? "")}/${encodeURIComponent(selectedRepo.name)}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmName: deleteRepoText }),
      });
      toast({ title: "Repository deleted", description: `${selectedRepo.fullName} was deleted on GitHub.` });
      setRepos((previous) => previous.filter((repo) => repo.id !== selectedRepo.id));
      setSelectedRepo(null); setShowDeleteRepo(false); setDeleteRepoText("");
    } catch (error) { toast({ title: "Repository was not deleted", description: error instanceof Error ? error.message : "GitHub request failed", variant: "destructive" }); }
    finally { setBusy(false); }
  }

  const grantedScopes = (status?.scopes ?? "").split(",").map((scope) => scope.trim()).filter(Boolean);
  const scopeWarning = status?.source === "encrypted-settings" && grantedScopes.length > 0 && (!grantedScopes.includes("repo") || !grantedScopes.includes("delete_repo"));

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto" style={{ background: "#0e1012" }}>
      <div className="mx-auto w-full max-w-screen-2xl flex-1 px-4 py-6 sm:px-6 space-y-5">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.22em] text-[#e6ad68]"><Github className="h-3.5 w-3.5" /> GitHub Control</div>
            <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">Repositories, branches, and commits</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Create repositories, edit settings, browse source, and commit changes without reopening GitHub each time.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status?.connected && <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/15 bg-emerald-300/[.06] px-3 py-1.5 text-xs text-emerald-200"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />{status.username}</span>}
            <Button variant="outline" size="sm" onClick={() => void refreshPage()} disabled={pageLoading || repoLoading} className="gap-2 border-white/10"><RefreshCw className={`h-3.5 w-3.5 ${pageLoading ? "animate-spin" : ""}`} />Refresh</Button>
          </div>
        </header>

        {pageLoading ? <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
          : !status?.connected ? <section className="mx-auto max-w-3xl rounded-2xl border border-[#e6ad68]/20 bg-[#15181b] p-5 sm:p-7">
            <div className="flex items-start gap-3"><div className="rounded-xl border border-[#e6ad68]/20 bg-[#e6ad68]/[.08] p-2.5"><KeyRound className="h-5 w-5 text-[#f0c58f]" /></div><div><h2 className="text-lg font-bold">Connect your GitHub account once</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Use a classic personal access token with <code className="text-[#f0c58f]">repo</code> and <code className="text-[#f0c58f]">delete_repo</code> scopes to create repositories, manage private repositories, push file commits, and delete repositories. The token is encrypted with this server’s application key; the browser never receives it back.</p></div></div>
            {status?.message && <p className="mt-4 rounded-xl border border-amber-200/15 bg-amber-200/[.04] p-3 text-xs text-amber-100">{status.message}</p>}
            <p className="mt-4 rounded-xl border border-amber-200/15 bg-amber-200/[.04] p-3 text-xs leading-relaxed text-amber-100"><strong>Security note:</strong> do not enter a real token in a shared/test Preview. Connect it after deploying this app to your own HTTPS VPS domain.</p>
            <form onSubmit={connectGithub} className="mt-5 space-y-3">
              <label htmlFor="github-control-token" className="text-xs font-semibold text-foreground/80">GitHub token <span className="text-muted-foreground">(sent once over this panel connection)</span></label>
              <Input id="github-control-token" type="password" autoComplete="new-password" spellCheck={false} value={connectionToken} onChange={(event) => setConnectionToken(event.target.value)} placeholder="github_pat_… or ghp_…" className="font-mono" />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy || !connectionToken.trim()} className="gap-2 bg-[#e6ad68] text-[#14110e] hover:bg-[#f0c58f]">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}Connect and encrypt</Button>
                <a href={TOKEN_HELP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-[#e6ad68] hover:text-[#f0c58f]">Create token on GitHub <ExternalLink className="h-3 w-3" /></a>
              </div>
            </form>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/[.06] bg-black/[.12] p-3"><h3 className="text-xs font-semibold">What this token can do</h3><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">It grants broad repository control for your GitHub account. Choose an expiration date, do not share the token, and revoke it on GitHub if it is lost or no longer needed.</p></div>
              <div className="rounded-xl border border-white/[.06] bg-black/[.12] p-3"><h3 className="text-xs font-semibold">What this panel stores</h3><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">An authenticated-encrypted copy in this app’s database, tied to this administrator account. Only the connected account’s owned repositories are exposed to mutation routes.</p></div>
            </div>
          </section>
          : <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[.06] bg-white/[.02] px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-emerald-300" />Connected as <strong className="text-foreground">@{status.username}</strong><span className="hidden sm:inline">· credential: {status.source === "server-env" ? "server-managed" : "encrypted in app database"}</span></div>
              <div className="flex gap-2">{status.source === "encrypted-settings" && <Button variant="outline" size="sm" onClick={() => void disconnectGithub()} disabled={busy} className="h-8 gap-1.5 border-white/10 text-xs"><X className="h-3.5 w-3.5" />Disconnect</Button>}
                <a href="/deploy-script" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-3 text-xs font-medium text-foreground/80 hover:bg-white/[.04]"><CloudUpload className="h-3.5 w-3.5" />Deploy script</a>
                <Button size="sm" onClick={() => setShowCreate((value) => !value)} className="h-8 gap-1.5 bg-[#e6ad68] text-[#14110e] hover:bg-[#f0c58f]"><Plus className="h-3.5 w-3.5" />New repository</Button></div>
            </div>
            {scopeWarning && <div className="flex items-start gap-2 rounded-xl border border-amber-200/15 bg-amber-200/[.04] px-4 py-3 text-xs text-amber-100"><ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0" /><span>GitHub did not report both expected classic-token scopes (<code>repo</code>, <code>delete_repo</code>). Some create, write, or delete operations may be rejected. Reconnect with the required least-privilege scopes if needed.</span></div>}
            {branchTruncated && <div className="rounded-xl border border-amber-200/15 bg-amber-200/[.04] px-4 py-3 text-xs text-amber-100">This repository has more than 2,000 branches. The branch selector shows the first 2,000; manage additional branches in GitHub.</div>}
            {showCreate && <form onSubmit={createRepository} className="grid gap-3 rounded-2xl border border-[#e6ad68]/20 bg-[#15181b] p-4 md:grid-cols-[1fr_1.2fr_auto] md:items-end">
              <div><label htmlFor="new-repo-name" className="mb-1.5 block text-xs font-medium">Repository name</label><Input id="new-repo-name" value={newRepoName} onChange={(event) => setNewRepoName(event.target.value)} required maxLength={100} placeholder="my-new-project" /></div>
              <div><label htmlFor="new-repo-description" className="mb-1.5 block text-xs font-medium">Description</label><Input id="new-repo-description" value={newRepoDescription} onChange={(event) => setNewRepoDescription(event.target.value)} maxLength={350} placeholder="What this repository is for" /></div>
              <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={newRepoPrivate} onChange={(event) => setNewRepoPrivate(event.target.checked)} className="accent-amber-400" />Private by default</label><Button type="submit" disabled={repoCreating || !newRepoName.trim()} className="gap-2 bg-[#e6ad68] text-[#14110e] hover:bg-[#f0c58f]">{repoCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create</Button></div>
              <p className="text-[10px] text-muted-foreground md:col-span-3">Creates the repository on your GitHub account and initializes its default branch with a README.</p>
            </form>}

            <div className="grid min-h-[620px] gap-4 xl:grid-cols-[minmax(280px,350px)_minmax(0,1fr)]">
              <section className="flex min-h-[440px] flex-col overflow-hidden rounded-2xl border border-white/[.07] bg-[#15181b]">
                <div className="border-b border-white/[.06] p-4">
                  <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-bold">Your repositories</h2><span className="text-[10px] text-muted-foreground">{repos.length}{hasMore ? "+" : ""}</span></div>
                  <div className="relative"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={repoQuery} onChange={(event) => setRepoQuery(event.target.value)} placeholder="Filter repositories" className="h-9 pl-9 text-xs" /></div>
                </div>
                <div className="flex-1 divide-y divide-white/[.04] overflow-y-auto">
                  {repoLoading && !repos.length ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-16 rounded-lg" />)}</div>
                    : visibleRepos.length ? visibleRepos.map((repo) => <button key={repo.id} onClick={() => void selectRepository(repo)} className={`w-full px-4 py-3 text-left transition-colors hover:bg-white/[.035] ${selectedRepo?.id === repo.id ? "bg-[#e6ad68]/[.07]" : ""}`}>
                      <div className="flex items-start justify-between gap-2"><span className="truncate text-xs font-semibold text-foreground">{repo.name}</span>{repo.private ? <LockKeyhole className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-200/70" /> : <Globe2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />}</div>
                      <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{repo.description || "No description"}</p>
                      <div className="mt-2 flex items-center gap-3 text-[9px] text-muted-foreground/60"><span className="inline-flex items-center gap-1"><Star className="h-2.5 w-2.5" />{repo.stars ?? 0}</span><span className="inline-flex items-center gap-1"><GitFork className="h-2.5 w-2.5" />{repo.forks ?? 0}</span><span>{repo.language || "—"}</span></div>
                    </button>) : <div className="p-6 text-center text-xs text-muted-foreground">{repoQuery ? "No repositories match this filter." : "No repositories found."}</div>}
                </div>
                <div className="flex items-center justify-between border-t border-white/[.06] p-3">
                  <Button variant="ghost" size="sm" onClick={() => void loadRepos(1, false)} disabled={repoLoading} className="h-8 gap-1.5 text-[10px]"><RotateCcw className={`h-3 w-3 ${repoLoading ? "animate-spin" : ""}`} />Reload</Button>
                  {hasMore && <Button variant="outline" size="sm" onClick={() => void loadRepos(repoPage + 1, true)} disabled={repoLoading} className="h-8 text-[10px]">Load more</Button>}
                </div>
              </section>

              <section className="min-w-0 overflow-hidden rounded-2xl border border-white/[.07] bg-[#15181b]">
                {!selectedRepo ? <div className="flex h-full min-h-[440px] flex-col items-center justify-center px-6 text-center"><div className="mb-3 rounded-2xl border border-[#e6ad68]/15 bg-[#e6ad68]/[.05] p-4"><Github className="h-7 w-7 text-[#e6ad68]" /></div><h2 className="text-sm font-semibold">Select a repository</h2><p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">Choose one of your repositories to browse its branches and files, update settings, and commit changes.</p></div>
                  : <>
                    <div className="flex flex-col gap-3 border-b border-white/[.06] p-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-base font-bold">{selectedRepo.fullName}</h2><span className="rounded-full border border-white/10 px-2 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{selectedRepo.private ? "Private" : "Public"}</span>{selectedRepo.archived && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] text-muted-foreground">Archived</span>}</div><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{selectedRepo.description || "No description"}</p><div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground/70"><a href={selectedRepo.htmlUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#e6ad68] hover:text-[#f0c58f]">Open GitHub <ExternalLink className="h-3 w-3" /></a><span>Updated {formatDate(selectedRepo.updatedAt)}</span><span>{selectedRepo.defaultBranch || "default branch unknown"}</span></div></div>
                      <div className="flex flex-wrap items-center gap-2"><label className="sr-only" htmlFor="github-branch">Branch</label><div className="relative"><GitBranch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><select id="github-branch" value={selectedBranch} onChange={(event) => void changeBranch(event.target.value)} disabled={branchLoading || !branches.length} className="h-9 max-w-48 rounded-lg border border-white/10 bg-[#0e1012] pl-8 pr-3 text-xs text-foreground outline-none focus:border-[#e6ad68]/50">{branches.length ? branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.protected ? " · protected" : ""}</option>) : <option value="">Loading branches…</option>}</select></div></div>
                    </div>

                    <div className="grid min-w-0 lg:grid-cols-[minmax(230px,.72fr)_minmax(0,1.28fr)]">
                      <div className="min-w-0 border-b border-white/[.06] lg:border-b-0 lg:border-r">
                        <div className="flex min-h-12 items-center justify-between gap-2 border-b border-white/[.05] px-3 py-2"><div className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground"><button onClick={() => void loadContents(selectedRepo, selectedBranch, "")} className="hover:text-[#e6ad68]">root</button>{contentsPath.split("/").filter(Boolean).map((part, index, all) => <span key={`${part}-${index}`} className="flex min-w-0 items-center gap-1"><ChevronRight className="h-2.5 w-2.5 flex-shrink-0" /><button onClick={() => void loadContents(selectedRepo, selectedBranch, all.slice(0, index + 1).join("/"))} className="max-w-24 truncate hover:text-[#e6ad68]">{part}</button></span>)}</div><button onClick={() => void loadContents(selectedRepo, selectedBranch, contentsPath)} title="Refresh files" className="rounded p-1 text-muted-foreground hover:text-foreground"><RefreshCw className={`h-3 w-3 ${contentsLoading ? "animate-spin" : ""}`} /></button></div>
                        <div className="max-h-[440px] min-h-[210px] overflow-auto">
                          {contentsLoading ? <div className="space-y-2 p-3">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-8 rounded" />)}</div>
                            : <div className="divide-y divide-white/[.035]">{contentsPath && <button onClick={() => void loadContents(selectedRepo, selectedBranch, contentsPath.split("/").slice(0, -1).join("/"))} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[11px] text-muted-foreground hover:bg-white/[.03]"><ArrowUp className="h-3.5 w-3.5" />Parent folder</button>}{contents.map((entry) => <button key={entry.path} onClick={() => void openEntry(entry)} className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-[11px] transition-colors hover:bg-white/[.03] ${openFile?.path === entry.path ? "bg-[#e6ad68]/[.06] text-[#f0c58f]" : "text-foreground/80"}`}>{entry.type === "dir" ? <Folder className="h-3.5 w-3.5 flex-shrink-0 text-[#e6ad68]" /> : <File className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />}<span className="min-w-0 flex-1 truncate">{entry.name}</span>{entry.type === "file" && <span className="text-[9px] text-muted-foreground/50">{formatSize(entry.size)}</span>}</button>)}{!contents.length && <p className="p-4 text-[10px] text-muted-foreground">This folder is empty.</p>}</div>}
                        </div>
                        <div className="flex items-center gap-2 border-t border-white/[.05] p-2"><Input value={newFilePath} onChange={(event) => setNewFilePath(event.target.value)} placeholder="Add a file path…" className="h-8 text-[10px]" /><Button size="sm" variant="outline" disabled={!newFilePath.trim() || !selectedBranch} onClick={startNewFile} className="h-8 flex-shrink-0 gap-1 text-[10px]"><FilePlus2 className="h-3 w-3" />New file</Button></div>
                      </div>

                      <div className="min-w-0">
                        {fileLoading ? <div className="space-y-3 p-4"><Skeleton className="h-5 w-48" /><Skeleton className="h-80 rounded-xl" /></div>
                          : openFile ? <form onSubmit={saveFile} className="space-y-3 p-3 sm:p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-xs font-semibold">{openFile.path}</h3><p className="mt-0.5 text-[9px] text-muted-foreground">{openFile.sha ? `${formatSize(openFile.size)} · ${openFile.sha.slice(0, 8)}` : "New file · will be created in the selected branch"}</p></div><div className="flex items-center gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => { setOpenFile(null); setDraft(""); }} className="h-8 text-[10px]">Close</Button>{openFile.sha && <Button type="button" variant="ghost" size="sm" onClick={() => void deleteFile()} disabled={fileSaving} className="h-8 gap-1 text-[10px] text-red-300 hover:text-red-200"><Trash2 className="h-3 w-3" />Delete file</Button>}</div></div>
                            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} aria-label="File contents" className="min-h-[320px] w-full resize-y rounded-xl border border-white/10 bg-[#0d0f10] p-3 font-mono text-[11px] leading-relaxed text-foreground/90 outline-none focus:border-[#e6ad68]/40" />
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"><Input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} maxLength={500} required placeholder="Commit message" className="h-9 text-xs" /><Button type="submit" disabled={fileSaving || !commitMessage.trim() || new TextEncoder().encode(draft).length > 750_000} className="h-9 gap-2 bg-[#e6ad68] text-[#14110e] hover:bg-[#f0c58f]">{fileSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Commit to {selectedBranch}</Button></div>
                            {new TextEncoder().encode(draft).length > 750_000 && <p className="text-[10px] text-red-300">Files must be 750 KB or smaller for browser editing.</p>}
                            <p className="text-[9px] text-muted-foreground/60">This creates a real commit on the selected GitHub branch. Verify the branch and diff before pushing.</p>
                          </form> : <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center"><File className="mb-3 h-7 w-7 text-muted-foreground/30" /><h3 className="text-xs font-semibold">Choose a file to inspect</h3><p className="mt-1 max-w-xs text-[10px] leading-relaxed text-muted-foreground">Text files up to 750 KB can be edited here and committed directly to the selected branch.</p></div>}
                      </div>
                    </div>

                    <div className="grid gap-4 border-t border-white/[.06] p-4 lg:grid-cols-[1fr_auto]">
                      <form onSubmit={saveRepositorySettings} className="space-y-2">
                        <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><Github className="h-3 w-3" />Repository settings</div>
                        <div className="grid gap-2 sm:grid-cols-[.8fr_1.2fr_auto] sm:items-end"><div><label htmlFor="repo-setting-name" className="mb-1 block text-[9px] text-muted-foreground">Name</label><Input id="repo-setting-name" value={settingsName} onChange={(event) => setSettingsName(event.target.value)} maxLength={100} className="h-8 text-[10px]" /></div><div><label htmlFor="repo-setting-description" className="mb-1 block text-[9px] text-muted-foreground">Description</label><Input id="repo-setting-description" value={settingsDescription} onChange={(event) => setSettingsDescription(event.target.value)} maxLength={350} className="h-8 text-[10px]" /></div><div className="flex items-center gap-2"><label className="flex items-center gap-1.5 whitespace-nowrap text-[10px]"><input type="checkbox" checked={settingsPrivate} onChange={(event) => setSettingsPrivate(event.target.checked)} className="accent-amber-400" />Private</label><Button type="submit" size="sm" disabled={settingsSaving} className="h-8 gap-1 text-[10px]">{settingsSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}Save</Button></div></div>
                      </form>
                      <div className="flex items-end justify-start lg:justify-end">{showDeleteRepo ? <form onSubmit={deleteRepository} className="w-full max-w-sm space-y-2 rounded-xl border border-red-300/20 bg-red-300/[.035] p-3">
                        <div className="flex items-center gap-2 text-[10px] font-semibold text-red-200"><Trash2 className="h-3.5 w-3.5" />Permanent repository deletion</div><p className="text-[9px] leading-relaxed text-muted-foreground">Type <code className="text-red-100">{selectedRepo.name}</code> exactly. This cannot be undone from this panel.</p><Input value={deleteRepoText} onChange={(event) => setDeleteRepoText(event.target.value)} autoComplete="off" className="h-8 border-red-200/15 font-mono text-[10px]" /><div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => { setShowDeleteRepo(false); setDeleteRepoText(""); }} className="h-7 text-[10px]">Cancel</Button><Button type="submit" size="sm" disabled={busy || deleteRepoText !== selectedRepo.name} className="h-7 gap-1 bg-red-600 text-[10px] text-white hover:bg-red-500"><Trash2 className="h-3 w-3" />Delete repository</Button></div>
                      </form> : <Button variant="outline" size="sm" onClick={() => setShowDeleteRepo(true)} className="h-8 gap-1.5 border-red-300/15 text-[10px] text-red-200/80 hover:bg-red-300/[.05] hover:text-red-100"><Trash2 className="h-3.5 w-3.5" />Delete repository</Button>}</div>
                    </div>
                  </>}
              </section>
            </div>
          </>}
        <div className="flex items-start gap-2 text-[10px] leading-relaxed text-muted-foreground/55"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />Repository actions use GitHub’s API and are audited. File edits create commits on the selected branch immediately; repository deletion requires typing its exact name. Review visibility and branch before applying changes.</div>
      </div>
      <Footer />
    </div>
  );
}
