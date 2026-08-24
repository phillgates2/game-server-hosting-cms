"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import SandboxChat from "@/components/SandboxChat";
import { useToast } from "@/components/ToastProvider";
import { mutate } from "@/lib/api-client";

interface AuthUser { id: number; username: string; role: string }

interface Category {
  id: number; name: string; slug: string; description: string | null;
  sortOrder: number | null;
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
  const confirm = useConfirm();
  const toast = useToast();
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

  // Category management state
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCat, setNewCat] = useState({ name: "", description: "", sortOrder: 0 });
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editCat, setEditCat] = useState({ name: "", description: "", sortOrder: 0 });
  const [catError, setCatError] = useState("");

  const isMod = user.role === "admin" || user.role === "moderator";

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/forum/categories");
      if (res.ok) {
        const d = await res.json();
        setCategories(d.categories || []);
      }
    } catch { /* ignore */ }
  }, []);

  // Load once on mount. Keying the effect on the callback makes it a
  // synchronous setState-in-effect that React flags as a cascading render.
  const didLoadCategories = useRef(false);
  useEffect(() => {
    if (didLoadCategories.current) return;
    didLoadCategories.current = true;
    void loadCategories();
  }, [loadCategories]);

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

  // ── Category CRUD ─────────────────────────────────────────────────────────
  async function createCategory(e: React.FormEvent) {
    e.preventDefault();
    setCatError("");
    const res = await fetch("/api/forum/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCat),
    });
    const data = await res.json();
    if (!res.ok) { setCatError(data.error || "Failed to create category"); return; }
    setShowNewCategory(false);
    setNewCat({ name: "", description: "", sortOrder: 0 });
    loadCategories();
  }

  async function updateCategory(e: React.FormEvent) {
    e.preventDefault();
    setCatError("");
    const res = await fetch("/api/forum/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingCatId, ...editCat }),
    });
    const data = await res.json();
    if (!res.ok) { setCatError(data.error || "Failed to update category"); return; }
    setEditingCatId(null);
    loadCategories();
  }

  async function deleteCategory(catId: number, catName: string) {
    const ok = await confirm({ title: "Delete Category", message: `Delete category "${catName}"? This only works if the category has no threads.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    setCatError("");
    const res = await fetch("/api/forum/categories", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: catId }),
    });
    const data = await res.json();
    if (!res.ok) { setCatError(data.error || "Failed to delete category"); return; }
    loadCategories();
  }

  function startEditCategory(cat: Category) {
    setEditingCatId(cat.id);
    setEditCat({ name: cat.name, description: cat.description || "", sortOrder: cat.sortOrder || 0 });
    setCatError("");
  }

  // ── Thread/Post CRUD ──────────────────────────────────────────────────────
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
    const res = await mutate(`/api/forum/threads/${threadId}`, { method: "PATCH", body: JSON.stringify({ pinned: !current }) });
    if (!res.ok) return toast.error(current ? "Could not unpin" : "Could not pin", res.error);
    if (selectedCat) loadThreads(selectedCat.id);
    loadThread(threadId);
  }
  async function toggleLock(threadId: number, current: boolean | null) {
    const res = await mutate(`/api/forum/threads/${threadId}`, { method: "PATCH", body: JSON.stringify({ locked: !current }) });
    if (!res.ok) return toast.error(current ? "Could not unlock" : "Could not lock", res.error);
    loadThread(threadId);
  }
  async function deleteThread(threadId: number) {
    const ok = await confirm({ title: "Delete Thread", message: "Delete this thread and all of its posts? This cannot be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const res = await mutate(`/api/forum/threads/${threadId}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Could not delete thread", res.error);
    toast.success("Thread deleted");
    if (selectedCat) { setView("threads"); loadThreads(selectedCat.id); }
  }

  async function savePostEdit(postId: number) {
    const res = await mutate(`/api/forum/posts/${postId}`, { method: "PATCH", body: JSON.stringify({ body: editBody }) });
    if (!res.ok) return toast.error("Could not save the edit", res.error);
    setEditingPostId(null); setEditBody("");
    if (selectedThread) loadThread(selectedThread.id);
  }
  async function deletePost(postId: number) {
    const ok = await confirm({ title: "Delete Post", message: "Delete this post? This cannot be undone.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const res = await mutate(`/api/forum/posts/${postId}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Could not delete post", res.error);
    if (selectedThread) loadThread(selectedThread.id);
  }
  function quotePost(post: Post) {
    setQuoteText(`${post.authorName}: ${post.body.slice(0, 200)}`);
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
    <div className="animate-fade-in panel-view space-y-6">
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

      {/* Main content + Chat sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
        {/* Left: Forum content */}
        <div className="space-y-6 min-w-0">

      {/* ═══ CATEGORIES ═══ */}
      {view === "categories" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">💬 Forum</h2>
            {isMod && (
              <button
                onClick={() => { setShowNewCategory(!showNewCategory); setEditingCatId(null); setCatError(""); }}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium"
              >
                {showNewCategory ? "Cancel" : "+ New Category"}
              </button>
            )}
          </div>

          {catError && (
            <div className="bg-danger/10 border border-danger/30 text-danger rounded-lg px-4 py-3 text-sm">{catError}</div>
          )}

          {/* New category form */}
          {showNewCategory && isMod && (
            <form onSubmit={createCategory} className="gaming-surface rounded-xl p-6 space-y-4">
              <h3 className="font-semibold">Create New Category</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Name *</label>
                  <input
                    value={newCat.name}
                    onChange={(e) => setNewCat({ ...newCat, name: e.target.value })}
                    placeholder="e.g. General Discussion"
                    className="w-full px-4 py-2.5 gaming-chip rounded-lg text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Sort Order</label>
                  <input
                    type="number"
                    value={newCat.sortOrder}
                    onChange={(e) => setNewCat({ ...newCat, sortOrder: Number(e.target.value) })}
                    className="w-full px-4 py-2.5 gaming-chip rounded-lg text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Description</label>
                <input
                  value={newCat.description}
                  onChange={(e) => setNewCat({ ...newCat, description: e.target.value })}
                  placeholder="Brief description of what this category is for"
                  className="w-full px-4 py-2.5 gaming-chip rounded-lg text-sm"
                />
              </div>
              <button type="submit" className="px-6 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">
                Create Category
              </button>
            </form>
          )}

          {categories.length === 0 && !showNewCategory ? (
            <div className="gaming-surface rounded-xl p-8 text-center text-text-secondary">
              No forum categories yet.
              {isMod && <> Click <strong>+ New Category</strong> to create one.</>}
            </div>
          ) : (
            <div className="grid gap-3">
              {categories.map((cat) => (
                <div key={cat.id} className="gaming-surface rounded-xl p-5 transition-colors">
                  {/* Edit mode */}
                  {editingCatId === cat.id ? (
                    <form onSubmit={updateCategory} className="space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Name</label>
                          <input
                            value={editCat.name}
                            onChange={(e) => setEditCat({ ...editCat, name: e.target.value })}
                            className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Description</label>
                          <input
                            value={editCat.description}
                            onChange={(e) => setEditCat({ ...editCat, description: e.target.value })}
                            className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-text-muted mb-1">Sort Order</label>
                          <input
                            type="number"
                            value={editCat.sortOrder}
                            onChange={(e) => setEditCat({ ...editCat, sortOrder: Number(e.target.value) })}
                            className="w-full px-3 py-2 gaming-chip rounded-lg text-sm"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button type="submit" className="px-4 py-1.5 bg-success hover:opacity-90 text-white rounded-lg text-xs font-medium">Save</button>
                        <button type="button" onClick={() => setEditingCatId(null)} className="px-4 py-1.5 bg-bg-secondary border border-border text-text-secondary rounded-lg text-xs font-medium">Cancel</button>
                      </div>
                    </form>
                  ) : (
                    /* Normal display */
                    <div className="flex items-center justify-between">
                      <button onClick={() => openCategory(cat)} className="text-left flex-1 min-w-0">
                        <h3 className="font-semibold">{cat.name}</h3>
                        <p className="text-sm text-text-secondary mt-1">{cat.description}</p>
                      </button>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                        <div className="text-right text-xs text-text-muted">
                          <p><strong>{cat.threadCount}</strong> threads</p>
                          <p><strong>{cat.postCount}</strong> posts</p>
                          {cat.lastActivity && <p className="mt-1">{fmt(cat.lastActivity)}</p>}
                        </div>
                        {isMod && (
                          <div className="flex gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); startEditCategory(cat); }}
                              className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-accent transition-colors"
                              title="Edit category"
                            >✏️</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteCategory(cat.id, cat.name); }}
                              className="p-1.5 rounded hover:bg-danger/10 text-text-muted hover:text-danger transition-colors"
                              title="Delete category"
                            >🗑️</button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
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
            <form onSubmit={createThread} className="gaming-surface rounded-xl p-6 space-y-4">
              <input value={newThread.title} onChange={(e) => setNewThread({ ...newThread, title: e.target.value })} placeholder="Thread title" className="w-full px-4 py-2.5 gaming-chip rounded-lg text-sm" required />
              <textarea value={newThread.body} onChange={(e) => setNewThread({ ...newThread, body: e.target.value })} placeholder="Write your post..." rows={5} className="w-full px-4 py-2.5 gaming-chip rounded-lg text-sm resize-y" required />
              <button type="submit" className="px-6 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">Create Thread</button>
            </form>
          )}

          {threads.length === 0 ? (
            <div className="gaming-surface rounded-xl p-8 text-center text-text-secondary text-sm">No threads yet. Start a discussion!</div>
          ) : (
            <div className="gaming-surface rounded-xl overflow-hidden">
              {threads.map((thread, i) => (
                <button key={thread.id} onClick={() => openThread(thread)} className={`w-full text-left p-4 hover:bg-bg-hover transition-colors flex items-center gap-4 ${i > 0 ? "border-t border-border/50" : ""}`}>
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
                      by {thread.authorName || "Unknown"} {roleBadge(thread.authorRole)} · {fmt(thread.createdAt)} · <strong>{thread.replyCount}</strong> replies
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ THREAD VIEW ═══ */}
      {view === "thread" && selectedThread && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-xl font-bold">{selectedThread.title}</h2>
            {isMod && (
              <div className="flex gap-2 text-xs">
                <button onClick={() => togglePin(selectedThread.id, selectedThread.pinned)} className="px-3 py-1.5 gaming-chip rounded-lg hover:bg-bg-hover">{selectedThread.pinned ? "Unpin" : "📌 Pin"}</button>
                <button onClick={() => toggleLock(selectedThread.id, selectedThread.locked)} className="px-3 py-1.5 gaming-chip rounded-lg hover:bg-bg-hover">{selectedThread.locked ? "Unlock" : "🔒 Lock"}</button>
                <button onClick={() => deleteThread(selectedThread.id)} className="px-3 py-1.5 bg-danger/10 border border-danger/30 text-danger rounded-lg hover:bg-danger/20">Delete</button>
              </div>
            )}
          </div>

          <div className="space-y-4">
            {posts.map((post) => (
              <div key={post.id} className="gaming-surface rounded-xl overflow-hidden">
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
                          {post.authorJoined && <p>Joined {fmt(post.authorJoined)}</p>}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-text-muted">{fmtFull(post.createdAt)}</span>
                      <div className="flex gap-1">
                        <button onClick={() => quotePost(post)} className="text-xs text-text-muted hover:text-accent px-2 py-1 rounded hover:bg-bg-hover">Quote</button>
                        {(post.authorId === user.id || isMod) && (
                          <>
                            <button onClick={() => { setEditingPostId(post.id); setEditBody(post.body); }} className="text-xs text-text-muted hover:text-accent px-2 py-1 rounded hover:bg-bg-hover">Edit</button>
                            <button onClick={() => deletePost(post.id)} className="text-xs text-text-muted hover:text-danger px-2 py-1 rounded hover:bg-bg-hover">Delete</button>
                          </>
                        )}
                      </div>
                    </div>
                    {editingPostId === post.id ? (
                      <div className="space-y-2">
                        <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={4} className="w-full px-3 py-2 gaming-chip rounded-lg text-sm resize-y" />
                        <div className="flex gap-2">
                          <button onClick={() => savePostEdit(post.id)} className="px-4 py-1.5 bg-success text-white rounded-lg text-xs">Save</button>
                          <button onClick={() => setEditingPostId(null)} className="px-4 py-1.5 gaming-chip rounded-lg text-xs">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">{post.body}</div>
                    )}
                    {post.updatedAt !== post.createdAt && <p className="text-[10px] text-text-muted mt-3 italic">Edited {fmtFull(post.updatedAt)}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Reply form */}
          {!selectedThread.locked ? (
            <form id="forum-reply" onSubmit={createReply} className="gaming-surface rounded-xl p-6 space-y-4">
              <h3 className="font-semibold text-sm">Reply</h3>
              {quoteText && (
                <div className="bg-bg-secondary rounded-lg p-3 text-sm text-text-secondary border-l-4 border-accent flex items-start gap-2">
                  <span className="flex-1 italic line-clamp-3">{quoteText}</span>
                  <button type="button" onClick={() => setQuoteText("")} className="text-text-muted hover:text-danger text-xs flex-shrink-0">✕</button>
                </div>
              )}
              <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Write your reply..." rows={4} className="w-full px-4 py-2.5 gaming-chip rounded-lg text-sm resize-y" required />
              <button type="submit" className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">Post Reply</button>
            </form>
          ) : (
            <div className="gaming-surface rounded-xl p-6 text-center text-text-muted text-sm">🔒 This thread is locked. No new replies.</div>
          )}
        </div>
      )}

        </div>{/* end left column */}

        {/* Right: Sandbox Chat sidebar */}
        <div className="xl:sticky xl:top-4 self-start">
          <SandboxChat user={user} />
        </div>
      </div>{/* end grid */}
    </div>
  );
}
