import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cmsPages, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, desc, and } from "drizzle-orm";

// GET /api/cms?type=blog|changelog|page&published=true
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const publishedOnly = url.searchParams.get("published") !== "false";
    const limit = parseInt(url.searchParams.get("limit") || "50");

    const conditions = [];
    if (type) conditions.push(eq(cmsPages.type, type));
    if (publishedOnly) conditions.push(eq(cmsPages.published, true));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const posts = await db
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
      .where(where)
      .orderBy(desc(cmsPages.pinned), desc(cmsPages.createdAt))
      .limit(limit);

    return NextResponse.json({ posts });
  } catch {
    return NextResponse.json({ posts: [] });
  }
}

// POST /api/cms - Create a new post (admin only)
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { title, slug, content, type, excerpt, coverImage, published, pinned, tags } = body;

    if (!title || !content) {
      return NextResponse.json({ error: "Title and content required" }, { status: 400 });
    }

    const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const [post] = await db
      .insert(cmsPages)
      .values({
        slug: finalSlug,
        title,
        body: content,
        type: type || "blog",
        excerpt: excerpt || content.slice(0, 200),
        coverImage: coverImage || null,
        published: published ?? true,
        pinned: pinned ?? false,
        authorId: auth.userId,
        tags: tags || [],
      })
      .returning();

    return NextResponse.json({ post }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
