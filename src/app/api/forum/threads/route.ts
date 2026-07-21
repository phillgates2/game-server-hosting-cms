import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumThreads, forumPosts, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const categoryId = url.searchParams.get("categoryId");

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
      })
      .from(forumThreads)
      .leftJoin(users, eq(forumThreads.userId, users.id))
      .orderBy(desc(forumThreads.pinned), desc(forumThreads.updatedAt))
      .$dynamic();

    if (categoryId) {
      query = query.where(eq(forumThreads.categoryId, Number(categoryId)));
    }

    const threads = await query;
    return NextResponse.json({ threads });
  } catch {
    return NextResponse.json({ threads: [] });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { categoryId, title, body } = await req.json();
    if (!categoryId || !title || !body) {
      return NextResponse.json({ error: "All fields required" }, { status: 400 });
    }

    const [thread] = await db
      .insert(forumThreads)
      .values({
        categoryId: Number(categoryId),
        userId: auth.userId,
        title,
      })
      .returning();

    await db.insert(forumPosts).values({
      threadId: thread.id,
      userId: auth.userId,
      body,
    });

    return NextResponse.json({ thread }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
