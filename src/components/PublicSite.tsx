"use client";

import { useEffect, useState, useCallback } from "react";
import PublicChatWidget from "@/components/PublicChatWidget";

/* ── Types ──────────────────────────────────────────────────────────────────── */
interface CmsPost {
  id: number; slug: string; title: string; body: string; type: string;
  excerpt: string | null; pinned: boolean; tags: string[] | null;
  authorName: string | null; createdAt: string;
}
interface ForumCategory {
  id: number; name: string; slug: string; description: string | null;
  threadCount: number; postCount: number; lastActivity: string | null;
}
interface ForumThread {
  id: number; title: string; pinned: boolean | null; locked: boolean | null;
  createdAt: string; updatedAt: string; authorName: string | null;
  authorId: number | null; authorRole: string | null; replyCount: number;
}
interface ForumPost {
  id: number; body: string; createdAt: string; updatedAt: string;
  authorId: number | null; authorName: string | null; authorRole: string | null;
  authorBio: string | null; authorLocation: string | null;
  authorJoined: string | null; authorPostCount: number;
}
interface LadderEntry {
  id: number; rank: number; teamName: string; tag: string | null;
  logoEmoji: string | null; wins: number; losses: number; draws: number;
  points: number; streak: number; notes: string | null;
}
interface LadderOption { type: "game" | "standalone"; id: number | null; name: string; icon: string; }
interface SiteSettings {
  panel_name?: string; hero_title?: string; hero_subtitle?: string;
  hero_cta_text?: string; footer_text?: string;
  announcement?: string; announcement_type?: string;
}
interface Props {
  user: { id: number; username: string; role: string;
    roleName?: string; roleIcon?: string; roleColor?: string; } | null;
  onLoginClick: () => void;
  onDashboardClick: () => void;
  onLogout: () => void;
}

type Tab = "home" | "forums" | "ladder" | "blog" | "changelog" | "post"
  | "forum-cat" | "forum-thread" | "site-editor";



