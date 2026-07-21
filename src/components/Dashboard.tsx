"use client";

import { useState } from "react";
import ErrorBoundary from "./ErrorBoundary";
import ServersPanel from "./panels/ServersPanel";
import MonitorPanel from "./panels/MonitorPanel";
import ForumPanel from "./panels/ForumPanel";
import DatabasePanel from "./panels/DatabasePanel";
import GamesPanel from "./panels/GamesPanel";
import OverviewPanel from "./panels/OverviewPanel";
import NodesPanel from "./panels/NodesPanel";
import CmsPanel from "./panels/CmsPanel";
import UsersPanel from "./panels/UsersPanel";
import ProfilePanel from "./panels/ProfilePanel";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface Props {
  user: AuthUser;
  onLogout: () => void;
}

type Tab = "overview" | "servers" | "nodes" | "games" | "monitor" | "forum" | "cms" | "users" | "profile" | "database";

const NAV_ITEMS: { key: Tab; label: string; icon: string; adminOnly?: boolean; section?: string }[] = [
  { key: "overview", label: "Overview", icon: "📊", section: "main" },
  { key: "servers", label: "Servers", icon: "🎮", section: "main" },
  { key: "nodes", label: "Nodes", icon: "🖥️", adminOnly: true, section: "main" },
  { key: "games", label: "Games", icon: "📦", section: "main" },
  { key: "monitor", label: "Monitor", icon: "📈", section: "main" },
  { key: "forum", label: "Forum", icon: "💬", section: "community" },
  { key: "cms", label: "CMS", icon: "✍️", adminOnly: true, section: "community" },
  { key: "users", label: "Users", icon: "👥", adminOnly: true, section: "admin" },
  { key: "profile", label: "My Profile", icon: "👤", section: "account" },
  { key: "database", label: "Database", icon: "🗄️", adminOnly: true, section: "admin" },
];

export default function Dashboard({ user, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  async function handleLogout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    onLogout();
  }

  const filteredNav = NAV_ITEMS.filter(
    (item) => !item.adminOnly || user.role === "admin"
  );

  // Group by section
  const sections: Record<string, typeof filteredNav> = {};
  for (const item of filteredNav) {
    const s = item.section || "main";
    if (!sections[s]) sections[s] = [];
    sections[s].push(item);
  }

  const sectionLabels: Record<string, string> = {
    main: "Management",
    community: "Community",
    admin: "Administration",
    account: "Account",
  };

  function renderPanel() {
    switch (tab) {
      case "overview": return <OverviewPanel user={user} />;
      case "servers": return <ServersPanel user={user} />;
      case "nodes": return <NodesPanel user={user} />;
      case "games": return <GamesPanel />;
      case "monitor": return <MonitorPanel user={user} />;
      case "forum": return <ForumPanel user={user} />;
      case "cms": return <CmsPanel />;
      case "users": return <UsersPanel />;
      case "profile": return <ProfilePanel />;
      case "database": return <DatabasePanel />;
      default: return <OverviewPanel user={user} />;
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? "w-64" : "w-16"} bg-bg-secondary border-r border-border flex flex-col transition-all duration-300 flex-shrink-0`}>
        {/* Logo */}
        <div className="p-4 border-b border-border flex items-center gap-3">
          <span className="text-2xl">🎮</span>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <h1 className="text-sm font-bold text-text-primary whitespace-nowrap">GameServer Manager</h1>
              <p className="text-[10px] text-text-muted">v1.0.0 • Multi-Node</p>
            </div>
          )}
        </div>

        {/* Grouped nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-3">
          {Object.entries(sections).map(([sectionKey, items]) => (
            <div key={sectionKey}>
              {sidebarOpen && (
                <p className="text-[10px] text-text-muted uppercase tracking-wider px-3 mb-1">
                  {sectionLabels[sectionKey] || sectionKey}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => setTab(item.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      tab === item.key
                        ? "bg-accent/15 text-accent"
                        : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                    }`}
                  >
                    <span className="text-base">{item.icon}</span>
                    {sidebarOpen && <span>{item.label}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User footer */}
        <div className="p-3 border-t border-border">
          <button onClick={() => setTab("profile")} className="w-full flex items-center gap-3 mb-3 hover:bg-bg-hover rounded-lg p-1 transition-colors">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-bold flex-shrink-0">
              {user.username[0].toUpperCase()}
            </div>
            {sidebarOpen && (
              <div className="overflow-hidden text-left">
                <p className="text-sm font-medium text-text-primary truncate">{user.username}</p>
                <p className="text-[10px] text-text-muted uppercase">{user.role}</p>
              </div>
            )}
          </button>
          <div className="flex gap-2">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="flex-1 px-2 py-1.5 bg-bg-tertiary hover:bg-bg-hover text-text-muted text-xs rounded transition-colors">
              {sidebarOpen ? "◀" : "▶"}
            </button>
            {sidebarOpen && (
              <button onClick={handleLogout} className="flex-1 px-2 py-1.5 bg-danger/10 hover:bg-danger/20 text-danger text-xs rounded transition-colors">
                Logout
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">
          <ErrorBoundary key={tab} name={tab}>
            {renderPanel()}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
