"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import FileTransferPanel from "./panels/FileTransferPanel";
import AuditPanel from "./panels/AuditPanel";
import ActivityPanel from "./panels/ActivityPanel";
import SchedulerPanel from "./panels/SchedulerPanel";
import ApiKeysPanel from "./panels/ApiKeysPanel";
import LicensesPanel from "./panels/LicensesPanel";
import SettingsPanel from "./panels/SettingsPanel";
import LadderPanel from "./panels/LadderPanel";
import ShopPanel from "./panels/ShopPanel";
import { ThemeToggleButton } from "./ThemeToggle";
import { NotificationBell } from "./NotificationCenter";
import { LanguageSelector } from "@/lib/i18n";

import { useRouter } from "next/navigation";
import { clampPaletteIndex, stepPaletteIndex } from "@/lib/palette";
import { fetchWithTimeout } from "@/lib/api-client";

const PALETTE_TYPE_TAB_MAP: Record<string, Tab> = { server: "servers", user: "users", game: "games", thread: "forum", cms: "cms", node: "nodes" };

interface AuthUser {
  id: number; username: string; role: string;
  roleName?: string; roleColor?: string; roleIcon?: string;
}
interface Props { user: AuthUser; onLogout: () => void; onGoHome?: () => void }

type Tab = "overview" | "servers" | "files" | "transfer" | "rcon" | "nodes" | "games" | "audit" | "monitor" | "forum" | "cms" | "ladder" | "shop" | "users" | "roles" | "profile" | "database" | "activity" | "scheduler" | "apikeys" | "licenses" | "settings";

interface NavItem { key: Tab; label: string; permission?: string; section: string; shortcut?: string }

const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "Overview", section: "main", shortcut: "O" },
  { key: "servers", label: "Servers", permission: "servers.view", section: "main", shortcut: "S" },
  { key: "files", label: "File Manager", permission: "servers.files", section: "main", shortcut: "F" },
  { key: "transfer", label: "File Transfer", permission: "transfer.view", section: "main" },
  { key: "rcon", label: "RCON Console", permission: "servers.console", section: "main", shortcut: "R" },
  { key: "nodes", label: "Nodes", permission: "nodes.view", section: "main", shortcut: "N" },
  { key: "games", label: "Games", permission: "games.view", section: "main", shortcut: "G" },
  { key: "audit", label: "Audit", permission: "games.install", section: "main", shortcut: "A" },
  { key: "monitor", label: "Monitor", permission: "monitor.view", section: "main", shortcut: "M" },
  { key: "shop", label: "Shop", permission: "shop.view", section: "main", shortcut: "H" },
  { key: "forum", label: "Forum", permission: "forum.view", section: "community" },
  { key: "cms", label: "CMS", permission: "cms.view", section: "community" },
  { key: "ladder", label: "League Ladder", permission: "ladder.view", section: "community", shortcut: "L" },
  { key: "users", label: "Users", permission: "users.view", section: "admin", shortcut: "U" },
  { key: "roles", label: "Roles", permission: "roles.view", section: "admin" },
  { key: "database", label: "Database", permission: "database.view", section: "admin", shortcut: "D" },
  { key: "activity", label: "Activity Log", permission: "security.audit", section: "admin" },
  { key: "settings", label: "Settings", permission: "panel.settings", section: "admin" },
  { key: "scheduler", label: "Scheduler", permission: "scheduler.view", section: "main" },
  { key: "licenses", label: "License Keys", permission: "licenses.view", section: "admin" },
  { key: "apikeys", label: "API Keys", permission: "apikeys.view", section: "account" },
  { key: "profile", label: "My Profile", section: "account", shortcut: "P" },
];

const SECTION_LABELS: Record<string, string> = { main: "Management", community: "Community", admin: "Administration", account: "Account" };

