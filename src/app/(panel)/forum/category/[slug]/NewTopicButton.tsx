"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewTopicButton({ categoryId }: { categoryId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!title || !content) { setError("Title and content are required"); return; }
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/forum/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, title, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setOpen(false);
      setTitle("");
      setContent("");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create topic";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-6 py-3 bg-gradient-to-r from-brand-500 to-accent-500 text-white font-semibold rounded-xl hover:opacity-90 transition-all"
      >
        + New Topic
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="glass-card rounded-2xl p-8 w-full max-w-lg animate-slide-up">
            <h2 className="text-2xl font-bold text-white mb-6">Create New Topic</h2>

            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-dark-300 mb-2">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white focus:outline-none focus:border-brand-500"
                  placeholder="Topic title..."
                />
              </div>
              <div>
                <label className="block text-sm text-dark-300 mb-2">Content</label>
                <textarea
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  rows={6}
                  className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white focus:outline-none focus:border-brand-500 resize-none"
                  placeholder="Write your post..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 py-3 px-6 bg-dark-600 hover:bg-dark-500 text-white rounded-xl transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 py-3 px-6 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl transition-all disabled:opacity-50"
              >
                {loading ? "Creating..." : "Create Topic"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
