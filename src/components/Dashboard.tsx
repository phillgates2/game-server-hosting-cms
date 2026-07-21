"use client";

import { useState } from "react";
import ServersPanel from "./panels/ServersPanel";
import MonitorPanel from "./panels/MonitorPanel";
import ForumPanel from "./panels/ForumPanel";
import DatabasePanel from "./panels/DatabasePanel";
import GamesPanel from "./panels/GamesPanel";
import OverviewPanel from "./panels/OverviewPanel";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface Props {
  user: AuthUser;
  onLogout: () => void;
}

type Tab = "overview" | "servers" | "games" | "monitor" | "forum" | "database";

const NAV_ITEMS: { key: Tab; label: string; icon: string; adminOnly?: boolean }[] = [
  { key: "overview", label: "Overview", icon: "📊" },
  { key: "servers", label: "Servers", icon: "🖥️" },
  { key: "games", label: "Games", icon: "🎮" },
  { key: "monitor", label: "Monitor", icon: "📈" },
  { key: "forum", label: "Forum", icon: "💬" },
  { key: "database", label: "Database", icon: "🗄️", adminOnly: true },
];

export default function Dashboard({ user, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  const filteredNav = NAV_ITEMS.filter(
    (item) => !item.adminOnly || user.role === "admin"
  );

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-16"
        } bg-bg-secondary border-r border-border flex flex-col transition-all duration-300 flex-shrink-0`}
      >
        {/* Logo area */}
        <div className="p-4 border-b border-border flex items-center gap-3">
          <span className="text-2xl">🎮</span>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <h1 className="text-sm font-bold text-text-primary whitespace-nowrap">GameServer Manager</h1>
              <p className="text-[10px] text-text-muted">v1.0.0</p>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 p-2 space-y-1">
          {filteredNav.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                tab === item.key
                  ? "bg-accent/15 text-accent"
                  : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* User section */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-bold">
              {user.username[0].toUpperCase()}
            </div>
            {sidebarOpen && (
              <div className="overflow-hidden">
                <p className="text-sm font-medium text-text-primary truncate">{user.username}</p>
                <p className="text-[10px] text-text-muted uppercase">{user.role}</p>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="flex-1 px-2 py-1.5 bg-bg-tertiary hover:bg-bg-hover text-text-muted text-xs rounded transition-colors"
            >
              {sidebarOpen ? "◀" : "▶"}
            </button>
            {sidebarOpen && (
              <button
                onClick={handleLogout}
                className="flex-1 px-2 py-1.5 bg-danger/10 hover:bg-danger/20 text-danger text-xs rounded transition-colors"
              >
                Logout
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          {tab === "overview" && <OverviewPanel user={user} />}
          {tab === "servers" && <ServersPanel user={user} />}
          {tab === "games" && <GamesPanel />}
          {tab === "monitor" && <MonitorPanel user={user} />}
          {tab === "forum" && <ForumPanel user={user} />}
          {tab === "database" && <DatabasePanel />}
        </div>
      </main>
    </div>
  );
}
