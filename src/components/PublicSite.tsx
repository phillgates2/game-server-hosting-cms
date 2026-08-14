"use client";

import { useEffect, useState, useCallback } from "react";

interface CmsPost {
  id: number;
  slug: string;
  title: string;
  body: string;
  type: string;
  excerpt: string | null;
  pinned: boolean;
  tags: string[] | null;
  authorName: string | null;
  createdAt: string;
}

interface ForumCategory {
  id: number; name: string; slug: string; description: string | null;
  threadCount: number; postCount: number; lastActivity: string | null;
}

interface Props {
  user: {
    username: string;
    roleName?: string;
    roleIcon?: string;
    roleColor?: string;
  } | null;
  onLoginClick: () => void;
  onDashboardClick: () => void;
  onLogout: () => void;
}

type Tab = "home" | "blog" | "changelog" | "forums" | "post";

export default function PublicSite({ user, onLoginClick, onDashboardClick, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>("home");
  const [blogs, setBlogs] = useState<CmsPost[]>([]);
  const [changelogs, setChangelogs] = useState<CmsPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<CmsPost | null>(null);
  const [forumCategories, setForumCategories] = useState<ForumCategory[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [blogRes, logRes] = await Promise.allSettled([
        fetch("/api/cms?type=blog&published=true"),
        fetch("/api/cms?type=changelog&published=true"),
      ]);
      if (blogRes.status === "fulfilled" && blogRes.value.ok) setBlogs((await blogRes.value.json()).posts || []);
      if (logRes.status === "fulfilled" && logRes.value.ok) setChangelogs((await logRes.value.json()).posts || []);
    } catch { /* ignore */ } finally { setLoaded(true); }
  }, []);

  const loadForumCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/forum/categories");
      if (res.ok) {
        const data = await res.json();
        setForumCategories(data.categories || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    if (tab === "forums" && forumCategories.length === 0) {
      void loadForumCategories();
    }
  }, [tab, forumCategories.length, loadForumCategories]);

  function openPost(post: CmsPost) { setSelectedPost(post); setTab("post"); }
  function fmt(d: string) { return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); }
  const roleColor = user?.roleColor || "#3b82f6";
  const roleIcon = user?.roleIcon || "👤";
  const roleName = user?.roleName || "Member";

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      <header className="border-b border-border bg-bg-secondary/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <button onClick={() => { setTab("home"); setSelectedPost(null); }} className="flex items-center gap-3 group">
            <span className="text-2xl">🎮</span>
            <span className="text-lg font-bold group-hover:text-accent transition-colors">GameServer Manager</span>
          </button>
          <nav className="flex items-center gap-1">
            {([["home","Home"],["forums","Forums"],["blog","Blog"],["changelog","Changelog"]] as const).map(([k,l]) => (
              <button key={k} onClick={() => { setTab(k); setSelectedPost(null); }} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === k ? "text-accent bg-accent/10" : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"}`}>{l}</button>
            ))}
            {user ? (
              <>
                <button onClick={onDashboardClick} className="ml-3 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">Control Panel</button>
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
              <button onClick={onLoginClick} className="ml-3 px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">Login</button>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 py-8 w-full">
        {tab === "home" && (
          <div className="animate-fade-in space-y-12">
            <section id="frontpage" className="text-center py-16">
              <h1 className="text-4xl sm:text-5xl font-bold mb-4"><span className="bg-gradient-to-r from-accent to-purple bg-clip-text text-transparent">Game Server Hosting</span></h1>
              <p className="text-text-secondary text-lg max-w-2xl mx-auto mb-8">High-performance game servers with a modern control panel. Multi-node infrastructure, real-time monitoring, and one-click deploys.</p>
              <div className="flex gap-4 justify-center flex-wrap">
                <button onClick={user ? onDashboardClick : onLoginClick} className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors">{user ? "Open Control Panel →" : "Control Panel →"}</button>
                <button onClick={() => setTab("forums")} className="px-6 py-3 bg-bg-card border border-border hover:border-accent/30 rounded-lg font-medium transition-colors">💬 Forums</button>
                <button onClick={() => setTab("blog")} className="px-6 py-3 bg-bg-card border border-border hover:border-accent/30 rounded-lg font-medium transition-colors">Read Blog</button>
              </div>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { icon: "🖥️", t: "Multi-Node", d: "Deploy game servers across multiple machines from a single panel." },
                { icon: "📊", t: "Live Monitoring", d: "Real-time CPU, RAM, disk, and network stats with buffer management." },
                { icon: "🎮", t: "30+ Games", d: "Pre-built templates for Minecraft, CS2, Rust, Valheim, ARK, and more." },
                { icon: "🔔", t: "Discord Alerts", d: "Webhook notifications for server start, stop, crash, and restarts." },
                { icon: "🗄️", t: "Database Tools", d: "Built-in PostgreSQL viewer and editor — like phpMyAdmin, built in." },
                { icon: "💬", t: "Community Forums", d: "Built-in forums for your gaming community with categories and threads." },
              ].map((f) => (
                <div key={f.t} className="bg-bg-card border border-border rounded-xl p-6 hover:border-accent/30 transition-colors">
                  <span className="text-3xl mb-3 block">{f.icon}</span>
                  <h3 className="font-semibold mb-2">{f.t}</h3>
                  <p className="text-text-secondary text-sm">{f.d}</p>
                </div>
              ))}
            </section>

            <section className="bg-bg-card border border-border rounded-xl p-6">
              <h2 className="text-2xl font-bold mb-4">How it works</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <HowStep number="1" title="Install a game template" text="Choose a built-in template or import one from Pterodactyl/AMP sources." />
                <HowStep number="2" title="Create your server" text="Pick a node, fill in the friendly settings form, and install the files." />
                <HowStep number="3" title="Start and manage it" text="Use Console, File Manager, RCON, and Monitor tools from one dashboard." />
              </div>
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

            <section className="bg-bg-card border border-border rounded-xl p-6">
              <h2 className="text-2xl font-bold mb-4">Quick FAQ</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <Faq q="Do I need to use the terminal?" a="Usually no. Most setup, file editing, installs, and console access are available directly in the panel." />
                <Faq q="Can I host more than one game?" a="Yes. Install multiple templates, create multiple servers, and place them on the same or different nodes." />
                <Faq q="Can I edit config files in the browser?" a="Yes. Use File Manager to edit configs, upload mods, download logs, and browse server folders." />
                <Faq q="How do I know a template is correct?" a="Use the Audit tool to verify expected binaries, scripts, and live install artifacts." />
              </div>
            </section>

            {loaded && blogs.length === 0 && changelogs.length === 0 && (
              <section className="text-center py-12 bg-bg-card border border-border rounded-xl">
                <span className="text-4xl block mb-3">✍️</span>
                <h3 className="font-semibold mb-1">No content yet</h3>
                <p className="text-text-secondary text-sm">Log in and create blog posts or changelogs from the CMS section.</p>
              </section>
            )}
          </div>
        )}

        {/* ═══ FORUMS (public read-only view) ═══ */}
        {tab === "forums" && (
          <div className="animate-fade-in space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">💬 Community Forums</h2>
              {user ? (
                <button onClick={onDashboardClick} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">Open in Dashboard →</button>
              ) : (
                <button onClick={onLoginClick} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg transition-colors">Login to Post →</button>
              )}
            </div>
            {forumCategories.length === 0 ? (
              <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
                <span className="text-4xl block mb-3">💬</span>
                <h3 className="font-semibold mb-1">No forum categories yet</h3>
                <p className="text-text-secondary text-sm">Forum categories will appear here once an admin creates them.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {forumCategories.map((cat) => (
                  <div key={cat.id} className="bg-bg-card border border-border rounded-xl p-5 hover:border-accent/30 transition-colors cursor-pointer" onClick={user ? onDashboardClick : onLoginClick}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-lg">{cat.name}</h3>
                        <p className="text-sm text-text-secondary mt-1">{cat.description}</p>
                      </div>
                      <div className="text-right text-xs text-text-muted flex-shrink-0 ml-4">
                        <p><strong className="text-text-secondary">{cat.threadCount}</strong> threads</p>
                        <p><strong className="text-text-secondary">{cat.postCount}</strong> posts</p>
                        {cat.lastActivity && <p className="mt-1">{fmt(cat.lastActivity)}</p>}
                      </div>
                    </div>
                  </div>
                ))}
                {!user && (
                  <p className="text-center text-text-muted text-sm pt-2">
                    <button onClick={onLoginClick} className="text-accent hover:underline">Log in</button> to create threads and reply to posts.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {tab === "blog" && !selectedPost && (
          <div className="animate-fade-in space-y-6">
            <h2 className="text-2xl font-bold">📝 Blog</h2>
            {blogs.length === 0 && loaded ? <Empty text="No blog posts yet." /> : <div className="grid grid-cols-1 md:grid-cols-2 gap-6">{blogs.map((p) => <PostCard key={p.id} post={p} onClick={() => openPost(p)} fmt={fmt} />)}</div>}
          </div>
        )}

        {tab === "changelog" && !selectedPost && (
          <div className="animate-fade-in space-y-6">
            <h2 className="text-2xl font-bold">📋 Changelog</h2>
            {changelogs.length === 0 && loaded ? <Empty text="No changelogs yet." /> : <div className="space-y-4">{changelogs.map((p) => <LogCard key={p.id} post={p} onClick={() => openPost(p)} fmt={fmt} />)}</div>}
          </div>
        )}

        {tab === "post" && selectedPost && (
          <article className="animate-fade-in max-w-3xl mx-auto">
            <button onClick={() => { setTab(selectedPost.type === "changelog" ? "changelog" : "blog"); setSelectedPost(null); }} className="text-accent text-sm hover:underline mb-6 block">← Back to {selectedPost.type === "changelog" ? "Changelog" : "Blog"}</button>
            <div className="mb-6">
              <div className="flex items-center gap-3 text-sm text-text-muted mb-3">
                {selectedPost.pinned && <span className="text-warning">📌 Pinned</span>}
                <span>{fmt(selectedPost.createdAt)}</span>
                {selectedPost.authorName && <span>by {selectedPost.authorName}</span>}
                <span className="px-2 py-0.5 bg-accent/15 text-accent rounded text-xs">{selectedPost.type}</span>
              </div>
              <h1 className="text-3xl font-bold">{selectedPost.title}</h1>
            </div>
            {selectedPost.tags && (selectedPost.tags as string[]).length > 0 && <div className="flex gap-2 mb-6 flex-wrap">{(selectedPost.tags as string[]).map((t: string) => <span key={t} className="px-2 py-0.5 bg-bg-secondary text-text-muted rounded text-xs">#{t}</span>)}</div>}
            <div className="bg-bg-card border border-border rounded-xl p-8 text-text-secondary leading-relaxed whitespace-pre-wrap">{selectedPost.body}</div>
          </article>
        )}
      </main>

      <footer className="border-t border-border mt-auto py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between text-xs text-text-muted">
          <span>© {new Date().getFullYear()} GameServer Manager</span>
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

function HowStep({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="bg-bg-secondary rounded-xl p-4"><div className="w-8 h-8 rounded-full bg-accent/15 text-accent flex items-center justify-center text-sm font-bold mb-3">{number}</div><h3 className="font-semibold mb-1">{title}</h3><p className="text-text-secondary text-sm">{text}</p></div>;
}
function Faq({ q, a }: { q: string; a: string }) {
  return <div className="bg-bg-secondary rounded-xl p-4"><p className="font-medium mb-1">{q}</p><p className="text-text-secondary">{a}</p></div>;
}
function PostCard({ post, onClick, fmt }: { post: CmsPost; onClick: () => void; fmt: (d: string) => string }) {
  return <button onClick={onClick} className="bg-bg-card border border-border rounded-xl p-6 text-left hover:border-accent/30 transition-all hover:shadow-lg w-full">{post.pinned && <span className="text-warning text-xs mb-2 block">📌 Pinned</span>}<h3 className="font-semibold text-lg mb-2">{post.title}</h3><p className="text-text-secondary text-sm mb-3 line-clamp-3">{post.excerpt || post.body.slice(0, 200)}</p><div className="flex items-center gap-3 text-xs text-text-muted"><span>{fmt(post.createdAt)}</span>{post.authorName && <span>by {post.authorName}</span>}</div></button>;
}
function LogCard({ post, onClick, fmt }: { post: CmsPost; onClick: () => void; fmt: (d: string) => string }) {
  return <button onClick={onClick} className="bg-bg-card border border-border rounded-xl p-5 text-left hover:border-accent/30 transition-all w-full flex gap-4"><div className="flex-shrink-0 w-24 text-xs text-text-muted">{fmt(post.createdAt)}</div><div className="flex-1 min-w-0"><h3 className="font-semibold mb-1">{post.title}</h3><p className="text-text-secondary text-sm line-clamp-2">{post.excerpt || post.body.slice(0, 150)}</p></div></button>;
}
function Empty({ text }: { text: string }) { return <div className="text-center py-12 bg-bg-card border border-border rounded-xl"><p className="text-text-secondary">{text}</p></div>; }
