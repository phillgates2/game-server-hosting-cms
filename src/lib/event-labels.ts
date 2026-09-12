/**
 * Display labels for server lifecycle events.
 *
 * Pure and dependency-free on purpose: the overview widget is a client
 * component and must never pull the db-touching server-events module into
 * the browser bundle.
 */

/** Display labels — pure so the wording is unit-tested. */
export function eventLabel(kind: string): string {
  switch (kind) {
    case "crashed":
      return "💥 Crashed";
    case "watchdog-stop":
      return "⛔ Stopped by resource watchdog";
    case "auto-restarted":
      return "🔁 Auto-restarted";
    case "idle-stopped":
      return "😴 Stopped automatically (idle — zero players)";
    case "update-report":
      return "🧬 Update file report";
    case "updated":
      return "📥 Updated via Steam";
    case "restored":
      return "🛡️ Restored from backup";
    default:
      return kind;
  }
}
