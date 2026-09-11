"use client";

import { useEffect, useState, useCallback } from "react";
import MetricsChart from "@/components/MetricsChart";
import type { MetricPoint } from "@/lib/metrics-history";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/ToastProvider";

interface CapacityInfo {
  nodeId: number;
  disk: { usedPct: number | null; days: number | null; tone: string; label: string };
  ram: { usedPct: number | null; days: number | null; tone: string; label: string };
}

interface NodeAnomalies {
  cpu: Array<{ t: number; v: number; z: number }>;
  ram: Array<{ t: number; v: number; z: number }>;
}

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
  maintenanceMode: boolean | null;
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

interface MaintenanceWindowInfo {
  id: number;
  nodeId: number;
  nodeName: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  applied: boolean;
}

export default function NodesPanel({ user }: { user: AuthUser }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [capacity, setCapacity] = useState<Record<number, CapacityInfo>>({});
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
  const [testingNode, setTestingNode] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ nodeId: number; ok: boolean; text: string } | null>(null);
  const [deployingNode, setDeployingNode] = useState<number | null>(null);
  const [nodeHist, setNodeHist] = useState<{ cpu: MetricPoint[]; ram: MetricPoint[]; samples: number; anomalies?: NodeAnomalies } | null>(null);
  const [nodeHistRange, setNodeHistRange] = useState(6);
  const [nodeHistLoading, setNodeHistLoading] = useState(false);
  const [nodeHistId, setNodeHistId] = useState<number | null>(null);

  const [maintWindows, setMaintWindows] = useState<MaintenanceWindowInfo[]>([]);
  const [mwStart, setMwStart] = useState("");
  const [mwEnd, setMwEnd] = useState("");
  const [mwReason, setMwReason] = useState("");
  const [mwBusy, setMwBusy] = useState(false);

  async function loadMaintenanceWindows() {
    try {
      const res = await fetch("/api/maintenance-windows");
      const data = await res.json().catch(() => null);
      if (res.ok) setMaintWindows(data?.windows ?? []);
    } catch { /* panel keeps working */ }
  }

  async function scheduleMaintenanceWindow(nodeId: number) {
    if (!mwStart || !mwEnd || mwBusy) return;
    setMwBusy(true);
    try {
      const res = await fetch("/api/maintenance-windows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId,
          startsAt: new Date(mwStart).toISOString(),
          endsAt: new Date(mwEnd).toISOString(),
          reason: mwReason.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success("Maintenance scheduled", "The node will drain automatically at the window start and release itself at the end.");
        setMwStart(""); setMwEnd(""); setMwReason("");
        void loadMaintenanceWindows();
      } else {
        toast.error("Scheduling failed", data?.error || "Invalid maintenance window");
      }
    } catch (e) {
      toast.error("Scheduling failed", e instanceof Error ? e.message : "Network error");
    } finally { setMwBusy(false); }
  }

  async function cancelMaintenanceWindow(id: number) {
    if (mwBusy) return;
    setMwBusy(true);
    try {
      const res = await fetch(`/api/maintenance-windows/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (res.ok) void loadMaintenanceWindows();
      else toast.error("Cancel failed", data?.error || "Could not cancel the window");
    } finally { setMwBusy(false); }
  }

  async function loadNodeHistory(nodeId: number, hours: number) {
    setNodeHistLoading(true);
    setNodeHist(null);
    try {
      const res = await fetch(`/api/nodes/${nodeId}/metrics?hours=${hours}`);
      const data = await res.json();
      if (res.ok) setNodeHist({ cpu: data.cpu || [], ram: data.ram || [], samples: data.samples || 0, anomalies: data.anomalies || { cpu: [], ram: [] } });
    } catch { /* leave empty */ }
    finally { setNodeHistLoading(false); }
  }

  function toggleNodeHistory(nodeId: number) {
    if (nodeHistId === nodeId) { setNodeHistId(null); setNodeHist(null); return; }
    setNodeHistId(nodeId);
    void loadNodeHistory(nodeId, nodeHistRange);
  }
  const [editingNode, setEditingNode] = useState<Node | null>(null);
  const [editForm, setEditForm] = useState({ name: "", hostname: "", ipv4: "", ipv6: "", sshPort: "22", maxServers: "10", maxRamMb: "16384", gameServerPath: "", location: "", provider: "", description: "" });

  const loadNodes = useCallback(async () => {
    try {
      const res = await fetch("/api/nodes");
      const data = await res.json();
      setNodes(data.nodes || []);
      fetch("/api/nodes/capacity")
        .then(async (r) => {
          if (!r.ok) return;
          const cap = await r.json();
          const map: Record<number, CapacityInfo> = {};
          for (const n of cap.nodes || []) map[n.nodeId] = n;
          setCapacity(map);
        })
        .catch(() => undefined);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadNodes();
      void loadMaintenanceWindows();
    }, 0);

    const interval = window.setInterval(() => {
      void loadNodes();
      void loadMaintenanceWindows();
    }, 30000);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
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
    const ok = await confirm({ title: "Delete Node", message: "Delete this node? This cannot be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;

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

  async function testNode(id: number) {
    setTestingNode(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/nodes/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ nodeId: id, ok: false, text: data.error || "Connection failed" });
      } else {
        setTestResult({ nodeId: id, ok: true, text: data.message || "Agent reachable" });
      }
    } catch (e) {
      setTestResult({ nodeId: id, ok: false, text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setTestingNode(null);
    }
  }

  async function deployAgent(id: number) {
    const ok = await confirm({ title: "Deploy Agent", message: "Copy the node agent to this machine over SSH and start it as a user service? The node needs its SSH user and a key path or password.", confirmLabel: "Deploy" });
    if (!ok) return;
    setDeployingNode(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/nodes/${id}/deploy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ nodeId: id, ok: false, text: data.error || "Deploy failed" });
      } else {
        setTestResult({ nodeId: id, ok: true, text: data.message || "Agent deployed" });
        loadNodes();
      }
    } catch (e) {
      setTestResult({ nodeId: id, ok: false, text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setDeployingNode(null);
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

  async function toggleMaintenance(node: Node) {
    const next = !node.maintenanceMode;
    try {
      const res = await fetch(`/api/nodes/${node.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maintenanceMode: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error("Maintenance mode", data?.error || "Could not update the node");
        return;
      }
      toast.success(
        "Maintenance mode",
        next ? `${node.name} is drained — no new servers will be placed on it.` : `${node.name} is accepting new servers again.`
      );
      loadNodes();
    } catch {
      toast.error("Maintenance mode", "Could not update the node");
    }
  }

  const hasLocalNode = nodes.some((n) => n.isLocal);

  return (
    <div className="animate-fade-in panel-view space-y-6">
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
        <form onSubmit={createNode} className="gaming-surface rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Add Remote Node</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Node Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
                required
                placeholder="US East Server"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Hostname *</label>
              <input
                value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
                required
                placeholder="node1.example.com"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">IPv4 Address</label>
              <input
                value={form.ipv4}
                onChange={(e) => setForm({ ...form, ipv4: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
                placeholder="192.168.1.100"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">IPv6 Address</label>
              <input
                value={form.ipv6}
                onChange={(e) => setForm({ ...form, ipv6: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
                placeholder="2001:db8::1"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">SSH Port</label>
              <input
                type="number"
                value={form.sshPort}
                onChange={(e) => setForm({ ...form, sshPort: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">SSH User</label>
              <input
                value={form.sshUser}
                onChange={(e) => setForm({ ...form, sshUser: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">SSH Key Path</label>
              <input
                value={form.sshKeyPath}
                onChange={(e) => setForm({ ...form, sshKeyPath: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
                placeholder="/root/.ssh/id_rsa"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Max Servers</label>
              <input
                type="number"
                value={form.maxServers}
                onChange={(e) => setForm({ ...form, maxServers: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Max RAM (MB)</label>
              <input
                type="number"
                value={form.maxRamMb}
                onChange={(e) => setForm({ ...form, maxRamMb: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Game Server Path</label>
              <input
                value={form.gameServerPath}
                onChange={(e) => setForm({ ...form, gameServerPath: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Location</label>
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
                placeholder="New York, USA"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Provider</label>
              <input
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
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
              className="w-full px-3 py-2 gaming-chip rounded-lg text-sm resize-y"
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
        <div className="gaming-surface rounded-xl p-12 text-center">
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
                      {node.maintenanceMode && <span className="px-1.5 py-0.5 text-[10px] bg-warning/15 text-warning rounded" title="Maintenance mode: new servers are blocked">🔧 Maintenance</span>}
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

              {/* Capacity forecast */}
              {capacity[node.id] && capacity[node.id].disk.usedPct !== null && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] px-2 py-1 rounded-full bg-bg-secondary text-text-muted">
                    💽 Disk {capacity[node.id].disk.usedPct}% · {capacity[node.id].disk.label}
                  </span>
                  {(capacity[node.id].ram.days ?? Infinity) <= 45 && capacity[node.id].ram.days !== null && (
                    <span className={`text-[10px] px-2 py-1 rounded-full ${capacity[node.id].ram.tone === "critical" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning"}`}>
                      🧠 RAM {capacity[node.id].ram.label}
                    </span>
                  )}
                </div>
              )}

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
        <div className="gaming-surface rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{selectedNode.name} — Details</h3>
            <div className="flex gap-2">
              {!selectedNode.isLocal && (
                <button onClick={() => testNode(selectedNode.id)} disabled={testingNode === selectedNode.id} className="px-3 py-1.5 bg-sky-500/15 text-sky-400 rounded-lg text-xs font-medium disabled:opacity-40">
                  {testingNode === selectedNode.id ? "Testing…" : "🔌 Test Connection"}
                </button>
              )}
              {!selectedNode.isLocal && selectedNode.hostname && (
                <button onClick={() => deployAgent(selectedNode.id)} disabled={deployingNode === selectedNode.id} className="px-3 py-1.5 bg-accent/15 text-accent rounded-lg text-xs font-medium disabled:opacity-40" title="Copy the agent over SSH and start it (needs the SSH user + key/password)">
                  {deployingNode === selectedNode.id ? "Deploying…" : "🚀 Deploy Agent"}
                </button>
              )}
              <button onClick={() => startEditNode(selectedNode)} className="px-3 py-1.5 bg-accent/15 text-accent rounded-lg text-xs font-medium">✏️ Edit</button>
              {!selectedNode.isDefault && (
                <button onClick={() => setDefaultNode(selectedNode.id)} className="px-3 py-1.5 bg-success/15 text-success rounded-lg text-xs font-medium">Set as Default</button>
              )}
              <button
                onClick={() => void toggleMaintenance(selectedNode)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${selectedNode.maintenanceMode ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}
                title={selectedNode.maintenanceMode ? "Let this node accept new servers again" : "Drain this node: block new server placements while you work on it"}
              >
                {selectedNode.maintenanceMode ? "✅ End Maintenance" : "🔧 Maintenance Mode"}
              </button>
              <button onClick={() => deleteNode(selectedNode.id)} className="px-3 py-1.5 bg-danger/15 text-danger rounded-lg text-xs font-medium">Delete Node</button>
            </div>
          </div>
          {testResult && testResult.nodeId === selectedNode.id && (
            <div className={`mb-4 rounded-lg border p-3 text-sm ${testResult.ok ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"}`}>
              {testResult.ok ? "✅ " : "❌ "}{testResult.text}
            </div>
          )}
          {/* Maintenance windows */}
          <div className="mb-4 rounded-lg border border-border bg-bg-secondary/40 p-3 space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="font-semibold text-sm">🗓️ Scheduled maintenance windows</h4>
            </div>
            {maintWindows.filter((w) => w.nodeId === selectedNode.id).length === 0 ? (
              <p className="text-xs text-text-muted">No upcoming windows for this node. Schedule one below — it drains the node automatically at the start and releases it at the end.</p>
            ) : (
              <div className="space-y-1">
                {maintWindows.filter((w) => w.nodeId === selectedNode.id).map((w) => (
                  <div key={w.id} className="flex items-center gap-2 flex-wrap rounded-lg bg-bg-card px-3 py-2">
                    <span className="flex-1 min-w-[180px] text-xs text-text-secondary">
                      {new Date(w.startsAt).toLocaleString()} → {new Date(w.endsAt).toLocaleString()}
                      {w.reason ? <span className="text-text-muted"> · {w.reason}</span> : null}
                      {w.applied ? <span className="ml-2 px-1.5 py-0.5 rounded-full bg-warning/15 text-warning text-[10px]">active</span> : null}
                    </span>
                    <button onClick={() => void cancelMaintenanceWindow(w.id)} disabled={mwBusy} className="text-xs text-text-muted hover:text-danger disabled:opacity-40">Cancel</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <input type="datetime-local" value={mwStart} onChange={(e) => setMwStart(e.target.value)} className="rounded-lg border border-border bg-bg-card px-2 py-1.5 text-xs text-text-secondary" />
              <span className="text-text-muted text-xs">→</span>
              <input type="datetime-local" value={mwEnd} onChange={(e) => setMwEnd(e.target.value)} className="rounded-lg border border-border bg-bg-card px-2 py-1.5 text-xs text-text-secondary" />
              <input value={mwReason} onChange={(e) => setMwReason(e.target.value)} placeholder="Reason (optional), e.g. kernel upgrade" maxLength={200} className="min-w-[180px] flex-1 rounded-lg border border-border bg-bg-card px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted" />
              <button
                onClick={() => void scheduleMaintenanceWindow(selectedNode.id)}
                disabled={mwBusy || !mwStart || !mwEnd}
                className="rounded-lg bg-warning/15 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/25 disabled:opacity-40"
              >{mwBusy ? "Working…" : "Schedule"}</button>
            </div>
            <p className="text-[10px] text-text-muted">Max 24h. Windows apply on the scheduler tick (~30s); a window that was never reached is simply skipped, never applied late.</p>
          </div>

          {/* Resource history */}
          <div className="border-t border-border pt-4 mt-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h4 className="font-semibold text-sm">📈 Resource history</h4>
                {nodeHistId !== null && (
                  <a href={`/api/nodes/${nodeHistId}/metrics?hours=${nodeHistRange}&format=csv`} className="text-[11px] px-2 py-1 rounded-lg bg-bg-tertiary text-text-secondary hover:bg-bg-hover font-medium">⬇ CSV</a>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {[{ h: 1, l: "1h" }, { h: 6, l: "6h" }, { h: 24, l: "24h" }].map((r) => (
                  <button key={r.h} onClick={() => { setNodeHistRange(r.h); if (nodeHistId === selectedNode.id) void loadNodeHistory(selectedNode.id, r.h); }} className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${nodeHistRange === r.h ? "bg-accent text-white" : "bg-bg-secondary text-text-secondary hover:text-text-primary border border-border"}`}>{r.l}</button>
                ))}
                <button onClick={() => toggleNodeHistory(selectedNode.id)} className="ml-2 rounded-lg border border-border bg-bg-secondary px-3 py-1 text-[11px] font-medium text-text-secondary hover:border-accent/40 hover:text-accent transition-colors">
                  {nodeHistId === selectedNode.id ? "Hide" : "Load charts"}
                </button>
              </div>
            </div>
            {nodeHistId === selectedNode.id && (
              nodeHistLoading ? (
                <p className="text-xs text-text-muted mt-3">Loading samples…</p>
              ) : nodeHist ? (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <MetricsChart points={nodeHist.cpu} color="#38bdf8" label="CPU load" unit="%" />
                    <MetricsChart points={nodeHist.ram} color="#a78bfa" label="RAM used" unit="%" />
                  </div>
                  <p className="text-[10px] text-text-muted">{nodeHist.samples.toLocaleString()} heartbeat samples in window · sent every 15 seconds{selectedNode.isLocal ? " by the panel itself" : " by the node agent"}</p>
                  {(() => {
                    const cpuA = nodeHist.anomalies?.cpu ?? [];
                    const ramA = nodeHist.anomalies?.ram ?? [];
                    if (cpuA.length === 0 && ramA.length === 0) return (
                      <p className="text-[10px] text-text-muted">✅ No unusual spikes detected in this window.</p>
                    );
                    return (
                      <div className="rounded-lg border border-warning/30 bg-warning/10 p-2.5">
                        <p className="text-[11px] font-medium text-warning">⚠️ Unusual spikes in this window: {cpuA.length > 0 ? `${cpuA.length} CPU` : ""}{cpuA.length > 0 && ramA.length > 0 ? " · " : ""}{ramA.length > 0 ? `${ramA.length} RAM` : ""}</p>
                        <p className="text-[10px] text-text-muted mt-1">Latest: {[...cpuA.map((a) => ({ ...a, kind: "CPU" })), ...ramA.map((a) => ({ ...a, kind: "RAM" }))].sort((a, b) => b.t - a.t).slice(0, 3).map((a) => `${a.kind} ${Math.round(a.v)}% @ ${new Date(a.t).toLocaleTimeString()} (z=${a.z})`).join(" · ")}</p>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <p className="text-xs text-text-muted mt-3">No samples yet — the agent sends heartbeats every 15 seconds once deployed.</p>
              )
            )}
          </div>

          {/* Edit form */}
          {editingNode?.id === selectedNode.id && (
            <div className="border-t border-border pt-4 mt-4 space-y-4">
              <h4 className="font-semibold text-sm">Edit Node</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><label className="block text-xs text-text-muted mb-1">Name</label><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 gaming-chip rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Hostname</label><input value={editForm.hostname} onChange={(e) => setEditForm({ ...editForm, hostname: e.target.value })} className="w-full px-3 py-2 gaming-chip rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">IPv4</label><input value={editForm.ipv4} onChange={(e) => setEditForm({ ...editForm, ipv4: e.target.value })} className="w-full px-3 py-2 gaming-chip rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">SSH Port</label><input type="number" value={editForm.sshPort} onChange={(e) => setEditForm({ ...editForm, sshPort: e.target.value })} className="w-full px-3 py-2 gaming-chip rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Max Servers</label><input type="number" value={editForm.maxServers} onChange={(e) => setEditForm({ ...editForm, maxServers: e.target.value })} className="w-full px-3 py-2 gaming-chip rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Max RAM (MB)</label><input type="number" value={editForm.maxRamMb} onChange={(e) => setEditForm({ ...editForm, maxRamMb: e.target.value })} className="w-full px-3 py-2 gaming-chip rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Game Server Path</label><input value={editForm.gameServerPath} onChange={(e) => setEditForm({ ...editForm, gameServerPath: e.target.value })} className="w-full px-3 py-2 gaming-chip rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Location</label><input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} className="w-full px-3 py-2 gaming-chip rounded-lg text-sm" /></div>
                <div><label className="block text-xs text-text-muted mb-1">Provider</label><input value={editForm.provider} onChange={(e) => setEditForm({ ...editForm, provider: e.target.value })} className="w-full px-3 py-2 gaming-chip rounded-lg text-sm" /></div>
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
