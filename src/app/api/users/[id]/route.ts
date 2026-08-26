import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, gameServers, forumPosts, apiKeys } from "@/db/schema";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq, sql } from "drizzle-orm";
import { apiError, isUniqueViolation } from "@/lib/api-error";
import { publicUser } from "@/lib/server-lifecycle";
import {
  normalizeRole,
  normalizeStatus,
  normalizeMaxServers,
  normalizeEmail,
  normalizeProfileText,
  checkPassword,
} from "@/lib/user-fields";

// GET /api/users/[id] — Admin: get user detail
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  const allowed = auth && ((await hasPermission(auth.userId, "users.view")) || (await hasPermission(auth.userId, "users.view.detail")));
  if (!allowed) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
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
    return apiError(e, "Unknown", 500);
  }
}

// PATCH /api/users/[id] — Admin: update user
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "users.edit"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  try {
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (body.role !== undefined) {
      if (!(await hasPermission(auth.userId, "users.roles"))) {
        return NextResponse.json({ error: "users.roles permission required" }, { status: 403 });
      }
      // Refusing here is what keeps the last admin from locking the panel:
      // without it, an admin (or admin role edit) could demote themselves
      // and leave no account able to reach the admin surfaces.
      const byId = Number(id);
      const roleCheck = normalizeRole(body.role);
      if (!roleCheck.ok) return NextResponse.json({ error: roleCheck.error }, { status: 400 });
      if (byId === auth.userId && roleCheck.value !== "admin" && auth.role === "admin") {
        return NextResponse.json({ error: "You cannot remove your own admin role" }, { status: 400 });
      }
      updateData.role = roleCheck.value;
    }
    if (body.status !== undefined) {
      if (!(await hasPermission(auth.userId, "users.suspend"))) {
        return NextResponse.json({ error: "users.suspend permission required" }, { status: 403 });
      }
      const statusCheck = normalizeStatus(body.status);
      if (!statusCheck.ok) return NextResponse.json({ error: statusCheck.error }, { status: 400 });
      updateData.status = statusCheck.value;
    }
    if (body.maxServers !== undefined) {
      if (!(await hasPermission(auth.userId, "users.limits"))) {
        return NextResponse.json({ error: "users.limits permission required" }, { status: 403 });
      }
      const limitCheck = normalizeMaxServers(body.maxServers);
      if (!limitCheck.ok) return NextResponse.json({ error: limitCheck.error }, { status: 400 });
      updateData.maxServers = limitCheck.value;
    }
    if (body.email !== undefined) {
      const emailCheck = normalizeEmail(body.email);
      if (!emailCheck.ok) return NextResponse.json({ error: emailCheck.error }, { status: 400 });
      updateData.email = emailCheck.value;
    }
    if (body.bio !== undefined) {
      const bio = normalizeProfileText(body.bio, "bio");
      if (!bio.ok) return NextResponse.json({ error: bio.error }, { status: 400 });
      updateData.bio = bio.value;
    }
    if (body.location !== undefined) {
      const location = normalizeProfileText(body.location, "location");
      if (!location.ok) return NextResponse.json({ error: location.error }, { status: 400 });
      updateData.location = location.value;
    }
    if (body.website !== undefined) {
      const website = normalizeProfileText(body.website, "website");
      if (!website.ok) return NextResponse.json({ error: website.error }, { status: 400 });
      updateData.website = website.value;
    }
    if (body.password !== undefined && String(body.password ?? "") !== "") {
      if (!((await hasPermission(auth.userId, "users.reset_password")) || (await hasPermission(auth.userId, "users.edit.security")))) {
        return NextResponse.json({ error: "users.reset_password permission required" }, { status: 403 });
      }
      const pwCheck = checkPassword(body.password);
      if (!pwCheck.ok) return NextResponse.json({ error: pwCheck.error }, { status: 400 });
      updateData.passwordHash = await hashPassword(pwCheck.value);
    }

    let updated;
    try {
      [updated] = await db.update(users).set(updateData).where(eq(users.id, Number(id))).returning();
    } catch (e: unknown) {
      // Two admins editing the same email: the unique index arbitrates.
      if (isUniqueViolation(e)) {
        return NextResponse.json({ error: "That email is already in use" }, { status: 409 });
      }
      throw e;
    }
    // .returning() yields every column, including passwordHash and
    // twoFactorSecret; never hand those to a browser.
    return NextResponse.json({ user: updated ? publicUser(updated) : updated });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}

// DELETE /api/users/[id] — Admin: delete user
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "users.delete"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { id } = await params;
  if (Number(id) === auth.userId) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  try {
    // Every table referencing users carries a plain REFERENCES with no
    // ON DELETE, so Postgres refuses the delete (23503) whenever the account
    // owns anything -- which previously surfaced as an opaque 500.
    //
    // Cascading silently is not the right answer either: it would destroy the
    // user's game servers and rewrite forum history. Refuse with a reason and
    // let an admin reassign or delete the servers first, mirroring how the
    // nodes route already handles the same situation.
    const [{ count: ownedServers } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(gameServers)
      .where(eq(gameServers.userId, Number(id)));
    if (ownedServers > 0) {
      return NextResponse.json(
        {
          error: `This user owns ${ownedServers} server(s). Delete or reassign them first.`,
        },
        { status: 400 }
      );
    }

    // Check every refusal BEFORE deleting anything. This used to drop the
    // user's API keys and only then count forum posts, so deleting an author
    // returned "delete their posts first" with the keys already destroyed --
    // a 400 that still caused irreversible data loss.
    const [{ count: authored } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(forumPosts)
      .where(eq(forumPosts.userId, Number(id)));
    if (authored > 0) {
      return NextResponse.json(
        {
          error: `This user has ${authored} forum post(s). Delete them first, or suspend the account instead of deleting it.`,
        },
        { status: 400 }
      );
    }

    // Both writes land or neither does: an account left without its API keys
    // is a silent security hole, since the keys are useless but still listed.
    await db.transaction(async (tx) => {
      // API keys are useless without their owner; forum posts are handled by
      // the forum routes and are refused above.
      await tx.delete(apiKeys).where(eq(apiKeys.userId, Number(id)));
      await tx.delete(users).where(eq(users.id, Number(id)));
    });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return apiError(e, "Unknown", 500);
  }
}
