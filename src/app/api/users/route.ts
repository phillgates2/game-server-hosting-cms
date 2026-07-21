import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { eq, sql, ilike, or } from "drizzle-orm";

// GET /api/users — Admin: list all users
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || auth.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const search = url.searchParams.get("search") || "";

    let query = db
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
      .orderBy(users.id)
      .$dynamic();

    if (search) {
      query = query.where(
        or(
          ilike(users.username, `%${search}%`),
          ilike(users.email, `%${search}%`)
        )
      );
    }

    const allUsers = await query;

    // Get server counts per user
    const serverCounts = await db
      .select({
        userId: gameServers.userId,
        count: sql<number>`count(*)::int`,
      })
      .from(gameServers)
      .groupBy(gameServers.userId);

    const countMap = new Map(serverCounts.map((s) => [s.userId, s.count]));

    const usersWithCounts = allUsers.map((u) => ({
      ...u,
      serverCount: countMap.get(u.id) || 0,
    }));

    return NextResponse.json({ users: usersWithCounts });
  } catch (e) {
    console.error("GET /api/users error:", e);
    return NextResponse.json({ users: [] });
  }
}
