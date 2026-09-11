/**
 * The curated API reference rendered at /api-docs.
 *
 * Deliberately static data: the live truth is the route files themselves,
 * and this catalog documents the endpoints API-key holders and integrators
 * actually use. Keep it honest — the unit tests pin the anchors.
 */

export interface ApiDocEndpoint {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  description: string;
  /** What a caller needs: session user, API key scope, or none (public). */
  auth: string;
}

export interface ApiDocGroup {
  title: string;
  icon: string;
  note?: string;
  endpoints: ApiDocEndpoint[];
}

export const API_DOCS: ApiDocGroup[] = [
  {
    title: "Authentication & panel access",
    icon: "🔐",
    note: "Session routes use the gsm_token cookie. When the CD-key gate is enabled, login/register also require an access key.",
    endpoints: [
      { method: "POST", path: "/api/auth/login", description: "Sign in (username + password, optional 2FA code, optional accessKey).", auth: "public (throttled)" },
      { method: "POST", path: "/api/auth/register", description: "Create an account (age gate + optional access key apply).", auth: "public (throttled)" },
      { method: "POST", path: "/api/auth/logout", description: "End the current session.", auth: "session" },
      { method: "GET", path: "/api/auth/me", description: "Current user + permissions.", auth: "session" },
      { method: "GET", path: "/api/auth/access-gate", description: "Whether the panel access gate is enabled (one boolean).", auth: "public (throttled)" },
      { method: "POST", path: "/api/auth/forgot-password", description: "Email a password-reset link.", auth: "public (throttled)" },
      { method: "POST", path: "/api/auth/reset-password", description: "Consume a reset token (gate applies).", auth: "public (throttled)" },
    ],
  },
  {
    title: "Servers",
    icon: "🎮",
    endpoints: [
      { method: "GET", path: "/api/servers", description: "List servers (ownership-scoped for non-admins).", auth: "servers.view" },
      { method: "POST", path: "/api/servers", description: "Create a server (blocked on maintenance-mode nodes).", auth: "servers.create" },
      { method: "PATCH", path: "/api/servers/:id", description: "Update allowlisted fields (name, ports, notes, tags, flags…).", auth: "servers.edit" },
      { method: "DELETE", path: "/api/servers/:id", description: "Delete a server.", auth: "servers.delete" },
      { method: "POST", path: "/api/servers/:id/process", description: "start / stop / restart / status.", auth: "servers.start_stop / servers.restart" },
      { method: "POST", path: "/api/servers/:id/install", description: "Run the game installer.", auth: "servers.install" },
      { method: "POST", path: "/api/servers/:id/update", description: "Steam update with automatic pre-update backup.", auth: "servers.install" },
      { method: "POST", path: "/api/servers/:id/backup", description: "Create / list / restore backups.", auth: "servers.backup" },
      { method: "POST", path: "/api/servers/:id/migrate", description: "Move a stopped server to another node.", auth: "servers.edit" },
      { method: "GET", path: "/api/servers/:id/metrics", description: "CPU/RAM history + events for the charts.", auth: "servers.view" },
      { method: "GET", path: "/api/servers/:id/uptime", description: "Stability % over ?hours= (≤14d).", auth: "servers.view" },
      { method: "GET", path: "/api/servers/uptime", description: "Fleet stability summary, worst first.", auth: "servers.view" },
      { method: "GET", path: "/api/servers/idle", description: "Servers with long zero-player streaks.", auth: "servers.view" },
      { method: "GET", path: "/api/servers/events", description: "Fleet incident feed (crashes/watchdog/auto-restarts).", auth: "servers.view" },
      { method: "POST", path: "/api/servers/batch", description: "Batch start/stop/restart (≤25 ids, delegated per server).", auth: "servers.start_stop / restart" },
      { method: "POST", path: "/api/servers/batch-update", description: "Batch Steam updates for stopped servers (≤10, sequential).", auth: "servers.install" },
      { method: "GET", path: "/api/servers/:id/daily-restart", description: "Daily restart schedule state.", auth: "servers.edit / scheduler.view" },
      { method: "POST", path: "/api/servers/:id/daily-restart", description: "Enable/disable the daily restart (strict daily cron).", auth: "servers.edit / scheduler.create" },
      { method: "GET", path: "/api/servers/:id/daily-backup", description: "Daily backup schedule state.", auth: "servers.edit / scheduler.view" },
      { method: "POST", path: "/api/servers/:id/daily-backup", description: "Enable/disable the daily backup.", auth: "servers.edit / scheduler.create" },
    ],
  },
  {
    title: "Nodes",
    icon: "🖥️",
    endpoints: [
      { method: "GET", path: "/api/nodes", description: "List nodes with latest heartbeat metrics (metrics need nodes.view.metrics).", auth: "nodes.view" },
      { method: "POST", path: "/api/nodes", description: "Register a node.", auth: "nodes.create" },
      { method: "PATCH", path: "/api/nodes/:id", description: "Update node settings (incl. maintenanceMode).", auth: "nodes.edit" },
      { method: "DELETE", path: "/api/nodes/:id", description: "Remove a node.", auth: "nodes.delete" },
      { method: "POST", path: "/api/nodes/:id/heartbeat", description: "Agent heartbeat (metrics + status).", auth: "node API key" },
      { method: "GET", path: "/api/nodes/:id/metrics", description: "Node CPU/RAM history.", auth: "nodes.view.metrics" },
      { method: "POST", path: "/api/nodes/:id/deploy", description: "One-click SSH deploy of the node agent.", auth: "nodes.edit (admin)" },
    ],
  },
  {
    title: "Scheduler & presets",
    icon: "⏰",
    endpoints: [
      { method: "GET", path: "/api/scheduler", description: "List scheduled tasks.", auth: "scheduler.view / servers.edit" },
      { method: "POST", path: "/api/scheduler", description: "Create a task (restart/backup/update/command, 5-field cron).", auth: "scheduler.create / servers.edit" },
      { method: "PATCH", path: "/api/scheduler/:id", description: "Edit/enable a task.", auth: "scheduler.edit / servers.edit" },
      { method: "DELETE", path: "/api/scheduler/:id", description: "Delete a task.", auth: "scheduler.delete / servers.edit" },
      { method: "GET", path: "/api/presets", description: "List server presets.", auth: "session" },
      { method: "POST", path: "/api/presets", description: "Save a preset (variables whitelist-applied at use).", auth: "servers.create" },
      { method: "DELETE", path: "/api/presets/:id", description: "Delete a preset.", auth: "creator or admin" },
      { method: "POST", path: "/api/presets/import", description: "Import ≤20 presets from exported JSON.", auth: "servers.create" },
    ],
  },
  {
    title: "Keys & security",
    icon: "🔑",
    endpoints: [
      { method: "GET", path: "/api/api-keys", description: "List personal API keys.", auth: "session" },
      { method: "POST", path: "/api/api-keys", description: "Mint an API key (shown once).", auth: "session" },
      { method: "DELETE", path: "/api/api-keys/:id", description: "Revoke an API key.", auth: "owner or admin" },
      { method: "GET", path: "/api/access-keys", description: "List panel access keys (prefixes only).", auth: "admin" },
      { method: "POST", path: "/api/access-keys", description: "Mint a panel access key (shown once).", auth: "admin" },
      { method: "DELETE", path: "/api/access-keys/:id", description: "Revoke a panel access key.", auth: "admin" },
      { method: "POST", path: "/api/access-keys/gate", description: "Enable/disable the access gate (bootstraps a key).", auth: "admin" },
    ],
  },
  {
    title: "Games & templates",
    icon: "📦",
    endpoints: [
      { method: "GET", path: "/api/games", description: "Game template list.", auth: "games.view" },
      { method: "GET", path: "/api/games/:id/variables", description: "Template variables for the wizard.", auth: "games.view" },
      { method: "POST", path: "/api/games/import", description: "Import a custom game template.", auth: "games.create" },
    ],
  },
  {
    title: "Public status",
    icon: "🌐",
    note: "Unguessable tokens are the only key; deliberately no addresses or ids.",
    endpoints: [
      { method: "GET", path: "/api/public/status/:token", description: "JSON status for one share link.", auth: "public (throttled)" },
      { method: "GET", path: "/api/public/board", description: "Aggregated public board JSON.", auth: "public (throttled)" },
      { method: "GET", path: "/api/health", description: "Liveness probe.", auth: "public" },
    ],
  },
];

/** Flat count for tests and the docs header. */
export function countDocumentedEndpoints(): number {
  return API_DOCS.reduce((n, g) => n + g.endpoints.length, 0);
}
