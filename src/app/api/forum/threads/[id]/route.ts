import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumThreads, forumPosts, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, asc } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [thread] = await db
      .select({
        id: forumThreads.id,
        title: forumThreads.title,
        categoryId: forumThreads.categoryId,
        pinned: forumThreads.pinned,
        locked: forumThreads.locked,
        createdAt: forumThreads.createdAt,
        authorName: users.username,
      })
      .from(forumThreads)
      .leftJoin(users, eq(forumThreads.userId, users.id))
      .where(eq(forumThreads.id, Number(id)))
      .limit(1);

    if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const posts = await db
      .select({
        id: forumPosts.id,
        body: forumPosts.body,
        createdAt: forumPosts.createdAt,
        updatedAt: forumPosts.updatedAt,
        authorName: users.username,
        authorId: users.id,
      })
      .from(forumPosts)
      .leftJoin(users, eq(forumPosts.userId, users.id))
      .where(eq(forumPosts.threadId, Number(id)))
      .orderBy(asc(forumPosts.createdAt));

    return NextResponse.json({ thread, posts });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const { body } = await req.json();
    if (!body) return NextResponse.json({ error: "Body required" }, { status: 400 });

    const [post] = await db
      .insert(forumPosts)
      .values({
        threadId: Number(id),
        userId: auth.userId,
        body,
      })
      .returning();

    // Update thread's updatedAt
    await db
      .update(forumThreads)
      .set({ updatedAt: new Date() })
      .where(eq(forumThreads.id, Number(id)));

    return NextResponse.json({ post }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
