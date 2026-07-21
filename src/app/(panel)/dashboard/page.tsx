import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { gameServers, games, nodes } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const isAdmin = user.role === "admin";

  // Get user's servers
  const myServers = isAdmin
    ? await db.select().from(gameServers)
    : await db.select().from(gameServers).where(eq(gameServers.userId, user.userId));

  const allGames = await db.select().from(games);
  const allNodes = await db.select().from(nodes);

  const runningServers = myServers.filter(s => s.status === "running").length;
  const totalSlots = myServers.reduce((sum, s) => sum + s.slots, 0);

  const enrichedServers = myServers.map(s => ({
    ...s,
    game: allGames.find(g => g.id === s.gameId),
    node: allNodes.find(n => n.id === s.nodeId),
  }));

  const statusColors: Record<string, string> = {
    running: "text-green-400 bg-green-500/10 border-green-500/30",
    stopped: "text-gray-400 bg-gray-500/10 border-gray-500/30",
    installing: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    error: "text-red-400 bg-red-500/10 border-red-500/30",
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Welcome back, {user.username}!</h1>
        <p className="text-dark-300 mt-1">Manage your game servers and community</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        {[
          { label: "Total Servers", value: myServers.length, icon: "🖥️", color: "from-brand-500/20 to-brand-600/10" },
          { label: "Running", value: runningServers, icon: "✅", color: "from-green-500/20 to-green-600/10" },
          { label: "Total Slots", value: totalSlots, icon: "👥", color: "from-accent-500/20 to-accent-600/10" },
          { label: "Nodes Online", value: allNodes.filter(n => n.status === "online").length, icon: "🌐", color: "from-purple-500/20 to-purple-600/10" },
        ].map((stat, i) => (
          <div key={i} className={`glass-card rounded-2xl p-6 bg-gradient-to-br ${stat.color}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-3xl">{stat.icon}</span>
              <span className="text-3xl font-bold text-white">{stat.value}</span>
            </div>
            <p className="text-dark-300 text-sm">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link href="/servers/create" className="glass-card rounded-xl p-4 flex items-center gap-4 hover:border-brand-500/50 transition-all group">
          <div className="w-12 h-12 rounded-xl bg-brand-500/20 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">➕</div>
          <div>
            <div className="font-semibold text-white">Create Server</div>
            <div className="text-xs text-dark-300">Deploy a new game server</div>
          </div>
        </Link>
        <Link href="/forum" className="glass-card rounded-xl p-4 flex items-center gap-4 hover:border-brand-500/50 transition-all group">
          <div className="w-12 h-12 rounded-xl bg-accent-500/20 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">💬</div>
          <div>
            <div className="font-semibold text-white">Community Forum</div>
            <div className="text-xs text-dark-300">Join the discussion</div>
          </div>
        </Link>
        <Link href="/plans" className="glass-card rounded-xl p-4 flex items-center gap-4 hover:border-brand-500/50 transition-all group">
          <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">📦</div>
          <div>
            <div className="font-semibold text-white">View Plans</div>
            <div className="text-xs text-dark-300">Upgrade your hosting</div>
          </div>
        </Link>
      </div>

      {/* Server List */}
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Your Servers</h2>
          <Link href="/servers/create" className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm rounded-xl transition-all">
            + New Server
          </Link>
        </div>

        {enrichedServers.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">🎮</div>
            <h3 className="text-lg font-semibold text-white mb-2">No servers yet</h3>
            <p className="text-dark-300 mb-4">Deploy your first game server in minutes</p>
            <Link href="/servers/create" className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-brand-500 to-accent-500 text-white rounded-xl font-semibold hover:opacity-90 transition-all">
              🚀 Create Your First Server
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {enrichedServers.map(server => (
              <Link
                key={server.id}
                href={`/servers/${server.id}`}
                className="flex items-center gap-4 p-4 bg-dark-700/50 rounded-xl hover:bg-dark-700 transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-dark-600 flex items-center justify-center text-2xl">
                  {server.game?.slug === "cs2" ? "🔫" : server.game?.slug === "minecraft" ? "⛏️" : server.game?.slug === "rust" ? "🏗️" : "🎮"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white group-hover:text-brand-400 transition-colors">{server.name}</div>
                  <div className="text-xs text-dark-300">{server.game?.name} • {server.node?.name} • Port {server.port}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-dark-300">{server.slots} slots</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium border ${statusColors[server.status] || statusColors.stopped}`}>
                    {server.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
