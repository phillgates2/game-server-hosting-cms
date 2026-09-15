/**
 * Display helper for audit-log `details`.
 *
 * The column is jsonb. Callers historically wrote both free-text strings and
 * structured objects (`{ scope, username }` from file transfer, `{ pid }`
 * from process events, …). The overview widget used to drop the value
 * straight into JSX, which throws React error #31 when the payload is an
 * object:
 *
 *   Objects are not valid as a React child (found: object with keys {scope, username})
 *
 * Always returns a string so it is safe to render as a React child.
 * Pure and dependency-free: the overview is a client component.
 */

const PAIR_SEP = " · ";

/** Turn a jsonb audit payload into a one-line caption. */
export function formatAuditDetails(details: unknown, fallback: string): string {
  if (details === undefined || details === null || details === "") return fallback;
  if (typeof details === "string") {
    const trimmed = details.trim();
    return trimmed || fallback;
  }
  if (typeof details === "number" || typeof details === "boolean") return String(details);
  if (typeof details !== "object") return fallback;

  if (Array.isArray(details)) {
    const parts = details
      .map((item) => formatAuditDetails(item, ""))
      .filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join(", ") : fallback;
  }

  const entries = Object.entries(details as Record<string, unknown>).filter(
    ([, value]) => value !== undefined && value !== null && value !== ""
  );
  if (entries.length === 0) return fallback;

  return entries
    .map(([key, value]) => `${key}: ${formatAuditValue(value)}`)
    .join(PAIR_SEP);
}

function formatAuditValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}
