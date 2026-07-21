import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { games } from "@/db/schema";
import { redirect } from "next/navigation";
import { GAME_TEMPLATES } from "@/lib/game-installer";

export const dynamic = "force-dynamic";

export default async function AdminGamesPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") redirect("/dashboard");

  const allGames = await db.select().from(games);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Game Management</h1>
          <p className="text-dark-300 mt-1">{allGames.length} games configured</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {allGames.map(game => {
          const tmpl = GAME_TEMPLATES.find(t => t.slug === game.slug);
          return (
            <div key={game.id} className="glass-card rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-xl bg-dark-600 flex items-center justify-center text-3xl">
                  {tmpl?.iconEmoji || "🎮"}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-white text-lg">{game.name}</h3>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      game.isActive ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                    }`}>
                      {game.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="text-dark-300 text-sm mt-1">{game.description}</p>
                  <div className="flex gap-4 mt-3 text-xs text-dark-400">
                    <span>Port: {game.defaultPort}</span>
                    {game.steamAppId && <span>Steam ID: {game.steamAppId}</span>}
                    <span>Slug: {game.slug}</span>
                  </div>
                </div>
              </div>

              {game.installScript && (
                <div className="mt-4 p-3 bg-dark-800 rounded-xl">
                  <div className="text-xs text-dark-400 mb-1">Install Script</div>
                  <code className="text-xs text-accent-400 font-mono break-all">{game.installScript}</code>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
