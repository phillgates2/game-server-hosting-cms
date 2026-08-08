"use client";

import { useEffect, useState, useCallback } from "react";

interface LadderEntry {
  id: number;
  gameId: number | null;
  season: string;
  teamName: string;
  tag: string | null;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  streak: number;
  logoEmoji: string | null;
  notes: string | null;
  rank: number;
}

interface LadderGame {
  id: number;
  slug: string;
  name: string;
  iconEmoji: string | null;
}

interface LadderResponse {
  gameId: number | null;
  games: LadderGame[];
  season: string;
  seasons: string[];
  standings: LadderEntry[];
}

const EMPTY_FORM = {
  teamName: "",
  tag: "",
  wins: "0",
  losses: "0",
  draws: "0",
  points: "0",
  streak: "0",
  logoEmoji: "🎯",
  notes: "",
};

export default function LadderPanel() {
  const [gameId, setGameId] = useState("");
  const [games, setGames] = useState<LadderGame[]>([]);
  const [season, setSeason] = useState("S1");
  const [seasons, setSeasons] = useState<string[]>([]);
  const [standings, setStandings] = useState<LadderEntry[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const canCreate = perms["ladder.create"] === true;
  const canEdit = perms["ladder.edit"] === true;
  const canDelete = perms["ladder.delete"] === true;
  const canSeason = perms["ladder.season"] === true || perms["ladder.season.manage"] === true;
  const canCreateEntry = canCreate || perms["ladder.create.entry"] === true;
  const canEditEntry = canEdit || perms["ladder.edit.entry"] === true;
  const canDeleteEntry = canDelete || perms["ladder.delete.entry"] === true;

  const loadPermissions = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/permissions");
      if (res.ok) setPerms((await res.json()).permissions || {});
    } catch {
      setPerms({});
    }
  }, []);

  const loadLadder = useCallback(async (activeSeason: string, activeGameId?: string) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ season: activeSeason });
      const nextGameId = activeGameId ?? gameId;
      if (nextGameId) query.set("gameId", nextGameId);
      const res = await fetch(`/api/ladder?${query.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage({ type: "error", text: data.error || "Failed to load standings" });
        setStandings([]);
        setSeasons([]);
        setGames([]);
        return;
      }
      const data = (await res.json()) as LadderResponse;
      const nextId = data.gameId ? String(data.gameId) : "";
      setGameId(nextId);
      setGames(data.games || []);
      setSeason(data.season || activeSeason);
      setSeasons(data.seasons || []);
      setStandings(data.standings || []);
    } catch {
      setMessage({ type: "error", text: "Failed to load standings" });
    } finally {
      setLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPermissions();
      void loadLadder("S1", "");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLadder, loadPermissions]);

  function calcPoints(wins: string, draws: string) {
    return String(Number(wins || "0") * 3 + Number(draws || "0"));
  }

  function startEdit(entry: LadderEntry) {
    setEditingId(entry.id);
    setForm({
      teamName: entry.teamName,
      tag: entry.tag || "",
      wins: String(entry.wins),
      losses: String(entry.losses),
      draws: String(entry.draws),
      points: String(entry.points),
      streak: String(entry.streak),
      logoEmoji: entry.logoEmoji || "🎯",
      notes: entry.notes || "",
    });
    setMessage(null);
  }

  function clearForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function saveEntry(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    const payload = {
      gameId: gameId ? Number(gameId) : null,
      season,
      teamName: form.teamName,
      tag: form.tag,
      wins: Number(form.wins || "0"),
      losses: Number(form.losses || "0"),
      draws: Number(form.draws || "0"),
      points: Number(form.points || "0"),
      streak: Number(form.streak || "0"),
      logoEmoji: form.logoEmoji,
      notes: form.notes,
    };

    try {
      const res = await fetch(editingId ? `/api/ladder/${editingId}` : "/api/ladder", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Could not save entry" });
        return;
      }

      setMessage({ type: "success", text: editingId ? "Entry updated" : "Entry created" });
      clearForm();
      void loadLadder(season, gameId);
    } catch {
      setMessage({ type: "error", text: "Could not save entry" });
    }
  }

  async function deleteEntry(id: number) {
    if (!confirm("Delete this ladder entry?")) return;
    setMessage(null);
    try {
      const res = await fetch(`/api/ladder/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Could not delete entry" });
        return;
      }
      setMessage({ type: "success", text: "Entry deleted" });
      if (editingId === id) clearForm();
      void loadLadder(season, gameId);
    } catch {
      setMessage({ type: "error", text: "Could not delete entry" });
    }
  }

  return (
    <div className="animate-fade-in panel-view space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="heading-font text-2xl font-bold uppercase tracking-[0.08em]">🏆 Gaming League Ladder</h2>
          <p className="text-text-secondary text-sm">Run parallel ladders per game, each with its own active seasons and standings.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <label className="text-xs text-text-muted uppercase tracking-[0.14em]">Game</label>
          <select
            value={gameId}
            onChange={(e) => {
              const nextGameId = e.target.value;
              setGameId(nextGameId);
              void loadLadder(season, nextGameId);
            }}
            className="min-w-48 px-3 py-2 gaming-chip rounded-lg text-sm"
          >
            {games.length === 0 && <option value="">No installed games</option>}
            {games.map((game) => (
              <option key={game.id} value={String(game.id)}>{game.iconEmoji || "🎮"} {game.name}</option>
            ))}
          </select>
          <label className="text-xs text-text-muted uppercase tracking-[0.14em]">Season</label>
          <input
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="w-24 px-3 py-2 gaming-chip rounded-lg text-sm"
            disabled={!canSeason}
          />
          <button
            onClick={() => void loadLadder(season, gameId)}
            className="gaming-chip px-3 py-2 rounded-lg text-xs font-semibold hover:border-accent/40"
          >
            Refresh
          </button>
        </div>
      </div>

      {seasons.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {seasons.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSeason(s);
                void loadLadder(s, gameId);
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${season === s ? "bg-accent text-slate-950" : "gaming-chip text-text-secondary hover:text-text-primary"}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {message && (
        <div className={`rounded-lg p-3 text-sm ${message.type === "success" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
          {message.text}
        </div>
      )}

      {(!gameId && games.length > 0) && (
        <div className="rounded-lg p-3 text-sm bg-danger/15 text-danger">
          Select a game to manage ladder entries.
        </div>
      )}

      {(canCreateEntry || (canEditEntry && editingId !== null)) && gameId && (
        <form onSubmit={saveEntry} className="gaming-surface rounded-xl p-5 space-y-4">
          <h3 className="heading-font text-lg uppercase tracking-[0.06em]">{editingId ? "Edit Ladder Team" : "Add Ladder Team"}</h3>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input value={form.teamName} onChange={(e) => setForm({ ...form, teamName: e.target.value })} placeholder="Team Name" className="md:col-span-2 px-3 py-2 gaming-chip rounded-lg text-sm" required />
            <input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder="TAG" className="px-3 py-2 gaming-chip rounded-lg text-sm" />
            <input value={form.logoEmoji} onChange={(e) => setForm({ ...form, logoEmoji: e.target.value })} placeholder="🎯" className="px-3 py-2 gaming-chip rounded-lg text-sm" />
            <input value={form.streak} onChange={(e) => setForm({ ...form, streak: e.target.value })} placeholder="Streak" type="number" className="px-3 py-2 gaming-chip rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input value={form.wins} onChange={(e) => setForm({ ...form, wins: e.target.value, points: calcPoints(e.target.value, form.draws) })} placeholder="Wins" type="number" className="px-3 py-2 gaming-chip rounded-lg text-sm" />
            <input value={form.losses} onChange={(e) => setForm({ ...form, losses: e.target.value })} placeholder="Losses" type="number" className="px-3 py-2 gaming-chip rounded-lg text-sm" />
            <input value={form.draws} onChange={(e) => setForm({ ...form, draws: e.target.value, points: calcPoints(form.wins, e.target.value) })} placeholder="Draws" type="number" className="px-3 py-2 gaming-chip rounded-lg text-sm" />
            <input value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} placeholder="Points" type="number" className="px-3 py-2 gaming-chip rounded-lg text-sm" />
          </div>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" rows={2} className="w-full px-3 py-2 gaming-chip rounded-lg text-sm resize-y" />
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 bg-accent hover:bg-accent-hover text-slate-950 rounded-lg text-sm font-bold uppercase tracking-[0.05em]">
              {editingId ? "Save Team" : "Add Team"}
            </button>
            {editingId !== null && (
              <button type="button" onClick={clearForm} className="gaming-chip px-4 py-2 rounded-lg text-sm">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      <div className="gaming-surface rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-secondary/80">
              <tr className="text-left text-text-muted uppercase tracking-[0.12em] text-[10px]">
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Team</th>
                <th className="px-4 py-3">W</th>
                <th className="px-4 py-3">L</th>
                <th className="px-4 py-3">D</th>
                <th className="px-4 py-3">Pts</th>
                <th className="px-4 py-3">Streak</th>
                {(canEditEntry || canDeleteEntry) && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {!loading && standings.length === 0 && (
                <tr>
                  <td className="px-4 py-10 text-center text-text-muted" colSpan={canEditEntry || canDeleteEntry ? 8 : 7}>
                    No teams in this season yet.
                  </td>
                </tr>
              )}
              {standings.map((entry) => (
                <tr key={entry.id} className="border-t border-border/70 hover:bg-bg-hover/40 transition-colors">
                  <td className="px-4 py-3 font-semibold">#{entry.rank}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span>{entry.logoEmoji || "🎯"}</span>
                      <span className="font-medium">{entry.teamName}</span>
                      {entry.tag && <span className="text-[10px] gaming-chip px-1.5 py-0.5 rounded">{entry.tag}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">{entry.wins}</td>
                  <td className="px-4 py-3">{entry.losses}</td>
                  <td className="px-4 py-3">{entry.draws}</td>
                  <td className="px-4 py-3 font-bold text-accent">{entry.points}</td>
                  <td className="px-4 py-3">{entry.streak}</td>
                  {(canEditEntry || canDeleteEntry) && (
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {canEditEntry && <button onClick={() => startEdit(entry)} className="px-2 py-1 bg-accent/15 text-accent rounded text-xs">Edit</button>}
                        {canDeleteEntry && <button onClick={() => void deleteEntry(entry.id)} className="px-2 py-1 bg-danger/15 text-danger rounded text-xs">Delete</button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
