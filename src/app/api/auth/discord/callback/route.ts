import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { createToken, getCookieOptions } from "@/lib/auth";
import { getAuthPolicy } from "@/lib/auth-policy";
import { getDiscordSettings, isOauthConfigured } from "@/lib/discord-settings";
import { OAUTH_STATE_COOKIE, discordRedirectUri, oauthLoginDecision } from "@/lib/discord-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISCORD_API = "https://discord.com/api/v10";

/** Every outcome lands back on the login screen with a machine-readable flag. */
function outcome(req: NextRequest, code: string): NextResponse {
  const url = new URL("/", req.nextUrl.origin);
  url.searchParams.set("oauth", code);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}

/**
 * GET /api/auth/discord/callback — Discord redirects here with a code.
 *
 * Signs the matching panel account in. New accounts are created only when
 * self-registration is open AND the age gate is off — when age verification
 * is on, every new account must declare a date of birth, which OAuth cannot
 * supply, so auto-creation would be a hole straight through the Australian
 * minimum-age rule. Accounts with 2FA are never signed in by OAuth: the
 * token hand-off cannot present a TOTP code.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  // The user declined consent on Discord's screen.
  if (searchParams.get("error")) return outcome(req, "denied");

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return outcome(req, "error");
  }

  try {
    const s = await getDiscordSettings();
    if (!isOauthConfigured(s)) return outcome(req, "not_configured");

    // ── Exchange the code for an access token ────────────────────────────────
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: s.oauthClientId,
        client_secret: s.oauthClientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: discordRedirectUri(req.nextUrl.origin),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenRes.ok) return outcome(req, "error");
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return outcome(req, "error");

    // ── Fetch the Discord identity ───────────────────────────────────────────
    const meRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!meRes.ok) return outcome(req, "error");
    const me = (await meRes.json()) as {
      id?: string;
      username?: string;
      email?: string;
      verified?: boolean;
    };
    // An unverified email proves nothing — it could be anyone's address.
    if (!me.email || me.verified !== true) return outcome(req, "no_email");
    const mail = me.email.trim().toLowerCase();

    // ── Match or create the panel account ────────────────────────────────────
    const [existing] = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        status: users.status,
        twoFactorEnabled: users.twoFactorEnabled,
      })
      .from(users)
      .where(sql`LOWER(${users.email}) = ${mail}`)
      .limit(1);

    const policy = await getAuthPolicy();
    const decision = oauthLoginDecision({
      accountExists: Boolean(existing),
      accountActive: existing?.status === "active",
      twoFactorEnabled: Boolean(existing?.twoFactorEnabled),
      registrationEnabled: policy.registrationEnabled,
      ageVerificationEnabled: policy.ageVerificationEnabled,
    });
    if (decision === "suspended") return outcome(req, "suspended");
    // OAuth cannot produce a TOTP code; never let it sidestep 2FA.
    if (decision === "2fa") return outcome(req, "2fa");
    if (decision === "no_register") return outcome(req, "no_register");
    // Age verification demands a declared date of birth, which OAuth cannot
    // supply — never mint an account around the Australian minimum-age rule.
    if (decision === "age_gate") return outcome(req, "age_gate");
    if (decision === "sign_in" && existing) return signIn(req, existing.id, existing.role);

    // decision === "create": self-registration is open and no age declaration
    // is required. Mirror the register route's defaults (first user = admin).
    const username = await uniqueUsername(me.username || mail.split("@")[0] || "user");
    const anyUser = await db.select({ id: users.id }).from(users).limit(1);
    const role = anyUser.length === 0 ? "admin" : "user";

    const [created] = await db
      .insert(users)
      .values({
        username,
        email: mail,
        // An OAuth-linked account has no password; a random hash keeps the
        // NOT NULL constraint while remaining permanently unusable.
        passwordHash: `oauth:${me.id ?? ""}:${Date.now()}`,
        role,
        maxServers: policy.defaultMaxServers > 0 ? policy.defaultMaxServers : null,
      })
      .returning({ id: users.id, role: users.role });

    return signIn(req, created.id, created.role);
  } catch {
    return outcome(req, "error");
  }
}

async function signIn(req: NextRequest, userId: number, role: string): Promise<NextResponse> {
  const token = createToken({ userId, role });
  const res = outcome(req, "ok");
  res.cookies.set("gsm_token", token, getCookieOptions(req.headers));
  const { trackIssuedSession } = await import("@/lib/auth");
  await trackIssuedSession(token, req.headers);
  return res;
}

/** Suffix a name until it is unique (same column width as the register route). */
async function uniqueUsername(base: string): Promise<string> {
  const clean = base.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 56) || "user";
  for (let i = 0; i < 25; i++) {
    const candidate = i === 0 ? clean : `${clean}_${i}`;
    const clash = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, candidate))
      .limit(1);
    if (clash.length === 0) return candidate;
  }
  return `${clean}_${Date.now().toString(36)}`.slice(0, 64);
}
