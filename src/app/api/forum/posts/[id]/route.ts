import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumPosts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";

// PATCH /api/forum/posts/[id] — Edit post
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [post] = await db.select({ userId: forumPosts.userId }).from(forumPosts).where(eq(forumPosts.id, Number(id))).limit(1);
    if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const canEditAny = (await hasPermission(auth.userId, "forum.edit_any")) || (await hasPermission(auth.userId, "forum.moderate"));
    const isOwner = post.userId === auth.userId;
    const canEditOwn = await hasPermission(auth.userId, "forum.edit_own");
    if (!canEditAny && !(isOwner && canEditOwn)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { body } = await req.json();
    if (!body) return NextResponse.json({ error: "Body required" }, { status: 400 });

    const [updated] = await db.update(forumPosts).set({ body, updatedAt: new Date() }).where(eq(forumPosts.id, Number(id))).returning();
    return NextResponse.json({ post: updated });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}

// DELETE /api/forum/posts/[id] — Delete post
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  try {
    const [post] = await db.select({ userId: forumPosts.userId }).from(forumPosts).where(eq(forumPosts.id, Number(id))).limit(1);
    if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const canDeleteAny = (await hasPermission(auth.userId, "forum.delete_any")) || (await hasPermission(auth.userId, "forum.moderate"));
    const isOwner = post.userId === auth.userId;
    const canDeleteOwn = await hasPermission(auth.userId, "forum.delete_own");
    if (!canDeleteAny && !(isOwner && canDeleteOwn)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await db.delete(forumPosts).where(eq(forumPosts.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}
