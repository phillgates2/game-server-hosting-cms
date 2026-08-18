"use client";

import { useEffect, useState, useCallback, useRef } from "react";

interface AuthUser { id: number; username: string; role: string }
interface Server { id: number; name: string; gameName: string | null; gameIcon: string | null; gameSlug: string | null; status: string }
interface FileEntry { name: string; path: string; isDir: boolean; size: number; modified: string; ext: string | null }
interface FileContent { type: "file"; path: string; name: string; size: number; content: string | null; tooLarge?: boolean; modified?: string }

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function fileIcon(ext: string | null, isDir: boolean): string {
  if (isDir) return "📁";
  const icons: Record<string, string> = {
    cfg: "⚙️", ini: "⚙️", conf: "⚙️", config: "⚙️", properties: "⚙️", yml: "⚙️", yaml: "⚙️", toml: "⚙️",
    json: "📋", xml: "📋", csv: "📋",
    sh: "🔧", bash: "🔧", bat: "🔧", cmd: "🔧", ps1: "🔧",
    log: "📄", txt: "📄", md: "📄", readme: "📄",
    jar: "☕", java: "☕",
    lua: "🌙", py: "🐍", js: "📜", ts: "📜",
    pk3: "📦", pk4: "📦", zip: "📦", tar: "📦", gz: "📦", bz2: "📦", "7z": "📦", rar: "📦",
    png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", bmp: "🖼️", ico: "🖼️",
    mp3: "🎵", wav: "🎵", ogg: "🎵",
    mp4: "🎬", avi: "🎬", mkv: "🎬",
    db: "🗄️", sqlite: "🗄️", sql: "🗄️",
    so: "🔗", dll: "🔗", exe: "💻", bin: "💻",
  };
  return icons[ext || ""] || "📄";
}

const EDITABLE_EXTS = new Set(["cfg", "ini", "conf", "config", "properties", "yml", "yaml", "toml", "json", "xml", "csv", "txt", "md", "log", "sh", "bash", "bat", "cmd", "lua", "py", "js", "ts", "html", "css", "sql", "env", "service", "timer", ""]);

