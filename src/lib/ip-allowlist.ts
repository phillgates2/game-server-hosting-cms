/**
 * Panel IP allowlist: when configured, only listed client IPs may use the
 * authenticated API. Pure rule math, unit-tested.
 *
 * Rules are exact addresses or suffix globs ("1.2.3.*", "10.*"). Loopback
 * passes so an operator at the console can never lock themselves out — but
 * only loopback observed through the TRUSTED proxy hop, or a direct
 * connection; a loopback merely CLAIMED in attacker-controlled headers is
 * refused (Stage 46). An unknown client IP fails CLOSED when a list is
 * configured.
 */

export const IP_ALLOWLIST_KEY = "ip_allowlist";

/** Split a stored spec into clean rules. */
export function parseAllowList(spec: string | null | undefined): string[] {
  if (!spec) return [];
  return spec
    .split(/[,\n]/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

export function isLoopback(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const bare = ip.replace(/^\[|\]$/g, "");
  return bare === "127.0.0.1" || bare === "::1" || bare.startsWith("127.");
}

/** Exact match, or suffix glob where "*" matches within dotted groups. */
export function ipMatchesRule(ip: string, rule: string): boolean {
  if (rule === ip) return true;
  if (rule.endsWith(".*")) {
    const prefix = rule.slice(0, -1); // keep the trailing dot
    return ip.startsWith(prefix);
  }
  if (rule === "*") return true;
  return false;
}

/**
 * The decision: no rules → allow everything; loopback → always allow;
 * unknown IP with rules configured → deny (fail closed).
 */
export function ipAllowed(ip: string | null | undefined, rules: readonly string[]): boolean {
  if (rules.length === 0) return true;
  if (isLoopback(ip)) return true;
  if (!ip || ip === "unknown") return false;
  return rules.some((r) => ipMatchesRule(ip, r));
}

export const TRUST_PROXY_ENV = "GSM_TRUST_PROXY";

/**
 * Extract the client IP the same way every route does — Stage 46 hardening.
 *
 * Forwarded headers are attacker-controllable, so they are honoured ONLY
 * when the panel runs behind its own trusted edge proxy
 * (`GSM_TRUST_PROXY=1` — install.sh sets it when Caddy is enabled). In that
 * case the LAST X-Forwarded-For hop is used: it is the entry our own proxy
 * appended, while earlier entries can be client-forged. The old code used
 * the FIRST hop, so `X-Forwarded-For: 127.0.0.1` spoofed loopback and
 * bypassed the whole allowlist.
 *
 * Without a trusted proxy, any request that PRESENTS forwarded headers is
 * claiming an unverifiable identity -> "unknown" (fails closed when an
 * allowlist is configured). A request with no forwarded headers at all is a
 * direct connection to the panel port — the console safety hatch (null).
 */
export function clientIpFromHeaders(
  headers: Headers,
  trustProxy: boolean = process.env[TRUST_PROXY_ENV] === "1"
): string | null {
  const xff = headers.get("x-forwarded-for");
  const real = headers.get("x-real-ip");
  if (!trustProxy) {
    return xff || real ? "unknown" : null;
  }
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter((h) => h.length > 0);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return real || null;
}

/** Display/audit variant: never null — direct connections show as "direct". */
export function clientIpForRecord(headers: Headers, trustProxy?: boolean): string {
  return clientIpFromHeaders(headers, trustProxy) ?? "direct";
}
