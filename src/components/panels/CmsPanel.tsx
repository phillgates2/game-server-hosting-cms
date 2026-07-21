"use client";

import { useEffect, useState, useCallback } from "react";

interface CmsPost {
  id: number;
  slug: string;
  title: string;
  body: string;
  type: string;
  excerpt: string | null;
  published: boolean;
  pinned: boolean;
  tags: string[] | null;
  authorName: string | null;
  createdAt: string;
}

export default function CmsPanel() {
  const [posts, setPosts] = useState<CmsPost[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<CmsPost | null>(null);
  const [form, setForm] = useState({
    title: "",
    content: "",
    type: "blog",
    excerpt: "",
    tags: "",
    published: true,
    pinned: false,
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const loadPosts = useCallback(async () => {
    try {
      const res = await fetch("/api/cms?published=false");
      const data = await res.json();
      setPosts(data.posts || []);
    } catch {
      // ignore
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  function resetForm() {
    setForm({ title: "", content: "", type: "blog", excerpt: "", tags: "", published: true, pinned: false });
    setEditing(null);
    setShowCreate(false);
  }

  function startEdit(post: CmsPost) {
    setForm({
      title: post.title,
      content: post.body,
      type: post.type,
      excerpt: post.excerpt || "",
      tags: post.tags ? (post.tags as string[]).join(", ") : "",
      published: post.published,
      pinned: post.pinned,
    });
    setEditing(post);
    setShowCreate(true);
  }

  async function savePost(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    const payload = {
      title: form.title,
      content: form.content,
      type: form.type,
      excerpt: form.excerpt || form.content.slice(0, 200),
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      published: form.published,
      pinned: form.pinned,
    };

    try {
      let res;
      if (editing) {
        res = await fetch(`/api/cms/${editing.slug}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/cms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: "error", text: data.error || "Failed" });
      } else {
        setMessage({ type: "success", text: editing ? "Post updated" : "Post created" });
        resetForm();
        loadPosts();
      }
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed" });
    } finally {
      setLoading(false);
    }
  }

  async function deletePost(slug: string) {
    if (!confirm("Delete this post?")) return;
    try {
      await fetch(`/api/cms/${slug}`, { method: "DELETE" });
      loadPosts();
    } catch {
      // ignore
    }
  }

  async function togglePublish(post: CmsPost) {
    try {
      await fetch(`/api/cms/${post.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: !post.published }),
      });
      loadPosts();
    } catch {
      // ignore
    }
  }

  const filteredPosts = filter === "all" ? posts : posts.filter((p) => p.type === filter);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">✍️ Content Management</h2>
          <p className="text-text-secondary text-sm">Create blog posts, changelogs, and pages for the public site</p>
        </div>
        <button
          onClick={() => { if (showCreate) resetForm(); else setShowCreate(true); }}
          className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium"
        >
          {showCreate ? "Cancel" : "+ New Post"}
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-lg text-sm ${message.type === "success" ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}>
          {message.text}
        </div>
      )}

      {/* Create/Edit form */}
      {showCreate && (
        <form onSubmit={savePost} className="bg-bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="font-semibold">{editing ? "Edit Post" : "New Post"}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs text-text-muted mb-1">Title *</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
                required
                placeholder="My Post Title"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
              >
                <option value="blog">📝 Blog Post</option>
                <option value="changelog">📋 Changelog</option>
                <option value="page">📄 Page</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Excerpt (optional)</label>
            <input
              value={form.excerpt}
              onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
              placeholder="Short summary shown on cards"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Content *</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm resize-y min-h-[200px]"
              required
              placeholder="Write your post content..."
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-text-muted mb-1">Tags (comma-separated)</label>
              <input
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-sm"
                placeholder="update, gameserver, news"
              />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.published}
                  onChange={(e) => setForm({ ...form, published: e.target.checked })}
                  className="rounded"
                />
                Published
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
                  className="rounded"
                />
                Pinned
              </label>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-success hover:opacity-90 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            {loading ? "Saving..." : editing ? "Update Post" : "Create Post"}
          </button>
        </form>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        {[
          ["all", "All"],
          ["blog", "📝 Blog"],
          ["changelog", "📋 Changelog"],
          ["page", "📄 Pages"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === key ? "bg-accent text-white" : "bg-bg-secondary text-text-muted hover:text-text-primary"
            }`}
          >
            {label} {key === "all" ? `(${posts.length})` : `(${posts.filter((p) => p.type === key).length})`}
          </button>
        ))}
      </div>

      {/* Posts list */}
      {!loaded && (
        <div className="text-center py-8">
          <div className="inline-block w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {loaded && filteredPosts.length === 0 && (
        <div className="bg-bg-card border border-border rounded-xl p-12 text-center">
          <span className="text-4xl block mb-3">✍️</span>
          <h3 className="font-semibold mb-1">No posts yet</h3>
          <p className="text-text-secondary text-sm">Create a blog post or changelog to populate the public site</p>
        </div>
      )}

      {filteredPosts.length > 0 && (
        <div className="grid gap-3">
          {filteredPosts.map((post) => (
            <div key={post.id} className="bg-bg-card border border-border rounded-xl p-5 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">{post.type === "blog" ? "📝" : post.type === "changelog" ? "📋" : "📄"}</span>
                  <h3 className="font-medium truncate">{post.title}</h3>
                  {post.pinned && <span className="text-warning text-xs">📌</span>}
                  <span className={`px-2 py-0.5 rounded text-[10px] ${
                    post.published ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
                  }`}>
                    {post.published ? "Published" : "Draft"}
                  </span>
                </div>
                <div className="flex gap-3 text-xs text-text-muted">
                  <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                  {post.authorName && <span>by {post.authorName}</span>}
                  <span className="font-mono">{post.slug}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => togglePublish(post)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium ${
                    post.published ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
                  }`}
                >
                  {post.published ? "Unpublish" : "Publish"}
                </button>
                <button
                  onClick={() => startEdit(post)}
                  className="px-3 py-1 bg-accent/15 text-accent rounded-lg text-xs font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => deletePost(post.slug)}
                  className="px-3 py-1 bg-danger/15 text-danger rounded-lg text-xs font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
