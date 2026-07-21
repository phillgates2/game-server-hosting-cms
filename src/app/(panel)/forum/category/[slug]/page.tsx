import { db } from "@/db";
import { forumCategories, forumTopics, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import NewTopicButton from "./NewTopicButton";

export const dynamic = "force-dynamic";

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const cats = await db.select().from(forumCategories).where(eq(forumCategories.slug, slug)).limit(1);
  if (cats.length === 0) return notFound();
  const category = cats[0];

  const topics = await db.select().from(forumTopics)
    .where(eq(forumTopics.categoryId, category.id))
    .orderBy(desc(forumTopics.isPinned), desc(forumTopics.lastPostAt));

  const allUsers = await db.select({ id: users.id, username: users.username, role: users.role }).from(users);

  const enrichedTopics = topics.map(t => ({
    ...t,
    author: allUsers.find(u => u.id === t.userId),
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 text-sm text-dark-400 mb-2">
            <Link href="/forum" className="hover:text-brand-400 transition-colors">Forum</Link>
            <span>/</span>
            <span className="text-white">{category.name}</span>
          </div>
          <h1 className="text-3xl font-bold text-white">{category.name}</h1>
          <p className="text-dark-300 mt-1">{category.description}</p>
        </div>
        <NewTopicButton categoryId={category.id} />
      </div>

      {enrichedTopics.length === 0 ? (
        <div className="glass-card rounded-2xl p-16 text-center">
          <div className="text-5xl mb-4">💬</div>
          <h3 className="text-xl font-bold text-white mb-2">No topics yet</h3>
          <p className="text-dark-300">Be the first to start a discussion!</p>
        </div>
      ) : (
        <div className="glass-card rounded-2xl overflow-hidden">
          {enrichedTopics.map((topic, i) => (
            <Link
              key={topic.id}
              href={`/forum/topic/${topic.id}`}
              className={`flex items-center gap-4 p-5 hover:bg-dark-700/50 transition-all ${
                i < enrichedTopics.length - 1 ? "border-b border-dark-600" : ""
              }`}
            >
              <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center text-sm font-bold text-brand-400">
                {topic.author?.username?.[0]?.toUpperCase() || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {topic.isPinned && <span className="text-yellow-400 text-xs">📌</span>}
                  {topic.isLocked && <span className="text-red-400 text-xs">🔒</span>}
                  <h3 className="font-semibold text-white truncate hover:text-brand-400 transition-colors">
                    {topic.title}
                  </h3>
                </div>
                <div className="text-xs text-dark-400 mt-1">
                  by {topic.author?.username || "Unknown"} • {new Date(topic.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center gap-6 text-xs text-dark-400">
                <div className="text-center">
                  <div className="text-white font-bold">{topic.replyCount}</div>
                  <div>replies</div>
                </div>
                <div className="text-center">
                  <div className="text-white font-bold">{topic.viewCount}</div>
                  <div>views</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
