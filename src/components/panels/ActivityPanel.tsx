"use client";

import { useEffect, useState, useCallback } from "react";

interface LogEntry {
  id: number;
  action: string;
  entityType: string | null;
  entityId: number | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  username: string | null;
}

const ACTION_ICONS: Record<string, string> = {
  login: "🔑", logout: "🚪", register: "📝",
  "server.create": "🎮", "server.delete": "🗑️", "server.start": "▶", "server.stop": "⏹", "server.install": "📥",
  "node.create": "🖥️", "node.delete": "🗑️",
  "game.install": "📦", "game.uninstall": "📦",
  "user.update": "👤", "user.suspend": "⚠️", "user.delete": "🗑️",
  "role.create": "🔑", "role.update": "🔑", "role.delete": "🗑️",
  "cms.create": "✍️", "cms.update": "✍️", "cms.delete": "🗑️",
  "forum.thread": "💬", "forum.post": "💬", "forum.delete": "🗑️",
};

export default function ActivityPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/audit-log?limit=200");
      if (res.ok) setEntries((await res.json()).entries || []);
    } catch { /**/ }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">📋 Activity Log</h2>
          <p className="text-text-secondary text-sm">Who did what and when — complete audit trail</p>
        </div>
        <button onClick={load} className="px-4 py-2 bg-bg-secondary border border-border hover:bg-bg-hover text-text-secondary rounded-lg text-sm">↻ Refresh</button>
      </div>

      {!loaded && <div className="text-center py-12"><div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" /></div>}

      {loaded && entries.length === 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <span className="text-4xl block mb-3">📋</span>
          <h3 className="font-semibold mb-1">No activity yet</h3>
          <p className="text-text-secondary text-sm">Actions will appear here as users interact with the panel.</p>
        </div>
      )}

      {entries.length > 0 && (
        <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-4 py-3 text-text-muted text-xs font-medium w-8"></th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">Action</th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">User</th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">Target</th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">IP</th>
                  <th className="px-4 py-3 text-text-muted text-xs font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-border/50 hover:bg-bg-hover">
                    <td className="px-4 py-2 text-center">{ACTION_ICONS[e.action] || "📌"}</td>
                    <td className="px-4 py-2 font-medium">{e.action}</td>
                    <td className="px-4 py-2 text-text-secondary">{e.username || "System"}</td>
                    <td className="px-4 py-2 text-text-muted text-xs font-mono">{e.entityType ? `${e.entityType}#${e.entityId}` : "—"}</td>
                    <td className="px-4 py-2 text-text-muted text-xs font-mono">{e.ipAddress || "—"}</td>
                    <td className="px-4 py-2 text-text-muted text-xs">{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
