import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getDiscordSettings, isOauthConfigured } from "@/lib/discord-settings";
import { OAUTH_STATE_COOKIE, discordRedirectUri } from "@/lib/discord-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/discord — start the OAuth dance.
 *
 * Redirects to Discord's consent screen. The `state` parameter is a fresh
 * random value echoed in a short-lived cookie so the callback can refuse
 * cross-site forgery of the final step.
 */
export async function GET(req: NextRequest) {
  const s = await getDiscordSettings();
  if (!isOauthConfigured(s)) {
    return NextResponse.redirect(new URL("/?oauth=not_configured", req.url));
  }

  const state = randomBytes(16).toString("hex");
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", s.oauthClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", discordRedirectUri(req.nextUrl.origin));
  url.searchParams.set("scope", "identify email");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");

  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.headers.get("x-forwarded-proto") === "https",
    maxAge: 600,
    path: "/",
  });
  return res;
}
