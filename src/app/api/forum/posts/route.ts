import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumPosts, forumTopics } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, sql } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { topicId, content } = await request.json();
    if (!topicId || !content) {
      return NextResponse.json({ error: "Topic ID and content required" }, { status: 400 });
    }

    const result = await db.insert(forumPosts).values({
      topicId,
      userId: user.userId,
      content,
    }).returning();

    // Update topic reply count and last post time
    await db.update(forumTopics).set({
      replyCount: sql`${forumTopics.replyCount} + 1`,
      lastPostAt: new Date(),
    }).where(eq(forumTopics.id, topicId));

    return NextResponse.json({ post: result[0] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create post";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
