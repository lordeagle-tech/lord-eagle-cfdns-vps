import { useCallback, useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { ArrowLeft, ArrowUp, FileText, Folder, FolderPlus, LoaderCircle, Pencil, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Server = { id: number; name: string; host: string; username: string; hostFingerprint?: string | null };
type RemoteEntry = { name: string; path: string; type: "directory" | "file" | "symlink" | "other"; size: number; permissions: string; modifiedAt: string };
type Listing = { path: string; parentPath: string | null; entries: RemoteEntry[] };
type FileResult = { path: string; content: string; isBinary: boolean; size: number };

async function request(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, credentials: "include", headers: { ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body;
}
function childPath(parent: string, name: string): string { return parent === "/" ? `/${name}` : `${parent.replace(/\/$/, "")}/${name}`; }
function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RemoteFilesPage() {
  const [, params] = useRoute("/connections/:id/files");
  const serverId = params?.id ?? "";
  const [, navigate] = useLocation();
  const [server, setServer] = useState<Server | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [currentPath, setCurrentPath] = useState("/");
  const [pathInput, setPathInput] = useState("/");
  const [selected, setSelected] = useState<FileResult | null>(null);
  const [content, setContent] = useState("");
  const [binary, setBinary] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDirectory = useCallback(async (target: string) => {
    setLoading(true); setError("");
    try {
      const data = await request(`/api/servers/${encodeURIComponent(serverId)}/files/list?path=${encodeURIComponent(target)}`) as Listing;
      setListing(data); setCurrentPath(data.path); setPathInput(data.path); setSelected(null); setContent(""); setBinary(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not list remote directory"); }
    finally { setLoading(false); }
  }, [serverId]);

  useEffect(() => {
    if (!serverId) return;
    request(`/api/servers/${encodeURIComponent(serverId)}`)
      .then((data) => setServer(data as Server))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load server profile"));
    void loadDirectory("/");
  }, [serverId, loadDirectory]);

  async function openEntry(entry: RemoteEntry) {
    if (entry.type === "directory" || entry.type === "symlink") { await loadDirectory(entry.path); return; }
    setBusy(true); setError("");
    try {
      const file = await request(`/api/servers/${encodeURIComponent(serverId)}/files/read?path=${encodeURIComponent(entry.path)}`) as FileResult;
      setSelected(file); setContent(file.content); setBinary(file.isBinary);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not read remote file"); }
    finally { setBusy(false); }
  }

  async function createDirectory() {
    const name = window.prompt("New directory name");
    if (!name?.trim() || name.includes("/") || name === "." || name === "..") return;
    setBusy(true); setError("");
    try {
      await request(`/api/servers/${encodeURIComponent(serverId)}/files/mkdir`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: childPath(currentPath, name.trim()) }) });
      setNotice("Directory created."); await loadDirectory(currentPath);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create directory"); }
    finally { setBusy(false); }
  }

  async function createFile() {
    const name = window.prompt("New text file name");
    if (!name?.trim() || name.includes("/") || name === "." || name === "..") return;
    const remote = childPath(currentPath, name.trim());
    setBusy(true); setError("");
    try {
      await request(`/api/servers/${encodeURIComponent(serverId)}/files/write`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: remote, content: "" }) });
      await loadDirectory(currentPath);
      const file = await request(`/api/servers/${encodeURIComponent(serverId)}/files/read?path=${encodeURIComponent(remote)}`) as FileResult;
      setSelected(file); setContent(""); setBinary(false); setNotice("Text file created.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create file"); }
    finally { setBusy(false); }
  }

  async function saveFile() {
    if (!selected || binary) return;
    setSaving(true); setError("");
    try {
      await request(`/api/servers/${encodeURIComponent(serverId)}/files/write`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: selected.path, content }) });
      setNotice("File saved.");
      const file = await request(`/api/servers/${encodeURIComponent(serverId)}/files/read?path=${encodeURIComponent(selected.path)}`) as FileResult;
      setSelected(file); setContent(file.content);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save file"); }
    finally { setSaving(false); }
  }

  async function renameEntry(entry: RemoteEntry) {
    const newName = window.prompt("Rename to", entry.name);
    if (!newName?.trim() || newName.includes("/") || newName === "." || newName === ".." || newName === entry.name) return;
    setBusy(true); setError("");
    try {
      await request(`/api/servers/${encodeURIComponent(serverId)}/files/rename`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oldPath: entry.path, newPath: childPath(currentPath, newName.trim()) }) });
      if (selected?.path === entry.path) { setSelected(null); setContent(""); }
      setNotice("Remote path renamed."); await loadDirectory(currentPath);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not rename path"); }
    finally { setBusy(false); }
  }

  async function deleteEntry(entry: RemoteEntry) {
    if (!window.confirm(`Delete ${entry.path}? Folders must be empty.`)) return;
    setBusy(true); setError("");
    try {
      await request(`/api/servers/${encodeURIComponent(serverId)}/files/delete?path=${encodeURIComponent(entry.path)}`, { method: "DELETE" });
      if (selected?.path === entry.path) { setSelected(null); setContent(""); }
      setNotice("Remote path deleted."); await loadDirectory(currentPath);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete remote path"); }
    finally { setBusy(false); }
  }

  const trusted = !!server?.hostFingerprint;
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: "#0b0b0c" }}>
      <header className="px-4 sm:px-6 py-4 border-b border-white/10 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/connections")} aria-label="Back to connections"><ArrowLeft className="w-4 h-4" /></Button>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-xs text-[#ffd1c2]"><Folder className="w-3.5 h-3.5" /> Remote SFTP browser</div><h1 className="font-bold truncate">{server?.name ?? "Loading VPS…"}</h1></div>
        <Button variant="outline" size="sm" onClick={() => void loadDirectory(currentPath)} disabled={loading || busy}><RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /></Button>
      </header>
      {import.meta.env.DEV && <div className="mx-4 mt-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-100">Shared preview safety: live SFTP operations are disabled. Deploy to your own production VPS to use remote file management.</div>}
      {!loading && server && !trusted && <div className="mx-4 mt-4 rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100"><ShieldCheck className="inline w-4 h-4 mr-2" />Test SSH and verify the host fingerprint on the VPS Connections page before using SFTP.</div>}
      {error && <div className="mx-4 mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-200">{error}</div>}
      {notice && <div className="mx-4 mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-200">{notice}</div>}
      <div className="p-3 sm:p-4 border-b border-white/10 flex flex-wrap gap-2 items-center bg-[#111113]">
        <Button size="sm" variant="ghost" onClick={() => listing?.parentPath && void loadDirectory(listing.parentPath)} disabled={!listing?.parentPath || loading || import.meta.env.DEV}><ArrowUp className="w-4 h-4" /></Button>
        <form className="flex-1 min-w-[220px] flex gap-2" onSubmit={(event) => { event.preventDefault(); void loadDirectory(pathInput); }}>
          <input value={pathInput} onChange={(event) => setPathInput(event.target.value)} disabled={!trusted || import.meta.env.DEV} className="flex-1 min-w-0 h-9 rounded-md border border-white/10 bg-black px-3 font-mono text-xs outline-none focus:border-[#ff5a1f]/50" aria-label="Remote path" />
          <Button type="submit" size="sm" variant="outline" disabled={loading || !trusted || import.meta.env.DEV}>Go</Button>
        </form>
        <Button size="sm" variant="outline" onClick={() => void createDirectory()} disabled={busy || !trusted || import.meta.env.DEV}><FolderPlus className="w-4 h-4 mr-1.5" /> New folder</Button>
        <Button size="sm" onClick={() => void createFile()} disabled={busy || !trusted || import.meta.env.DEV}><Plus className="w-4 h-4 mr-1.5" /> New file</Button>
      </div>
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] overflow-hidden">
        <section className="min-h-0 overflow-auto border-b lg:border-b-0 lg:border-r border-white/10">
          <div className="px-4 py-2 text-[11px] font-mono text-muted-foreground border-b border-white/5 break-all">{currentPath}</div>
          {loading ? <div className="p-5 text-sm text-muted-foreground flex items-center gap-2"><LoaderCircle className="w-4 h-4 animate-spin" /> Loading directory…</div> : !listing?.entries.length ? <div className="p-5 text-sm text-muted-foreground">This directory is empty.</div> : listing.entries.map((entry) => (
            <div key={entry.path} className={`px-3 sm:px-4 py-2.5 flex items-center gap-3 border-b border-white/[.035] hover:bg-white/[.025] ${selected?.path === entry.path ? "bg-[#ff5a1f]/10" : ""}`}>
              <button type="button" onClick={() => void openEntry(entry)} className="flex-1 min-w-0 flex items-center gap-3 text-left">
                {entry.type === "directory" || entry.type === "symlink" ? <Folder className="w-4 h-4 text-[#ffd1c2] shrink-0" /> : <FileText className="w-4 h-4 text-muted-foreground shrink-0" />}
                <span className="truncate text-sm">{entry.name}</span><span className="hidden sm:inline text-[10px] text-muted-foreground font-mono">{entry.permissions}</span>
              </button>
              <span className="hidden md:inline text-[10px] text-muted-foreground">{formatSize(entry.size)}</span>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void renameEntry(entry)} disabled={busy || !trusted || import.meta.env.DEV} title="Rename"><Pencil className="w-3.5 h-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-300" onClick={() => void deleteEntry(entry)} disabled={busy || !trusted || import.meta.env.DEV} title="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
        </section>
        <section className="min-h-0 flex flex-col overflow-hidden">
          <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between gap-3"><span className="truncate text-xs font-mono text-muted-foreground">{selected?.path ?? "Select a text file to view or edit"}</span>{selected && !binary && <Button size="sm" onClick={() => void saveFile()} disabled={saving || busy || import.meta.env.DEV}><Save className="w-3.5 h-3.5 mr-1.5" />{saving ? "Saving…" : "Save"}</Button>}</div>
          {binary ? <div className="p-5 text-sm text-amber-200">Binary file ({selected ? formatSize(selected.size) : ""}) is not shown in the text editor.</div> : selected ? <textarea value={content} onChange={(event) => setContent(event.target.value)} disabled={import.meta.env.DEV} spellCheck={false} className="flex-1 min-h-48 resize-none bg-transparent p-4 font-mono text-xs sm:text-sm leading-relaxed outline-none" aria-label="Remote text file contents" /> : <div className="flex-1 grid place-items-center text-sm text-muted-foreground">Choose a file from the remote host.</div>}
        </section>
      </div>
    </div>
  );
}
