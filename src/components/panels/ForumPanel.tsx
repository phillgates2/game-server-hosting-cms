"use client";

import { useEffect, useState, useCallback } from "react";

interface AuthUser {
  id: number;
  username: string;
  role: string;
}

interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number | null;
}

interface Thread {
  id: number;
  title: string;
  pinned: boolean | null;
  locked: boolean | null;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  authorId: number | null;
}

interface Post {
  id: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  authorName: string | null;
  authorId: number | null;
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

  useEffect(() => {
    fetch("/api/forum/categories")
      .then((r) => r.json())
      .then((d) => setCategories(d.categories || []))
      .catch(() => {});
  }, []);

  const loadThreads = useCallback(async (catId: number) => {
    const res = await fetch(`/api/forum/threads?categoryId=${catId}`);
    const d = await res.json();
    setThreads(d.threads || []);
  }, []);

  const loadThread = useCallback(async (threadId: number) => {
    const res = await fetch(`/api/forum/threads/${threadId}`);
    const d = await res.json();
    setPosts(d.posts || []);
  }, []);

  function openCategory(cat: Category) {
    setSelectedCat(cat);
    setView("threads");
    loadThreads(cat.id);
  }

  function openThread(thread: Thread) {
    setSelectedThread(thread);
    setView("thread");
    loadThread(thread.id);
  }

  async function createThread(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCat) return;
    const res = await fetch("/api/forum/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId: selectedCat.id,
        title: newThread.title,
        body: newThread.body,
      }),
    });
    if (res.ok) {
      setShowNewThread(false);
      setNewThread({ title: "", body: "" });
      loadThreads(selectedCat.id);
    }
  }

  async function createReply(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedThread) return;
    const res = await fetch(`/api/forum/threads/${selectedThread.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: replyBody }),
    });
    if (res.ok) {
      setReplyBody("");
      loadThread(selectedThread.id);
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <button onClick={() => setView("categories")} className="text-accent hover:underline">
          Forum
        </button>
        {selectedCat && view !== "categories" && (
          <>
            <span className="text-text-muted">/</span>
            <button onClick={() => { setView("threads"); loadThreads(selectedCat.id); }} className="text-accent hover:underline">
              {selectedCat.name}
            </button>
          </>
        )}
        {selectedThread && view === "thread" && (
          <>
            <span className="text-text-muted">/</span>
            <span className="text-text-secondary">{selectedThread.title}</span>
          </>
        )}
      </div>

      {/* Categories view */}
      {view === "categories" && (
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">💬 Forum</h2>
          <div className="grid gap-3">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => openCategory(cat)}
                className="bg-bg-card border border-border rounded-xl p-5 text-left hover:border-accent/30 transition-colors"
              >
                <h3 className="font-semibold">{cat.name}</h3>
                <p className="text-sm text-text-secondary mt-1">{cat.description}</p>
              </button>
            ))}
            {categories.length === 0 && (
              <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
                <p className="text-text-secondary">No forum categories. Run the installer to set up the forum.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Threads view */}
      {view === "threads" && selectedCat && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">{selectedCat.name}</h2>
              <p className="text-text-secondary text-sm">{selectedCat.description}</p>
            </div>
            <button
              onClick={() => setShowNewThread(!showNewThread)}
              className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium transition-colors"
            >
              {showNewThread ? "Cancel" : "+ New Thread"}
            </button>
          </div>

          {showNewThread && (
            <form onSubmit={createThread} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
              <input
                value={newThread.title}
                onChange={(e) => setNewThread({ ...newThread, title: e.target.value })}
                placeholder="Thread title"
                className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                required
              />
              <textarea
                value={newThread.body}
                onChange={(e) => setNewThread({ ...newThread, body: e.target.value })}
                placeholder="Write your post..."
                rows={4}
                className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-y"
                required
              />
              <button type="submit" className="px-6 py-2 bg-success hover:opacity-90 text-white rounded-lg text-sm font-medium">
                Create Thread
              </button>
            </form>
          )}

          <div className="grid gap-2">
            {threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => openThread(thread)}
                className="bg-bg-card border border-border rounded-xl p-4 text-left hover:border-accent/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {thread.pinned && <span className="text-warning text-xs">📌</span>}
                  {thread.locked && <span className="text-danger text-xs">🔒</span>}
                  <h3 className="font-medium">{thread.title}</h3>
                </div>
                <div className="flex gap-3 mt-1 text-xs text-text-muted">
                  <span>by {thread.authorName}</span>
                  <span>{new Date(thread.createdAt).toLocaleDateString()}</span>
                </div>
              </button>
            ))}
            {threads.length === 0 && (
              <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
                <p className="text-text-secondary text-sm">No threads yet. Start a discussion!</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Thread view */}
      {view === "thread" && selectedThread && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold">{selectedThread.title}</h2>

          <div className="space-y-3">
            {posts.map((post) => (
              <div key={post.id} className="bg-bg-card border border-border rounded-xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-bold">
                    {(post.authorName || "?")[0].toUpperCase()}
                  </div>
                  <div>
                    <span className="text-sm font-medium">{post.authorName}</span>
                    <span className="text-xs text-text-muted ml-2">
                      {new Date(post.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="text-sm text-text-secondary whitespace-pre-wrap">{post.body}</div>
              </div>
            ))}
          </div>

          {!selectedThread.locked && (
            <form onSubmit={createReply} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
              <h3 className="font-medium text-sm">Reply</h3>
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Write your reply..."
                rows={3}
                className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-y"
                required
              />
              <button type="submit" className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">
                Post Reply
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
