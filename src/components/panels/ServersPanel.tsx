"use client";

import { useEffect, useState, useCallback } from "react";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface GameDef {
  id: number;
  name: string;
  slug: string;
  defaultPort: number;
  iconEmoji: string | null;
}

interface Node {
  id: number;
  name: string;
  hostname: string;
  status: string;
  isDefault: boolean | null;
  gameServerPath: string | null;
}

interface Server {
  id: number;
  name: string;
  ipv4: string | null;
  ipv6: string | null;
  port: number;
  status: string;
  gameName: string | null;
  gameSlug: string | null;
  gameIcon: string | null;
  nodeName: string | null;
  nodeId: number | null;
  autoRestart: boolean | null;
  discordWebhook: string | null;
  createdAt: string;
}

export default function ServersPanel({ user }: { user: AuthUser }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [games, setGames] = useState<GameDef[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    gameId: "",
    nodeId: "",
    port: "",
    ipv4: "0.0.0.0",
    ipv6: "",
    installPath: "/opt/gameservers",
    discordWebhook: "",
    discordNotifyStart: true,
    discordNotifyStop: true,
    discordNotifyRestart: true,
    discordNotifyCrash: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDiscordSettings, setShowDiscordSettings] = useState(false);

  const loadServers = useCallback(async () => {
    const res = await fetch("/api/servers");
    const data = await res.json();
    setServers(data.servers || []);
  }, []);

  const loadGames = useCallback(async () => {
    const res = await fetch("/api/games");
    const data = await res.json();
    setGames(data.games || []);
  }, []);

  const loadNodes = useCallback(async () => {
    const res = await fetch("/api/nodes");
    const data = await res.json();
    const onlineNodes = (data.nodes || []).filter((n: Node) => n.status === "online");
    setNodes(onlineNodes);
    
    // Set default node
    const defaultNode = onlineNodes.find((n: Node) => n.isDefault);
    if (defaultNode && !form.nodeId) {
      setForm((f) => ({
        ...f,
        nodeId: String(defaultNode.id),
        installPath: defaultNode.gameServerPath || "/opt/gameservers",
      }));
    }
  }, [form.nodeId]);

  useEffect(() => {
    loadServers();
    loadGames();
    loadNodes();
  }, [loadServers, loadGames, loadNodes]);

  function onGameChange(gameId: string) {
    const game = games.find((g) => g.id === Number(gameId));
    const selectedNode = nodes.find((n) => n.id === Number(form.nodeId));
    const basePath = selectedNode?.gameServerPath || "/opt/gameservers";
    
    if (game) {
      setForm((f) => ({
        ...f,
        gameId,
        port: game.defaultPort.toString(),
        installPath: `${basePath}/${game.slug}`,
      }));
    } else {
      setForm((f) => ({ ...f, gameId }));
    }
  }

  function onNodeChange(nodeId: string) {
    const node = nodes.find((n) => n.id === Number(nodeId));
    const game = games.find((g) => g.id === Number(form.gameId));
    const basePath = node?.gameServerPath || "/opt/gameservers";
    
    setForm((f) => ({
      ...f,
      nodeId,
      installPath: game ? `${basePath}/${game.slug}` : basePath,
    }));
  }

  async function createServer(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          nodeId: form.nodeId ? Number(form.nodeId) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
      } else {
        setShowCreate(false);
        setForm({
          name: "",
          gameId: "",
          nodeId: nodes.find((n) => n.isDefault)?.id.toString() || "",
          port: "",
          ipv4: "0.0.0.0",
          ipv6: "",
          installPath: "/opt/gameservers",
          discordWebhook: "",
          discordNotifyStart: true,
          discordNotifyStop: true,
          discordNotifyRestart: true,
          discordNotifyCrash: true,
        });
        loadServers();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function deleteServer(id: number) {
    if (!confirm("Delete this server?")) return;
    await fetch(`/api/servers/${id}`, { method: "DELETE" });
    loadServers();
  }

  async function toggleStatus(id: number, currentStatus: string) {
    const newStatus = currentStatus === "running" ? "stopped" : "running";
    await fetch(`/api/servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    loadServers();
  }

  async function testWebhook(webhookUrl: string, serverName: string) {
    if (!webhookUrl) {
      alert("No webhook URL configured");
      return;
    }

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "GameServer Manager",
          embeds: [{
            title: "🔔 Webhook Test",
            description: `This is a test notification from **${serverName}**`,
            color: 0x3b82f6,
            timestamp: new Date().toISOString(),
          }],
        }),
      });
      
      if (res.ok) {
        alert("✅ Webhook test sent successfully!");
      } else {
        alert(`❌ Webhook failed: ${res.status}`);
      }
    } catch (e) {
      alert(`❌ Webhook error: ${e instanceof Error ? e.message : "Unknown"}`);
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">🎮 Game Servers</h2>
          <p className="text-text-secondary text-sm">Manage game servers across all nodes</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
        >
          {showCreate ? "Cancel" : "+ New Server"}
        </button>
      </div>

      {/* Warning if no nodes */}
      {nodes.length === 0 && (
        <div className="bg-warning/15 border border-warning/30 rounded-xl p-4 text-warning text-sm">
          ⚠️ No online nodes available. Add a node from the Nodes panel first.
        </div>
      )}

      {/* Warning if no games */}
      {games.length === 0 && (
        <div className="bg-warning/15 border border-warning/30 rounded-xl p-4 text-warning text-sm">
          ⚠️ No games installed. Install game templates from the Games panel first.
        </div>
      )}

      {/* Create form */}
      {showCreate && nodes.length > 0 && games.length > 0 && (
        <form onSubmit={createServer} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Create New Server</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Server Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                required
                placeholder="My Game Server"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Node *</label>
              <select
                value={form.nodeId}
                onChange={(e) => onNodeChange(e.target.value)}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                required
              >
                <option value="">Select a node</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.hostname}) {n.isDefault ? "★" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Game *</label>
              <select
                value={form.gameId}
                onChange={(e) => onGameChange(e.target.value)}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                required
              >
                <option value="">Select a game</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.iconEmoji} {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Port *</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Install Path</label>
              <input
                value={form.installPath}
                onChange={(e) => setForm({ ...form, installPath: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">IPv4 Address</label>
              <input
                value={form.ipv4}
                onChange={(e) => setForm({ ...form, ipv4: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="0.0.0.0"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">IPv6 Address</label>
              <input
                value={form.ipv6}
                onChange={(e) => setForm({ ...form, ipv6: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="::1"
              />
            </div>
          </div>

          {/* Discord Webhook Section */}
          <div className="border-t border-border pt-4 mt-4">
            <button
              type="button"
              onClick={() => setShowDiscordSettings(!showDiscordSettings)}
              className="flex items-center gap-2 text-sm font-medium text-accent hover:text-accent-hover"
            >
              <span>🔔</span>
              <span>Discord Notifications</span>
              <span className="text-xs text-text-muted">{showDiscordSettings ? "▼" : "▶"}</span>
            </button>

            {showDiscordSettings && (
              <div className="mt-4 space-y-4 animate-fade-in">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Discord Webhook URL</label>
                  <input
                    value={form.discordWebhook}
                    onChange={(e) => setForm({ ...form, discordWebhook: e.target.value })}
                    className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent font-mono"
                    placeholder="https://discord.com/api/webhooks/..."
                  />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.discordNotifyStart}
                      onChange={(e) => setForm({ ...form, discordNotifyStart: e.target.checked })}
                      className="rounded"
                    />
                    <span>Start</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.discordNotifyStop}
                      onChange={(e) => setForm({ ...form, discordNotifyStop: e.target.checked })}
                      className="rounded"
                    />
                    <span>Stop</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.discordNotifyRestart}
                      onChange={(e) => setForm({ ...form, discordNotifyRestart: e.target.checked })}
                      className="rounded"
                    />
                    <span>Restart</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.discordNotifyCrash}
                      onChange={(e) => setForm({ ...form, discordNotifyCrash: e.target.checked })}
                      className="rounded"
                    />
                    <span>Crash</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-danger text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? "Creating..." : "Create Server"}
          </button>
        </form>
      )}

      {/* Server list */}
      {servers.length === 0 ? (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <span className="text-4xl mb-3 block">🎮</span>
          <h3 className="text-lg font-semibold mb-1">No servers yet</h3>
          <p className="text-text-secondary text-sm">Create your first game server to get started</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {servers.map((server) => (
            <div key={server.id} className="bg-bg-card border border-border rounded-xl p-5 hover:border-accent/30 transition-colors">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <span className="text-3xl">{server.gameIcon || "🎮"}</span>
                  <div>
                    <h3 className="font-semibold flex items-center gap-2">
                      {server.name}
                      {server.discordWebhook && (
                        <span className="text-xs bg-[#5865F2]/20 text-[#5865F2] px-1.5 py-0.5 rounded" title="Discord">
                          🔔
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-text-secondary">{server.gameName}</p>
                    <div className="flex gap-3 mt-1 text-xs text-text-muted">
                      {server.nodeName && <span>🖥️ {server.nodeName}</span>}
                      {server.ipv4 && <span>IPv4: {server.ipv4}:{server.port}</span>}
                      {server.ipv6 && <span>IPv6: [{server.ipv6}]:{server.port}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      server.status === "running"
                        ? "bg-success/15 text-success"
                        : server.status === "installing"
                        ? "bg-warning/15 text-warning"
                        : "bg-bg-secondary text-text-muted"
                    }`}
                  >
                    {server.status}
                  </span>
                  <button
                    onClick={() => toggleStatus(server.id, server.status)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      server.status === "running"
                        ? "bg-danger/15 text-danger hover:bg-danger/25"
                        : "bg-success/15 text-success hover:bg-success/25"
                    }`}
                  >
                    {server.status === "running" ? "Stop" : "Start"}
                  </button>
                  {server.discordWebhook && (
                    <button
                      onClick={() => testWebhook(server.discordWebhook!, server.name)}
                      className="px-3 py-1.5 bg-[#5865F2]/15 text-[#5865F2] hover:bg-[#5865F2]/25 rounded-lg text-xs font-medium transition-colors"
                    >
                      Test 🔔
                    </button>
                  )}
                  {user.role === "admin" && (
                    <button
                      onClick={() => deleteServer(server.id)}
                      className="px-3 py-1.5 bg-danger/10 hover:bg-danger/20 text-danger rounded-lg text-xs font-medium transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
