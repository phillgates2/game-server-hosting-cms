/**
 * Panel IP allowlist: when configured, only listed client IPs may use the
 * authenticated API. Pure rule math, unit-tested.
 *
 * Rules are exact addresses or suffix globs ("1.2.3.*", "10.*"). Loopback
 * ALWAYS passes so an operator at the console can never lock themselves out
 * of their own machine. An unknown client IP fails CLOSED when a list is
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

/** Extract the client IP the same way every route does. */
export function clientIpFromHeaders(headers: Headers): string | null {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    null
  );
}
