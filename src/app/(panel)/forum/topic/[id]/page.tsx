import { db } from "@/db";
import { forumTopics, forumPosts, users, forumCategories } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import ReplyForm from "./ReplyForm";

export const dynamic = "force-dynamic";

export default async function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const topicId = parseInt(id, 10);

  const topics = await db.select().from(forumTopics).where(eq(forumTopics.id, topicId)).limit(1);
  if (topics.length === 0) return notFound();
  const topic = topics[0];

  // Increment views
  await db.update(forumTopics).set({ viewCount: topic.viewCount + 1 }).where(eq(forumTopics.id, topicId));

  const posts = await db.select().from(forumPosts).where(eq(forumPosts.topicId, topicId)).orderBy(asc(forumPosts.createdAt));
  const allUsers = await db.select({ id: users.id, username: users.username, role: users.role }).from(users);
  const cats = await db.select().from(forumCategories).where(eq(forumCategories.id, topic.categoryId)).limit(1);

  const enrichedPosts = posts.map(p => ({
    ...p,
    author: allUsers.find(u => u.id === p.userId),
  }));

  const topicAuthor = allUsers.find(u => u.id === topic.userId);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-dark-400 mb-4">
        <Link href="/forum" className="hover:text-brand-400 transition-colors">Forum</Link>
        <span>/</span>
        {cats[0] && (
          <>
            <Link href={`/forum/category/${cats[0].slug}`} className="hover:text-brand-400 transition-colors">{cats[0].name}</Link>
            <span>/</span>
          </>
        )}
        <span className="text-white truncate">{topic.title}</span>
      </div>

      {/* Topic Header */}
      <div className="glass-card rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-2">
          {topic.isPinned && <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded-full">📌 Pinned</span>}
          {topic.isLocked && <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">🔒 Locked</span>}
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">{topic.title}</h1>
        <div className="flex items-center gap-4 text-sm text-dark-300">
          <span>by <span className="text-brand-400">{topicAuthor?.username || "Unknown"}</span></span>
          <span>•</span>
          <span>{new Date(topic.createdAt).toLocaleString()}</span>
          <span>•</span>
          <span>{topic.viewCount + 1} views</span>
          <span>•</span>
          <span>{topic.replyCount} replies</span>
        </div>
      </div>

      {/* Posts */}
      <div className="space-y-4 mb-6">
        {enrichedPosts.map((post, i) => (
          <div key={post.id} className="glass-card rounded-2xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-brand-500/20 flex items-center justify-center text-lg font-bold text-brand-400 flex-shrink-0">
                {post.author?.username?.[0]?.toUpperCase() || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-3">
                  <span className="font-semibold text-white">{post.author?.username || "Unknown"}</span>
                  {post.author?.role === "admin" && (
                    <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">Admin</span>
                  )}
                  <span className="text-xs text-dark-400">{new Date(post.createdAt).toLocaleString()}</span>
                  {i === 0 && <span className="px-2 py-0.5 bg-brand-500/20 text-brand-400 text-xs rounded-full">OP</span>}
                </div>
                <div className="text-gray-300 whitespace-pre-wrap">{post.content}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Reply Form */}
      {!topic.isLocked && <ReplyForm topicId={topic.id} />}
    </div>
  );
}
