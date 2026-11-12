import { useParams, useSearch, useLocation } from "wouter";
import {
  useListFiles, getListFilesQueryKey,
  useReadFile, getReadFileQueryKey,
  useWriteFile,
  useDeleteFile,
  useCreateDirectory,
  useRenameFile
} from "@workspace/api-client-react";
import { useState, useEffect } from "react";
import {
  Folder, File as FileIcon, FileText, Trash2, Edit2, FolderPlus,
  FilePlus, ChevronRight, X, Save, RefreshCw, MoveRight, ArrowLeft,
  HardDrive, AlertTriangle, Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getFileIcon(name: string, type: string) {
  if (type === "directory") return <Folder className="w-4 h-4 text-primary fill-primary/20 flex-shrink-0" />;
  if (type === "symlink") return <FileIcon className="w-4 h-4 text-yellow-400 flex-shrink-0" />;
  const ext = name.split(".").pop()?.toLowerCase();
  const codeExts = ["js", "ts", "tsx", "jsx", "py", "sh", "bash", "rb", "go", "rs", "c", "cpp", "h", "java", "php", "sql", "yaml", "yml", "json", "toml", "ini", "conf", "env", "xml", "html", "css", "scss", "md"];
  const imgExts = ["png", "jpg", "jpeg", "gif", "svg", "ico", "webp", "bmp"];
  if (codeExts.includes(ext ?? "")) return <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />;
  if (imgExts.includes(ext ?? "")) return <FileIcon className="w-4 h-4 text-lime-400 flex-shrink-0" />;
  return <FileIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
}

type DialogMode = "mkdir" | "newfile" | "rename" | "move";

export default function ServerFiles() {
  const { id } = useParams<{ id: string }>();
  const serverId = parseInt(id);
  const searchString = useSearch();
  const [, navigate] = useLocation();
  const searchParams = new URLSearchParams(searchString);
  const currentPath = searchParams.get("path") || "/";

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("mkdir");
  const [dialogInput, setDialogInput] = useState("");
  const [targetItem, setTargetItem] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<{ path: string; type: string } | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: listData, isLoading: listLoading, error: listError, refetch } = useListFiles(serverId, { path: currentPath }, {
    query: {
      enabled: !!serverId,
      queryKey: getListFilesQueryKey(serverId, { path: currentPath })
    }
  });

  const { data: fileData, isLoading: fileLoading } = useReadFile(serverId, { path: selectedFile! }, {
    query: {
      enabled: !!serverId && !!selectedFile,
      queryKey: getReadFileQueryKey(serverId, { path: selectedFile! })
    }
  });

  useEffect(() => {
    if (fileData) {
      setFileContent(fileData.content);
      setIsEditing(false);
    }
  }, [fileData]);

  // Reset file view when path changes
  useEffect(() => {
    setSelectedFile(null);
    setIsEditing(false);
  }, [currentPath]);

  const writeMutation = useWriteFile({
    mutation: {
      onSuccess: () => {
        toast({ title: "File saved" });
        setIsEditing(false);
        queryClient.invalidateQueries({ queryKey: getReadFileQueryKey(serverId, { path: selectedFile! }) });
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(serverId, { path: currentPath }) });
      },
      onError: (e: any) => toast({ title: "Save failed", description: e?.error ?? "Unknown error", variant: "destructive" })
    }
  });

  const deleteMutation = useDeleteFile({
    mutation: {
      onSuccess: () => {
        toast({ title: "Deleted successfully" });
        setDeleteTarget(null);
        if (selectedFile) setSelectedFile(null);
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(serverId, { path: currentPath }) });
      },
      onError: (e: any) => toast({ title: "Delete failed", description: e?.error ?? "Unknown error", variant: "destructive" })
    }
  });

  const mkdirMutation = useCreateDirectory({
    mutation: {
      onSuccess: () => {
        toast({ title: "Directory created" });
        setDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(serverId, { path: currentPath }) });
      },
      onError: (e: any) => toast({ title: "Create failed", description: e?.error ?? "Unknown error", variant: "destructive" })
    }
  });

  const newFileMutation = useWriteFile({
    mutation: {
      onSuccess: (_, vars) => {
        toast({ title: "File created" });
        setDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(serverId, { path: currentPath }) });
        setSelectedFile(vars.data.path);
      },
      onError: (e: any) => toast({ title: "Create failed", description: e?.error ?? "Unknown error", variant: "destructive" })
    }
  });

  const renameMutation = useRenameFile({
    mutation: {
      onSuccess: () => {
        toast({ title: dialogMode === "move" ? "Moved successfully" : "Renamed successfully" });
        setDialogOpen(false);
        setSelectedFile(null);
        queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(serverId, { path: currentPath }) });
      },
      onError: (e: any) => toast({ title: "Failed", description: e?.error ?? "Unknown error", variant: "destructive" })
    }
  });

  const handleNavigate = (path: string) => {
    navigate(`/servers/${serverId}/files?path=${encodeURIComponent(path)}`);
  };

  const handleSaveFile = () => {
    if (selectedFile) {
      writeMutation.mutate({ id: serverId, data: { path: selectedFile, content: fileContent } });
    }
  };

  const openDialog = (mode: DialogMode, target = "") => {
    setDialogMode(mode);
    setTargetItem(target);
    if (mode === "rename") {
      setDialogInput(target.split("/").pop() || "");
    } else if (mode === "move") {
      setDialogInput(target);
    } else {
      setDialogInput("");
    }
    setDialogOpen(true);
  };

  const submitDialog = () => {
    if (!dialogInput.trim()) return;
    if (dialogMode === "mkdir") {
      const newPath = currentPath === "/" ? `/${dialogInput}` : `${currentPath}/${dialogInput}`;
      mkdirMutation.mutate({ id: serverId, data: { path: newPath } });
    } else if (dialogMode === "newfile") {
      const newPath = currentPath === "/" ? `/${dialogInput}` : `${currentPath}/${dialogInput}`;
      newFileMutation.mutate({ id: serverId, data: { path: newPath, content: "" } });
    } else if (dialogMode === "rename") {
      const parent = targetItem.substring(0, targetItem.lastIndexOf("/"));
      const newPath = parent === "" ? `/${dialogInput}` : `${parent}/${dialogInput}`;
      renameMutation.mutate({ id: serverId, data: { oldPath: targetItem, newPath } });
    } else if (dialogMode === "move") {
      renameMutation.mutate({ id: serverId, data: { oldPath: targetItem, newPath: dialogInput } });
    }
  };

  const isPending =
    mkdirMutation.isPending || newFileMutation.isPending ||
    renameMutation.isPending || deleteMutation.isPending;

  const breadcrumbs = currentPath.split("/").filter(Boolean);

  const dialogTitles: Record<DialogMode, string> = {
    mkdir: "New Directory",
    newfile: "New File",
    rename: "Rename",
    move: "Move to",
  };
  const dialogPlaceholders: Record<DialogMode, string> = {
    mkdir: "directory-name",
    newfile: "filename.txt",
    rename: "new-name",
    move: "/absolute/destination/path",
  };

  return (
    <div className="flex flex-col h-full flex-1 min-h-0 bg-background">
      {/* Top toolbar */}
      <div className="h-14 border-b border-border bg-card/30 flex items-center justify-between px-4 flex-shrink-0 gap-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-0.5 font-mono text-sm flex-1 min-w-0 overflow-x-auto scrollbar-none">
          <Button
            variant="ghost" size="sm"
            className="px-2 h-7 text-muted-foreground hover:text-primary font-mono flex-shrink-0"
            onClick={() => handleNavigate("/")}
            data-testid="breadcrumb-root"
          >
            <HardDrive className="w-3 h-3 mr-1" /> /
          </Button>
          {breadcrumbs.map((crumb, idx) => {
            const path = "/" + breadcrumbs.slice(0, idx + 1).join("/");
            return (
              <div key={path} className="flex items-center flex-shrink-0">
                <ChevronRight className="w-3 h-3 text-muted-foreground/40" />
                <Button
                  variant="ghost" size="sm"
                  className="px-2 h-7 font-mono"
                  onClick={() => handleNavigate(path)}
                  data-testid={`breadcrumb-${crumb}`}
                >
                  {crumb}
                </Button>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {listData?.parentPath && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost" size="icon"
                  className="h-8 w-8"
                  onClick={() => handleNavigate(listData.parentPath!)}
                  data-testid="btn-go-up"
                >
                  <ArrowLeft className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Go up</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()} data-testid="btn-refresh">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant="outline" size="sm"
            className="font-mono text-xs h-8"
            onClick={() => openDialog("newfile")}
            data-testid="btn-new-file"
          >
            <FilePlus className="w-3.5 h-3.5 mr-1.5" /> New File
          </Button>
          <Button
            variant="outline" size="sm"
            className="font-mono text-xs h-8"
            onClick={() => openDialog("mkdir")}
            data-testid="btn-new-folder"
          >
            <FolderPlus className="w-3.5 h-3.5 mr-1.5" /> New Dir
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left pane: File List */}
        <div className={`flex flex-col min-h-0 border-r border-border ${selectedFile ? "w-1/2" : "flex-1"}`}>
          {/* Column headers */}
          <div className="bg-muted/20 border-b border-border grid grid-cols-12 gap-2 px-4 py-2 font-mono text-xs text-muted-foreground font-semibold flex-shrink-0 select-none">
            <div className="col-span-6">Name</div>
            <div className="col-span-2 text-right">Size</div>
            <div className="col-span-2">Perms</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          <ScrollArea className="flex-1">
            {listLoading ? (
              <div className="p-4 space-y-1.5">
                {[...Array(8)].map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full rounded-sm" />
                ))}
              </div>
            ) : listError ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
                <AlertTriangle className="w-8 h-8 text-destructive" />
                <p className="font-mono text-sm">Failed to list directory</p>
                <Button variant="outline" size="sm" onClick={() => refetch()} className="font-mono text-xs">
                  Retry
                </Button>
              </div>
            ) : (
              <div className="font-mono text-sm">
                {/* Parent dir row */}
                {listData?.parentPath != null && (
                  <div
                    className="grid grid-cols-12 gap-2 px-4 py-2 hover:bg-accent/40 cursor-pointer items-center border-b border-border/40 transition-colors"
                    onClick={() => handleNavigate(listData.parentPath!)}
                    data-testid="file-parent-dir"
                  >
                    <div className="col-span-12 flex items-center text-muted-foreground gap-2">
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span className="text-xs opacity-70">.. (parent directory)</span>
                    </div>
                  </div>
                )}

                {/* File/dir rows */}
                {listData?.entries.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
                    <Folder className="w-8 h-8 opacity-30" />
                    <p className="text-sm opacity-60">Empty directory</p>
                  </div>
                )}

                {listData?.entries.map((entry) => (
                  <div
                    key={entry.path}
                    className={`grid grid-cols-12 gap-2 px-4 py-2.5 cursor-pointer items-center border-b border-border/30 group transition-colors ${
                      selectedFile === entry.path
                        ? "bg-primary/10 border-l-2 border-l-primary"
                        : "hover:bg-accent/40"
                    }`}
                    onClick={() => {
                      if (entry.type === "directory") handleNavigate(entry.path);
                      else setSelectedFile(entry.path);
                    }}
                    data-testid={`file-entry-${entry.name}`}
                  >
                    <div className="col-span-6 flex items-center gap-2 min-w-0">
                      {getFileIcon(entry.name, entry.type)}
                      <span className="truncate text-sm" title={entry.name}>{entry.name}</span>
                      {entry.type === "symlink" && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 font-mono h-4 flex-shrink-0">link</Badge>
                      )}
                    </div>
                    <div className="col-span-2 text-right text-xs text-muted-foreground">
                      {formatSize(entry.size)}
                    </div>
                    <div className="col-span-2 text-xs text-muted-foreground/70 font-mono tracking-tight">
                      {entry.permissions}
                    </div>
                    <div className="col-span-2 flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {entry.type !== "directory" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost" size="icon"
                              className="w-7 h-7 text-muted-foreground hover:text-foreground"
                              onClick={(e) => { e.stopPropagation(); setSelectedFile(entry.path); }}
                              data-testid={`btn-view-${entry.name}`}
                            >
                              <Eye className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View</TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost" size="icon"
                            className="w-7 h-7 text-muted-foreground hover:text-foreground"
                            onClick={(e) => { e.stopPropagation(); openDialog("rename", entry.path); }}
                            data-testid={`btn-rename-${entry.name}`}
                          >
                            <Edit2 className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Rename</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost" size="icon"
                            className="w-7 h-7 text-muted-foreground hover:text-foreground"
                            onClick={(e) => { e.stopPropagation(); openDialog("move", entry.path); }}
                            data-testid={`btn-move-${entry.name}`}
                          >
                            <MoveRight className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Move</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost" size="icon"
                            className="w-7 h-7 text-destructive/60 hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget({ path: entry.path, type: entry.type }); }}
                            data-testid={`btn-delete-${entry.name}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Status bar */}
          <div className="h-7 border-t border-border bg-card/20 flex items-center px-4 gap-4 flex-shrink-0">
            <span className="font-mono text-xs text-muted-foreground/60">
              {listData?.entries.length ?? 0} items
            </span>
            <span className="font-mono text-xs text-muted-foreground/40 truncate">{currentPath}</span>
          </div>
        </div>

        {/* Right pane: File viewer/editor */}
        {selectedFile && (
          <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#09090b]">
            {/* File header */}
            <div className="h-12 border-b border-border bg-card/60 flex items-center justify-between px-4 flex-shrink-0 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                <span className="font-mono text-sm font-medium text-primary truncate" title={selectedFile}>
                  {selectedFile}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {isEditing ? (
                  <>
                    <Button
                      variant="outline" size="sm"
                      className="h-7 font-mono text-xs"
                      onClick={() => { setIsEditing(false); setFileContent(fileData?.content ?? ""); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 font-mono text-xs"
                      onClick={handleSaveFile}
                      disabled={writeMutation.isPending}
                      data-testid="btn-save-file"
                    >
                      <Save className="w-3 h-3 mr-1.5" />
                      {writeMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </>
                ) : (
                  <>
                    {!fileData?.isBinary && (
                      <Button
                        variant="outline" size="sm"
                        className="h-7 font-mono text-xs"
                        onClick={() => setIsEditing(true)}
                        data-testid="btn-edit-file"
                      >
                        <Edit2 className="w-3 h-3 mr-1.5" /> Edit
                      </Button>
                    )}
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => setSelectedFile(null)}
                      data-testid="btn-close-file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* File body */}
            <div className="flex-1 min-h-0 flex flex-col">
              {fileLoading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground gap-3">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span className="font-mono text-sm">Loading...</span>
                </div>
              ) : fileData?.isBinary ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
                  <FileIcon className="w-12 h-12 opacity-20" />
                  <p className="font-mono text-sm">Binary file — cannot display</p>
                </div>
              ) : isEditing ? (
                <Textarea
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  className="flex-1 h-full font-mono text-sm bg-transparent border-0 rounded-none resize-none focus-visible:ring-0 p-4 leading-relaxed"
                  spellCheck={false}
                  data-testid="textarea-file-editor"
                />
              ) : (
                <ScrollArea className="flex-1 h-full">
                  <pre className="p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-muted-foreground">
                    {fileContent || <span className="italic opacity-40">Empty file</span>}
                  </pre>
                </ScrollArea>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create/Rename/Move dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono">{dialogTitles[dialogMode]}</DialogTitle>
            {dialogMode === "move" && (
              <DialogDescription className="font-mono text-xs">
                From: <span className="text-primary">{targetItem}</span>
              </DialogDescription>
            )}
            {dialogMode === "rename" && (
              <DialogDescription className="font-mono text-xs">
                Renaming: <span className="text-primary">{targetItem.split("/").pop()}</span>
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="py-2">
            <Input
              value={dialogInput}
              onChange={(e) => setDialogInput(e.target.value)}
              placeholder={dialogPlaceholders[dialogMode]}
              className="font-mono text-sm"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && dialogInput.trim()) submitDialog(); }}
              data-testid="input-dialog-val"
            />
            {dialogMode === "move" && (
              <p className="mt-2 text-xs text-muted-foreground font-mono">
                Enter the full absolute destination path (e.g. /home/user/newname.txt)
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} className="font-mono text-sm">
              Cancel
            </Button>
            <Button
              onClick={submitDialog}
              disabled={!dialogInput.trim() || isPending}
              className="font-mono text-sm"
              data-testid="btn-dialog-confirm"
            >
              {isPending ? "Working..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" /> Confirm Delete
            </AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-sm">
              Delete <span className="text-foreground font-medium">{deleteTarget?.path}</span>?
              {deleteTarget?.type === "directory" && (
                <span className="block mt-1 text-destructive text-xs">
                  This will recursively delete all contents.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-sm" data-testid="btn-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono text-sm"
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate({
                    id: serverId,
                    params: { path: deleteTarget.path, recursive: deleteTarget.type === "directory" }
                  });
                }
              }}
              disabled={deleteMutation.isPending}
              data-testid="btn-delete-confirm"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
