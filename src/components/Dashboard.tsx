"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
import ActivityPanel from "./panels/ActivityPanel";
import SchedulerPanel from "./panels/SchedulerPanel";
import ApiKeysPanel from "./panels/ApiKeysPanel";
import { ThemeToggleButton } from "./ThemeToggle";
import { NotificationBell } from "./NotificationCenter";
import { LanguageSelector } from "@/lib/i18n";

interface AuthUser {
  id: number; username: string; role: string;
  roleName?: string; roleColor?: string; roleIcon?: string;
}
interface Props { user: AuthUser; onLogout: () => void }

type Tab = "overview" | "servers" | "files" | "rcon" | "nodes" | "games" | "audit" | "monitor" | "forum" | "cms" | "users" | "roles" | "profile" | "database" | "activity" | "scheduler" | "apikeys";

interface NavItem { key: Tab; label: string; icon: string; permission?: string; section: string; shortcut?: string }

const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "Overview", icon: "📊", section: "main", shortcut: "O" },
  { key: "servers", label: "Servers", icon: "🎮", permission: "servers.view", section: "main", shortcut: "S" },
  { key: "files", label: "File Manager", icon: "📂", permission: "servers.files", section: "main", shortcut: "F" },
  { key: "rcon", label: "RCON Console", icon: "🖥️", permission: "servers.console", section: "main", shortcut: "R" },
  { key: "nodes", label: "Nodes", icon: "🌐", permission: "nodes.view", section: "main", shortcut: "N" },
  { key: "games", label: "Games", icon: "📦", permission: "games.view", section: "main", shortcut: "G" },
  { key: "audit", label: "Audit", icon: "🔍", permission: "games.install", section: "main", shortcut: "A" },
  { key: "monitor", label: "Monitor", icon: "📈", permission: "monitor.view", section: "main", shortcut: "M" },
  { key: "forum", label: "Forum", icon: "💬", permission: "forum.view", section: "community" },
  { key: "cms", label: "CMS", icon: "✍️", permission: "cms.view", section: "community" },
  { key: "users", label: "Users", icon: "👥", permission: "users.view", section: "admin", shortcut: "U" },
  { key: "roles", label: "Roles", icon: "🔑", permission: "roles.view", section: "admin" },
  { key: "database", label: "Database", icon: "🗄️", permission: "database.view", section: "admin", shortcut: "D" },
  { key: "activity", label: "Activity Log", icon: "📋", permission: "panel.settings", section: "admin" },
  { key: "scheduler", label: "Scheduler", icon: "⏰", permission: "servers.edit", section: "main" },
  { key: "apikeys", label: "API Keys", icon: "🔐", section: "account" },
  { key: "profile", label: "My Profile", icon: "👤", section: "account", shortcut: "P" },
];

const SECTION_LABELS: Record<string, string> = { main: "Management", community: "Community", admin: "Administration", account: "Account" };

const TAB_META: Record<Tab, { title: string; subtitle: string }> = {
  overview: { title: "Overview", subtitle: "Your hosting control center and quick-start checklist." },
  servers: { title: "Servers", subtitle: "Create, install, start, and manage game servers." },
  files: { title: "File Manager", subtitle: "Browse and edit server files directly in the browser." },
  rcon: { title: "RCON Console", subtitle: "Send remote console commands to supported servers." },
  nodes: { title: "Nodes", subtitle: "Manage the machines that host your servers." },
  games: { title: "Games", subtitle: "Install, edit, import, and create server templates." },
  audit: { title: "Audit", subtitle: "Verify templates, binaries, and live install paths." },
  monitor: { title: "Monitor", subtitle: "Track system health, memory, and buffer/cache usage." },
  forum: { title: "Forum", subtitle: "Community discussions, moderation, and user profiles." },
  cms: { title: "CMS", subtitle: "Publish blog posts, pages, and changelogs." },
  users: { title: "Users", subtitle: "Manage accounts, limits, roles, and account status." },
  roles: { title: "Roles", subtitle: "Create advanced roles and assign granular permissions." },
  profile: { title: "My Profile", subtitle: "Update your account details, password, and security info." },
    database: { title: "Database", subtitle: "Inspect and manage PostgreSQL tables and queries." },
    activity: { title: "Activity Log", subtitle: "Full audit trail — who did what and when." },
    scheduler: { title: "Scheduler", subtitle: "Automate server restarts, backups, and updates on a schedule." },
    apikeys: { title: "API Keys", subtitle: "Generate personal keys for external tools and scripts." },
  };

