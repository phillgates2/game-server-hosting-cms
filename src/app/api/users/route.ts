import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql, ilike, or } from "drizzle-orm";
import { limitParam, offsetParam } from "@/lib/pagination";
import { createLogger } from "@/lib/logger";

const log = createLogger("users");

// GET /api/users — Admin: list all users
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "users.view"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const search = url.searchParams.get("search") || "";
    const limit = limitParam(url.searchParams, 100);
    const offset = offsetParam(url.searchParams);

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

    // Admin-only, but a panel with thousands of accounts should not ship them
    // all in one response.
    const allUsers = await query.limit(limit).offset(offset);

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

    return NextResponse.json({ users: usersWithCounts, limit, offset });
  } catch (e) {
    log.exception("failed to list users", e);
    return NextResponse.json({ users: [] });
  }
}
