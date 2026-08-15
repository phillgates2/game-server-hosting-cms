import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { forumCategories, forumThreads, forumPosts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { asc, eq, sql } from "drizzle-orm";

export async function GET(_req: NextRequest) {
  // Forum categories are publicly readable — no auth required

  try {
    const categories = await db
      .select()
      .from(forumCategories)
      .orderBy(asc(forumCategories.sortOrder));

    // Get thread and post counts per category
    const threadCounts = await db
      .select({
        categoryId: forumThreads.categoryId,
        threadCount: sql<number>`count(distinct ${forumThreads.id})::int`,
        postCount: sql<number>`count(${forumPosts.id})::int`,
        lastActivity: sql<string>`max(${forumPosts.createdAt})`,
      })
      .from(forumThreads)
      .leftJoin(forumPosts, eq(forumPosts.threadId, forumThreads.id))
      .groupBy(forumThreads.categoryId);

    const countMap = new Map(threadCounts.map((c) => [c.categoryId, c]));

    const result = categories.map((cat) => ({
      ...cat,
      threadCount: countMap.get(cat.id)?.threadCount || 0,
      postCount: countMap.get(cat.id)?.postCount || 0,
      lastActivity: countMap.get(cat.id)?.lastActivity || null,
    }));

    return NextResponse.json({ categories: result });
  } catch {
    return NextResponse.json({ categories: [] });
  }
}

export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "forum.manage_categories"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, description, sortOrder } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Category name is required" }, { status: 400 });
    }

    // Generate slug from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 128);

    if (!slug) {
      return NextResponse.json({ error: "Could not generate a valid slug from the category name" }, { status: 400 });
    }

    // Check for duplicate slug
    const existing = await db
      .select({ id: forumCategories.id })
      .from(forumCategories)
      .where(eq(forumCategories.slug, slug))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ error: "A category with that name already exists" }, { status: 409 });
    }

    const [category] = await db
      .insert(forumCategories)
      .values({
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
      })
      .returning();

    return NextResponse.json({ category }, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "forum.manage_categories"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { id, name, description, sortOrder } = body;

    if (!id) {
      return NextResponse.json({ error: "Category id is required" }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        return NextResponse.json({ error: "Category name cannot be empty" }, { status: 400 });
      }
      updates.name = name.trim();

      // Update slug too
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 128);
      updates.slug = slug;
    }

    if (description !== undefined) {
      updates.description = description?.trim() || null;
    }

    if (sortOrder !== undefined) {
      updates.sortOrder = typeof sortOrder === "number" ? sortOrder : 0;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const [category] = await db
      .update(forumCategories)
      .set(updates)
      .where(eq(forumCategories.id, Number(id)))
      .returning();

    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    return NextResponse.json({ category });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "forum.manage_categories"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "Category id is required" }, { status: 400 });
    }

    // Check if category has threads
    const threads = await db
      .select({ id: forumThreads.id })
      .from(forumThreads)
      .where(eq(forumThreads.categoryId, Number(id)))
      .limit(1);

    if (threads.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete a category that has threads. Delete all threads first." },
        { status: 409 }
      );
    }

    const deleted = await db
      .delete(forumCategories)
      .where(eq(forumCategories.id, Number(id)))
      .returning();

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
