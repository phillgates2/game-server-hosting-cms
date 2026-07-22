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
  const [newName, setNewName] = useState("");
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setLoaded(false);
    loadDir(id, ".");
  }

  function navigate(path: string) {
    if (!selectedId) return;
    setEditingFile(null);
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
      loadDir(selectedId, currentPath);
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
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

  const breadcrumbs = currentPath === "." ? ["root"] : ["root", ...currentPath.split("/")];
  const isEditable = editingFile && !editingFile.tooLarge && EDITABLE_EXTS.has((editingFile.name.split(".").pop() || "").toLowerCase());

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">📂 File Manager</h2>
          <p className="text-text-secondary text-sm">Browse and edit server files</p>
        </div>
        <select value={selectedId || ""} onChange={(e) => e.target.value && selectServer(Number(e.target.value))}
          className="px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm min-w-[220px]">
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
        <>
          {/* Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={goUp} disabled={currentPath === "."} className="px-3 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs disabled:opacity-30">⬆️ Up</button>
            <button onClick={() => loadDir(selectedId, currentPath)} className="px-3 py-1.5 bg-bg-secondary border border-border rounded-lg text-xs">🔄 Refresh</button>
            <button onClick={() => { setShowNewDialog("file"); setNewName(""); }} className="px-3 py-1.5 bg-accent/15 text-accent rounded-lg text-xs">📄 New File</button>
            <button onClick={() => { setShowNewDialog("dir"); setNewName(""); }} className="px-3 py-1.5 bg-accent/15 text-accent rounded-lg text-xs">📁 New Folder</button>
            <label className={`px-3 py-1.5 bg-success/15 text-success rounded-lg text-xs cursor-pointer ${uploading ? "opacity-50" : ""}`}>
              ⬆️ Upload
              <input ref={fileInputRef} type="file" className="hidden" onChange={uploadFile} disabled={uploading} />
            </label>
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
                className="flex-1 px-3 py-1.5 bg-bg-secondary border border-border rounded-lg text-sm" autoFocus
                onKeyDown={(e) => e.key === "Enter" && createNew(showNewDialog)} />
              <button onClick={() => createNew(showNewDialog)} className="px-3 py-1.5 bg-success text-white rounded-lg text-xs">Create</button>
              <button onClick={() => setShowNewDialog(null)} className="px-3 py-1.5 bg-bg-secondary text-text-muted rounded-lg text-xs">Cancel</button>
            </div>
          )}

          {/* File listing */}
          {!loaded && <div className="text-center py-8"><div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" /></div>}

          {loaded && (
            <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-text-muted">
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
                      <td className="px-4 py-2 text-center">⬆️</td>
                      <td className="px-4 py-2 text-text-muted">..</td>
                      <td></td><td></td><td></td>
                    </tr>
                  )}
                  {entries.map((entry) => (
                    <tr key={entry.path} className="border-b border-border/30 hover:bg-bg-hover group">
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
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted">Empty directory</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
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
            <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
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
            <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
              <span className="text-3xl block mb-2">{fileIcon(editingFile.name.split(".").pop() || null, false)}</span>
              <p className="text-text-secondary">Binary file — cannot edit in browser</p>
              <button onClick={() => { if (selectedId) downloadFile({ name: editingFile.name, path: editingFile.path, isDir: false, size: editingFile.size, modified: "", ext: null }); }}
                className="mt-3 px-4 py-2 bg-accent text-white rounded-lg text-sm">Download File</button>
            </div>
          )}
        </div>
      )}

      {!selectedId && (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <span className="text-4xl block mb-3">📂</span>
          <h3 className="font-semibold mb-1">Select a Server</h3>
          <p className="text-text-secondary text-sm">Choose a server from the dropdown to browse its files</p>
        </div>
      )}
    </div>
  );
}
