import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, createToken } from "@/lib/auth";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const { username, email, password } = await request.json();
    if (!username || !email || !password) {
      return NextResponse.json({ error: "All fields required" }, { status: 400 });
    }

    // Check existing
    const existingEmail = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingEmail.length > 0) {
      return NextResponse.json({ error: "Email already registered" }, { status: 400 });
    }

    const existingUser = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existingUser.length > 0) {
      return NextResponse.json({ error: "Username already taken" }, { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    const result = await db.insert(users).values({
      username,
      email,
      passwordHash,
      role: "user",
    }).returning();

    const user = result[0];
    const token = createToken({
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    });

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, username: user.username, email: user.email, role: user.role },
    });

    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Registration failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
