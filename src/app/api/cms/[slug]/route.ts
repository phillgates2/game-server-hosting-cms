import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cmsPages, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq } from "drizzle-orm";

// GET /api/cms/[slug]
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  try {
    const [post] = await db
      .select({
        id: cmsPages.id,
        slug: cmsPages.slug,
        title: cmsPages.title,
        body: cmsPages.body,
        type: cmsPages.type,
        excerpt: cmsPages.excerpt,
        coverImage: cmsPages.coverImage,
        published: cmsPages.published,
        pinned: cmsPages.pinned,
        tags: cmsPages.tags,
        authorName: users.username,
        createdAt: cmsPages.createdAt,
        updatedAt: cmsPages.updatedAt,
      })
      .from(cmsPages)
      .leftJoin(users, eq(cmsPages.authorId, users.id))
      .where(eq(cmsPages.slug, slug))
      .limit(1);

    if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ post });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

// PATCH /api/cms/[slug]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { slug } = await params;
  const body = await req.json();

  try {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.content !== undefined) updateData.body = body.content;
    if (body.excerpt !== undefined) updateData.excerpt = body.excerpt;
    if (body.coverImage !== undefined) updateData.coverImage = body.coverImage;
    if (body.published !== undefined) updateData.published = body.published;
    if (body.pinned !== undefined) updateData.pinned = body.pinned;
    if (body.tags !== undefined) updateData.tags = body.tags;
    if (body.type !== undefined) updateData.type = body.type;

    const [post] = await db
      .update(cmsPages)
      .set(updateData)
      .where(eq(cmsPages.slug, slug))
      .returning();

    return NextResponse.json({ post });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// DELETE /api/cms/[slug]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { slug } = await params;

  try {
    await db.delete(cmsPages).where(eq(cmsPages.slug, slug));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
