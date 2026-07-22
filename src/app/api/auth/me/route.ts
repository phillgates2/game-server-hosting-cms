import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, roles } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getUserPermissions } from "@/lib/permissions";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const auth = await getCurrentUser(req.headers);
    if (!auth) return NextResponse.json({ user: null }, { status: 401 });

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        role: users.role,
        roleId: users.roleId,
        status: users.status,
        createdAt: users.createdAt,
        roleName: roles.displayName,
        roleColor: roles.color,
        roleIcon: roles.icon,
      })
      .from(users)
      .leftJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, auth.userId))
      .limit(1);

    if (!user) return NextResponse.json({ user: null }, { status: 401 });

    const permissions = await getUserPermissions(user.id);

    return NextResponse.json({
      user: {
        ...user,
        roleName: user.roleName || user.role,
        roleColor: user.roleColor || "#3b82f6",
        roleIcon: user.roleIcon || "👤",
      },
      permissions,
    });
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }
}
