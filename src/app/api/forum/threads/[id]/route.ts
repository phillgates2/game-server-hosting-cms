import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumThreads, forumPosts, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, asc, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";

// GET thread with posts and rich user data — publicly readable
export async function GET(
  _req: NextRequest,
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
    return apiError(e, "Unknown", 500);
  }
}

// POST reply
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "forum.post"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;

  try {
    // Check if thread is locked
    const [thread] = await db.select({ locked: forumThreads.locked }).from(forumThreads).where(eq(forumThreads.id, Number(id))).limit(1);
    if (thread?.locked) return NextResponse.json({ error: "Thread is locked" }, { status: 403 });

    const { body } = await req.json();
    if (!body) return NextResponse.json({ error: "Body required" }, { status: 400 });

    // The reply and the thread's activity bump belong together; otherwise a
    // failure leaves a visible reply on a thread that looks untouched, so it
    // sorts to the bottom of an activity-ordered list and nobody sees it.
    const post = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(forumPosts)
        .values({ threadId: Number(id), userId: auth.userId, body })
        .returning();
      await tx
        .update(forumThreads)
        .set({ updatedAt: new Date() })
        .where(eq(forumThreads.id, Number(id)));
      return created;
    });

    return NextResponse.json({ post }, { status: 201 });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
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

    const canThreadModerate =
      (await hasPermission(auth.userId, "forum.thread.edit_any")) ||
      (await hasPermission(auth.userId, "forum.moderate"));
    const isOwner = thread.userId === auth.userId;

    if (!canThreadModerate && !isOwner) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (isOwner && !canThreadModerate && !(await hasPermission(auth.userId, "forum.thread.edit_own"))) {
      return NextResponse.json({ error: "Permission denied" }, { status: 403 });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined && (canThreadModerate || isOwner)) update.title = body.title;
    if (body.pinned !== undefined) {
      const canPin = canThreadModerate || (await hasPermission(auth.userId, "forum.thread.pin")) || (await hasPermission(auth.userId, "forum.pin"));
      if (!canPin) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
      update.pinned = body.pinned;
    }
    if (body.locked !== undefined) {
      const canLock = canThreadModerate || (await hasPermission(auth.userId, "forum.thread.lock")) || (await hasPermission(auth.userId, "forum.lock"));
      if (!canLock) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
      update.locked = body.locked;
    }

    const [updated] = await db.update(forumThreads).set(update).where(eq(forumThreads.id, Number(id))).returning();
    return NextResponse.json({ thread: updated });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
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

    const canDeleteAny =
      (await hasPermission(auth.userId, "forum.thread.delete_any")) ||
      (await hasPermission(auth.userId, "forum.moderate"));
    const isOwner = thread.userId === auth.userId;
    const canDeleteOwn = await hasPermission(auth.userId, "forum.thread.delete_own");

    if (!canDeleteAny && !(isOwner && canDeleteOwn)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Posts first, then the thread -- in one transaction. Run as two separate
    // statements, a failure in between wipes every reply while leaving the
    // thread in place, and the replies are not recoverable.
    await db.transaction(async (tx) => {
      await tx.delete(forumPosts).where(eq(forumPosts.threadId, Number(id)));
      await tx.delete(forumThreads).where(eq(forumThreads.id, Number(id)));
    });

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}
