import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumTopics, forumPosts, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const categoryId = searchParams.get("categoryId");

  try {
    const condition = categoryId
      ? eq(forumTopics.categoryId, parseInt(categoryId, 10))
      : undefined;

    const topics = condition
      ? await db.select().from(forumTopics).where(condition).orderBy(desc(forumTopics.isPinned), desc(forumTopics.lastPostAt))
      : await db.select().from(forumTopics).orderBy(desc(forumTopics.isPinned), desc(forumTopics.lastPostAt));

    const allUsers = await db.select({ id: users.id, username: users.username, role: users.role }).from(users);

    const enriched = topics.map(t => ({
      ...t,
      author: allUsers.find(u => u.id === t.userId),
    }));

    return NextResponse.json({ topics: enriched });
  } catch {
    return NextResponse.json({ topics: [] });
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { categoryId, title, content } = await request.json();
    if (!categoryId || !title || !content) {
      return NextResponse.json({ error: "All fields required" }, { status: 400 });
    }

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    const topicResult = await db.insert(forumTopics).values({
      categoryId,
      userId: user.userId,
      title,
      slug: `${slug}-${Date.now()}`,
    }).returning();

    const topic = topicResult[0];

    await db.insert(forumPosts).values({
      topicId: topic.id,
      userId: user.userId,
      content,
    });

    return NextResponse.json({ topic });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create topic";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
