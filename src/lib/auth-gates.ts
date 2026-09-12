/**
 * Defense-in-depth gates applied on top of credential verification:
 * session-revocation tracking and the IP allowlist. Both fail OPEN on
 * database errors — the primary credential check already passed, and the
 * panel must not go down because an auxiliary table is slow.
 */

import { clientIpFromHeaders, ipAllowed, parseAllowList, IP_ALLOWLIST_KEY } from "./ip-allowlist";

/** Is this cookie token's session still active? */
export async function sessionGate(token: string): Promise<boolean> {
  try {
    const { checkSession } = await import("./session-store");
    const res = await checkSession(token);
    return res.ok;
  } catch {
    return true;
  }
}

/** Does the client IP pass the configured allowlist (if any)? */
export async function ipGate(headers: Headers): Promise<boolean> {
  try {
    const { db } = await import("@/db");
    const { settings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, IP_ALLOWLIST_KEY))
      .limit(1);
    const rules = parseAllowList(row?.value ?? null);
    if (rules.length === 0) return true;
    const ip = clientIpFromHeaders(headers);
    // null = direct connection to the panel port (no forwarded headers):
    // the console safety hatch. install.sh firewalls the port, and behind
    // Caddy every external request carries XFF, so direct == local console.
    if (ip === null) return true;
    return ipAllowed(ip, rules);
  } catch {
    return true;
  }
}
