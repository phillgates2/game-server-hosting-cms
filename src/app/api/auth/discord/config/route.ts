import { NextResponse } from "next/server";
import { getDiscordSettings, isOauthConfigured } from "@/lib/discord-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/discord/config — is "Sign in with Discord" available?
 *
 * Public by design (the login screen needs it before anyone is logged in).
 * Answers only a boolean: no client id, no redirect URI, nothing a visitor
 * could not derive from the button existing.
 */
export async function GET() {
  try {
    const s = await getDiscordSettings();
    return NextResponse.json({ enabled: isOauthConfigured(s) });
  } catch {
    // Fresh install with no settings table yet: the feature is simply off.
    return NextResponse.json({ enabled: false });
  }
}
