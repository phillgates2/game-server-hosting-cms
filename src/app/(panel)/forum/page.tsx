import { db } from "@/db";
import { forumCategories, forumTopics } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ForumPage() {
  const categories = await db.select().from(forumCategories).orderBy(forumCategories.sortOrder);

  const enriched = await Promise.all(categories.map(async (cat) => {
    const topicCount = await db.select({ count: sql<number>`count(*)` })
      .from(forumTopics)
      .where(eq(forumTopics.categoryId, cat.id));
    return { ...cat, topicCount: Number(topicCount[0]?.count || 0) };
  }));

  const categoryIcons: Record<string, string> = {
    announcements: "📢",
    general: "💬",
    "game-servers": "🖥️",
    support: "🎫",
    "off-topic": "🎲",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Community Forum</h1>
          <p className="text-dark-300 mt-1">Connect with other gamers and get help</p>
        </div>
      </div>

      <div className="space-y-4">
        {enriched.map(cat => (
          <Link
            key={cat.id}
            href={`/forum/category/${cat.slug}`}
            className="glass-card rounded-2xl p-6 flex items-center gap-6 hover:border-brand-500/40 transition-all group block"
          >
            <div className="w-14 h-14 rounded-xl bg-dark-600 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">
              {categoryIcons[cat.slug] || "💬"}
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-white group-hover:text-brand-400 transition-colors">{cat.name}</h3>
              <p className="text-dark-300 text-sm mt-1">{cat.description}</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-white">{cat.topicCount}</div>
              <div className="text-xs text-dark-400">topics</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