export default function FilesPanel({ user }: { user: AuthUser }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [currentPath, setCurrentPath] = useState(".");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [basePath, setBasePath] = useState("");
  const [editingFile, setEditingFile] = useState<FileContent | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState<"file" | "dir" | null>(null);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveTargetDir, setMoveTargetDir] = useState(".");
  const [newName, setNewName] = useState("");
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const checkboxShiftRef = useRef(false);
  const dragCounterRef = useRef(0);

  // Load servers
  useEffect(() => {
    fetch("/api/servers").then((r) => r.json()).then((d) => setServers(d.servers || [])).catch(() => {});
  }, []);

  const loadDir = useCallback(async (serverId: number, path: string) => {
    try {
      const res = await fetch(`/api/servers/${serverId}/files?path=${encodeURIComponent(path)}&action=list`);
      const data = await res.json();
      if (data.type === "directory") {
        setEntries(data.items || []);
        setCurrentPath(data.path || ".");
        setBasePath(data.basePath || "");
        setSelectedPaths([]);
        setLastSelectedPath(null);
      } else if (data.error) {
        setMessage({ type: "error", text: data.error });
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setLoaded(true);
    }
  }, []);

  function selectServer(id: number) {
    setSelectedId(id);
    setEditingFile(null);
    setCurrentPath(".");
    setSelectedPaths([]);
    setLastSelectedPath(null);
    setLoaded(false);
    loadDir(id, ".");
  }

  function navigate(path: string) {
    if (!selectedId) return;
    setEditingFile(null);
    setSelectedPaths([]);
    setLastSelectedPath(null);
    loadDir(selectedId, path);
  }

  function goUp() {
    if (currentPath === "." || currentPath === "") return;
    const parts = currentPath.split("/");
    parts.pop();
    navigate(parts.length > 0 ? parts.join("/") : ".");
  }

  async function openFile(entry: FileEntry) {
    if (!selectedId) return;
    if (entry.isDir) { navigate(entry.path); return; }
    try {
      const res = await fetch(`/api/servers/${selectedId}/files?path=${encodeURIComponent(entry.path)}&action=read`);
      const data = await res.json();
      if (data.type === "file") {
        setEditingFile(data);
        setEditContent(data.content || "");
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to open file" });
    }
  }

  async function saveFile() {
    if (!selectedId || !editingFile) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/servers/${selectedId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", path: editingFile.path, content: editContent }),
      });
      if (!res.ok) { const d = await res.json(); setMessage({ type: "error", text: d.error }); }
      else { setMessage({ type: "success", text: `Saved ${editingFile.name}` }); }
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
    finally { setSaving(false); }
  }

  async function downloadFile(entry: FileEntry) {
    if (!selectedId) return;
    window.open(`/api/servers/${selectedId}/files?path=${encodeURIComponent(entry.path)}&action=download`, "_blank");
  }

  async function deleteEntry(entry: FileEntry) {
    if (!selectedId || !confirm(`Delete "${entry.name}"${entry.isDir ? " and all its contents" : ""}?`)) return;
    try {
      await fetch(`/api/servers/${selectedId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", path: entry.path }),
      });
      setSelectedPaths((prev) => prev.filter((p) => p !== entry.path));
      loadDir(selectedId, currentPath);
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
  }

  function togglePath(path: string, checked: boolean, shiftKey = false) {
    setSelectedPaths((prev) => {
      if (shiftKey && lastSelectedPath) {
        const indexByPath = new Map(entries.map((entry, index) => [entry.path, index]));
        const start = indexByPath.get(lastSelectedPath);
        const end = indexByPath.get(path);
        if (start !== undefined && end !== undefined) {
          const [from, to] = start <= end ? [start, end] : [end, start];
          const range = entries.slice(from, to + 1).map((entry) => entry.path);
          if (checked) {
            const merged = new Set([...prev, ...range]);
            return Array.from(merged);
          }
          const removeSet = new Set(range);
          return prev.filter((p) => !removeSet.has(p));
        }
      }

      if (checked) {
        if (prev.includes(path)) return prev;
        return [...prev, path];
      }
      return prev.filter((p) => p !== path);
    });
    setLastSelectedPath(path);
  }

  function onRowClick(entry: FileEntry, event: React.MouseEvent<HTMLTableRowElement>) {
    const isToggleClick = event.ctrlKey || event.metaKey;
    const isRangeClick = event.shiftKey;
    if (!isToggleClick && !isRangeClick) {
      return;
    }

    event.preventDefault();
    const alreadySelected = selectedPaths.includes(entry.path);
    const nextChecked = isRangeClick ? true : !alreadySelected;
    togglePath(entry.path, nextChecked, isRangeClick);
  }

  function toggleSelectAllCurrent(checked: boolean) {
    if (checked) {
      setSelectedPaths(entries.map((e) => e.path));
      if (entries.length > 0) {
        setLastSelectedPath(entries[entries.length - 1].path);
      }
      return;
    }
    setSelectedPaths([]);
    setLastSelectedPath(null);
  }

  async function deleteSelected() {
    if (!selectedId || selectedPaths.length === 0) return;
    if (!confirm(`Delete ${selectedPaths.length} selected item(s)?`)) return;

    try {
      const res = await fetch(`/api/servers/${selectedId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deleteMany", paths: selectedPaths }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 207) {
        setMessage({ type: "error", text: data.error || "Bulk delete failed" });
        return;
      }

      const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
      const deletedCount = typeof data.deleted === "number" ? data.deleted : 0;
      if (failedCount > 0) {
        setMessage({ type: "error", text: `Deleted ${deletedCount}, failed ${failedCount}` });
      } else {
        setMessage({ type: "success", text: `Deleted ${deletedCount} item(s)` });
      }
      setSelectedPaths([]);
      loadDir(selectedId, currentPath);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Bulk delete failed" });
    }
  }

  async function moveSelected(targetDir: string) {
    if (!selectedId || selectedPaths.length === 0) return;

    try {
      const res = await fetch(`/api/servers/${selectedId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "moveMany", paths: selectedPaths, targetDir: targetDir.trim() || "." }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 207) {
        setMessage({ type: "error", text: data.error || "Bulk move failed" });
        return;
      }

      const failedCount = Array.isArray(data.failed) ? data.failed.length : 0;
      const movedCount = typeof data.moved === "number" ? data.moved : 0;
      if (failedCount > 0) {
        setMessage({ type: "error", text: `Moved ${movedCount}, failed ${failedCount}` });
      } else {
        setMessage({ type: "success", text: `Moved ${movedCount} item(s)` });
      }
      setSelectedPaths([]);
      setLastSelectedPath(null);
      setShowMoveDialog(false);
      loadDir(selectedId, currentPath);
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Bulk move failed" });
    }
  }

  function openMoveDialog() {
    if (selectedPaths.length === 0) return;
    setMoveTargetDir(currentPath === "." ? "." : currentPath);
    setShowMoveDialog(true);
  }

  function closeMoveDialog() {
    setShowMoveDialog(false);
  }

  async function submitMoveDialog() {
    if (!moveTargetDir.trim()) {
      setMessage({ type: "error", text: "Target directory is required" });
      return;
    }
    await moveSelected(moveTargetDir);
  }

  async function createNew(type: "file" | "dir") {
    if (!selectedId || !newName.trim()) return;
    const path = currentPath === "." ? newName.trim() : `${currentPath}/${newName.trim()}`;
    try {
      await fetch(`/api/servers/${selectedId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: type === "file" ? "createFile" : "createDir", path }),
      });
      setShowNewDialog(null);
      setNewName("");
      loadDir(selectedId, currentPath);
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
  }

  async function submitRename() {
    if (!selectedId || !renamingEntry || !renameValue.trim()) return;
    const parts = renamingEntry.path.split("/");
    parts.pop();
    const newPath = [...parts, renameValue.trim()].join("/") || renameValue.trim();
    try {
      await fetch(`/api/servers/${selectedId}/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", path: renamingEntry.path, newPath }),
      });
      setRenamingEntry(null);
      setRenameValue("");
      loadDir(selectedId, currentPath);
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (!selectedId || !e.target.files?.[0]) return;
    setUploading(true);
    setMessage(null);
    const formData = new FormData();
    formData.append("file", e.target.files[0]);
    formData.append("path", currentPath);
    try {
      const res = await fetch(`/api/servers/${selectedId}/files/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) setMessage({ type: "error", text: data.error });
      else { setMessage({ type: "success", text: `Uploaded ${data.name} (${fmtSize(data.size)})` }); loadDir(selectedId, currentPath); }
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  }

  async function uploadFiles(files: FileList | File[], targetPath: string) {
    if (!selectedId || files.length === 0) return;
    setUploading(true);
    setMessage(null);
    setUploadProgress({ current: 0, total: files.length });
    let successCount = 0;
    let failCount = 0;
    const fileArray = Array.from(files);
    for (let i = 0; i < fileArray.length; i++) {
      setUploadProgress({ current: i + 1, total: fileArray.length });
      const formData = new FormData();
      formData.append("file", fileArray[i]);
      formData.append("path", targetPath);
      try {
        const res = await fetch(`/api/servers/${selectedId}/files/upload`, { method: "POST", body: formData });
        if (res.ok) successCount++;
        else failCount++;
      } catch {
        failCount++;
      }
    }
    setUploadProgress(null);
    setUploading(false);
    if (failCount > 0) {
      setMessage({ type: "error", text: `Uploaded ${successCount} file(s), ${failCount} failed` });
    } else {
      setMessage({ type: "success", text: `Uploaded ${successCount} file(s)` });
    }
    loadDir(selectedId, currentPath);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setDragging(true);
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setDragging(false);
      setDropTarget(null);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragging(false);
    setDropTarget(null);
    if (!selectedId) return;
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      uploadFiles(files, currentPath);
    }
  }

  function handleRowDragOver(e: React.DragEvent, entry: FileEntry) {
    if (!entry.isDir) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDropTarget(entry.path);
  }

  function handleRowDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
  }

  function handleRowDrop(e: React.DragEvent, entry: FileEntry) {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setDragging(false);
    setDropTarget(null);
    if (!selectedId || !entry.isDir) return;
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      uploadFiles(files, entry.path);
    }
  }

  const breadcrumbs = currentPath === "." ? ["root"] : ["root", ...currentPath.split("/")];
  const isEditable = editingFile && !editingFile.tooLarge && EDITABLE_EXTS.has((editingFile.name.split(".").pop() || "").toLowerCase());
  const allSelected = entries.length > 0 && selectedPaths.length === entries.length;

  return (
    <div className="animate-fade-in panel-view space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">📂 File Manager</h2>
          <p className="text-text-secondary text-sm">Browse and edit server files</p>
        </div>
        <select value={selectedId || ""} onChange={(e) => e.target.value && selectServer(Number(e.target.value))}
          className="px-3 py-2 gaming-chip rounded-lg text-sm min-w-[220px]">
          <option value="">Select a server...</option>
          {servers.map((s) => <option key={s.id} value={s.id}>{s.gameIcon} {s.name}</option>)}
        </select>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.type === "success" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
          {message.text}
        </div>
      )}

      {selectedId && !editingFile && (
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className="relative space-y-4"
        >
          {/* Drag & drop overlay */}
          {dragging && (
            <div className="absolute inset-0 z-50 bg-accent/10 border-2 border-dashed border-accent rounded-xl flex items-center justify-center pointer-events-none backdrop-blur-[2px]">
              <div className="text-center">
                <span className="text-5xl block mb-3">📥</span>
                <p className="text-accent font-semibold text-lg">Drop files to upload</p>
                <p className="text-accent/70 text-sm mt-1">Files will be uploaded to the current directory</p>
              </div>
            </div>
          )}

          {/* Upload progress */}
          {uploadProgress && (
            <div className="bg-accent/10 border border-accent/30 rounded-lg p-3 flex items-center gap-3">
              <div className="inline-block w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-accent font-medium">
                Uploading file {uploadProgress.current} of {uploadProgress.total}...
              </span>
              <div className="flex-1 bg-bg-secondary rounded-full h-2 overflow-hidden">
                <div
                  className="bg-accent h-full rounded-full transition-all duration-300"
                  style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={goUp} disabled={currentPath === "."} className="px-3 py-1.5 gaming-chip rounded-lg text-xs disabled:opacity-30">⬆️ Up</button>
            <button onClick={() => loadDir(selectedId, currentPath)} className="px-3 py-1.5 gaming-chip rounded-lg text-xs">🔄 Refresh</button>
            <button onClick={() => { setShowNewDialog("file"); setNewName(""); }} className="px-3 py-1.5 bg-accent/15 text-accent rounded-lg text-xs">📄 New File</button>
            <button onClick={() => { setShowNewDialog("dir"); setNewName(""); }} className="px-3 py-1.5 bg-accent/15 text-accent rounded-lg text-xs">📁 New Folder</button>
            <label className={`px-3 py-1.5 bg-success/15 text-success rounded-lg text-xs cursor-pointer ${uploading ? "opacity-50" : ""}`}>
              ⬆️ Upload
              <input ref={fileInputRef} type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
            </label>
            <button
              onClick={openMoveDialog}
              disabled={selectedPaths.length === 0}
              className="px-3 py-1.5 bg-accent/15 text-accent rounded-lg text-xs disabled:opacity-40"
            >
              📦 Move Selected ({selectedPaths.length})
            </button>
            <button
              onClick={deleteSelected}
              disabled={selectedPaths.length === 0}
              className="px-3 py-1.5 bg-danger/15 text-danger rounded-lg text-xs disabled:opacity-40"
            >
              🗑️ Delete Selected
            </button>
            <div className="ml-auto text-xs text-text-muted font-mono truncate max-w-xs">{basePath}/{currentPath === "." ? "" : currentPath}</div>
          </div>

          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 text-xs flex-wrap">
            {breadcrumbs.map((crumb, i) => {
              const path = i === 0 ? "." : breadcrumbs.slice(1, i + 1).join("/");
              return (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-text-muted">/</span>}
                  <button onClick={() => navigate(path)} className="text-accent hover:underline">{crumb}</button>
                </span>
              );
            })}
          </div>

          {/* New file/dir dialog */}
          {showNewDialog && (
            <div className="flex items-center gap-2 bg-bg-card border border-border rounded-lg p-3">
              <span className="text-sm">{showNewDialog === "file" ? "📄" : "📁"} New {showNewDialog}:</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={showNewDialog === "file" ? "filename.cfg" : "folder-name"}
                className="flex-1 px-3 py-1.5 gaming-chip rounded-lg text-sm" autoFocus
                onKeyDown={(e) => e.key === "Enter" && createNew(showNewDialog)} />
              <button onClick={() => createNew(showNewDialog)} className="px-3 py-1.5 bg-success text-white rounded-lg text-xs">Create</button>
              <button onClick={() => setShowNewDialog(null)} className="px-3 py-1.5 bg-bg-secondary text-text-muted rounded-lg text-xs">Cancel</button>
            </div>
          )}

          {/* Move dialog */}
          {showMoveDialog && (
            <div className="bg-bg-card border border-border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">📦 Move {selectedPaths.length} item(s) to:</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={moveTargetDir}
                  onChange={(e) => setMoveTargetDir(e.target.value)}
                  placeholder="relative/path or ."
                  className="flex-1 px-3 py-1.5 gaming-chip rounded-lg text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitMoveDialog();
                    if (e.key === "Escape") closeMoveDialog();
                  }}
                />
                <button onClick={submitMoveDialog} className="px-3 py-1.5 bg-success text-white rounded-lg text-xs">Move</button>
                <button onClick={closeMoveDialog} className="px-3 py-1.5 bg-bg-secondary text-text-muted rounded-lg text-xs">Cancel</button>
              </div>
              <p className="text-[11px] text-text-muted mt-2">Use a relative directory (for example: <span className="font-mono">configs/archive</span>).</p>
            </div>
          )}

          {/* File listing */}
          {!loaded && <div className="text-center py-8"><div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" /></div>}

          {loaded && (
            <div className="gaming-surface rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
                    <th className="px-4 py-2 font-medium w-8 text-center">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleSelectAllCurrent(e.target.checked)}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-4 py-2 font-medium w-8"></th>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium w-24 text-right">Size</th>
                    <th className="px-4 py-2 font-medium w-40">Modified</th>
                    <th className="px-4 py-2 font-medium w-32 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPath !== "." && (
                    <tr className="border-b border-border/30 hover:bg-bg-hover cursor-pointer" onClick={goUp}>
                      <td></td>
                      <td className="px-4 py-2 text-center">⬆️</td>
                      <td className="px-4 py-2 text-text-muted">..</td>
                      <td></td><td></td><td></td>
                    </tr>
                  )}
                  {entries.map((entry) => (
                    <tr
                      key={entry.path}
                      className={`border-b border-border/30 hover:bg-bg-hover group transition-colors ${selectedPaths.includes(entry.path) ? "bg-accent/10" : ""} ${dropTarget === entry.path ? "!bg-accent/20 ring-1 ring-accent ring-inset" : ""}`}
                      onClick={(event) => onRowClick(entry, event)}
                      onDragOver={(e) => handleRowDragOver(e, entry)}
                      onDragLeave={handleRowDragLeave}
                      onDrop={(e) => { if (entry.isDir) handleRowDrop(e, entry); }}
                    >
                      <td className="px-4 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedPaths.includes(entry.path)}
                          onMouseDown={(e) => { checkboxShiftRef.current = e.shiftKey; }}
                          onChange={(e) => {
                            togglePath(entry.path, e.target.checked, checkboxShiftRef.current);
                            checkboxShiftRef.current = false;
                          }}
                          aria-label={`Select ${entry.name}`}
                        />
                      </td>
                      <td className="px-4 py-2 text-center cursor-pointer" onClick={() => openFile(entry)}>
                        {fileIcon(entry.ext, entry.isDir)}
                      </td>
                      <td className="px-4 py-2 cursor-pointer" onClick={() => openFile(entry)}>
                        {renamingEntry?.path === entry.path ? (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus
                              className="px-2 py-0.5 bg-bg-secondary border border-border rounded text-sm w-48"
                              onKeyDown={(e) => { if (e.key === "Enter") submitRename(); if (e.key === "Escape") setRenamingEntry(null); }} />
                            <button onClick={submitRename} className="text-success text-xs">✓</button>
                            <button onClick={() => setRenamingEntry(null)} className="text-text-muted text-xs">✕</button>
                          </div>
                        ) : (
                          <span className={`${entry.isDir ? "font-medium" : ""}`}>{entry.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-text-muted text-xs">{entry.isDir ? "—" : fmtSize(entry.size)}</td>
                      <td className="px-4 py-2 text-text-muted text-xs">{entry.modified ? new Date(entry.modified).toLocaleString() : ""}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          {!entry.isDir && (
                            <button onClick={(e) => { e.stopPropagation(); downloadFile(entry); }} className="px-2 py-0.5 text-[10px] text-accent hover:bg-accent/10 rounded" title="Download">⬇️</button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); setRenamingEntry(entry); setRenameValue(entry.name); }} className="px-2 py-0.5 text-[10px] text-text-muted hover:bg-bg-secondary rounded" title="Rename">✏️</button>
                          <button onClick={(e) => { e.stopPropagation(); deleteEntry(entry); }} className="px-2 py-0.5 text-[10px] text-danger hover:bg-danger/10 rounded" title="Delete">🗑️</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-text-muted">
                      <span className="text-3xl block mb-2">📂</span>
                      <p>Empty directory</p>
                      <p className="text-xs mt-1 opacity-60">Drag & drop files here to upload</p>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* File editor */}
      {editingFile && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => { setEditingFile(null); if (selectedId) loadDir(selectedId, currentPath); }} className="text-accent text-sm hover:underline">← Back</button>
              <span className="text-sm font-mono text-text-muted">{editingFile.path}</span>
              <span className="text-xs text-text-muted">({fmtSize(editingFile.size)})</span>
            </div>
            {isEditable && (
              <div className="flex gap-2">
                <button onClick={saveFile} disabled={saving} className="px-4 py-1.5 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-xs font-medium">
                  {saving ? "Saving..." : "💾 Save"}
                </button>
                <button onClick={() => { if (selectedId) downloadFile({ name: editingFile.name, path: editingFile.path, isDir: false, size: editingFile.size, modified: "", ext: null }); }}
                  className="px-3 py-1.5 bg-bg-secondary text-text-muted rounded-lg text-xs">⬇️ Download</button>
              </div>
            )}
          </div>

          {editingFile.tooLarge ? (
            <div className="gaming-surface rounded-xl p-8 text-center">
              <span className="text-3xl block mb-2">📦</span>
              <p className="text-text-secondary">File too large to edit in browser ({fmtSize(editingFile.size)})</p>
              <button onClick={() => { if (selectedId) downloadFile({ name: editingFile.name, path: editingFile.path, isDir: false, size: editingFile.size, modified: "", ext: null }); }}
                className="mt-3 px-4 py-2 bg-accent text-white rounded-lg text-sm">Download File</button>
            </div>
          ) : isEditable ? (
            <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-[500px] px-4 py-3 bg-[#0d1117] border border-border rounded-xl text-sm font-mono text-text-primary resize-y focus:outline-none focus:ring-2 focus:ring-accent"
              spellCheck={false}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveFile(); } }} />
          ) : (
            <div className="gaming-surface rounded-xl p-8 text-center">
              <span className="text-3xl block mb-2">{fileIcon(editingFile.name.split(".").pop() || null, false)}</span>
              <p className="text-text-secondary">Binary file — cannot edit in browser</p>
              <button onClick={() => { if (selectedId) downloadFile({ name: editingFile.name, path: editingFile.path, isDir: false, size: editingFile.size, modified: "", ext: null }); }}
                className="mt-3 px-4 py-2 bg-accent text-white rounded-lg text-sm">Download File</button>
            </div>
          )}
        </div>
      )}

      {!selectedId && (
        <div className="gaming-surface rounded-xl p-12 text-center">
          <span className="text-4xl block mb-3">📂</span>
          <h3 className="font-semibold mb-1">Select a Server</h3>
          <p className="text-text-secondary text-sm">Choose a server from the dropdown to browse its files</p>
        </div>
      )}
    </div>
  );
}