/* ── Component ──────────────────────────────────────────────────────────────── */
export default function PublicSite({ user, onLoginClick, onDashboardClick, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("home");
  const [blogs, setBlogs] = useState<CmsPost[]>([]);
  const [changelogs, setChangelogs] = useState<CmsPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<CmsPost | null>(null);
  const [ss, setSs] = useState<SiteSettings>({});

  // Forum
  const [forumCategories, setForumCategories] = useState<ForumCategory[]>([]);
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [selectedCat, setSelectedCat] = useState<ForumCategory | null>(null);
  const [selectedThread, setSelectedThread] = useState<ForumThread | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newThread, setNewThread] = useState({ title: "", body: "" });
  const [replyBody, setReplyBody] = useState("");

  // Ladder
  const [ladderEntries, setLadderEntries] = useState<LadderEntry[]>([]);
  const [ladders, setLadders] = useState<LadderOption[]>([]);
  const [activeLadderKey, setActiveLadderKey] = useState("");
  const [ladderSeasons, setLadderSeasons] = useState<string[]>([]);
  const [ladderSeason, setLadderSeason] = useState("S1");

  // Site editor
  const [editorSettings, setEditorSettings] = useState<SiteSettings>({});
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorMsg, setEditorMsg] = useState("");

  const [loaded, setLoaded] = useState(false);
  const isAdmin = user?.role === "admin";
  const roleColor = user?.roleColor || "#3b82f6";
  const roleIcon = user?.roleIcon || "👤";
  const roleName = user?.roleName || "Member";

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadCms = useCallback(async () => {
    try {
      const [a, b, c] = await Promise.allSettled([
        fetch("/api/cms?type=blog&published=true"),
        fetch("/api/cms?type=changelog&published=true"),
        fetch("/api/site-settings"),
      ]);
      if (a.status === "fulfilled" && a.value.ok) setBlogs((await a.value.json()).posts || []);
      if (b.status === "fulfilled" && b.value.ok) setChangelogs((await b.value.json()).posts || []);
      if (c.status === "fulfilled" && c.value.ok) {
        const s = (await c.value.json()).settings || {};
        setSs(s);
        setEditorSettings(s);
      }
    } catch { /* */ } finally { setLoaded(true); }
  }, []);
  useEffect(() => { void loadCms(); }, [loadCms]);

  const loadCategories = useCallback(async () => {
    try { const r = await fetch("/api/forum/categories"); if (r.ok) setForumCategories((await r.json()).categories || []); } catch { /* */ }
  }, []);
  const loadThreads = useCallback(async (catId: number) => {
    try { const r = await fetch(`/api/forum/threads?categoryId=${catId}`); if (r.ok) setThreads((await r.json()).threads || []); } catch { /* */ }
  }, []);
  const loadThread = useCallback(async (tid: number) => {
    try { const r = await fetch(`/api/forum/threads/${tid}`); if (r.ok) { const d = await r.json(); if (d.thread) setSelectedThread(d.thread); setPosts(d.posts || []); } } catch { /* */ }
  }, []);
  const loadLadder = useCallback(async (key?: string, season?: string) => {
    try {
      const params = new URLSearchParams();
      if (key) {
        // key format: "game:123" or "standalone:MyLadder"
        if (key.startsWith("game:")) params.set("gameId", key.slice(5));
        else if (key.startsWith("standalone:")) params.set("ladder", key.slice(11));
      }
      if (season) params.set("season", season);
      const r = await fetch(`/api/ladder?${params}`);
      if (r.ok) {
        const d = await r.json();
        setLadderEntries(d.standings || []);
        setLadders(d.ladders || []);
        setLadderSeasons(d.seasons || []);
        if (d.season) setLadderSeason(d.season);
        // Set active key from response
        if (d.activeGameId) setActiveLadderKey(`game:${d.activeGameId}`);
        else if (d.activeLadderName) setActiveLadderKey(`standalone:${d.activeLadderName}`);
      }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    if ((tab === "forums" || tab === "forum-cat" || tab === "forum-thread") && forumCategories.length === 0) void loadCategories();
    if (tab === "ladder" && ladderEntries.length === 0) void loadLadder();
  }, [tab, forumCategories.length, ladderEntries.length, loadCategories, loadLadder]);

  // ── Nav helpers ───────────────────────────────────────────────────────────
  function goTab(t: Tab) { setTab(t); setSelectedPost(null); setSelectedCat(null); setSelectedThread(null); setShowNewThread(false); }
  function openPost(p: CmsPost) { setSelectedPost(p); setTab("post"); }
  function openCategory(c: ForumCategory) { setSelectedCat(c); setTab("forum-cat"); setShowNewThread(false); loadThreads(c.id); }
  function openThread(t: ForumThread) { setSelectedThread(t); setTab("forum-thread"); loadThread(t.id); }

  // ── Forum actions ─────────────────────────────────────────────────────────
  async function createThread(e: React.FormEvent) {
    e.preventDefault(); if (!selectedCat || !user) return;
    const r = await fetch("/api/forum/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categoryId: selectedCat.id, title: newThread.title, body: newThread.body }) });
    if (r.ok) { setShowNewThread(false); setNewThread({ title: "", body: "" }); loadThreads(selectedCat.id); }
  }
  async function createReply(e: React.FormEvent) {
    e.preventDefault(); if (!selectedThread || !user) return;
    const r = await fetch(`/api/forum/threads/${selectedThread.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: replyBody }) });
    if (r.ok) { setReplyBody(""); loadThread(selectedThread.id); }
  }

  // ── Site editor ───────────────────────────────────────────────────────────
  async function saveSettings(e: React.FormEvent) {
    e.preventDefault(); setEditorSaving(true); setEditorMsg("");
    try {
      const r = await fetch("/api/site-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: editorSettings }) });
      if (r.ok) { setSs({ ...editorSettings }); setEditorMsg("✅ Saved!"); } else { const d = await r.json(); setEditorMsg(`❌ ${d.error}`); }
    } catch { setEditorMsg("❌ Failed to save"); } finally { setEditorSaving(false); }
  }

  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const fmtS = (d: string) => new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const fmtF = (d: string) => new Date(d).toLocaleString();
  const panelName = ss.panel_name || "GameServer Manager";
  const heroTitle = ss.hero_title || "Game Server Hosting";
  const heroSub = ss.hero_subtitle || "High-performance game servers with a modern control panel. Multi-node infrastructure, real-time monitoring, and one-click deploys.";


  const roleBadge = (r: string | null) => {
    if (!r) return null;
    const c = r === "admin" ? "bg-danger/15 text-danger" : r === "moderator" ? "bg-purple/15 text-purple" : null;
    return c ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${c}`}>{r}</span> : null;
  };

  const navTabs: [Tab, string][] = [["home","Home"],["forums","Forums"],["ladder","Ladder"],["blog","Blog"],["changelog","Changelog"]];

  /* ═══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      {ss.announcement && (
        <div className={`text-center text-sm py-2 px-4 ${ss.announcement_type === "warning" ? "bg-warning/15 text-warning" : ss.announcement_type === "error" ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent"}`}>{ss.announcement}</div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-bg-secondary/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <button onClick={() => goTab("home")} className="flex items-center gap-3 group">
            <span className="text-2xl">🎮</span>
            <span className="text-lg font-bold group-hover:text-accent transition-colors">{panelName}</span>
          </button>
          <nav className="flex items-center gap-1 flex-wrap">
            {navTabs.map(([k,l]) => (
              <button key={k} onClick={() => goTab(k)}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  tab === k || (k === "forums" && (tab === "forum-cat" || tab === "forum-thread"))
                    ? "text-accent bg-accent/10" : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"}`}>{l}</button>
            ))}
            {user ? (
              <>
                <button onClick={onDashboardClick} className="ml-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">⚙️ Panel</button>
                {isAdmin && <button onClick={() => setTab("site-editor")} className="ml-1 px-3 py-2 text-sm rounded-lg transition-colors text-text-muted hover:text-accent hover:bg-bg-hover" title="Edit Site">✏️</button>}
                <button onClick={onDashboardClick} className="ml-1 flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border hover:bg-bg-hover transition-colors">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: `${roleColor}20`, color: roleColor }}>{user.username[0].toUpperCase()}</div>
                  <div className="hidden md:block text-left"><p className="text-xs font-medium leading-none">{user.username}</p><p className="text-[10px] text-text-muted">{roleIcon} {roleName}</p></div>
                </button>
                <button onClick={onLogout} className="ml-1 px-3 py-2 bg-danger/10 hover:bg-danger/20 border border-danger/30 text-danger text-sm rounded-lg transition-colors">Logout</button>
              </>
            ) : (
              <button onClick={onLoginClick} className="ml-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">Login</button>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 py-8 w-full">

        {/* ═══ HOME ═══ */}
        {tab === "home" && (
          <div className="animate-fade-in space-y-12">
            <section className="text-center py-16">
              <h1 className="text-4xl sm:text-5xl font-bold mb-4"><span className="bg-gradient-to-r from-accent to-purple bg-clip-text text-transparent">{heroTitle}</span></h1>
              <p className="text-text-secondary text-lg max-w-2xl mx-auto mb-8">{heroSub}</p>
              <div className="flex gap-4 justify-center flex-wrap">
                {user
                  ? <button onClick={onDashboardClick} className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors">⚙️ Control Panel</button>
                  : <button onClick={onLoginClick} className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors">Get Started →</button>}
                <button onClick={() => goTab("forums")} className="px-6 py-3 bg-bg-card border border-border hover:border-accent/30 rounded-lg font-medium transition-colors">💬 Forums</button>
                <button onClick={() => goTab("ladder")} className="px-6 py-3 bg-bg-card border border-border hover:border-accent/30 rounded-lg font-medium transition-colors">🏆 Ladder</button>
                <button onClick={() => goTab("blog")} className="px-6 py-3 bg-bg-card border border-border hover:border-accent/30 rounded-lg font-medium transition-colors">📝 Blog</button>
              </div>
            </section>

            {blogs.length > 0 && (<section><div className="flex items-center justify-between mb-6"><h2 className="text-2xl font-bold">Latest Posts</h2><button onClick={() => goTab("blog")} className="text-accent text-sm hover:underline">View All →</button></div><div className="grid grid-cols-1 md:grid-cols-2 gap-6">{blogs.slice(0, 4).map((p) => <PostCard key={p.id} post={p} onClick={() => openPost(p)} fmt={fmt} />)}</div></section>)}
            {changelogs.length > 0 && (<section><div className="flex items-center justify-between mb-6"><h2 className="text-2xl font-bold">Changelog</h2><button onClick={() => goTab("changelog")} className="text-accent text-sm hover:underline">View All →</button></div><div className="space-y-4">{changelogs.slice(0, 3).map((p) => <LogCard key={p.id} post={p} onClick={() => openPost(p)} fmt={fmt} />)}</div></section>)}
            {loaded && blogs.length === 0 && changelogs.length === 0 && (<section className="text-center py-12 bg-bg-card border border-border rounded-xl"><span className="text-4xl block mb-3">✍️</span><h3 className="font-semibold mb-1">No content yet</h3><p className="text-text-secondary text-sm">Create blog posts or changelogs from the Control Panel.</p></section>)}
          </div>
        )}

        {/* ═══ SITE EDITOR (admin only) ═══ */}
        {tab === "site-editor" && isAdmin && (
          <div className="animate-fade-in space-y-6 max-w-3xl mx-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">✏️ Edit Frontpage</h2>
              <button onClick={() => goTab("home")} className="text-accent text-sm hover:underline">← Back to Site</button>
            </div>
            <form onSubmit={saveSettings} className="space-y-6">
              <div className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
                <h3 className="font-semibold text-lg">General</h3>
                <Field label="Site Name" value={editorSettings.panel_name || ""} onChange={(v) => setEditorSettings({ ...editorSettings, panel_name: v })} placeholder="GameServer Manager" />
                <Field label="Footer Text" value={editorSettings.footer_text || ""} onChange={(v) => setEditorSettings({ ...editorSettings, footer_text: v })} placeholder="© 2026 GameServer Manager" />
              </div>
              <div className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
                <h3 className="font-semibold text-lg">Hero Section</h3>
                <Field label="Hero Title" value={editorSettings.hero_title || ""} onChange={(v) => setEditorSettings({ ...editorSettings, hero_title: v })} placeholder="Game Server Hosting" />
                <div>
                  <label className="block text-xs text-text-muted mb-1">Hero Subtitle</label>
                  <textarea value={editorSettings.hero_subtitle || ""} onChange={(e) => setEditorSettings({ ...editorSettings, hero_subtitle: e.target.value })}
                    placeholder="High-performance game servers..." rows={3}
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
              </div>
              <div className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
                <h3 className="font-semibold text-lg">Announcement Banner</h3>
                <Field label="Announcement Text (leave empty to hide)" value={editorSettings.announcement || ""} onChange={(v) => setEditorSettings({ ...editorSettings, announcement: v })} placeholder="Server maintenance tonight..." />
                <div>
                  <label className="block text-xs text-text-muted mb-1">Banner Type</label>
                  <select value={editorSettings.announcement_type || "info"} onChange={(e) => setEditorSettings({ ...editorSettings, announcement_type: e.target.value })}
                    className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent">
                    <option value="info">Info (blue)</option>
                    <option value="warning">Warning (yellow)</option>
                    <option value="error">Error (red)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button type="submit" disabled={editorSaving} className="px-6 py-2.5 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {editorSaving ? "Saving..." : "💾 Save Changes"}
                </button>
                {editorMsg && <span className="text-sm">{editorMsg}</span>}
              </div>
            </form>
          </div>
        )}

        {/* ═══ LADDER ═══ */}
        {tab === "ladder" && (
          <div className="animate-fade-in space-y-6">
            <h2 className="text-2xl font-bold">🏆 League Ladder</h2>
            {ladders.length > 0 && (
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex gap-2 flex-wrap">
                  {ladders.map((l) => {
                    const key = l.type === "game" ? `game:${l.id}` : `standalone:${l.name}`;
                    return (
                      <button key={key} onClick={() => { setActiveLadderKey(key); loadLadder(key, ladderSeason); }}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${activeLadderKey === key ? "bg-accent text-white" : "bg-bg-card border border-border hover:border-accent/30 text-text-secondary"}`}>
                        {l.icon} {l.name}
                      </button>
                    );
                  })}
                </div>
                {ladderSeasons.length > 1 && (
                  <select value={ladderSeason} onChange={(e) => { setLadderSeason(e.target.value); loadLadder(activeLadderKey, e.target.value); }}
                    className="px-3 py-1.5 bg-bg-card border border-border rounded-lg text-sm">
                    {ladderSeasons.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
            )}
            {ladderEntries.length === 0 ? (
              <Empty text="No ladder entries yet." />
            ) : (
              <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-text-muted text-left">
                    <th className="px-4 py-3 w-12">#</th><th className="px-4 py-3">Team</th>
                    <th className="px-4 py-3 text-center">W</th><th className="px-4 py-3 text-center">L</th><th className="px-4 py-3 text-center">D</th>
                    <th className="px-4 py-3 text-center font-bold">Pts</th><th className="px-4 py-3 text-center">Streak</th>
                  </tr></thead>
                  <tbody>
                    {ladderEntries.map((e, i) => (
                      <tr key={e.id} className={`border-b border-border/30 ${i < 3 ? "bg-accent/5" : ""}`}>
                        <td className="px-4 py-3 font-bold text-text-muted">{e.rank}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{e.logoEmoji || "🎯"}</span>
                            <div>
                              <span className="font-semibold">{e.teamName}</span>
                              {e.tag && <span className="text-text-muted text-xs ml-1">[{e.tag}]</span>}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-success font-medium">{e.wins}</td>
                        <td className="px-4 py-3 text-center text-danger font-medium">{e.losses}</td>
                        <td className="px-4 py-3 text-center text-text-muted">{e.draws}</td>
                        <td className="px-4 py-3 text-center font-bold text-accent">{e.points}</td>
                        <td className="px-4 py-3 text-center">{e.streak > 0 ? <span className="text-success">🔥{e.streak}</span> : e.streak < 0 ? <span className="text-danger">❄️{Math.abs(e.streak)}</span> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ═══ FORUMS ═══ */}
        {tab === "forums" && (
          <div className="animate-fade-in">
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
              <div className="space-y-6 min-w-0">
                <h2 className="text-2xl font-bold">💬 Forums</h2>
                {forumCategories.length === 0 ? <Empty text="No forum categories yet." /> : (
                  <div className="grid gap-3">{forumCategories.map((c) => (
                    <button key={c.id} onClick={() => openCategory(c)} className="bg-bg-card border border-border rounded-xl p-5 text-left hover:border-accent/30 transition-colors w-full">
                      <div className="flex items-center justify-between"><div><h3 className="font-semibold text-lg">{c.name}</h3><p className="text-sm text-text-secondary mt-1">{c.description}</p></div>
                        <div className="text-right text-xs text-text-muted flex-shrink-0 ml-4"><p><strong className="text-text-secondary">{c.threadCount}</strong> threads</p><p><strong className="text-text-secondary">{c.postCount}</strong> posts</p>{c.lastActivity && <p className="mt-1">{fmtS(c.lastActivity)}</p>}</div></div>
                    </button>
                  ))}</div>
                )}
              </div>
              <div className="xl:sticky xl:top-20 self-start">
                <PublicChatWidget user={user} onLoginClick={onLoginClick} />
              </div>
            </div>
          </div>
        )}

        {/* ═══ FORUM CATEGORY ═══ */}
        {tab === "forum-cat" && selectedCat && (
          <div className="animate-fade-in">
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
              <div className="space-y-4 min-w-0">
                <Crumb items={[["Forums", () => goTab("forums")], [selectedCat.name]]} />
                <div className="flex items-center justify-between">
                  <div><h2 className="text-2xl font-bold">{selectedCat.name}</h2><p className="text-text-secondary text-sm">{selectedCat.description}</p></div>
                  {user ? <button onClick={() => setShowNewThread(!showNewThread)} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">{showNewThread ? "Cancel" : "+ New Thread"}</button>
                    : <button onClick={onLoginClick} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">Login to Post</button>}
                </div>
                {showNewThread && user && (
                  <form onSubmit={createThread} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
                    <input value={newThread.title} onChange={(e) => setNewThread({ ...newThread, title: e.target.value })} placeholder="Thread title" className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent" required />
                    <textarea value={newThread.body} onChange={(e) => setNewThread({ ...newThread, body: e.target.value })} placeholder="Write your post..." rows={5} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent" required />
                    <button type="submit" className="px-6 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">Create Thread</button>
                  </form>
                )}
                {threads.length === 0 ? <Empty text="No threads yet. Be the first!" /> : (
                  <div className="bg-bg-card border border-border rounded-xl overflow-hidden">{threads.map((t, i) => (
                    <button key={t.id} onClick={() => openThread(t)} className={`w-full text-left p-4 hover:bg-bg-hover transition-colors flex items-center gap-4 ${i > 0 ? "border-t border-border/50" : ""}`}>
                      <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent text-sm font-bold flex-shrink-0">{t.pinned ? "📌" : (t.authorName || "?")[0].toUpperCase()}</div>
                      <div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><h3 className="font-semibold text-sm truncate">{t.title}</h3>{t.pinned && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning">Pinned</span>}{t.locked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/15 text-danger">Locked</span>}</div>
                        <p className="text-xs text-text-muted mt-1">by {t.authorName || "Unknown"} {roleBadge(t.authorRole)} · {fmtS(t.createdAt)} · <strong>{t.replyCount}</strong> replies</p></div>
                    </button>
                  ))}</div>
                )}
              </div>
              <div className="xl:sticky xl:top-20 self-start">
                <PublicChatWidget user={user} onLoginClick={onLoginClick} />
              </div>
            </div>
          </div>
        )}

        {/* ═══ FORUM THREAD ═══ */}
        {tab === "forum-thread" && selectedThread && (
          <div className="animate-fade-in">
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
              <div className="space-y-4 min-w-0">
                <Crumb items={[["Forums", () => goTab("forums")], ...(selectedCat ? [[selectedCat.name, () => { setTab("forum-cat"); loadThreads(selectedCat.id); }] as [string, () => void]] : []), [selectedThread.title]]} />
                <h2 className="text-xl font-bold">{selectedThread.title}</h2>
                <div className="space-y-4">{posts.map((p) => (
                  <div key={p.id} className="bg-bg-card border border-border rounded-xl overflow-hidden"><div className="flex flex-col md:flex-row">
                    <div className="md:w-44 p-4 bg-bg-secondary/50 border-b md:border-b-0 md:border-r border-border/50 flex-shrink-0"><div className="flex md:flex-col items-center md:items-start gap-3">
                      <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent text-sm font-bold">{(p.authorName || "?")[0].toUpperCase()}</div>
                      <div><p className="font-semibold text-sm">{p.authorName || "Unknown"}</p>{roleBadge(p.authorRole)}<div className="text-[10px] text-text-muted mt-1 space-y-0.5"><p>{p.authorPostCount} posts</p>{p.authorLocation && <p>📍 {p.authorLocation}</p>}{p.authorJoined && <p>Joined {fmtS(p.authorJoined)}</p>}</div></div>
                    </div></div>
                    <div className="flex-1 p-4"><span className="text-xs text-text-muted">{fmtF(p.createdAt)}</span><div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed mt-2">{p.body}</div>{p.updatedAt !== p.createdAt && <p className="text-[10px] text-text-muted mt-3 italic">Edited {fmtF(p.updatedAt)}</p>}</div>
                  </div></div>
                ))}</div>
                {selectedThread.locked ? <div className="bg-bg-card border border-border rounded-xl p-6 text-center text-text-muted text-sm">🔒 This thread is locked.</div>
                  : user ? (
                    <form onSubmit={createReply} className="bg-bg-card border border-border rounded-xl p-6 space-y-4"><h3 className="font-semibold text-sm">Reply</h3>
                      <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Write your reply..." rows={4} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent" required />
                      <button type="submit" className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">Post Reply</button></form>
                  ) : <div className="bg-bg-card border border-border rounded-xl p-6 text-center"><button onClick={onLoginClick} className="text-accent hover:underline text-sm">Log in to reply</button></div>}
              </div>
              <div className="xl:sticky xl:top-20 self-start">
                <PublicChatWidget user={user} onLoginClick={onLoginClick} />
              </div>
            </div>
          </div>
        )}

        {/* ═══ BLOG / CHANGELOG / POST ═══ */}
        {tab === "blog" && !selectedPost && (<div className="animate-fade-in space-y-6"><h2 className="text-2xl font-bold">📝 Blog</h2>{blogs.length === 0 && loaded ? <Empty text="No blog posts yet." /> : <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{blogs.map((p) => <PostCard key={p.id} post={p} onClick={() => openPost(p)} fmt={fmt} />)}</div>}</div>)}
        {tab === "changelog" && !selectedPost && (<div className="animate-fade-in space-y-6"><h2 className="text-2xl font-bold">📋 Changelog</h2>{changelogs.length === 0 && loaded ? <Empty text="No changelogs yet." /> : <div className="space-y-4">{changelogs.map((p) => <LogCard key={p.id} post={p} onClick={() => openPost(p)} fmt={fmt} />)}</div>}</div>)}
        {tab === "post" && selectedPost && (
          <article className="animate-fade-in max-w-3xl mx-auto">
            <button onClick={() => { setTab(selectedPost.type === "changelog" ? "changelog" : "blog"); setSelectedPost(null); }} className="text-accent text-sm hover:underline mb-6 block">← Back</button>
            <div className="mb-6"><div className="flex items-center gap-3 text-sm text-text-muted mb-3">{selectedPost.pinned && <span className="text-warning">📌</span>}<span>{fmt(selectedPost.createdAt)}</span>{selectedPost.authorName && <span>by {selectedPost.authorName}</span>}<span className="px-2 py-0.5 bg-accent/15 text-accent rounded text-xs">{selectedPost.type}</span></div><h1 className="text-3xl font-bold">{selectedPost.title}</h1></div>
            {selectedPost.tags && (selectedPost.tags as string[]).length > 0 && <div className="flex gap-2 mb-6 flex-wrap">{(selectedPost.tags as string[]).map((t: string) => <span key={t} className="px-2 py-0.5 bg-bg-secondary text-text-muted rounded text-xs">#{t}</span>)}</div>}
            <div className="bg-bg-card border border-border rounded-xl p-8 text-text-secondary leading-relaxed whitespace-pre-wrap">{selectedPost.body}</div>
          </article>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border mt-auto py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between text-xs text-text-muted flex-wrap gap-2">
          <span>{ss.footer_text || `© ${new Date().getFullYear()} ${panelName}`}</span>
          <div className="flex gap-4">
            {user ? (<><button onClick={onDashboardClick} className="hover:text-text-primary transition-colors">Control Panel</button><button onClick={onLogout} className="hover:text-text-primary transition-colors">Logout</button></>)
              : (<button onClick={onLoginClick} className="hover:text-text-primary transition-colors">Login</button>)}
            <button onClick={() => goTab("forums")} className="hover:text-text-primary transition-colors">Forums</button>
            <button onClick={() => goTab("ladder")} className="hover:text-text-primary transition-colors">Ladder</button>
            <button onClick={() => goTab("blog")} className="hover:text-text-primary transition-colors">Blog</button>
          </div>
        </div>
      </footer>


    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────────── */
function Crumb({ items }: { items: ([string] | [string, (() => void)?])[] }) {
  return <div className="flex items-center gap-2 text-sm mb-2">{items.map(([label, onClick], i) => (
    <span key={i} className="flex items-center gap-2">
      {i > 0 && <span className="text-text-muted">/</span>}
      {onClick ? <button onClick={onClick} className="text-accent hover:underline">{label}</button> : <span className="text-text-secondary truncate max-w-xs">{label}</span>}
    </span>
  ))}</div>;
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <div><label className="block text-xs text-text-muted mb-1">{label}</label><input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent" /></div>;
}
function PostCard({ post, onClick, fmt }: { post: { id: number; title: string; pinned: boolean; excerpt: string | null; body: string; authorName: string | null; createdAt: string }; onClick: () => void; fmt: (d: string) => string }) {
  return <button onClick={onClick} className="bg-bg-card border border-border rounded-xl p-6 text-left hover:border-accent/30 transition-all hover:shadow-lg w-full">{post.pinned && <span className="text-warning text-xs mb-2 block">📌 Pinned</span>}<h3 className="font-semibold text-lg mb-2">{post.title}</h3><p className="text-text-secondary text-sm mb-3 line-clamp-3">{post.excerpt || post.body.slice(0, 200)}</p><div className="flex items-center gap-3 text-xs text-text-muted"><span>{fmt(post.createdAt)}</span>{post.authorName && <span>by {post.authorName}</span>}</div></button>;
}
function LogCard({ post, onClick, fmt }: { post: { id: number; title: string; excerpt: string | null; body: string; createdAt: string }; onClick: () => void; fmt: (d: string) => string }) {
  return <button onClick={onClick} className="bg-bg-card border border-border rounded-xl p-5 text-left hover:border-accent/30 transition-all w-full flex gap-4"><div className="flex-shrink-0 w-24 text-xs text-text-muted">{fmt(post.createdAt)}</div><div className="flex-1 min-w-0"><h3 className="font-semibold mb-1">{post.title}</h3><p className="text-text-secondary text-sm line-clamp-2">{post.excerpt || post.body.slice(0, 150)}</p></div></button>;
}
function Empty({ text }: { text: string }) { return <div className="text-center py-12 bg-bg-card border border-border rounded-xl"><p className="text-text-secondary">{text}</p></div>; }
