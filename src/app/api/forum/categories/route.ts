import { NextResponse } from "next/server";
import { db } from "@/db";
import { forumCategories, forumTopics } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET() {
  try {
    const categories = await db.select().from(forumCategories).orderBy(forumCategories.sortOrder);

    const enriched = await Promise.all(categories.map(async (cat) => {
      const topicCount = await db.select({ count: sql<number>`count(*)` })
        .from(forumTopics)
        .where(eq(forumTopics.categoryId, cat.id));
      return { ...cat, topicCount: Number(topicCount[0]?.count || 0) };
    }));

    return NextResponse.json({ categories: enriched });
  } catch {
    return NextResponse.json({ categories: [] });
  }
}
