import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, createToken, getCookieOptions } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const { username, email, password } = await req.json();
    if (!username || !email || !password) {
      return NextResponse.json({ error: "All fields required" }, { status: 400 });
    }

    const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ error: "Username already exists" }, { status: 409 });
    }

    const existingEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingEmail.length > 0) {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }

    // First user gets admin role
    const allUsers = await db.select().from(users).limit(1);
    const role = allUsers.length === 0 ? "admin" : "user";

    const passwordHash = await hashPassword(password);
    const [user] = await db
      .insert(users)
      .values({ username, email, passwordHash, role })
      .returning({ id: users.id, role: users.role });

    const token = createToken({ userId: user.id, role: user.role });

    const res = NextResponse.json({ ok: true, user: { id: user.id, username, role: user.role } });
    res.cookies.set("gsm_token", token, getCookieOptions(req.headers));
    return res;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
