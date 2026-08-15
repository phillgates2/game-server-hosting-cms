"use client";

import { useEffect, useState, useCallback } from "react";

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
interface SiteSettings {
  panel_name?: string; hero_title?: string; hero_subtitle?: string;
  hero_cta_text?: string; hero_cta_link?: string; footer_text?: string;
  announcement?: string; announcement_type?: string;
}
interface Props {
  user: { id: number; username: string; role: string;
    roleName?: string; roleIcon?: string; roleColor?: string; } | null;
  onLoginClick: () => void;
  onDashboardClick: () => void;
  onLogout: () => void;
}

type Tab = "home" | "forums" | "blog" | "changelog" | "post" | "forum-cat" | "forum-thread";

/* ── Component ──────────────────────────────────────────────────────────────── */
export default function PublicSite({ user, onLoginClick, onDashboardClick, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("home");
  const [blogs, setBlogs] = useState<CmsPost[]>([]);
  const [changelogs, setChangelogs] = useState<CmsPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<CmsPost | null>(null);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>({});

  // Forum state
  const [forumCategories, setForumCategories] = useState<ForumCategory[]>([]);
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [selectedCat, setSelectedCat] = useState<ForumCategory | null>(null);
  const [selectedThread, setSelectedThread] = useState<ForumThread | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newThread, setNewThread] = useState({ title: "", body: "" });
  const [replyBody, setReplyBody] = useState("");

  const [loaded, setLoaded] = useState(false);

  const roleColor = user?.roleColor || "#3b82f6";
  const roleIcon = user?.roleIcon || "👤";
  const roleName = user?.roleName || "Member";

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadCms = useCallback(async () => {
    try {
      const [blogRes, logRes, settingsRes] = await Promise.allSettled([
        fetch("/api/cms?type=blog&published=true"),
        fetch("/api/cms?type=changelog&published=true"),
        fetch("/api/site-settings"),
      ]);
      if (blogRes.status === "fulfilled" && blogRes.value.ok)
        setBlogs((await blogRes.value.json()).posts || []);
      if (logRes.status === "fulfilled" && logRes.value.ok)
        setChangelogs((await logRes.value.json()).posts || []);
      if (settingsRes.status === "fulfilled" && settingsRes.value.ok)
        setSiteSettings((await settingsRes.value.json()).settings || {});
    } catch { /* ignore */ } finally { setLoaded(true); }
  }, []);

  useEffect(() => { void loadCms(); }, [loadCms]);

  const loadCategories = useCallback(async () => {
    try {
      const r = await fetch("/api/forum/categories");
      if (r.ok) setForumCategories((await r.json()).categories || []);
    } catch { /* ignore */ }
  }, []);

  const loadThreads = useCallback(async (catId: number) => {
    try {
      const r = await fetch(`/api/forum/threads?categoryId=${catId}`);
      if (r.ok) setThreads((await r.json()).threads || []);
    } catch { /* ignore */ }
  }, []);

  const loadThread = useCallback(async (threadId: number) => {
    try {
      const r = await fetch(`/api/forum/threads/${threadId}`);
      if (r.ok) {
        const d = await r.json();
        if (d.thread) setSelectedThread(d.thread);
        setPosts(d.posts || []);
      }
    } catch { /* ignore */ }
  }, []);

  // Load forum data when entering forum tabs
  useEffect(() => {
    if ((tab === "forums" || tab === "forum-cat" || tab === "forum-thread") && forumCategories.length === 0) {
      void loadCategories();
    }
  }, [tab, forumCategories.length, loadCategories]);

  // ── Navigation helpers ────────────────────────────────────────────────────
  function openPost(post: CmsPost) { setSelectedPost(post); setTab("post"); }
  function openCategory(cat: ForumCategory) {
    setSelectedCat(cat); setTab("forum-cat"); setShowNewThread(false); loadThreads(cat.id);
  }
  function openThread(thread: ForumThread) {
    setSelectedThread(thread); setTab("forum-thread"); loadThread(thread.id);
  }
  function backToCategories() { setTab("forums"); setSelectedCat(null); }
  function backToThreads() {
    if (selectedCat) { setTab("forum-cat"); loadThreads(selectedCat.id); }
    else setTab("forums");
  }

  // ── Forum actions (authenticated) ─────────────────────────────────────────
  async function createThread(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCat || !user) return;
    const res = await fetch("/api/forum/threads", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: selectedCat.id, title: newThread.title, body: newThread.body }),
    });
    if (res.ok) { setShowNewThread(false); setNewThread({ title: "", body: "" }); loadThreads(selectedCat.id); }
  }

  async function createReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedThread || !user) return;
    const res = await fetch(`/api/forum/threads/${selectedThread.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: replyBody }),
    });
    if (res.ok) { setReplyBody(""); loadThread(selectedThread.id); }
  }

  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const fmtShort = (d: string) => new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const fmtFull = (d: string) => new Date(d).toLocaleString();
  const panelName = siteSettings.panel_name || "GameServer Manager";
  const heroTitle = siteSettings.hero_title || "Game Server Hosting";
  const heroSubtitle = siteSettings.hero_subtitle || "High-performance game servers with a modern control panel. Multi-node infrastructure, real-time monitoring, and one-click deploys.";

  const roleBadge = (role: string | null) => {
    if (!role) return null;
    const c = role === "admin" ? "bg-danger/15 text-danger" : role === "moderator" ? "bg-purple/15 text-purple" : null;
    if (!c) return null;
    return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${c}`}>{role}</span>;
  };

  /* ════════════════════════════════════════════════════════════════════════════
   *  RENDER
   * ════════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      {/* ── Announcement banner ──────────────────────────────────────────────── */}
      {siteSettings.announcement && (
        <div className={`text-center text-sm py-2 px-4 ${siteSettings.announcement_type === "warning" ? "bg-warning/15 text-warning" : siteSettings.announcement_type === "error" ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent"}`}>
          {siteSettings.announcement}
        </div>
      )}

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-bg-secondary/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <button onClick={() => { setTab("home"); setSelectedPost(null); }} className="flex items-center gap-3 group">
            <span className="text-2xl">🎮</span>
            <span className="text-lg font-bold group-hover:text-accent transition-colors">{panelName}</span>
          </button>
          <nav className="flex items-center gap-1 flex-wrap">
            {([["home","Home"],["forums","Forums"],["blog","Blog"],["changelog","Changelog"]] as const).map(([k,l]) => (
              <button key={k} onClick={() => { setTab(k); setSelectedPost(null); setSelectedCat(null); setSelectedThread(null); }}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  (tab === k || (k === "forums" && (tab === "forum-cat" || tab === "forum-thread")))
                    ? "text-accent bg-accent/10" : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"}`}>{l}</button>
            ))}
            {user ? (
              <>
                <button onClick={onDashboardClick} className="ml-2 px-3 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">⚙️ Control Panel</button>
                <button onClick={onDashboardClick} className="ml-1 flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border hover:bg-bg-hover transition-colors">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: `${roleColor}20`, color: roleColor }}>{user.username[0].toUpperCase()}</div>
                  <div className="hidden md:block text-left">
                    <p className="text-xs font-medium leading-none">{user.username}</p>
                    <p className="text-[10px] text-text-muted">{roleIcon} {roleName}</p>
                  </div>
                </button>
                <button onClick={onLogout} className="ml-1 px-3 py-2 bg-danger/10 hover:bg-danger/20 border border-danger/30 text-danger text-sm rounded-lg transition-colors">Logout</button>
              </>
            ) : (
              <button onClick={onLoginClick} className="ml-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">Login</button>
            )}
          </nav>
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 py-8 w-full">

        {/* ═══ HOME ═══ */}
        {tab === "home" && (
          <div className="animate-fade-in space-y-12">
            <section className="text-center py-16">
              <h1 className="text-4xl sm:text-5xl font-bold mb-4">
                <span className="bg-gradient-to-r from-accent to-purple bg-clip-text text-transparent">{heroTitle}</span>
              </h1>
              <p className="text-text-secondary text-lg max-w-2xl mx-auto mb-8">{heroSubtitle}</p>
              <div className="flex gap-4 justify-center flex-wrap">
                {user ? (
                  <button onClick={onDashboardClick} className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors">⚙️ Control Panel</button>
                ) : (
                  <button onClick={onLoginClick} className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors">Get Started →</button>
                )}
                <button onClick={() => setTab("forums")} className="px-6 py-3 bg-bg-card border border-border hover:border-accent/30 rounded-lg font-medium transition-colors">💬 Forums</button>
                <button onClick={() => setTab("blog")} className="px-6 py-3 bg-bg-card border border-border hover:border-accent/30 rounded-lg font-medium transition-colors">📝 Blog</button>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { icon: "🖥️", t: "Multi-Node", d: "Deploy game servers across multiple machines from a single panel." },
                { icon: "📊", t: "Live Monitoring", d: "Real-time CPU, RAM, disk, and network stats with buffer management." },
                { icon: "🎮", t: "30+ Games", d: "Pre-built templates for Minecraft, CS2, Rust, Valheim, ARK, and more." },
                { icon: "🔔", t: "Discord Alerts", d: "Webhook notifications for server start, stop, crash, and restarts." },
                { icon: "💬", t: "Community Forums", d: "Built-in forums for your gaming community with categories and threads." },
                { icon: "🗄️", t: "Database Tools", d: "Built-in PostgreSQL viewer and editor — like phpMyAdmin, built in." },
              ].map((f) => (
                <div key={f.t} className="bg-bg-card border border-border rounded-xl p-6 hover:border-accent/30 transition-colors">
                  <span className="text-3xl mb-3 block">{f.icon}</span>
                  <h3 className="font-semibold mb-2">{f.t}</h3>
                  <p className="text-text-secondary text-sm">{f.d}</p>
                </div>
              ))}
            </section>

            {blogs.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold">Latest Posts</h2>
                  <button onClick={() => setTab("blog")} className="text-accent text-sm hover:underline">View All →</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {blogs.slice(0, 4).map((p) => <PostCard key={p.id} post={p} onClick={() => openPost(p)} fmt={fmt} />)}
                </div>
              </section>
            )}

            {changelogs.length > 0 && (
              <section>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold">Changelog</h2>
                  <button onClick={() => setTab("changelog")} className="text-accent text-sm hover:underline">View All →</button>
                </div>
                <div className="space-y-4">
                  {changelogs.slice(0, 3).map((p) => <LogCard key={p.id} post={p} onClick={() => openPost(p)} fmt={fmt} />)}
                </div>
              </section>
            )}

            {loaded && blogs.length === 0 && changelogs.length === 0 && (
              <section className="text-center py-12 bg-bg-card border border-border rounded-xl">
                <span className="text-4xl block mb-3">✍️</span>
                <h3 className="font-semibold mb-1">No content yet</h3>
                <p className="text-text-secondary text-sm">Log in and create blog posts or changelogs from the CMS section in the Control Panel.</p>
              </section>
            )}
          </div>
        )}

        {/* ═══ FORUMS — Category List ═══ */}
        {tab === "forums" && (
          <div className="animate-fade-in space-y-6">
            <h2 className="text-2xl font-bold">💬 Forums</h2>
            {forumCategories.length === 0 ? (
              <Empty text="No forum categories yet." />
            ) : (
              <div className="grid gap-3">
                {forumCategories.map((cat) => (
                  <button key={cat.id} onClick={() => openCategory(cat)}
                    className="bg-bg-card border border-border rounded-xl p-5 text-left hover:border-accent/30 transition-colors w-full">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-lg">{cat.name}</h3>
                        <p className="text-sm text-text-secondary mt-1">{cat.description}</p>
                      </div>
                      <div className="text-right text-xs text-text-muted flex-shrink-0 ml-4">
                        <p><strong className="text-text-secondary">{cat.threadCount}</strong> threads</p>
                        <p><strong className="text-text-secondary">{cat.postCount}</strong> posts</p>
                        {cat.lastActivity && <p className="mt-1">{fmtShort(cat.lastActivity)}</p>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ FORUMS — Thread List ═══ */}
        {tab === "forum-cat" && selectedCat && (
          <div className="animate-fade-in space-y-4">
            <div className="flex items-center gap-2 text-sm mb-2">
              <button onClick={backToCategories} className="text-accent hover:underline">Forums</button>
              <span className="text-text-muted">/</span>
              <span className="text-text-secondary">{selectedCat.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">{selectedCat.name}</h2>
                <p className="text-text-secondary text-sm">{selectedCat.description}</p>
              </div>
              {user ? (
                <button onClick={() => setShowNewThread(!showNewThread)}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">
                  {showNewThread ? "Cancel" : "+ New Thread"}
                </button>
              ) : (
                <button onClick={onLoginClick} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">Login to Post</button>
              )}
            </div>

            {showNewThread && user && (
              <form onSubmit={createThread} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
                <input value={newThread.title} onChange={(e) => setNewThread({ ...newThread, title: e.target.value })}
                  placeholder="Thread title" className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent" required />
                <textarea value={newThread.body} onChange={(e) => setNewThread({ ...newThread, body: e.target.value })}
                  placeholder="Write your post..." rows={5} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent" required />
                <button type="submit" className="px-6 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">Create Thread</button>
              </form>
            )}

            {threads.length === 0 ? (
              <Empty text="No threads yet. Be the first to start a discussion!" />
            ) : (
              <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
                {threads.map((thread, i) => (
                  <button key={thread.id} onClick={() => openThread(thread)}
                    className={`w-full text-left p-4 hover:bg-bg-hover transition-colors flex items-center gap-4 ${i > 0 ? "border-t border-border/50" : ""}`}>
                    <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent text-sm font-bold flex-shrink-0">
                      {thread.pinned ? "📌" : (thread.authorName || "?")[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-sm truncate">{thread.title}</h3>
                        {thread.pinned && <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/15 text-warning">Pinned</span>}
                        {thread.locked && <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/15 text-danger">Locked</span>}
                      </div>
                      <p className="text-xs text-text-muted mt-1">
                        by {thread.authorName || "Unknown"} {roleBadge(thread.authorRole)} · {fmtShort(thread.createdAt)} · <strong>{thread.replyCount}</strong> replies
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ FORUMS — Thread View ═══ */}
        {tab === "forum-thread" && selectedThread && (
          <div className="animate-fade-in space-y-4">
            <div className="flex items-center gap-2 text-sm mb-2">
              <button onClick={backToCategories} className="text-accent hover:underline">Forums</button>
              {selectedCat && (<><span className="text-text-muted">/</span><button onClick={backToThreads} className="text-accent hover:underline">{selectedCat.name}</button></>)}
              <span className="text-text-muted">/</span>
              <span className="text-text-secondary truncate max-w-xs">{selectedThread.title}</span>
            </div>

            <h2 className="text-xl font-bold">{selectedThread.title}</h2>

            <div className="space-y-4">
              {posts.map((post) => (
                <div key={post.id} className="bg-bg-card border border-border rounded-xl overflow-hidden">
                  <div className="flex flex-col md:flex-row">
                    <div className="md:w-44 p-4 bg-bg-secondary/50 border-b md:border-b-0 md:border-r border-border/50 flex-shrink-0">
                      <div className="flex md:flex-col items-center md:items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent text-sm font-bold">
                          {(post.authorName || "?")[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{post.authorName || "Unknown"}</p>
                          {roleBadge(post.authorRole)}
                          <div className="text-[10px] text-text-muted mt-1 space-y-0.5">
                            <p>{post.authorPostCount} posts</p>
                            {post.authorLocation && <p>📍 {post.authorLocation}</p>}
                            {post.authorJoined && <p>Joined {fmtShort(post.authorJoined)}</p>}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 p-4">
                      <span className="text-xs text-text-muted">{fmtFull(post.createdAt)}</span>
                      <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed mt-2">{post.body}</div>
                      {post.updatedAt !== post.createdAt && <p className="text-[10px] text-text-muted mt-3 italic">Edited {fmtFull(post.updatedAt)}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Reply form */}
            {selectedThread.locked ? (
              <div className="bg-bg-card border border-border rounded-xl p-6 text-center text-text-muted text-sm">🔒 This thread is locked.</div>
            ) : user ? (
              <form onSubmit={createReply} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
                <h3 className="font-semibold text-sm">Reply</h3>
                <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Write your reply..." rows={4}
                  className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm resize-y focus:outline-none focus:ring-2 focus:ring-accent" required />
                <button type="submit" className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">Post Reply</button>
              </form>
            ) : (
              <div className="bg-bg-card border border-border rounded-xl p-6 text-center">
                <button onClick={onLoginClick} className="text-accent hover:underline text-sm">Log in to reply</button>
              </div>
            )}
          </div>
        )}

        {/* ═══ BLOG ═══ */}
        {tab === "blog" && !selectedPost && (
          <div className="animate-fade-in space-y-6">
            <h2 className="text-2xl font-bold">📝 Blog</h2>
            {blogs.length === 0 && loaded ? <Empty text="No blog posts yet." /> :
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{blogs.map((p) => <PostCard key={p.id} post={p} onClick={() => openPost(p)} fmt={fmt} />)}</div>}
          </div>
        )}

        {/* ═══ CHANGELOG ═══ */}
        {tab === "changelog" && !selectedPost && (
          <div className="animate-fade-in space-y-6">
            <h2 className="text-2xl font-bold">📋 Changelog</h2>
            {changelogs.length === 0 && loaded ? <Empty text="No changelogs yet." /> :
              <div className="space-y-4">{changelogs.map((p) => <LogCard key={p.id} post={p} onClick={() => openPost(p)} fmt={fmt} />)}</div>}
          </div>
        )}

        {/* ═══ POST VIEW ═══ */}
        {tab === "post" && selectedPost && (
          <article className="animate-fade-in max-w-3xl mx-auto">
            <button onClick={() => { setTab(selectedPost.type === "changelog" ? "changelog" : "blog"); setSelectedPost(null); }}
              className="text-accent text-sm hover:underline mb-6 block">← Back to {selectedPost.type === "changelog" ? "Changelog" : "Blog"}</button>
            <div className="mb-6">
              <div className="flex items-center gap-3 text-sm text-text-muted mb-3">
                {selectedPost.pinned && <span className="text-warning">📌 Pinned</span>}
                <span>{fmt(selectedPost.createdAt)}</span>
                {selectedPost.authorName && <span>by {selectedPost.authorName}</span>}
                <span className="px-2 py-0.5 bg-accent/15 text-accent rounded text-xs">{selectedPost.type}</span>
              </div>
              <h1 className="text-3xl font-bold">{selectedPost.title}</h1>
            </div>
            {selectedPost.tags && (selectedPost.tags as string[]).length > 0 &&
              <div className="flex gap-2 mb-6 flex-wrap">{(selectedPost.tags as string[]).map((t: string) => <span key={t} className="px-2 py-0.5 bg-bg-secondary text-text-muted rounded text-xs">#{t}</span>)}</div>}
            <div className="bg-bg-card border border-border rounded-xl p-8 text-text-secondary leading-relaxed whitespace-pre-wrap">{selectedPost.body}</div>
          </article>
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border mt-auto py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between text-xs text-text-muted">
          <span>{siteSettings.footer_text || `© ${new Date().getFullYear()} ${panelName}`}</span>
          <div className="flex gap-4">
            {user ? (
              <>
                <button onClick={onDashboardClick} className="hover:text-text-primary transition-colors">Control Panel</button>
                <button onClick={onLogout} className="hover:text-text-primary transition-colors">Logout</button>
              </>
            ) : (
              <button onClick={onLoginClick} className="hover:text-text-primary transition-colors">Login</button>
            )}
            <button onClick={() => setTab("forums")} className="hover:text-text-primary transition-colors">Forums</button>
            <button onClick={() => setTab("blog")} className="hover:text-text-primary transition-colors">Blog</button>
            <button onClick={() => setTab("changelog")} className="hover:text-text-primary transition-colors">Changelog</button>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────────── */
function PostCard({ post, onClick, fmt }: { post: { id: number; title: string; pinned: boolean; excerpt: string | null; body: string; authorName: string | null; createdAt: string }; onClick: () => void; fmt: (d: string) => string }) {
  return <button onClick={onClick} className="bg-bg-card border border-border rounded-xl p-6 text-left hover:border-accent/30 transition-all hover:shadow-lg w-full">{post.pinned && <span className="text-warning text-xs mb-2 block">📌 Pinned</span>}<h3 className="font-semibold text-lg mb-2">{post.title}</h3><p className="text-text-secondary text-sm mb-3 line-clamp-3">{post.excerpt || post.body.slice(0, 200)}</p><div className="flex items-center gap-3 text-xs text-text-muted"><span>{fmt(post.createdAt)}</span>{post.authorName && <span>by {post.authorName}</span>}</div></button>;
}
function LogCard({ post, onClick, fmt }: { post: { id: number; title: string; excerpt: string | null; body: string; createdAt: string }; onClick: () => void; fmt: (d: string) => string }) {
  return <button onClick={onClick} className="bg-bg-card border border-border rounded-xl p-5 text-left hover:border-accent/30 transition-all w-full flex gap-4"><div className="flex-shrink-0 w-24 text-xs text-text-muted">{fmt(post.createdAt)}</div><div className="flex-1 min-w-0"><h3 className="font-semibold mb-1">{post.title}</h3><p className="text-text-secondary text-sm line-clamp-2">{post.excerpt || post.body.slice(0, 150)}</p></div></button>;
}
function Empty({ text }: { text: string }) { return <div className="text-center py-12 bg-bg-card border border-border rounded-xl"><p className="text-text-secondary">{text}</p></div>; }
