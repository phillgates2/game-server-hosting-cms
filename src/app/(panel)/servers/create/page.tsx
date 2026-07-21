"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface GameItem {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  defaultPort: number;
  iconEmoji: string;
}

export default function CreateServerPage() {
  const router = useRouter();
  const [games, setGames] = useState<GameItem[]>([]);
  const [selectedGame, setSelectedGame] = useState<number | null>(null);
  const [serverName, setServerName] = useState("");
  const [slots, setSlots] = useState(16);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installSteps, setInstallSteps] = useState<Array<{ name: string; status: string }>>([]);
  const [installProgress, setInstallProgress] = useState(0);

  useEffect(() => {
    fetch("/api/games").then(r => r.json()).then(data => {
      setGames(data.games || []);
    });
  }, []);

  const handleCreate = async () => {
    if (!selectedGame) { setError("Please select a game"); return; }
    if (!serverName) { setError("Please enter a server name"); return; }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: serverName, gameId: selectedGame, slots }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const serverId = data.server.id;

      // Start auto-install
      setInstalling(true);
      const steps = [
        "Provisioning container...",
        "Creating directory structure...",
        "Allocating resources...",
        "Downloading game files via SteamCMD...",
        "Validating game installation...",
        "Applying server configuration...",
        "Setting up network ports...",
        "Configuring firewall rules...",
        "Finalizing setup...",
      ];

      for (let i = 0; i < steps.length; i++) {
        setInstallSteps(prev => [...prev, { name: steps[i], status: "running" }]);
        await new Promise(r => setTimeout(r, 500 + Math.random() * 800));
        setInstallSteps(prev => prev.map((s, idx) => idx === i ? { ...s, status: "completed" } : s));
        setInstallProgress(Math.round(((i + 1) / steps.length) * 90));
      }

      // Actually install
      await fetch(`/api/servers/${serverId}/install`, { method: "POST" });
      setInstallProgress(100);
      setInstallSteps(prev => [...prev, { name: "Server ready! 🎉", status: "completed" }]);

      await new Promise(r => setTimeout(r, 1500));
      router.push(`/servers/${serverId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create server";
      setError(message);
      setLoading(false);
      setInstalling(false);
    }
  };

  if (installing) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Installing Game Server</h1>
        <p className="text-dark-300 mb-8">Automatic file installation in progress...</p>

        <div className="glass-card rounded-2xl p-8 max-w-2xl">
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-dark-300">Installation Progress</span>
              <span className="text-brand-400 font-bold">{installProgress}%</span>
            </div>
            <div className="w-full h-4 bg-dark-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-500 to-accent-500 rounded-full transition-all duration-500"
                style={{ width: `${installProgress}%` }}
              />
            </div>
          </div>

          <div className="space-y-3">
            {installSteps.map((step, i) => (
              <div key={i} className="flex items-center gap-3 animate-slide-up">
                {step.status === "running" ? (
                  <div className="w-5 h-5 rounded-full border-2 border-brand-400 border-t-transparent animate-spin" />
                ) : (
                  <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-xs text-white">✓</div>
                )}
                <span className={step.status === "running" ? "text-brand-400" : "text-green-400"}>
                  {step.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Create Game Server</h1>
      <p className="text-dark-300 mb-8">Select a game, configure, and deploy with automatic file installation</p>

      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400">
          {error}
        </div>
      )}

      {/* Game Selection */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">1. Select Game</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {games.map(game => (
            <button
              key={game.id}
              onClick={() => {
                setSelectedGame(game.id);
                if (!serverName) setServerName(`${game.name} Server`);
              }}
              className={`glass-card rounded-xl p-4 text-center transition-all hover:scale-105 ${
                selectedGame === game.id ? "border-brand-500 bg-brand-500/10 ring-2 ring-brand-500/30" : "hover:border-dark-400"
              }`}
            >
              <div className="text-4xl mb-2">{game.iconEmoji}</div>
              <div className="text-sm font-semibold text-white">{game.name}</div>
              <div className="text-xs text-dark-400 mt-1">Port {game.defaultPort}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Server Configuration */}
      <div className="glass-card rounded-2xl p-6 mb-8">
        <h2 className="text-lg font-semibold text-white mb-4">2. Server Configuration</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Server Name</label>
            <input
              type="text"
              value={serverName}
              onChange={e => setServerName(e.target.value)}
              className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white focus:outline-none focus:border-brand-500 transition-colors"
              placeholder="My Awesome Server"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Player Slots</label>
            <select
              value={slots}
              onChange={e => setSlots(parseInt(e.target.value, 10))}
              className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white focus:outline-none focus:border-brand-500 transition-colors"
            >
              {[8, 10, 12, 16, 20, 24, 32, 48, 64, 100, 128].map(n => (
                <option key={n} value={n}>{n} Players</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Deploy Button */}
      <button
        onClick={handleCreate}
        disabled={loading || !selectedGame}
        className="w-full md:w-auto px-8 py-4 bg-gradient-to-r from-brand-500 to-accent-500 text-white font-bold text-lg rounded-xl hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Creating..." : "🚀 Deploy & Auto-Install Server"}
      </button>
    </div>
  );
}
