import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { roles, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission, invalidateRoleCache, PERMISSION_CATEGORIES } from "@/lib/permissions";
import { sql } from "drizzle-orm";

// GET /api/roles — List all roles with user counts
export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const allRoles = await db.select().from(roles).orderBy(roles.priority);

    const userCounts = await db
      .select({ roleId: users.roleId, count: sql<number>`count(*)::int` })
      .from(users)
      .groupBy(users.roleId);
    const countMap = new Map(userCounts.map((u) => [u.roleId, u.count]));

    const result = allRoles.map((r) => ({
      ...r,
      userCount: countMap.get(r.id) || 0,
    }));

    return NextResponse.json({ roles: result, categories: PERMISSION_CATEGORIES });
  } catch (e) {
    console.error("GET /api/roles error:", e);
    return NextResponse.json({ roles: [], categories: PERMISSION_CATEGORIES });
  }
}

// POST /api/roles — Create a new role
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasPermission(auth.userId, "roles.create"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, displayName, color, icon, permissions, priority, isDefault } = body;
    if (!name || !displayName) {
      return NextResponse.json({ error: "Name and display name required" }, { status: 400 });
    }

    const [role] = await db.insert(roles).values({
      name: name.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
      displayName,
      color: color || "#3b82f6",
      icon: icon || "👤",
      isSystem: false,
      isDefault: isDefault || false,
      priority: priority || 0,
      permissions: permissions || {},
    }).returning();

    invalidateRoleCache();
    return NextResponse.json({ role }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
