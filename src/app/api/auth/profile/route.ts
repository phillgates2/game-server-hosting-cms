import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, gameServers, forumPosts } from "@/db/schema";
import { getCurrentUser, verifyPassword, hashPassword } from "@/lib/auth";
import { eq, sql } from "drizzle-orm";

// GET /api/auth/profile — Get own full profile
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
      })
      .from(users)
      .where(eq(users.id, auth.userId))
      .limit(1);

    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [serverCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(gameServers)
      .where(eq(gameServers.userId, auth.userId));

    const [postCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(forumPosts)
      .where(eq(forumPosts.userId, auth.userId));

    const myServers = await db
      .select({ id: gameServers.id, name: gameServers.name, status: gameServers.status })
      .from(gameServers)
      .where(eq(gameServers.userId, auth.userId));

    return NextResponse.json({
      profile: user,
      serverCount: serverCount?.count || 0,
      postCount: postCount?.count || 0,
      servers: myServers,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

// PATCH /api/auth/profile — Update own profile
export async function PATCH(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    // Fields the user can edit on their own profile
    if (body.bio !== undefined) updateData.bio = body.bio;
    if (body.location !== undefined) updateData.location = body.location;
    if (body.website !== undefined) updateData.website = body.website;
    if (body.email !== undefined) updateData.email = body.email;

    // Password change requires current password
    if (body.newPassword) {
      if (!body.currentPassword) {
        return NextResponse.json({ error: "Current password required" }, { status: 400 });
      }
      const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, auth.userId)).limit(1);
      if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const valid = await verifyPassword(body.currentPassword, user.passwordHash);
      if (!valid) {
        return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
      }
      updateData.passwordHash = await hashPassword(body.newPassword);
    }

    const [updated] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, auth.userId))
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        bio: users.bio,
        location: users.location,
        website: users.website,
      });

    return NextResponse.json({ profile: updated });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
