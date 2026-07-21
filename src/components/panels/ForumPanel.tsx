"use client";

import { useEffect, useState, useCallback } from "react";

interface AuthUser { id: number; username: string; role: string }

interface Category {
  id: number; name: string; slug: string; description: string | null;
  threadCount: number; postCount: number; lastActivity: string | null;
}
interface Thread {
  id: number; title: string; pinned: boolean | null; locked: boolean | null;
  createdAt: string; updatedAt: string; authorName: string | null;
  authorId: number | null; authorRole: string | null; replyCount: number;
}
interface Post {
  id: number; body: string; createdAt: string; updatedAt: string;
  authorId: number | null; authorName: string | null; authorRole: string | null;
  authorBio: string | null; authorLocation: string | null;
  authorJoined: string | null; authorPostCount: number;
}

type View = "categories" | "threads" | "thread";

export default function ForumPanel({ user }: { user: AuthUser }) {
  const [view, setView] = useState<View>("categories");
  const [categories, setCategories] = useState<Category[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedCat, setSelectedCat] = useState<Category | null>(null);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newThread, setNewThread] = useState({ title: "", body: "" });
  const [replyBody, setReplyBody] = useState("");
  const [editingPostId, setEditingPostId] = useState<number | null>(null);
  const [editBody, setEditBody] = useState("");
  const [quoteText, setQuoteText] = useState("");

  const isMod = user.role === "admin" || user.role === "moderator";

  useEffect(() => {
    fetch("/api/forum/categories").then((r) => r.json()).then((d) => setCategories(d.categories || [])).catch(() => {});
  }, []);

  const loadThreads = useCallback(async (catId: number) => {
    const d = await (await fetch(`/api/forum/threads?categoryId=${catId}`)).json();
    setThreads(d.threads || []);
  }, []);

  const loadThread = useCallback(async (threadId: number) => {
    const d = await (await fetch(`/api/forum/threads/${threadId}`)).json();
    if (d.thread) setSelectedThread(d.thread);
    setPosts(d.posts || []);
  }, []);

  function openCategory(cat: Category) { setSelectedCat(cat); setView("threads"); loadThreads(cat.id); }
  function openThread(thread: Thread) { setSelectedThread(thread); setView("thread"); loadThread(thread.id); }

  async function createThread(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCat) return;
    const res = await fetch("/api/forum/threads", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: selectedCat.id, title: newThread.title, body: newThread.body }),
    });
    if (res.ok) { setShowNewThread(false); setNewThread({ title: "", body: "" }); loadThreads(selectedCat.id); }
  }

  async function createReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedThread) return;
    const fullBody = quoteText ? `> ${quoteText}\n\n${replyBody}` : replyBody;
    const res = await fetch(`/api/forum/threads/${selectedThread.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: fullBody }),
    });
    if (res.ok) { setReplyBody(""); setQuoteText(""); loadThread(selectedThread.id); }
  }

  async function togglePin(threadId: number, current: boolean | null) {
    await fetch(`/api/forum/threads/${threadId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinned: !current }) });
    if (selectedCat) loadThreads(selectedCat.id);
    loadThread(threadId);
  }
  async function toggleLock(threadId: number, current: boolean | null) {
    await fetch(`/api/forum/threads/${threadId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locked: !current }) });
    loadThread(threadId);
  }
  async function deleteThread(threadId: number) {
    if (!confirm("Delete this thread and all its posts?")) return;
    await fetch(`/api/forum/threads/${threadId}`, { method: "DELETE" });
    if (selectedCat) { setView("threads"); loadThreads(selectedCat.id); }
  }

  async function savePostEdit(postId: number) {
    await fetch(`/api/forum/posts/${postId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: editBody }) });
    setEditingPostId(null); setEditBody("");
    if (selectedThread) loadThread(selectedThread.id);
  }
  async function deletePost(postId: number) {
    if (!confirm("Delete this post?")) return;
    await fetch(`/api/forum/posts/${postId}`, { method: "DELETE" });
    if (selectedThread) loadThread(selectedThread.id);
  }
  function quotePost(post: Post) {
    setQuoteText(`${post.authorName}: ${post.body.slice(0, 200)}`);
    // Scroll to reply box
    document.getElementById("forum-reply")?.scrollIntoView({ behavior: "smooth" });
  }

  const roleBadge = (role: string | null) => {
    if (!role) return null;
    const c = role === "admin" ? "bg-danger/15 text-danger" : role === "moderator" ? "bg-purple/15 text-purple" : null;
    if (!c) return null;
    return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${c}`}>{role}</span>;
  };

  const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  const fmtFull = (d: string) => new Date(d).toLocaleString();

  return (
    <div className="animate-fade-in space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <button onClick={() => setView("categories")} className="text-accent hover:underline">Forum</button>
        {selectedCat && view !== "categories" && (
          <><span className="text-text-muted">/</span><button onClick={() => { setView("threads"); loadThreads(selectedCat.id); }} className="text-accent hover:underline">{selectedCat.name}</button></>
        )}
        {selectedThread && view === "thread" && (
          <><span className="text-text-muted">/</span><span className="text-text-secondary truncate max-w-xs">{selectedThread.title}</span></>
        )}
      </div>

      {/* ═══ CATEGORIES ═══ */}
      {view === "categories" && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">💬 Forum</h2>
          {categories.length === 0 ? (
            <div className="bg-bg-card border border-border rounded-xl p-8 text-center text-text-secondary">No forum categories. Run the installer.</div>
          ) : (
            <div className="grid gap-3">
              {categories.map((cat) => (
                <button key={cat.id} onClick={() => openCategory(cat)} className="bg-bg-card border border-border rounded-xl p-5 text-left hover:border-accent/30 transition-colors w-full">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{cat.name}</h3>
                      <p className="text-sm text-text-secondary mt-1">{cat.description}</p>
                    </div>
                    <div className="text-right text-xs text-text-muted flex-shrink-0 ml-4">
                      <p><strong>{cat.threadCount}</strong> threads</p>
                      <p><strong>{cat.postCount}</strong> posts</p>
                      {cat.lastActivity && <p className="mt-1">{fmt(cat.lastActivity)}</p>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ THREADS ═══ */}
      {view === "threads" && selectedCat && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">{selectedCat.name}</h2>
              <p className="text-text-secondary text-sm">{selectedCat.description}</p>
            </div>
            <button onClick={() => setShowNewThread(!showNewThread)} className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">
              {showNewThread ? "Cancel" : "+ New Thread"}
            </button>
          </div>

          {showNewThread && (
            <form onSubmit={createThread} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
              <input value={newThread.title} onChange={(e) => setNewThread({ ...newThread, title: e.target.value })} placeholder="Thread title" className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm" required />
              <textarea value={newThread.body} onChange={(e) => setNewThread({ ...newThread, body: e.target.value })} placeholder="Write your post..." rows={5} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm resize-y" required />
              <button type="submit" className="px-6 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">Create Thread</button>
            </form>
          )}

          {threads.length === 0 ? (
            <div className="bg-bg-card border border-border rounded-xl p-8 text-center text-text-secondary text-sm">No threads yet. Start a discussion!</div>
          ) : (
            <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
              {threads.map((thread, i) => (
                <button key={thread.id} onClick={() => openThread(thread)} className={`w-full text-left p-4 hover:bg-bg-hover transition-colors flex items-center gap-4 ${i > 0 ? "border-t border-border/50" : ""}`}>
                  <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent text-sm font-bold flex-shrink-0">
                    {thread.pinned ? "📌" : (thread.authorName || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {thread.pinned && <span className="text-warning text-[10px] font-medium bg-warning/10 px-1.5 py-0.5 rounded">Pinned</span>}
                      {thread.locked && <span className="text-danger text-[10px] font-medium bg-danger/10 px-1.5 py-0.5 rounded">🔒 Locked</span>}
                      <h3 className="font-medium truncate">{thread.title}</h3>
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-text-muted">
                      <span>{thread.authorName}</span>
                      {roleBadge(thread.authorRole)}
                      <span>{fmt(thread.createdAt)}</span>
                    </div>
                  </div>
                  <div className="text-right text-xs text-text-muted flex-shrink-0">
                    <p className="text-sm font-medium text-text-secondary">{Math.max(thread.replyCount, 0)}</p>
                    <p>replies</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ THREAD ═══ */}
      {view === "thread" && selectedThread && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              {selectedThread.pinned && <span className="text-warning text-xs bg-warning/10 px-2 py-0.5 rounded">📌 Pinned</span>}
              {selectedThread.locked && <span className="text-danger text-xs bg-danger/10 px-2 py-0.5 rounded">🔒 Locked</span>}
              <h2 className="text-xl font-bold">{selectedThread.title}</h2>
            </div>
            {isMod && (
              <div className="flex gap-2">
                <button onClick={() => togglePin(selectedThread.id, selectedThread.pinned)} className="px-3 py-1 bg-warning/15 text-warning rounded-lg text-xs font-medium">
                  {selectedThread.pinned ? "Unpin" : "📌 Pin"}
                </button>
                <button onClick={() => toggleLock(selectedThread.id, selectedThread.locked)} className="px-3 py-1 bg-accent/15 text-accent rounded-lg text-xs font-medium">
                  {selectedThread.locked ? "Unlock" : "🔒 Lock"}
                </button>
                <button onClick={() => deleteThread(selectedThread.id)} className="px-3 py-1 bg-danger/15 text-danger rounded-lg text-xs font-medium">
                  🗑️ Delete
                </button>
              </div>
            )}
          </div>

          {/* Posts */}
          <div className="space-y-4">
            {posts.map((post, i) => (
              <div key={post.id} className="bg-bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex flex-col md:flex-row">
                  {/* Author sidebar */}
                  <div className="md:w-48 bg-bg-secondary/50 p-4 md:border-r border-b md:border-b-0 border-border flex md:flex-col items-center md:items-start gap-3">
                    <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center text-accent text-lg font-bold flex-shrink-0">
                      {(post.authorName || "?")[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{post.authorName}</p>
                        {roleBadge(post.authorRole)}
                      </div>
                      <div className="text-[10px] text-text-muted mt-1 space-y-0.5">
                        <p>{post.authorPostCount} posts</p>
                        {post.authorJoined && <p>Joined {fmt(post.authorJoined)}</p>}
                        {post.authorLocation && <p>📍 {post.authorLocation}</p>}
                      </div>
                    </div>
                  </div>

                  {/* Post body */}
                  <div className="flex-1 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-text-muted">{fmtFull(post.createdAt)}{post.updatedAt !== post.createdAt ? " (edited)" : ""}</span>
                      <span className="text-[10px] text-text-muted">#{i + 1}</span>
                    </div>

                    {editingPostId === post.id ? (
                      <div className="space-y-3">
                        <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={4} className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm resize-y" />
                        <div className="flex gap-2">
                          <button onClick={() => savePostEdit(post.id)} className="px-4 py-1.5 bg-success hover:opacity-90 text-white rounded-lg text-xs font-medium">Save</button>
                          <button onClick={() => { setEditingPostId(null); setEditBody(""); }} className="px-4 py-1.5 bg-bg-secondary text-text-muted rounded-lg text-xs font-medium">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
                        {post.body.split("\n").map((line, li) =>
                          line.startsWith("> ") ? (
                            <div key={li} className="border-l-2 border-accent/30 pl-3 py-1 my-2 text-text-muted italic text-xs bg-bg-secondary/50 rounded-r">
                              {line.slice(2)}
                            </div>
                          ) : (
                            <span key={li}>{line}{"\n"}</span>
                          )
                        )}
                      </div>
                    )}

                    {/* Post actions */}
                    {editingPostId !== post.id && (
                      <div className="flex gap-2 mt-4 pt-3 border-t border-border/50">
                        {!selectedThread.locked && (
                          <button onClick={() => quotePost(post)} className="px-2 py-1 text-[10px] text-text-muted hover:text-accent transition-colors">
                            💬 Quote
                          </button>
                        )}
                        {(post.authorId === user.id || isMod) && (
                          <button onClick={() => { setEditingPostId(post.id); setEditBody(post.body); }} className="px-2 py-1 text-[10px] text-text-muted hover:text-accent transition-colors">
                            ✏️ Edit
                          </button>
                        )}
                        {(post.authorId === user.id || isMod) && i > 0 && (
                          <button onClick={() => deletePost(post.id)} className="px-2 py-1 text-[10px] text-text-muted hover:text-danger transition-colors">
                            🗑️ Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Reply */}
          {!selectedThread.locked ? (
            <form id="forum-reply" onSubmit={createReply} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
              <h3 className="font-medium text-sm">Post a Reply</h3>
              {quoteText && (
                <div className="border-l-2 border-accent/30 pl-3 py-2 bg-bg-secondary rounded-r text-xs text-text-muted flex items-start justify-between">
                  <span className="italic">{quoteText.slice(0, 200)}{quoteText.length > 200 ? "..." : ""}</span>
                  <button type="button" onClick={() => setQuoteText("")} className="text-text-muted hover:text-danger ml-2 flex-shrink-0">✕</button>
                </div>
              )}
              <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Write your reply..." rows={4} className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm resize-y" required />
              <button type="submit" className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">Post Reply</button>
            </form>
          ) : (
            <div className="bg-bg-card border border-border rounded-xl p-6 text-center text-text-muted text-sm">
              🔒 This thread is locked. No new replies can be posted.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
