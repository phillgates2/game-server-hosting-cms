import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, passwordResets } from "@/db/schema";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { isValidResetToken, hashResetToken } from "@/lib/password-reset";
import { apiError } from "@/lib/api-error";
import { accessGatePassed, ACCESS_GATE_ERROR } from "@/lib/access-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Registration enforces 8–200; a reset must not accept a weaker password
// than the account could have been created with.
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

const INVALID_LINK = { error: "That reset link is invalid or has expired. Request a new one." };

async function ensurePasswordResetsTable() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
}

// POST /api/auth/reset-password — consume a reset link, set a new password
export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { token, password } = (body ?? {}) as Record<string, unknown>;

    // CD-key gate: resetting a password is an entry point too.
    if (!(await accessGatePassed(((body ?? {}) as Record<string, unknown>).accessKey))) {
      return NextResponse.json({ error: ACCESS_GATE_ERROR }, { status: 403 });
    }

    if (!isValidResetToken(token)) {
      return NextResponse.json(INVALID_LINK, { status: 400 });
    }
    if (typeof password !== "string" || password.length < MIN_PASSWORD) {
      return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, { status: 400 });
    }
    if (password.length > MAX_PASSWORD) {
      return NextResponse.json({ error: `Password must be at most ${MAX_PASSWORD} characters` }, { status: 400 });
    }

    await ensurePasswordResetsTable();

    // Unspent and unexpired, matched on the hash — the raw token never
    // touches the database.
    const [row] = await db
      .select({ id: passwordResets.id, userId: passwordResets.userId })
      .from(passwordResets)
      .where(
        and(
          eq(passwordResets.tokenHash, hashResetToken(token)),
          isNull(passwordResets.usedAt),
          gt(passwordResets.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!row) return NextResponse.json(INVALID_LINK, { status: 400 });

    const passwordHash = await hashPassword(password);

    // Spend the link BEFORE changing the password: if the update fails, the
    // link is already dead and the request must be retried with a new one.
    await db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(eq(passwordResets.id, row.id));

    const updated = await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, row.userId))
      .returning({ id: users.id });

    if (updated.length === 0) {
      // The account was deleted between the email and the click.
      return NextResponse.json(INVALID_LINK, { status: 400 });
    }

    return NextResponse.json({ ok: true, message: "Password updated. Sign in with your new password." });
  } catch (e: unknown) {
    return apiError(e, "Could not reset the password", 500);
  }
}
