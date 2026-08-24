import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumThreads, forumPosts, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, desc, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { limitParam, offsetParam } from "@/lib/pagination";

export async function GET(req: NextRequest) {
  // Forum threads are publicly readable — no auth required
  const url = new URL(req.url);
  const categoryId = url.searchParams.get("categoryId");
  const limit = limitParam(url.searchParams, 100);
  const offset = offsetParam(url.searchParams);

  try {
    let query = db
      .select({
        id: forumThreads.id,
        title: forumThreads.title,
        pinned: forumThreads.pinned,
        locked: forumThreads.locked,
        createdAt: forumThreads.createdAt,
        updatedAt: forumThreads.updatedAt,
        authorName: users.username,
        authorId: users.id,
        authorRole: users.role,
        replyCount: sql<number>`(select count(*) from forum_posts where thread_id = ${forumThreads.id})::int - 1`,
      })
      .from(forumThreads)
      .leftJoin(users, eq(forumThreads.userId, users.id))
      .orderBy(desc(forumThreads.pinned), desc(forumThreads.updatedAt))
      .$dynamic();

    if (categoryId) {
      query = query.where(eq(forumThreads.categoryId, Number(categoryId)));
    }

    // Publicly readable and unauthenticated, with a correlated subquery per
    // row: without a cap an anonymous visitor can force a full scan of every
    // thread in the forum on each request.
    const threads = await query.limit(limit).offset(offset);
    return NextResponse.json({ threads, limit, offset });
  } catch {
    return NextResponse.json({ threads: [] });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "forum.post"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const { categoryId, title, body } = await req.json();
    if (!categoryId || !title || !body) {
      return NextResponse.json({ error: "All fields required" }, { status: 400 });
    }

    const [thread] = await db
      .insert(forumThreads)
      .values({ categoryId: Number(categoryId), userId: auth.userId, title })
      .returning();

    await db.insert(forumPosts).values({ threadId: thread.id, userId: auth.userId, body });

    return NextResponse.json({ thread }, { status: 201 });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}
