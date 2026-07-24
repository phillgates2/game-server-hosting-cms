"use client";

import { useEffect, useState, useCallback } from "react";

interface NodeMetrics {
  cpuPercent: number | null;
  cpuLoad1: number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  diskUsedMb: number | null;
  diskTotalMb: number | null;
  ipv6Enabled: boolean | null;
  recordedAt: string;
}

interface Node {
  id: number;
  name: string;
  description: string | null;
  hostname: string;
  ipv4: string | null;
  ipv6: string | null;
  sshPort: number | null;
  status: string;
  isLocal: boolean | null;
  isDefault: boolean | null;
  maxServers: number | null;
  maxRamMb: number | null;
  maxDiskMb: number | null;
  gameServerPath: string | null;
  location: string | null;
  provider: string | null;
  lastHeartbeat: string | null;
  createdAt: string;
  serverCount: number;
  runningServers: number;
  metrics: NodeMetrics | null;
}

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

export default function NodesPanel({ user }: { user: AuthUser }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    hostname: "",
    ipv4: "",
    ipv6: "",
    sshPort: "22",
    sshUser: "root",
    sshKeyPath: "",
    maxServers: "10",
    maxRamMb: "16384",
    gameServerPath: "/opt/gameservers",
    location: "",
    provider: "",
    isDefault: false,
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [editingNode, setEditingNode] = useState<Node | null>(null);
  const [editForm, setEditForm] = useState({ name: "", hostname: "", ipv4: "", ipv6: "", sshPort: "22", maxServers: "10", maxRamMb: "16384", gameServerPath: "", location: "", provider: "", description: "" });

  const loadNodes = useCallback(async () => {
    try {
      const res = await fetch("/api/nodes");
      const data = await res.json();
      setNodes(data.nodes || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadNodes();
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadNodes, 30000);
    return () => clearInterval(interval);
  }, [loadNodes]);

  async function createLocalNode() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/nodes/local", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error });
      } else {
        setMessage({ type: "success", text: "Local node created successfully!" });
        loadNodes();
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setLoading(false);
    }
  }

  async function createNode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          sshPort: parseInt(form.sshPort),
          maxServers: parseInt(form.maxServers),
          maxRamMb: parseInt(form.maxRamMb),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: "error", text: data.error });
      } else {
        setMessage({ type: "success", text: "Node created successfully!" });
        setShowCreate(false);
        setForm({
          name: "",
          description: "",
          hostname: "",
          ipv4: "",
          ipv6: "",
          sshPort: "22",
          sshUser: "root",
          sshKeyPath: "",
          maxServers: "10",
          maxRamMb: "16384",
          gameServerPath: "/opt/gameservers",
          location: "",
          provider: "",
          isDefault: false,
        });
        loadNodes();
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setLoading(false);
    }
  }

  function startEditNode(node: Node) {
    setEditingNode(node);
    setEditForm({
      name: node.name, hostname: node.hostname, ipv4: node.ipv4 || "", ipv6: node.ipv6 || "",
      sshPort: String(node.sshPort || 22), maxServers: String(node.maxServers || 10),
      maxRamMb: String(node.maxRamMb || 16384), gameServerPath: node.gameServerPath || "",
      location: node.location || "", provider: node.provider || "", description: node.description || "",
    });
  }

  async function saveEditNode() {
    if (!editingNode) return;
    setMessage(null);
    try {
      const res = await fetch(`/api/nodes/${editingNode.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name, hostname: editForm.hostname, ipv4: editForm.ipv4 || null, ipv6: editForm.ipv6 || null,
          sshPort: parseInt(editForm.sshPort), maxServers: parseInt(editForm.maxServers), maxRamMb: parseInt(editForm.maxRamMb),
          gameServerPath: editForm.gameServerPath, location: editForm.location || null, provider: editForm.provider || null,
          description: editForm.description || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) setMessage({ type: "error", text: data.error });
      else { setMessage({ type: "success", text: `Node "${editForm.name}" updated` }); setEditingNode(null); loadNodes(); }
    } catch (e) { setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" }); }
  }

  async function deleteNode(id: number) {
    if (!confirm("Delete this node? This cannot be undone.")) return;

    try {
      const res = await fetch(`/api/nodes/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error });
      } else {
        setMessage({ type: "success", text: "Node deleted" });
        setSelectedNode(null);
        loadNodes();
      }
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function setDefaultNode(id: number) {
    try {
      await fetch(`/api/nodes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      loadNodes();
    } catch {
      // ignore
    }
  }

  const hasLocalNode = nodes.some((n) => n.isLocal);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">🖥️ Server Nodes</h2>
          <p className="text-text-secondary text-sm">Manage multiple servers for hosting game servers</p>
        </div>
        <div className="flex gap-2">
          {!hasLocalNode && user.role === "admin" && (
            <button
              onClick={createLocalNode}
              disabled={loading}
              className="px-4 py-2 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
            >
              + Add Local Node
            </button>
          )}
          {user.role === "admin" && (
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
            >
              {showCreate ? "Cancel" : "+ Add Remote Node"}
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className={`p-4 rounded-lg text-sm ${message.type === "success" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
          {message.text}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={createNode} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Add Remote Node</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Node Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
                required
                placeholder="US East Server"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Hostname *</label>
              <input
                value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
                required
                placeholder="node1.example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">IPv4 Address</label>
              <input
                value={form.ipv4}
                onChange={(e) => setForm({ ...form, ipv4: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
                placeholder="192.168.1.100"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">IPv6 Address</label>
              <input
                value={form.ipv6}
                onChange={(e) => setForm({ ...form, ipv6: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
                placeholder="2001:db8::1"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">SSH Port</label>
              <input
                type="number"
                value={form.sshPort}
                onChange={(e) => setForm({ ...form, sshPort: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">SSH User</label>
              <input
                value={form.sshUser}
                onChange={(e) => setForm({ ...form, sshUser: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">SSH Key Path</label>
              <input
                value={form.sshKeyPath}
                onChange={(e) => setForm({ ...form, sshKeyPath: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
                placeholder="/root/.ssh/id_rsa"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Max Servers</label>
              <input
                type="number"
                value={form.maxServers}
                onChange={(e) => setForm({ ...form, maxServers: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Max RAM (MB)</label>
              <input
                type="number"
                value={form.maxRamMb}
                onChange={(e) => setForm({ ...form, maxRamMb: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Game Server Path</label>
              <input
                value={form.gameServerPath}
                onChange={(e) => setForm({ ...form, gameServerPath: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Location</label>
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
                placeholder="New York, USA"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Provider</label>
              <input
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
                placeholder="Hetzner, OVH, etc."
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                className="rounded"
              />
              Set as default node
            </label>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm resize-y"
              rows={2}
              placeholder="Optional description"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            {loading ? "Creating..." : "Create Node"}
          </button>
        </form>
      )}

      {/* Node list */}
      {nodes.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <span className="text-4xl block mb-3">🖥️</span>
          <h3 className="text-lg font-semibold mb-1">No nodes configured</h3>
          <p className="text-text-secondary text-sm mb-4">
            Add a node to start hosting game servers
          </p>
          {!hasLocalNode && user.role === "admin" && (
            <button
              onClick={createLocalNode}
              disabled={loading}
              className="px-4 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium"
            >
              + Add This Server as Local Node
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {nodes.map((node) => (
            <div
              key={node.id}
              onClick={() => setSelectedNode(selectedNode?.id === node.id ? null : node)}
              className={`bg-bg-card border rounded-xl p-5 cursor-pointer transition-all hover:shadow-lg ${
                selectedNode?.id === node.id ? "border-accent" : "border-border hover:border-accent/30"
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${node.status === "online" ? "bg-success" : "bg-danger"}`} />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{node.name}</h3>
                      {node.isLocal && <span className="px-1.5 py-0.5 text-[10px] bg-accent/15 text-accent rounded">Local</span>}
                      {node.isDefault && <span className="px-1.5 py-0.5 text-[10px] bg-success/15 text-success rounded">Default</span>}
                    </div>
                    <p className="text-xs text-text-muted">{node.hostname}</p>
                  </div>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded ${
                  node.status === "online" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"
                }`}>
                  {node.status}
                </span>
              </div>

              {/* Quick stats */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-bg-secondary rounded-lg p-2">
                  <p className="text-lg font-bold text-accent">{node.serverCount}</p>
                  <p className="text-[10px] text-text-muted">Servers</p>
                </div>
                <div className="bg-bg-secondary rounded-lg p-2">
                  <p className="text-lg font-bold text-success">{node.runningServers}</p>
                  <p className="text-[10px] text-text-muted">Running</p>
                </div>
                <div className="bg-bg-secondary rounded-lg p-2">
                  <p className="text-lg font-bold text-purple">
                    {node.metrics ? `${Math.round((node.metrics.ramUsedMb || 0) / (node.metrics.ramTotalMb || 1) * 100)}%` : "—"}
                  </p>
                  <p className="text-[10px] text-text-muted">RAM</p>
                </div>
              </div>

              {/* Metrics bar */}
              {node.metrics && (
                <div className="mt-3 space-y-2">
                  <div>
                    <div className="flex justify-between text-[10px] text-text-muted mb-0.5">
                      <span>CPU</span>
                      <span>{node.metrics.cpuLoad1?.toFixed(2) || 0}</span>
                    </div>
                    <div className="h-1.5 bg-bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent rounded-full"
                        style={{ width: `${Math.min((node.metrics.cpuLoad1 || 0) * 25, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] text-text-muted mb-0.5">
                      <span>RAM</span>
                      <span>{Math.round(node.metrics.ramUsedMb || 0)} / {Math.round(node.metrics.ramTotalMb || 0)} MB</span>
                    </div>
                    <div className="h-1.5 bg-bg-secondary rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple rounded-full"
                        style={{ width: `${(node.metrics.ramUsedMb || 0) / (node.metrics.ramTotalMb || 1) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Location info */}
              <div className="mt-3 flex gap-3 text-xs text-text-muted">
                {node.location && <span>📍 {node.location}</span>}
                {node.provider && <span>☁️ {node.provider}</span>}
                {node.ipv4 && <span>🌐 {node.ipv4}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Selected node details */}
      {selectedNode && user.role === "admin" && (
        <div className="bg-bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{selectedNode.name} — Details</h3>
            <div className="flex gap-2">
              <button onClick={() => startEditNode(selectedNode)} className="px-3 py-1.5 bg-accent/15 text-accent rounded-lg text-xs font-medium">✏️ Edit</button>
              {!selectedNode.isDefault && (
                <button onClick={() => setDefaultNode(selectedNode.id)} className="px-3 py-1.5 bg-success/15 text-success rounded-lg text-xs font-medium">Set as Default</button>
              )}
              <button onClick={() => deleteNode(selectedNode.id)} className="px-3 py-1.5 bg-danger/15 text-danger rounded-lg text-xs font-medium">Delete Node</button>
            </div>
          </div>
          {/* Edit form */}
          {editingNode?.id === selectedNode.id && (
            <div className="border-t border-border pt-4 mt-4 space-y-4">
              <h4 className="font-semibold text-sm">Edit Node</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><label className="block text-xs text-text-muted mb-1">Name</label><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Hostname</label><input value={editForm.hostname} onChange={(e) => setEditForm({ ...editForm, hostname: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">IPv4</label><input value={editForm.ipv4} onChange={(e) => setEditForm({ ...editForm, ipv4: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">SSH Port</label><input type="number" value={editForm.sshPort} onChange={(e) => setEditForm({ ...editForm, sshPort: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Max Servers</label><input type="number" value={editForm.maxServers} onChange={(e) => setEditForm({ ...editForm, maxServers: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Max RAM (MB)</label><input type="number" value={editForm.maxRamMb} onChange={(e) => setEditForm({ ...editForm, maxRamMb: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Game Server Path</label><input value={editForm.gameServerPath} onChange={(e) => setEditForm({ ...editForm, gameServerPath: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Location</label><input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Provider</label><input value={editForm.provider} onChange={(e) => setEditForm({ ...editForm, provider: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" /></div>
              </div>
              <div className="flex gap-2">
                <button onClick={saveEditNode} className="px-4 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">Save Changes</button>
                <button onClick={() => setEditingNode(null)} className="px-4 py-2 bg-bg-secondary border border-border text-text-primary rounded-lg text-sm font-medium">Cancel</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-text-muted text-xs">Hostname</p>
              <p className="font-mono">{selectedNode.hostname}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">IPv4</p>
              <p className="font-mono">{selectedNode.ipv4 || "—"}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">IPv6</p>
              <p className="font-mono text-xs">{selectedNode.ipv6 || "—"}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">SSH Port</p>
              <p>{selectedNode.sshPort || 22}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">Max Servers</p>
              <p>{selectedNode.maxServers}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">Max RAM</p>
              <p>{selectedNode.maxRamMb} MB</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">Game Path</p>
              <p className="font-mono text-xs">{selectedNode.gameServerPath}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">Last Heartbeat</p>
              <p className="text-xs">{selectedNode.lastHeartbeat ? new Date(selectedNode.lastHeartbeat).toLocaleString() : "Never"}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