const TAB_META: Record<Tab, { title: string; subtitle: string }> = {
  overview: { title: "Overview", subtitle: "Your hosting control center and quick-start checklist." },
  servers: { title: "Servers", subtitle: "Create, install, start, and manage game servers." },
  files: { title: "File Manager", subtitle: "Browse and edit server files directly in the browser." },
  transfer: { title: "File Transfer", subtitle: "FTP/FTPS logins for uploading large files with any client." },
  rcon: { title: "RCON Console", subtitle: "Send remote console commands to supported servers." },
  nodes: { title: "Nodes", subtitle: "Manage the machines that host your servers." },
  games: { title: "Games", subtitle: "Install, edit, import, and create server templates." },
  audit: { title: "Audit", subtitle: "Verify templates, binaries, and live install paths." },
  monitor: { title: "Monitor", subtitle: "Track system health, memory, and buffer/cache usage." },
  shop: { title: "Shop", subtitle: "Sell licenses, servers, digital goods — full storefront and order management." },
  forum: { title: "Forum", subtitle: "Community discussions, moderation, and user profiles." },
  cms: { title: "CMS", subtitle: "Publish blog posts, pages, and changelogs." },
  ladder: { title: "League Ladder", subtitle: "Season standings, team rankings, and competitive records." },
  users: { title: "Users", subtitle: "Manage accounts, limits, roles, and account status." },
  roles: { title: "Roles", subtitle: "Create advanced roles and assign granular permissions." },
  profile: { title: "My Profile", subtitle: "Update your account details, password, and security info." },
    database: { title: "Database", subtitle: "Inspect and manage PostgreSQL tables and queries." },
    activity: { title: "Activity Log", subtitle: "Full audit trail — who did what and when." },
    scheduler: { title: "Scheduler", subtitle: "Automate server restarts, backups, and updates on a schedule." },
    apikeys: { title: "API Keys", subtitle: "Generate personal keys for external tools and scripts." },
    licenses: { title: "License Keys", subtitle: "Issue and manage installation licenses — the master key desk for distributed panels." },
  settings: { title: "Settings", subtitle: "Access, retention, automation, alerts and integrations — one screen at a time." },
  };

/**
 * Focus treatment shared by the command palette and the mobile navigation
 * drawer: focus moves inside, Tab cycles within, the page behind cannot scroll,
 * Escape closes, and focus returns to the control that opened it. Without this
 * a keyboard user could tab out of a modal into content hidden behind it, or be
 * dropped at the top of the document when it closed.
 */
function useDialogFocus(
  open: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
  onClose: () => void
) {
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      const root = containerRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      (first ?? root).focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
      openerRef.current = null;
    };
  }, [open, containerRef]);

  return function onDialogKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const root = containerRef.current;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}

