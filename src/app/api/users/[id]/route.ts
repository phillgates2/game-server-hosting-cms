import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, gameServers, forumPosts } from "@/db/schema";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { eq, sql } from "drizzle-orm";

// GET /api/users/[id] — Admin: get user detail
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        status: users.status,
        bio: users.bio,
        location: users.location,
        website: users.website,
        maxServers: users.maxServers,
        twoFactorEnabled: users.twoFactorEnabled,
        lastLoginAt: users.lastLoginAt,
        lastLoginIp: users.lastLoginIp,
        loginCount: users.loginCount,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, Number(id)))
      .limit(1);

    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // User's servers
    const servers = await db
      .select({ id: gameServers.id, name: gameServers.name, status: gameServers.status })
      .from(gameServers)
      .where(eq(gameServers.userId, Number(id)));

    // Post count
    const [postCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(forumPosts)
      .where(eq(forumPosts.userId, Number(id)));

    return NextResponse.json({ user, servers, postCount: postCount?.count || 0 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// PATCH /api/users/[id] — Admin: update user
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  try {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.role !== undefined) updateData.role = body.role;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.maxServers !== undefined) updateData.maxServers = body.maxServers;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.bio !== undefined) updateData.bio = body.bio;
    if (body.location !== undefined) updateData.location = body.location;
    if (body.website !== undefined) updateData.website = body.website;
    if (body.password) {
      updateData.passwordHash = await hashPassword(body.password);
    }

    const [updated] = await db.update(users).set(updateData).where(eq(users.id, Number(id))).returning();
    return NextResponse.json({ user: updated });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// DELETE /api/users/[id] — Admin: delete user
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  if (Number(id) === auth.userId) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  try {
    await db.delete(users).where(eq(users.id, Number(id)));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