export default function Dashboard({ user, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ type: string; icon: string; id: number; title: string; subtitle: string }>>([]);

  const loadPerms = useCallback(async () => {
    try { const res = await fetch("/api/auth/permissions"); if (res.ok) setPerms((await res.json()).permissions || {}); } catch { /**/ }
  }, []);
  useEffect(() => { loadPerms(); }, [loadPerms]);

  // Global search — debounced API call when palette query is 2+ chars
  useEffect(() => {
    if (!paletteOpen || paletteQuery.trim().length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(paletteQuery.trim())}`);
        if (res.ok) { const data = await res.json(); setSearchResults(data.results || []); }
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [paletteQuery, paletteOpen]);

  async function handleLogout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /**/ }
    onLogout();
  }

  const filteredNav = NAV_ITEMS.filter((item) => !item.permission || perms[item.permission] === true);

  const sections: Record<string, NavItem[]> = {};
  for (const item of filteredNav) { if (!sections[item.section]) sections[item.section] = []; sections[item.section].push(item); }

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Ctrl/Cmd + K = palette
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); return; }
      if (e.key === "Escape") { setPaletteOpen(false); setMobileMenuOpen(false); return; }

      // Single-key shortcuts (only when no modifiers)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const shortcutMap: Record<string, Tab> = {};
      for (const item of filteredNav) { if (item.shortcut) shortcutMap[item.shortcut.toLowerCase()] = item.key; }

      const target = shortcutMap[e.key.toLowerCase()];
      if (target) { setTab(target); setMobileMenuOpen(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredNav]);

  // ── Command palette ──
  const paletteItems = useMemo(() => {
    const base = filteredNav.map((item) => ({
      id: item.key, icon: item.icon, title: item.label, subtitle: TAB_META[item.key].subtitle,
      section: SECTION_LABELS[item.section] || item.section, shortcut: item.shortcut,
      action: () => { setTab(item.key); setPaletteOpen(false); setPaletteQuery(""); setMobileMenuOpen(false); },
    }));
    const extras = [
      { id: "logout", icon: "🚪", title: "Log out", subtitle: "Return to the public site.", section: "Account", shortcut: undefined, action: () => { setPaletteOpen(false); handleLogout(); } },
      { id: "toggle-sidebar", icon: sidebarOpen ? "◀" : "▶", title: sidebarOpen ? "Collapse sidebar" : "Expand sidebar", subtitle: "Toggle navigation width.", section: "Interface", shortcut: undefined, action: () => { setSidebarOpen((v) => !v); setPaletteOpen(false); } },
    ];
    const all = [...base, ...extras];
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) => i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q));
  }, [filteredNav, paletteQuery, sidebarOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  function navTo(t: Tab) { setTab(t); setMobileMenuOpen(false); }

  function renderPanel() {
    switch (tab) {
      case "overview": return <OverviewPanel user={user} onNavigate={navTo} />;
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
      case "activity": return <ActivityPanel />;
      case "scheduler": return <SchedulerPanel />;
      case "apikeys": return <ApiKeysPanel />;
      default: return <OverviewPanel user={user} onNavigate={navTo} />;
    }
  }

  const roleColor = user.roleColor || "#3b82f6";
  const roleIcon = user.roleIcon || "👤";
  const roleName = user.roleName || user.role;

  return (
    <div className="min-h-screen flex">
      {/* Mobile overlay */}
      {mobileMenuOpen && <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setMobileMenuOpen(false)} />}

      {/* Sidebar */}
      <aside className={`
        ${sidebarOpen ? "w-64" : "w-16"} bg-bg-secondary border-r border-border flex flex-col transition-all duration-300 flex-shrink-0
        fixed lg:relative inset-y-0 left-0 z-40
        ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        <div className="p-4 border-b border-border flex items-center gap-3">
          <span className="text-2xl">🎮</span>
          {sidebarOpen && <div className="overflow-hidden"><h1 className="text-sm font-bold whitespace-nowrap">GameServer Manager</h1><p className="text-[10px] text-text-muted">v1.0.0</p></div>}
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-3">
          {Object.entries(sections).map(([sKey, items]) => (
            <div key={sKey}>
              {sidebarOpen && <p className="text-[10px] text-text-muted uppercase tracking-wider px-3 mb-1">{SECTION_LABELS[sKey] || sKey}</p>}
              <div className="space-y-0.5">
                {items.map((item) => (
                  <button key={item.key} onClick={() => navTo(item.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${tab === item.key ? "bg-accent/15 text-accent" : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"}`}>
                    <span className="text-base">{item.icon}</span>
                    {sidebarOpen && (
                      <span className="flex-1 text-left">{item.label}</span>
                    )}
                    {sidebarOpen && item.shortcut && (
                      <kbd className="text-[9px] text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded font-mono">{item.shortcut}</kbd>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-border">
          <button onClick={() => navTo("profile")} className="w-full flex items-center gap-3 mb-3 hover:bg-bg-hover rounded-lg p-1 transition-colors">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ backgroundColor: `${roleColor}20`, color: roleColor }}>{user.username[0].toUpperCase()}</div>
            {sidebarOpen && <div className="overflow-hidden text-left"><p className="text-sm font-medium truncate">{user.username}</p><p className="text-[10px] truncate" style={{ color: roleColor }}>{roleIcon} {roleName}</p></div>}
          </button>
          <div className="flex gap-2">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="flex-1 px-2 py-1.5 bg-bg-tertiary hover:bg-bg-hover text-text-muted text-xs rounded hidden lg:block">{sidebarOpen ? "◀" : "▶"}</button>
            {sidebarOpen && <ThemeToggleButton compact />}
            {sidebarOpen && <LanguageSelector compact />}
            {sidebarOpen && <button onClick={handleLogout} className="flex-1 px-2 py-1.5 bg-danger/10 hover:bg-danger/20 text-danger text-xs rounded">Logout</button>}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto min-w-0">
        <div className="p-4 lg:p-6 space-y-6">
          {/* Top bar */}
          <div className="bg-bg-card border border-border rounded-xl px-4 py-3 lg:px-5 lg:py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileMenuOpen(true)} className="lg:hidden text-text-muted hover:text-text-primary p-1">
                <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
              </button>
              <div>
                <h2 className="text-lg lg:text-xl font-bold">{TAB_META[tab].title}</h2>
                <p className="text-text-secondary text-xs lg:text-sm hidden sm:block">{TAB_META[tab].subtitle}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setPaletteOpen(true)} className="px-3 py-1.5 bg-bg-secondary border border-border hover:border-accent/30 text-text-muted rounded-lg text-xs transition-colors hidden sm:flex items-center gap-1.5">
                <span>⌘K</span> <span className="hidden md:inline">Quick Jump</span>
              </button>
              <NotificationBell />
              <ThemeToggleButton compact />
            </div>
          </div>
          <ErrorBoundary key={tab} name={tab}>{renderPanel()}</ErrorBoundary>
        </div>
      </main>

      {/* Command Palette */}
      {paletteOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4" onClick={() => setPaletteOpen(false)}>
          <div className="w-full max-w-2xl bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden mt-16 lg:mt-20" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-border">
              <input autoFocus value={paletteQuery} onChange={(e) => setPaletteQuery(e.target.value)} placeholder="Search pages and actions..." className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
              <p className="text-[10px] text-text-muted mt-2">Tip: type a page name or press its shortcut key. Esc to close.</p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="mb-2">
                  <p className="text-[10px] text-text-muted uppercase tracking-wider px-3 mb-1">Search Results</p>
                  {searchResults.map((r) => (
                    <button key={`${r.type}-${r.id}`} onClick={() => {
                      const typeTabMap: Record<string, Tab> = { server: "servers", user: "users", game: "games", thread: "forum", cms: "cms", node: "nodes" };
                      const t = typeTabMap[r.type];
                      if (t) { setTab(t); setPaletteOpen(false); setPaletteQuery(""); setMobileMenuOpen(false); }
                    }} className="w-full text-left p-3 rounded-xl hover:bg-bg-hover transition-colors flex items-center gap-3">
                      <span className="text-xl">{r.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{r.title}</p>
                        <p className="text-xs text-text-muted truncate">{r.subtitle}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {/* Pages */}
              {paletteItems.length > 0 && (
                <div>
                  {searchResults.length > 0 && <p className="text-[10px] text-text-muted uppercase tracking-wider px-3 mb-1 mt-2">Pages & Actions</p>}
                  {paletteItems.map((item) => (
                    <button key={item.id} onClick={item.action} className="w-full text-left p-3 rounded-xl hover:bg-bg-hover transition-colors flex items-center gap-3">
                      <span className="text-xl">{item.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{item.title}</p>
                        <p className="text-xs text-text-muted truncate">{item.subtitle}</p>
                      </div>
                      {item.shortcut && <kbd className="text-[10px] text-text-muted bg-bg-secondary px-2 py-1 rounded font-mono">{item.shortcut}</kbd>}
                    </button>
                  ))}
                </div>
              )}
              {paletteItems.length === 0 && searchResults.length === 0 && <div className="p-6 text-center text-sm text-text-muted">No results found.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
