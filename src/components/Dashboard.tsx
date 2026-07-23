"use client";

import { useState, useEffect, useCallback } from "react";
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
import RolesPanel from "./panels/RolesPanel";
import RconPanel from "./panels/RconPanel";
import FilesPanel from "./panels/FilesPanel";
import AuditPanel from "./panels/AuditPanel";

interface AuthUser {
  id: number;
  username: string;
  role: string;
  roleName?: string;
  roleColor?: string;
  roleIcon?: string;
}

interface Props {
  user: AuthUser;
  onLogout: () => void;
}

type Tab = "overview" | "servers" | "files" | "rcon" | "nodes" | "games" | "audit" | "monitor" | "forum" | "cms" | "users" | "roles" | "profile" | "database";

interface NavItem {
  key: Tab;
  label: string;
  icon: string;
  permission?: string; // required permission, undefined = everyone
  section: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "Overview", icon: "📊", section: "main" },
  { key: "servers", label: "Servers", icon: "🎮", permission: "servers.view", section: "main" },
  { key: "files", label: "File Manager", icon: "📂", permission: "servers.files", section: "main" },
  { key: "rcon", label: "RCON Console", icon: "🖥️", permission: "servers.console", section: "main" },
  { key: "nodes", label: "Nodes", icon: "🌐", permission: "nodes.view", section: "main" },
  { key: "games", label: "Games", icon: "📦", permission: "games.view", section: "main" },
  { key: "audit", label: "Audit", icon: "🔍", permission: "games.install", section: "main" },
  { key: "monitor", label: "Monitor", icon: "📈", permission: "monitor.view", section: "main" },
  { key: "forum", label: "Forum", icon: "💬", permission: "forum.view", section: "community" },
  { key: "cms", label: "CMS", icon: "✍️", permission: "cms.view", section: "community" },
  { key: "users", label: "Users", icon: "👥", permission: "users.view", section: "admin" },
  { key: "roles", label: "Roles", icon: "🔑", permission: "roles.view", section: "admin" },
  { key: "database", label: "Database", icon: "🗄️", permission: "database.view", section: "admin" },
  { key: "profile", label: "My Profile", icon: "👤", section: "account" },
];

const SECTION_LABELS: Record<string, string> = {
  main: "Management",
  community: "Community",
  admin: "Administration",
  account: "Account",
};

export default function Dashboard({ user, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [perms, setPerms] = useState<Record<string, boolean>>({});

  const loadPerms = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/permissions");
      if (res.ok) {
        const data = await res.json();
        setPerms(data.permissions || {});
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadPerms(); }, [loadPerms]);

  async function handleLogout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /* ignore */ }
    onLogout();
  }

  // Filter nav by permissions
  const filteredNav = NAV_ITEMS.filter((item) => {
    if (!item.permission) return true;
    return perms[item.permission] === true;
  });

  const sections: Record<string, NavItem[]> = {};
  for (const item of filteredNav) {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  }

  function renderPanel() {
    switch (tab) {
      case "overview": return <OverviewPanel user={user} />;
      case "servers": return <ServersPanel user={user} />;
      case "files": return <FilesPanel user={user} />;
      case "rcon": return <RconPanel user={user} />;
      case "nodes": return <NodesPanel user={user} />;
      case "games": return <GamesPanel />;
      case "audit": return <AuditPanel />;
      case "monitor": return <MonitorPanel user={user} />;
      case "forum": return <ForumPanel user={user} />;
      case "cms": return <CmsPanel />;
      case "users": return <UsersPanel />;
      case "roles": return <RolesPanel />;
      case "profile": return <ProfilePanel />;
      case "database": return <DatabasePanel />;
      default: return <OverviewPanel user={user} />;
    }
  }

  const roleColor = user.roleColor || "#3b82f6";
  const roleIcon = user.roleIcon || "👤";
  const roleName = user.roleName || user.role;

  return (
    <div className="min-h-screen flex">
      <aside className={`${sidebarOpen ? "w-64" : "w-16"} bg-bg-secondary border-r border-border flex flex-col transition-all duration-300 flex-shrink-0`}>
        <div className="p-4 border-b border-border flex items-center gap-3">
          <span className="text-2xl">🎮</span>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <h1 className="text-sm font-bold text-text-primary whitespace-nowrap">GameServer Manager</h1>
              <p className="text-[10px] text-text-muted">v1.0.0</p>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-3">
          {Object.entries(sections).map(([sectionKey, items]) => (
            <div key={sectionKey}>
              {sidebarOpen && (
                <p className="text-[10px] text-text-muted uppercase tracking-wider px-3 mb-1">
                  {SECTION_LABELS[sectionKey] || sectionKey}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((item) => (
                  <button key={item.key} onClick={() => setTab(item.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      tab === item.key ? "bg-accent/15 text-accent" : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                    }`}>
                    <span className="text-base">{item.icon}</span>
                    {sidebarOpen && <span>{item.label}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-border">
          <button onClick={() => setTab("profile")} className="w-full flex items-center gap-3 mb-3 hover:bg-bg-hover rounded-lg p-1 transition-colors">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ backgroundColor: `${roleColor}20`, color: roleColor }}>
              {user.username[0].toUpperCase()}
            </div>
            {sidebarOpen && (
              <div className="overflow-hidden text-left">
                <p className="text-sm font-medium text-text-primary truncate">{user.username}</p>
                <p className="text-[10px] truncate" style={{ color: roleColor }}>{roleIcon} {roleName}</p>
              </div>
            )}
          </button>
          <div className="flex gap-2">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="flex-1 px-2 py-1.5 bg-bg-tertiary hover:bg-bg-hover text-text-muted text-xs rounded">{sidebarOpen ? "◀" : "▶"}</button>
            {sidebarOpen && <button onClick={handleLogout} className="flex-1 px-2 py-1.5 bg-danger/10 hover:bg-danger/20 text-danger text-xs rounded">Logout</button>}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="p-6">
          <ErrorBoundary key={tab} name={tab}>{renderPanel()}</ErrorBoundary>
        </div>
      </main>
    </div>
  );
}
