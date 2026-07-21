import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumTopics, forumPosts, users } from "@/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const topicId = parseInt(id, 10);

  const topics = await db.select().from(forumTopics).where(eq(forumTopics.id, topicId)).limit(1);
  if (topics.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const topic = topics[0];

  // Increment view count
  await db.update(forumTopics).set({ viewCount: topic.viewCount + 1 }).where(eq(forumTopics.id, topicId));

  const posts = await db.select().from(forumPosts).where(eq(forumPosts.topicId, topicId)).orderBy(asc(forumPosts.createdAt));
  const allUsers = await db.select({ id: users.id, username: users.username, role: users.role }).from(users);

  const enrichedPosts = posts.map(p => ({
    ...p,
    author: allUsers.find(u => u.id === p.userId),
  }));

  const author = allUsers.find(u => u.id === topic.userId);

  return NextResponse.json({ topic: { ...topic, author }, posts: enrichedPosts });
}
