"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { GAME_TEMPLATES } from "@/lib/game-installer";

interface ServerData {
  id: number;
  name: string;
  port: number;
  slots: number;
  status: string;
  installStatus: string;
  installLog: string | null;
  ip6Bind: boolean;
  configData: Record<string, unknown> | null;
  createdAt: string;
  game?: { id: number; name: string; slug: string; startCommand: string | null };
  node?: { id: number; name: string; ipAddress: string; ip6Address?: string | null; ip6Enabled?: boolean; location: string | null };
}

function formatIPPort(ip: string, port: number): string {
  // IPv6 addresses contain colons and need bracket notation
  if (ip.includes(":")) return `[${ip}]:${port}`;
  return `${ip}:${port}`;
}

export default function ServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [server, setServer] = useState<ServerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "console" | "config" | "files">("overview");

  useEffect(() => {
    fetch(`/api/servers/${id}`)
      .then(r => r.json())
      .then(data => { setServer(data.server); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  const handleAction = async (action: string) => {
    setActionLoading(action);
    let newStatus = server?.status || "stopped";

    if (action === "start") newStatus = "running";
    else if (action === "stop") newStatus = "stopped";
    else if (action === "restart") newStatus = "running";

    if (action === "delete") {
      if (!confirm("Are you sure you want to delete this server?")) {
        setActionLoading("");
        return;
      }
      await fetch(`/api/servers/${id}`, { method: "DELETE" });
      router.push("/servers");
      return;
    }

    if (action === "reinstall") {
      await fetch(`/api/servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "installing", installStatus: "installing" }),
      });
      await fetch(`/api/servers/${id}/install`, { method: "POST" });
      const data = await fetch(`/api/servers/${id}`).then(r => r.json());
      setServer(data.server);
      setActionLoading("");
      return;
    }

    await fetch(`/api/servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });

    const data = await fetch(`/api/servers/${id}`).then(r => r.json());
    setServer(data.server);
    setActionLoading("");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!server) {
    return <div className="text-center py-16 text-dark-300">Server not found</div>;
  }

  const tmpl = GAME_TEMPLATES.find(t => t.slug === server.game?.slug);
  const statusColors: Record<string, string> = {
    running: "text-green-400 bg-green-500/10 border-green-500/30",
    stopped: "text-gray-400 bg-gray-500/10 border-gray-500/30",
    installing: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    error: "text-red-400 bg-red-500/10 border-red-500/30",
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-dark-700 flex items-center justify-center text-4xl">
            {tmpl?.iconEmoji || "🎮"}
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">{server.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-dark-300">{server.game?.name}</span>
              <span className="text-dark-500">•</span>
              <span className={`px-3 py-1 rounded-full text-xs font-medium border ${statusColors[server.status] || statusColors.stopped}`}>
                {server.status}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {server.status === "stopped" && (
            <button
              onClick={() => handleAction("start")}
              disabled={!!actionLoading}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-50"
            >
              {actionLoading === "start" ? "Starting..." : "▶ Start"}
            </button>
          )}
          {server.status === "running" && (
            <>
              <button
                onClick={() => handleAction("restart")}
                disabled={!!actionLoading}
                className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-50"
              >
                {actionLoading === "restart" ? "Restarting..." : "🔄 Restart"}
              </button>
              <button
                onClick={() => handleAction("stop")}
                disabled={!!actionLoading}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-50"
              >
                {actionLoading === "stop" ? "Stopping..." : "⏹ Stop"}
              </button>
            </>
          )}
          <button
            onClick={() => handleAction("reinstall")}
            disabled={!!actionLoading}
            className="px-4 py-2 bg-dark-600 hover:bg-dark-500 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-50"
          >
            📦 Reinstall
          </button>
          <button
            onClick={() => handleAction("delete")}
            disabled={!!actionLoading}
            className="px-4 py-2 bg-dark-600 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-all disabled:opacity-50"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-dark-800 rounded-xl p-1 w-fit">
        {(["overview", "console", "config", "files"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
              activeTab === tab ? "bg-brand-500 text-white" : "text-dark-300 hover:text-white"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">Server Information</h3>
            <div className="space-y-4">
              {[
                { label: "Server ID", value: `#${server.id}` },
                { label: "Game", value: server.game?.name || "Unknown" },
                { label: "Node", value: server.node?.name || "N/A" },
                { label: "IPv4 Address", value: formatIPPort(server.node?.ipAddress || "0.0.0.0", server.port) },
                ...(server.node?.ip6Address && server.node?.ip6Enabled
                  ? [{ label: "IPv6 Address", value: formatIPPort(server.node.ip6Address, server.port) }]
                  : []),
                { label: "Player Slots", value: String(server.slots) },
                { label: "IPv6 Bind", value: server.ip6Bind ? "Enabled" : "Disabled" },
                { label: "Install Status", value: server.installStatus },
                { label: "Location", value: server.node?.location || "N/A" },
                { label: "Created", value: new Date(server.createdAt).toLocaleString() },
              ].map((item, i) => (
                <div key={i} className="flex justify-between items-center py-2 border-b border-dark-600 last:border-0">
                  <span className="text-dark-300 text-sm">{item.label}</span>
                  <span className={`text-sm font-medium ${item.label.includes("IPv6") ? "text-accent-400 font-mono" : "text-white"}`}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">Resource Usage</h3>
            <div className="space-y-6">
              {[
                { label: "CPU", value: server.status === "running" ? 23 : 0, color: "from-brand-500 to-brand-600" },
                { label: "RAM", value: server.status === "running" ? 45 : 0, color: "from-accent-500 to-accent-600" },
                { label: "Disk", value: 32, color: "from-purple-500 to-purple-600" },
                { label: "Network", value: server.status === "running" ? 12 : 0, color: "from-green-500 to-green-600" },
              ].map((res, i) => (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-dark-300">{res.label}</span>
                    <span className="text-white font-medium">{res.value}%</span>
                  </div>
                  <div className="w-full h-2 bg-dark-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${res.color} rounded-full transition-all duration-1000`}
                      style={{ width: `${res.value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "console" && (
        <div className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">Server Console</h3>
          <div className="bg-dark-900 rounded-xl p-4 h-80 overflow-y-auto font-mono text-xs">
            {server.status === "running" ? (
              <>
                <div className="text-green-400">[INFO] Server started on port {server.port}</div>
                <div className="text-gray-400">[INFO] Loading world...</div>
                <div className="text-gray-400">[INFO] World loaded successfully</div>
                <div className="text-green-400">[INFO] Server is ready! Listening for connections...</div>
                <div className="text-gray-400">[INFO] 0/{server.slots} players online</div>
                <div className="text-brand-400 animate-pulse mt-2">▌</div>
              </>
            ) : server.installLog ? (
              server.installLog.split("\n").map((line, i) => (
                <div key={i} className={line.startsWith("[OK]") ? "text-green-400" : "text-gray-400"}>
                  {line}
                </div>
              ))
            ) : (
              <div className="text-dark-400">Server is offline. Start the server to view console output.</div>
            )}
          </div>
          {server.status === "running" && (
            <div className="mt-4 flex gap-2">
              <input
                type="text"
                placeholder="Enter command..."
                className="flex-1 px-4 py-2 bg-dark-800 border border-dark-500 rounded-xl text-white text-sm focus:outline-none focus:border-brand-500"
              />
              <button className="px-6 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-sm font-medium transition-all">
                Send
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "config" && (
        <div className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">Server Configuration</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-dark-300 mb-2">Start Command</label>
              <input
                type="text"
                value={server.game?.startCommand || ""}
                readOnly
                className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white font-mono text-sm"
              />
            </div>
            {server.configData && typeof server.configData === "object" && Object.entries(server.configData as Record<string, unknown>).map(([key, val]) => (
              <div key={key}>
                <label className="block text-sm text-dark-300 mb-2 capitalize">{key.replace(/([A-Z])/g, " $1")}</label>
                <input
                  type="text"
                  defaultValue={String(val)}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white text-sm focus:outline-none focus:border-brand-500"
                />
              </div>
            ))}
            <button className="px-6 py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-xl font-medium transition-all">
              Save Configuration
            </button>
          </div>
        </div>
      )}

      {activeTab === "files" && (
        <div className="glass-card rounded-2xl p-6">
          <h3 className="text-lg font-bold text-white mb-4">File Manager</h3>
          <div className="bg-dark-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-dark-700 border-b border-dark-600 text-sm text-dark-300 font-mono">
              /servers/{server.id}/
            </div>
            {[
              { name: "server.cfg", size: "2.4 KB", type: "file" },
              { name: "logs/", size: "—", type: "folder" },
              { name: "plugins/", size: "—", type: "folder" },
              { name: "world/", size: "—", type: "folder" },
              { name: "start.sh", size: "512 B", type: "file" },
              { name: "server.properties", size: "1.1 KB", type: "file" },
            ].map((file, i) => (
              <div key={i} className="px-4 py-3 border-b border-dark-700 flex items-center gap-3 hover:bg-dark-700/50 transition-colors cursor-pointer">
                <span>{file.type === "folder" ? "📁" : "📄"}</span>
                <span className="text-white text-sm flex-1">{file.name}</span>
                <span className="text-dark-400 text-xs">{file.size}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
