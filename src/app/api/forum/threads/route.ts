import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumThreads, forumPosts, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, desc, sql } from "drizzle-orm";
import { apiError } from "@/lib/api-error";
import { limitParam, offsetParam } from "@/lib/pagination";

/** Post bodies are text; cap them so a paste cannot become a multi-MB row. */
const MAX_TITLE_LENGTH = 256;
const MAX_POST_LENGTH = 100_000;

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

    const categoryIdNum = Number(categoryId);
    if (!Number.isInteger(categoryIdNum) || categoryIdNum <= 0) {
      return NextResponse.json({ error: "Invalid category" }, { status: 400 });
    }
    const finalTitle = String(title).trim();
    if (!finalTitle || finalTitle.length > MAX_TITLE_LENGTH) {
      return NextResponse.json({ error: `title is required (max ${MAX_TITLE_LENGTH} characters)` }, { status: 400 });
    }
    const finalBody = String(body).trim();
    if (!finalBody || finalBody.length > MAX_POST_LENGTH) {
      return NextResponse.json({ error: `body is required (max ${MAX_POST_LENGTH} characters)` }, { status: 400 });
    }

    // A thread without its opening post would be a broken thread (the reply
    // count subtracts one for it), and the GET above would show -1 replies.
    let thread;
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(forumThreads)
        .values({ categoryId: categoryIdNum, userId: auth.userId, title: finalTitle })
        .returning();
      await tx.insert(forumPosts).values({ threadId: created.id, userId: auth.userId, body: finalBody });
      thread = created;
    });

    return NextResponse.json({ thread }, { status: 201 });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}
