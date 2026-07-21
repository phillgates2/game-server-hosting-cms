import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { gameServers, games, nodes } from "@/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { GAME_TEMPLATES } from "@/lib/game-installer";

export const dynamic = "force-dynamic";

export default async function ServersPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const isAdmin = user.role === "admin";
  const myServers = isAdmin
    ? await db.select().from(gameServers)
    : await db.select().from(gameServers).where(eq(gameServers.userId, user.userId));

  const allGames = await db.select().from(games);
  const allNodes = await db.select().from(nodes);

  const enrichedServers = myServers.map(s => {
    const game = allGames.find(g => g.id === s.gameId);
    const tmpl = GAME_TEMPLATES.find(t => t.slug === game?.slug);
    return {
      ...s,
      game,
      node: allNodes.find(n => n.id === s.nodeId),
      iconEmoji: tmpl?.iconEmoji || "🎮",
    };
  });

  const statusColors: Record<string, string> = {
    running: "text-green-400 bg-green-500/10 border-green-500/30",
    stopped: "text-gray-400 bg-gray-500/10 border-gray-500/30",
    installing: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
    error: "text-red-400 bg-red-500/10 border-red-500/30",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Game Servers</h1>
          <p className="text-dark-300 mt-1">{enrichedServers.length} server{enrichedServers.length !== 1 ? "s" : ""} total</p>
        </div>
        <Link href="/servers/create" className="px-6 py-3 bg-gradient-to-r from-brand-500 to-accent-500 text-white font-semibold rounded-xl hover:opacity-90 transition-all">
          + Create Server
        </Link>
      </div>

      {enrichedServers.length === 0 ? (
        <div className="glass-card rounded-2xl p-16 text-center">
          <div className="text-6xl mb-4">🖥️</div>
          <h3 className="text-xl font-bold text-white mb-2">No servers yet</h3>
          <p className="text-dark-300 mb-6">Create your first game server with automatic file installation</p>
          <Link href="/servers/create" className="inline-flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-brand-500 to-accent-500 text-white rounded-xl font-semibold hover:opacity-90 transition-all">
            🚀 Deploy Server
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {enrichedServers.map(server => (
            <Link
              key={server.id}
              href={`/servers/${server.id}`}
              className="glass-card rounded-2xl p-6 hover:border-brand-500/40 transition-all group"
            >
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-xl bg-dark-600 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
                  {server.iconEmoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold text-white text-lg group-hover:text-brand-400 transition-colors truncate">{server.name}</h3>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${statusColors[server.status] || statusColors.stopped}`}>
                      {server.status}
                    </span>
                  </div>
                  <p className="text-dark-300 text-sm mb-3">{server.game?.name}</p>
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-dark-400">Node</span>
                      <div className="text-white mt-0.5">{server.node?.name || "N/A"}</div>
                    </div>
                    <div>
                      <span className="text-dark-400">Port</span>
                      <div className="text-white mt-0.5">{server.port}</div>
                    </div>
                    <div>
                      <span className="text-dark-400">Slots</span>
                      <div className="text-white mt-0.5">{server.slots}</div>
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
