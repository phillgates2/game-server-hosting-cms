import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, createToken, getCookieOptions } from "@/lib/auth";
import { getUserPermissions } from "@/lib/permissions";
import { eq, sql } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const username = (body.username || "").trim();
    const password = body.password || "";

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }

    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (user.status === "suspended") {
      return NextResponse.json({ error: "Account suspended. Contact an administrator." }, { status: 403 });
    }
    if (user.status === "banned") {
      return NextResponse.json({ error: "Account banned." }, { status: 403 });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Track login
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || "unknown";

    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        lastLoginIp: ip,
        loginCount: sql`COALESCE(login_count, 0) + 1`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    const token = createToken({ userId: user.id, role: user.role });
    const permissions = await getUserPermissions(user.id);

    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, username: user.username, role: user.role },
      permissions,
    });
    res.cookies.set("gsm_token", token, getCookieOptions(req.headers));
    return res;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