export default function Dashboard({ user, onLogout, onGoHome }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ type: string; icon: string; id: number; title: string; subtitle: string }>>([]);
  const [paletteIndex, setPaletteIndex] = useState(0);

  // ── dialogs: command palette + mobile navigation ─────────────────────────
  // Both are modal: while open the rest of the page must not be reachable by
  // Tab, the page behind must not scroll, and closing must return focus to the
  // control that opened it (see useDialogFocus).
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const paletteDialogRef = useRef<HTMLDivElement>(null);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const paletteKeyDown = useDialogFocus(paletteOpen, paletteDialogRef, closePalette);
  const mobileNavKeyDown = useDialogFocus(mobileNavOpen, mobileNavRef, closeMobileNav);

  const [permsError, setPermsError] = useState(false);

  // The nav is built from these permissions. If the request fails the menu
  // silently loses every gated panel, which looks like an account that lost its
  // rights — so the failure is surfaced with a retry instead.
  const loadPerms = useCallback(async () => {
    try {
      const res = await fetchWithTimeout("/api/auth/permissions", { cache: "no-store" }, 10_000);
      if (res.ok) {
        setPerms((await res.json()).permissions || {});
        setPermsError(false);
      } else {
        setPermsError(true);
      }
    } catch {
      setPermsError(true);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPerms();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPerms]);

  // Global search — debounced API call when palette query is 2+ chars
  useEffect(() => {
    const trimmed = paletteQuery.trim();
    const timer = window.setTimeout(async () => {
      if (!paletteOpen || trimmed.length < 2) {
        setSearchResults([]);
        return;
      }

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) { const data = await res.json(); setSearchResults(data.results || []); }
      } catch { setSearchResults([]); }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [paletteQuery, paletteOpen]);

  async function handleLogout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } catch { /**/ }
    onLogout();
  }

  const [licenseBanner, setLicenseBanner] = useState<string | null>(null);
  const [licenseLocked, setLicenseLocked] = useState(false);
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteIndex(0); setPaletteOpen((v) => !v); return; }
      if (e.key === "Escape") { setPaletteOpen(false); setOpenGroup(null); return; }

      // A modal owns the keyboard while it is open.
      if (paletteOpen || mobileNavOpen) return;

      // Single-key shortcuts (only when no modifiers)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const shortcutMap: Record<string, Tab> = {};
      for (const item of filteredNav) { if (item.shortcut) shortcutMap[item.shortcut.toLowerCase()] = item.key; }

      const target = shortcutMap[e.key.toLowerCase()];
      if (target) { setTab(target); setOpenGroup(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filteredNav, mobileNavOpen, paletteOpen]);

  // License heartbeat banner: warn during grace, show the lock when locked.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/license/status");
        const data = await res.json().catch(() => null);
        if (cancelled || !res.ok) return;
        setLicenseBanner(data?.banner ?? null);
        setLicenseLocked(data?.state === "locked");
      } catch { /* dashboard keeps working */ }
    };
    const timer = window.setTimeout(() => void check(), 0);
    const interval = window.setInterval(() => void check(), 60_000);
    return () => { cancelled = true; window.clearTimeout(timer); window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    function onWindowClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest("[data-top-menu]")) {
        setOpenGroup(null);
      }
    }
    window.addEventListener("click", onWindowClick);
    return () => window.removeEventListener("click", onWindowClick);
  }, []);

  // ── Command palette ──
  const paletteItems = useMemo(() => {
    const base = filteredNav.map((item) => ({
      id: item.key, icon: undefined as string | undefined, title: item.label, subtitle: TAB_META[item.key].subtitle,
      section: SECTION_LABELS[item.section] || item.section, shortcut: item.shortcut,
      action: () => { setTab(item.key); setPaletteOpen(false); setPaletteQuery(""); setOpenGroup(null); },
    }));
    const extras = [
      { id: "logout", icon: "🚪", title: "Log out", subtitle: "Return to the public site.", section: "Account", shortcut: undefined, action: () => { setPaletteOpen(false); handleLogout(); } },
      { id: "go-home", icon: "🏠", title: "Homepage", subtitle: "Open the public frontpage.", section: "Navigation", shortcut: undefined, action: () => { setPaletteOpen(false); if (onGoHome) onGoHome(); else router.push("/"); } },
    ];
    const all = [...base, ...extras];
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) => i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q));
  }, [filteredNav, paletteQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unified keyboard-navigable list: search results first, then pages/actions.
  const runSearchResult = useCallback((r: { type: string }) => {
    const t = PALETTE_TYPE_TAB_MAP[r.type];
    if (t) { setTab(t); setPaletteOpen(false); setPaletteQuery(""); setOpenGroup(null); }
  }, []);
  const selectables = [
    ...searchResults.map((r) => ({ key: `${r.type}-${r.id}`, run: () => runSearchResult(r) })),
    ...paletteItems.map((i) => ({ key: `item-${i.id}`, run: i.action })),
  ];
  const activeIndex = clampPaletteIndex(paletteIndex, selectables.length);


  function navTo(t: Tab) { setTab(t); setOpenGroup(null); }

  // Switching panels used to keep the previous scroll offset, so a new panel
  // opened half-way down with its heading off-screen.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  function renderPanel() {
    switch (tab) {
      case "overview": return <OverviewPanel user={user} onNavigate={navTo} />;
      case "servers": return <ServersPanel user={user} />;
      // The FTP cross-link only appears for somebody who can actually open that panel.
      case "files": return <FilesPanel user={user} onNavigate={perms["transfer.view"] ? navTo : undefined} />;
      case "transfer": return <FileTransferPanel />;
      case "rcon": return <RconPanel user={user} />;
      case "nodes": return <NodesPanel user={user} />;
      case "games": return <GamesPanel />;
      case "audit": return <AuditPanel />;
      case "monitor": return <MonitorPanel user={user} />;
      case "shop": return <ShopPanel />;
      case "forum": return <ForumPanel user={user} />;
      case "cms": return <CmsPanel />;
      case "ladder": return <LadderPanel />;
      case "users": return <UsersPanel />;
      case "roles": return <RolesPanel />;
      case "profile": return <ProfilePanel />;
      case "database": return <DatabasePanel />;
      case "activity": return <ActivityPanel />;
      case "scheduler": return <SchedulerPanel />;
      case "apikeys": return <ApiKeysPanel />;
      case "licenses": return <LicensesPanel />;
      case "settings": return <SettingsPanel />;
      default: return <OverviewPanel user={user} onNavigate={navTo} />;
    }
  }

  const roleColor = user.roleColor || "#3b82f6";
  const roleIcon = user.roleIcon || "👤";
  const roleName = user.roleName || user.role;

  const orderedSections = ["main", "community", "admin", "account"].filter((section) => sections[section]?.length);

  return (
    <div className="dashboard-shell min-h-screen relative isolate">
      {/* Keyboard users should be able to jump past the header and nav — there
          are more than twenty destinations in it. */}
      <a
        href="#panel-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>
      <main ref={mainRef} id="panel-main" tabIndex={-1} className="overflow-auto min-w-0 relative z-10 outline-none">
        <div className="dashboard-content p-4 lg:p-6 space-y-6 animate-panel-lift">
          {licenseBanner && (
            <div role="alert" className={`rounded-xl border px-4 py-3 text-sm font-medium ${licenseLocked ? "border-danger/40 bg-danger/10 text-danger" : "border-warning/40 bg-warning/10 text-warning"}`}>
              {licenseBanner}
            </div>
          )}
          <header className="gaming-surface relative z-30 overflow-visible rounded-2xl px-4 py-3 lg:px-5 lg:py-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-text-muted">Operations</p>
                  <h2 className="heading-font text-lg lg:text-xl font-bold uppercase tracking-[0.1em] truncate">{TAB_META[tab].title}</h2>
                  <p className="text-text-secondary text-xs lg:text-sm hidden sm:block">{TAB_META[tab].subtitle}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button onClick={() => setPaletteOpen(true)} className="px-3 py-1.5 gaming-chip hover:border-accent/30 text-text-muted rounded-lg text-xs transition-colors hidden sm:flex items-center gap-1.5">
                  <span>⌘K</span> <span className="hidden md:inline">Quick Jump</span>
                </button>
                <NotificationBell />
                <ThemeToggleButton compact />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap" data-top-menu>
              {/* Below lg the group menus would wrap into three rows of tiny
                  targets, so they move into a single drawer instead. */}
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-expanded={mobileNavOpen}
                aria-controls="panel-mobile-nav"
                className="nav-button gaming-chip menu-chip-opaque px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] text-text-secondary hover:text-text-primary flex items-center gap-2 lg:hidden"
              >
                <span aria-hidden>☰</span> Menu
              </button>
              <nav className="hidden lg:flex items-center gap-2 flex-wrap" data-top-menu>
                {orderedSections.map((sectionKey) => (
                  <div key={sectionKey} className="relative" data-top-menu>
                    <button
                      onClick={() => setOpenGroup((curr) => (curr === sectionKey ? null : sectionKey))}
                      className="nav-button gaming-chip menu-chip-opaque px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] text-text-secondary hover:text-text-primary flex items-center gap-2"
                      aria-expanded={openGroup === sectionKey}
                      aria-haspopup="true"
                      data-top-menu
                    >
                      <span>{SECTION_LABELS[sectionKey] || sectionKey}</span>
                      <span className="text-[10px]">▾</span>
                    </button>
                    {openGroup === sectionKey && (
                      <div className="absolute left-0 mt-2 w-72 gaming-surface menu-surface rounded-xl p-2 z-[90]" data-top-menu>
                        <div className="space-y-1">
                          {sections[sectionKey].map((item) => (
                            <button
                              key={item.key}
                              onClick={() => navTo(item.key)}
                              className={`nav-button w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${tab === item.key ? "nav-button-active text-accent" : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"}`}
                            >
                              <span className="flex-1 text-left">{item.label}</span>
                              {item.shortcut && <kbd className="text-[9px] text-text-muted gaming-chip px-1.5 py-0.5 rounded font-mono">{item.shortcut}</kbd>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <button onClick={onGoHome || (() => router.push("/"))} className="nav-button gaming-chip menu-chip-opaque px-3 py-2 rounded-lg text-xs uppercase tracking-[0.14em] text-text-secondary hover:text-text-primary">Frontpage</button>
              </nav>

              <div className="flex items-center gap-2">
                <button onClick={() => navTo("profile")} className="flex items-center gap-2 hover:bg-bg-hover rounded-lg p-1.5 transition-colors">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ backgroundColor: `${roleColor}20`, color: roleColor }}>{user.username[0].toUpperCase()}</div>
                  <div className="overflow-hidden text-left hidden sm:block">
                    <p className="text-xs font-medium truncate">{user.username}</p>
                    <p className="text-[10px] truncate" style={{ color: roleColor }}>{roleIcon} {roleName}</p>
                  </div>
                </button>
                <LanguageSelector compact />
                <button onClick={handleLogout} className="px-2.5 py-1.5 bg-danger/10 hover:bg-danger/20 border border-danger/30 text-danger text-xs rounded-lg">Logout</button>
              </div>
            </div>
          </header>

          {permsError && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-2.5 text-xs font-medium text-warning"
            >
              <span aria-hidden>⚠️</span>
              <span className="min-w-0 flex-1">
                Your menu permissions could not be loaded, so some panels may be
                missing from the menu. Retry — nothing has changed on your account.
              </span>
              <button
                type="button"
                onClick={() => void loadPerms()}
                className="rounded-lg border border-warning/40 px-3 py-1 text-[11px] font-medium transition-colors hover:bg-warning/20"
              >
                Retry
              </button>
            </div>
          )}

          <ErrorBoundary key={tab} name={tab}>{renderPanel()}</ErrorBoundary>
        </div>
      </main>

      {/* Command Palette */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-[80] lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={closeMobileNav} aria-hidden />
          <div
            ref={mobileNavRef}
            id="panel-mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Panel navigation"
            onKeyDown={mobileNavKeyDown}
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-[88%] max-w-sm flex-col overflow-y-auto gaming-surface p-4 shadow-2xl animate-fade-in outline-none"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-text-muted">Navigation</p>
              <button
                type="button"
                onClick={closeMobileNav}
                aria-label="Close navigation"
                className="rounded-lg p-2 text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {orderedSections.map((sectionKey) => (
                <div key={sectionKey}>
                  <p className="mb-1 px-2 text-[10px] uppercase tracking-[0.18em] text-text-muted">
                    {SECTION_LABELS[sectionKey] || sectionKey}
                  </p>
                  <div className="space-y-1">
                    {sections[sectionKey].map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => { navTo(item.key); closeMobileNav(); }}
                        aria-current={tab === item.key ? "page" : undefined}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${tab === item.key ? "bg-accent/10 text-accent" : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"}`}
                      >
                        <span className="flex-1 text-left">{item.label}</span>
                        {item.shortcut && (
                          <kbd className="gaming-chip rounded px-1.5 py-0.5 font-mono text-[9px] text-text-muted">{item.shortcut}</kbd>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-1 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => { closeMobileNav(); navTo("profile"); }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <span className="flex-1 text-left">Profile</span>
              </button>
              <button
                type="button"
                onClick={() => { closeMobileNav(); (onGoHome || (() => router.push("/")))(); }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <span className="flex-1 text-left">Frontpage</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {paletteOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center p-4" onClick={() => setPaletteOpen(false)}>
          <div
            ref={paletteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Quick jump"
            className="w-full max-w-2xl gaming-surface rounded-2xl shadow-2xl overflow-hidden mt-16 lg:mt-20"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={paletteKeyDown}
          >
            <div className="p-4 border-b border-border">
              <input
                ref={paletteInputRef}
                value={paletteQuery}
                onChange={(e) => { setPaletteQuery(e.target.value); setPaletteIndex(0); }}
                onKeyDown={(e) => {
                  // Escape while typing in the palette used to do nothing: the
                  // global handler ignores key events that come from an input.
                  if (e.key === "Escape") { e.preventDefault(); setPaletteOpen(false); return; }
                  if (e.key === "ArrowDown") { e.preventDefault(); setPaletteIndex((i) => stepPaletteIndex(i, selectables.length, 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setPaletteIndex((i) => stepPaletteIndex(i, selectables.length, -1)); }
                  else if (e.key === "Enter") { e.preventDefault(); const sel = selectables[activeIndex]; if (sel) sel.run(); }
                }}
                placeholder="Search pages and actions..."
                aria-label="Search pages and actions"
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <p className="text-[10px] text-text-muted mt-2">Tip: ↑↓ to move · Enter to select · type a page name or press its shortcut key · Esc to close.</p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2">
              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="mb-2">
                  <p className="text-[10px] text-text-muted uppercase tracking-wider px-3 mb-1">Search Results</p>
                  {searchResults.map((r, idx) => (
                    <button key={`${r.type}-${r.id}`} onClick={() => runSearchResult(r)} onMouseEnter={() => setPaletteIndex(idx)} className={`w-full text-left p-3 rounded-xl transition-colors flex items-center gap-3 ${idx === activeIndex ? "bg-bg-hover ring-1 ring-accent/40" : "hover:bg-bg-hover"}`}>
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
                  {paletteItems.map((item, idx) => (
                    <button key={item.id} onClick={item.action} onMouseEnter={() => setPaletteIndex(searchResults.length + idx)} className={`w-full text-left p-3 rounded-xl transition-colors flex items-center gap-3 ${searchResults.length + idx === activeIndex ? "bg-bg-hover ring-1 ring-accent/40" : "hover:bg-bg-hover"}`}>
                      {item.icon && <span className="text-xl">{item.icon}</span>}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{item.title}</p>
                        <p className="text-xs text-text-muted truncate">{item.subtitle}</p>
                      </div>
                      {item.shortcut && <kbd className="text-[10px] text-text-muted gaming-chip px-2 py-1 rounded font-mono">{item.shortcut}</kbd>}
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
