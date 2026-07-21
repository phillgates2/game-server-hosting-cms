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

interface NodeInfo {
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
  const [nodeList, setNodeList] = useState<NodeInfo[]>([]);
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
  const [loaded, setLoaded] = useState(false);
  const [showDiscord, setShowDiscord] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const results = await Promise.allSettled([
        fetch("/api/servers"),
        fetch("/api/games"),
        fetch("/api/nodes"),
      ]);

      if (results[0].status === "fulfilled" && results[0].value.ok) {
        const d = await results[0].value.json();
        setServers(d.servers || []);
      }
      if (results[1].status === "fulfilled" && results[1].value.ok) {
        const d = await results[1].value.json();
        setGames(d.games || []);
      }
      if (results[2].status === "fulfilled" && results[2].value.ok) {
        const d = await results[2].value.json();
        const online = (d.nodes || []).filter((n: NodeInfo) => n.status === "online");
        setNodeList(online);
        // Set default node
        const def = online.find((n: NodeInfo) => n.isDefault);
        if (def) {
          setForm((f) => ({
            ...f,
            nodeId: String(def.id),
            installPath: def.gameServerPath || "/opt/gameservers",
          }));
        }
      }
    } catch (e) {
      console.error("ServersPanel load error:", e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function onGameChange(gameId: string) {
    const game = games.find((g) => g.id === Number(gameId));
    const node = nodeList.find((n) => n.id === Number(form.nodeId));
    const base = node?.gameServerPath || "/opt/gameservers";
    if (game) {
      setForm((f) => ({ ...f, gameId, port: String(game.defaultPort), installPath: `${base}/${game.slug}` }));
    } else {
      setForm((f) => ({ ...f, gameId }));
    }
  }

  function onNodeChange(nodeId: string) {
    const node = nodeList.find((n) => n.id === Number(nodeId));
    const game = games.find((g) => g.id === Number(form.gameId));
    const base = node?.gameServerPath || "/opt/gameservers";
    setForm((f) => ({
      ...f,
      nodeId,
      installPath: game ? `${base}/${game.slug}` : base,
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
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create server");
      } else {
        setShowCreate(false);
        loadData();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus(id: number, current: string) {
    const next = current === "running" ? "stopped" : "running";
    try {
      await fetch(`/api/servers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      loadData();
    } catch (e) {
      console.error("Toggle error:", e);
    }
  }

  async function deleteServer(id: number) {
    if (!confirm("Delete this server?")) return;
    try {
      await fetch(`/api/servers/${id}`, { method: "DELETE" });
      loadData();
    } catch (e) {
      console.error("Delete error:", e);
    }
  }

  async function testWebhook(url: string, name: string) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "GameServer Manager",
          embeds: [{ title: "🔔 Test", description: `Test from **${name}**`, color: 0x3b82f6 }],
        }),
      });
      alert("✅ Webhook sent!");
    } catch {
      alert("❌ Webhook failed");
    }
  }

  const onlineNodes = nodeList;

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">🎮 Game Servers</h2>
          <p className="text-text-secondary text-sm">Manage game servers across all nodes</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium"
        >
          {showCreate ? "Cancel" : "+ New Server"}
        </button>
      </div>

      {onlineNodes.length === 0 && loaded && (
        <div className="bg-warning/15 border border-warning/30 rounded-xl p-4 text-warning text-sm">
          ⚠️ No online nodes. Add a node from the Nodes panel first.
        </div>
      )}
      {games.length === 0 && loaded && (
        <div className="bg-warning/15 border border-warning/30 rounded-xl p-4 text-warning text-sm">
          ⚠️ No games installed. Install templates from Games → Templates.
        </div>
      )}

      {showCreate && onlineNodes.length > 0 && games.length > 0 && (
        <form onSubmit={createServer} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">Create New Server</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Server Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required placeholder="My Server" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Node *</label>
              <select value={form.nodeId} onChange={(e) => onNodeChange(e.target.value)} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required>
                <option value="">Select node</option>
                {onlineNodes.map((n) => <option key={n.id} value={n.id}>{n.name} {n.isDefault ? "★" : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Game *</label>
              <select value={form.gameId} onChange={(e) => onGameChange(e.target.value)} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required>
                <option value="">Select game</option>
                {games.map((g) => <option key={g.id} value={g.id}>{g.iconEmoji} {g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Port *</label>
              <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" required />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Install Path</label>
              <input value={form.installPath} onChange={(e) => setForm({ ...form, installPath: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">IPv4</label>
              <input value={form.ipv4} onChange={(e) => setForm({ ...form, ipv4: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" placeholder="0.0.0.0" />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">IPv6</label>
              <input value={form.ipv6} onChange={(e) => setForm({ ...form, ipv6: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm" placeholder="::1" />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <button type="button" onClick={() => setShowDiscord(!showDiscord)} className="text-sm font-medium text-accent flex items-center gap-2">
              🔔 Discord Notifications {showDiscord ? "▼" : "▶"}
            </button>
            {showDiscord && (
              <div className="mt-3 space-y-3">
                <input value={form.discordWebhook} onChange={(e) => setForm({ ...form, discordWebhook: e.target.value })} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm font-mono" placeholder="https://discord.com/api/webhooks/..." />
                <div className="flex flex-wrap gap-3 text-sm">
                  {(["Start", "Stop", "Restart", "Crash"] as const).map((label) => {
                    const key = `discordNotify${label}` as keyof typeof form;
                    return (
                      <label key={label} className="flex items-center gap-1">
                        <input type="checkbox" checked={form[key] as boolean} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} className="rounded" />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-danger text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="px-6 py-2 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
            {loading ? "Creating..." : "Create Server"}
          </button>
        </form>
      )}

      {!loaded && (
        <div className="text-center py-8">
          <div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {loaded && servers.length === 0 && !showCreate && (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <span className="text-4xl mb-3 block">🎮</span>
          <h3 className="text-lg font-semibold mb-1">No servers yet</h3>
          <p className="text-text-secondary text-sm">Create your first game server to get started</p>
        </div>
      )}

      {servers.length > 0 && (
        <div className="grid gap-4">
          {servers.map((server) => (
            <div key={server.id} className="bg-bg-card border border-border rounded-xl p-5 hover:border-accent/30 transition-colors">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <span className="text-3xl">{server.gameIcon || "🎮"}</span>
                  <div>
                    <h3 className="font-semibold flex items-center gap-2">
                      {server.name}
                      {server.discordWebhook && <span className="text-xs bg-[#5865F2]/20 text-[#5865F2] px-1.5 py-0.5 rounded">🔔</span>}
                    </h3>
                    <p className="text-sm text-text-secondary">{server.gameName}</p>
                    <div className="flex gap-3 mt-1 text-xs text-text-muted">
                      {server.nodeName && <span>🖥️ {server.nodeName}</span>}
                      {server.ipv4 && <span>{server.ipv4}:{server.port}</span>}
                      {server.ipv6 && <span>[{server.ipv6}]:{server.port}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    server.status === "running" ? "bg-success/15 text-success" : "bg-bg-secondary text-text-muted"
                  }`}>{server.status}</span>
                  <button onClick={() => toggleStatus(server.id, server.status)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                    server.status === "running" ? "bg-danger/15 text-danger" : "bg-success/15 text-success"
                  }`}>{server.status === "running" ? "Stop" : "Start"}</button>
                  {server.discordWebhook && (
                    <button onClick={() => testWebhook(server.discordWebhook!, server.name)} className="px-3 py-1.5 bg-[#5865F2]/15 text-[#5865F2] rounded-lg text-xs font-medium">Test 🔔</button>
                  )}
                  {user.role === "admin" && (
                    <button onClick={() => deleteServer(server.id)} className="px-3 py-1.5 bg-danger/10 text-danger rounded-lg text-xs font-medium">Delete</button>
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
