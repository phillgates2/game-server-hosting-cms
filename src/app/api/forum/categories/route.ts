import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumCategories, forumThreads, forumPosts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { asc, eq, sql } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "forum.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const categories = await db
      .select()
      .from(forumCategories)
      .orderBy(asc(forumCategories.sortOrder));

    // Get thread and post counts per category
    const threadCounts = await db
      .select({
        categoryId: forumThreads.categoryId,
        threadCount: sql<number>`count(distinct ${forumThreads.id})::int`,
        postCount: sql<number>`count(${forumPosts.id})::int`,
        lastActivity: sql<string>`max(${forumPosts.createdAt})`,
      })
      .from(forumThreads)
      .leftJoin(forumPosts, eq(forumPosts.threadId, forumThreads.id))
      .groupBy(forumThreads.categoryId);

    const countMap = new Map(threadCounts.map((c) => [c.categoryId, c]));

    const result = categories.map((cat) => ({
      ...cat,
      threadCount: countMap.get(cat.id)?.threadCount || 0,
      postCount: countMap.get(cat.id)?.postCount || 0,
      lastActivity: countMap.get(cat.id)?.lastActivity || null,
    }));

    return NextResponse.json({ categories: result });
  } catch {
    return NextResponse.json({ categories: [] });
  }
}
