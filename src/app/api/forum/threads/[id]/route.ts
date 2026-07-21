import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumThreads, forumPosts, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, asc, sql } from "drizzle-orm";

// GET thread with posts and rich user data
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
        authorId: forumThreads.userId,
        authorRole: users.role,
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
        authorId: forumPosts.userId,
        authorName: users.username,
        authorRole: users.role,
        authorBio: users.bio,
        authorLocation: users.location,
        authorJoined: users.createdAt,
        authorPostCount: sql<number>`(select count(*) from forum_posts where user_id = ${forumPosts.userId})::int`,
      })
      .from(forumPosts)
      .leftJoin(users, eq(forumPosts.userId, users.id))
      .where(eq(forumPosts.threadId, Number(id)))
      .orderBy(asc(forumPosts.createdAt));

    return NextResponse.json({ thread, posts });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// POST reply
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    // Check if thread is locked
    const [thread] = await db.select({ locked: forumThreads.locked }).from(forumThreads).where(eq(forumThreads.id, Number(id))).limit(1);
    if (thread?.locked) return NextResponse.json({ error: "Thread is locked" }, { status: 403 });

    const { body } = await req.json();
    if (!body) return NextResponse.json({ error: "Body required" }, { status: 400 });

    const [post] = await db.insert(forumPosts).values({ threadId: Number(id), userId: auth.userId, body }).returning();
    await db.update(forumThreads).set({ updatedAt: new Date() }).where(eq(forumThreads.id, Number(id)));

    return NextResponse.json({ post }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// PATCH thread (admin: pin/lock/edit title)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  try {
    // Check ownership or admin
    const [thread] = await db.select({ userId: forumThreads.userId }).from(forumThreads).where(eq(forumThreads.id, Number(id))).limit(1);
    if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isAdmin = auth.role === "admin" || auth.role === "moderator";
    const isOwner = thread.userId === auth.userId;

    if (!isAdmin && !isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined && (isAdmin || isOwner)) update.title = body.title;
    if (body.pinned !== undefined && isAdmin) update.pinned = body.pinned;
    if (body.locked !== undefined && isAdmin) update.locked = body.locked;

    const [updated] = await db.update(forumThreads).set(update).where(eq(forumThreads.id, Number(id))).returning();
    return NextResponse.json({ thread: updated });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// DELETE thread (admin or owner)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [thread] = await db.select({ userId: forumThreads.userId }).from(forumThreads).where(eq(forumThreads.id, Number(id))).limit(1);
    if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isAdmin = auth.role === "admin" || auth.role === "moderator";
    if (!isAdmin && thread.userId !== auth.userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Delete posts first, then thread
    await db.delete(forumPosts).where(eq(forumPosts.threadId, Number(id)));
    await db.delete(forumThreads).where(eq(forumThreads.id, Number(id)));

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
