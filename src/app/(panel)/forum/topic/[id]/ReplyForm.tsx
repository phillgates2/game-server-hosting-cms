"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReplyForm({ topicId }: { topicId: number }) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!content.trim()) { setError("Reply content is required"); return; }
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/forum/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setContent("");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to post reply";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card rounded-2xl p-6">
      <h3 className="text-lg font-bold text-white mb-4">Post a Reply</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        rows={4}
        className="w-full px-4 py-3 bg-dark-800 border border-dark-500 rounded-xl text-white focus:outline-none focus:border-brand-500 resize-none mb-4"
        placeholder="Write your reply..."
      />

      <button
        onClick={handleSubmit}
        disabled={loading}
        className="px-6 py-3 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl transition-all disabled:opacity-50"
      >
        {loading ? "Posting..." : "Post Reply"}
      </button>
    </div>
  );
}
