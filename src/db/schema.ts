import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  real,
  index,
} from "drizzle-orm/pg-core";

// ── Roles & Permissions ───────────────────────────────────────
export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  displayName: varchar("display_name", { length: 128 }).notNull(),
  color: varchar("color", { length: 7 }).default("#3b82f6"), // hex
  icon: varchar("icon", { length: 8 }).default("👤"),
  isSystem: boolean("is_system").default(false), // can't delete system roles
  isDefault: boolean("is_default").default(false), // auto-assigned to new users
  priority: integer("priority").default(0), // higher = more important in display
  permissions: jsonb("permissions").notNull().default("{}"), // Record<string, boolean>
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Users ──────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("user"), // legacy field for JWT
  roleId: integer("role_id").references(() => roles.id),
  status: varchar("status", { length: 20 }).notNull().default("active"), // active, suspended, banned
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  location: varchar("location", { length: 128 }),
  website: varchar("website", { length: 256 }),
  themeConfig: jsonb("theme_config"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorSecret: text("two_factor_secret"),
  /** JSON array of SHA-256 hashes of the single-use recovery codes. */
  twoFactorRecovery: text("two_factor_recovery"),
  maxServers: integer("max_servers").default(5),
  // Age verification (Australian Online Safety Amendment Act 2024).
  // `dateOfBirth` is set at registration when age verification is on;
  // `ageVerifiedAt` records when the declaration was accepted.
  dateOfBirth: date("date_of_birth"),
  ageVerifiedAt: timestamp("age_verified_at"),
  lastLoginAt: timestamp("last_login_at"),
  lastLoginIp: varchar("last_login_ip", { length: 45 }),
  loginCount: integer("login_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Nodes (Multi-Server Support) ──────────────────────────────
export const nodes = pgTable("nodes", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  // Connection details
  hostname: varchar("hostname", { length: 255 }).notNull(),
  ipv4: varchar("ipv4", { length: 45 }),
  ipv6: varchar("ipv6", { length: 45 }),
  sshPort: integer("ssh_port").default(22),
  sshUser: varchar("ssh_user", { length: 64 }),
  sshKeyPath: text("ssh_key_path"),
  // NOTE: stored as plaintext. The panel has no encryption layer, so this
  // is only as protected as the database itself. Prefer sshKeyPath.
  sshPassword: text("ssh_password"),
  // API connection (alternative to SSH)
  apiUrl: text("api_url"),
  apiKey: text("api_key"),
  // Node capabilities
  maxServers: integer("max_servers").default(10),
  maxRamMb: integer("max_ram_mb").default(16384),
  maxDiskMb: integer("max_disk_mb").default(100000),
  // Paths
  gameServerPath: text("game_server_path").default("/opt/gameservers"),
  steamcmdPath: text("steamcmd_path").default("/opt/steamcmd"),
  // Status
  status: varchar("status", { length: 20 }).notNull().default("offline"),
  isLocal: boolean("is_local").default(false),
  isDefault: boolean("is_default").default(false),
  /** Maintenance: never recommended for new servers; creation is blocked. */
  maintenanceMode: boolean("maintenance_mode").default(false),
  lastHeartbeat: timestamp("last_heartbeat"),
  // Location/metadata
  location: varchar("location", { length: 128 }),
  provider: varchar("provider", { length: 64 }),
  tags: jsonb("tags"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Node Metrics (for monitoring) ─────────────────────────────
export const nodeMetrics = pgTable("node_metrics", {
  id: serial("id").primaryKey(),
  nodeId: integer("node_id").references(() => nodes.id).notNull(),
  cpuPercent: real("cpu_percent"),
  cpuLoad1: real("cpu_load_1"),
  cpuLoad5: real("cpu_load_5"),
  cpuLoad15: real("cpu_load_15"),
  ramUsedMb: real("ram_used_mb"),
  ramTotalMb: real("ram_total_mb"),
  ramBufferMb: real("ram_buffer_mb"),
  ramCachedMb: real("ram_cached_mb"),
  diskUsedMb: real("disk_used_mb"),
  diskTotalMb: real("disk_total_mb"),
  networkRxMb: real("network_rx_mb"),
  networkTxMb: real("network_tx_mb"),
  serverCount: integer("server_count"),
  ipv6Enabled: boolean("ipv6_enabled"),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (t) => ({
    node_metrics_node_id_idx: index("node_metrics_node_id_idx").on(t.nodeId),
    node_metrics_recorded_at_idx: index("node_metrics_recorded_at_idx").on(t.recordedAt),
}));

// ── Game definitions (templates installed by admin) ───────────
export const gameDefinitions = pgTable("game_definitions", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  engine: varchar("engine", { length: 64 }),
  defaultPort: integer("default_port").notNull(),
  steamAppId: varchar("steam_app_id", { length: 32 }),
  installScript: text("install_script").notNull(),
  startCommand: text("start_command").notNull(),
  stopCommand: text("stop_command"),
  configFiles: jsonb("config_files"),
  defaultConfig: jsonb("default_config"),
  supportsIpv6: boolean("supports_ipv6").default(false),
  iconEmoji: varchar("icon_emoji", { length: 8 }).default("🎮"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Game servers ───────────────────────────────────────────────
export const gameServers = pgTable("game_servers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  nodeId: integer("node_id").references(() => nodes.id), // Which node this server runs on
  gameId: integer("game_id")
    .references(() => gameDefinitions.id)
    .notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  ipv4: varchar("ipv4", { length: 45 }),
  ipv6: varchar("ipv6", { length: 45 }),
  port: integer("port").notNull(),
  queryPort: integer("query_port"),
  rconPort: integer("rcon_port"),
  installPath: text("install_path").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("stopped"),
  pid: integer("pid"),
  config: jsonb("config"),
  variables: jsonb("variables"), // Filled template variables
  autoRestart: boolean("auto_restart").default(true),
  autoStart: boolean("auto_start").default(false), // Start on node boot
  // Resource limits
  maxRamMb: integer("max_ram_mb"),
  maxCpuPercent: integer("max_cpu_percent"),
  // Discord integration
  discordWebhook: text("discord_webhook"),
  discordNotifyStart: boolean("discord_notify_start").default(true),
  discordNotifyStop: boolean("discord_notify_stop").default(true),
  discordNotifyRestart: boolean("discord_notify_restart").default(true),
  discordNotifyCrash: boolean("discord_notify_crash").default(true),
  /** Post join/leave messages as the roster changes between polls. */
  discordNotifyPlayers: boolean("discord_notify_players").default(true),
  /** Channel the panel provisioned for this server, so it can be cleaned up. */
  discordChannelId: text("discord_channel_id"),
  /**
   * Live status board: one message in the server's Discord channel that the
   * background loop keeps refreshed with the status dot, map and roster.
   */
  discordStatusEnabled: boolean("discord_status_enabled").default(false),
  discordStatusMessageId: text("discord_status_message_id"),
  discordStatusUpdatedAt: timestamp("discord_status_updated_at"),
  /** Last board error, surfaced in the panel so a dead channel is diagnosable. */
  discordStatusError: text("discord_status_error"),
  /**
   * Public status share link: an unguessable token that lets anyone without
   * an account see this server's up/down + player count. NULL = no link.
   */
  statusToken: varchar("status_token", { length: 64 }).unique(),
  /** Opt-in listing on the aggregated public status page (/status). */
  statusPublic: boolean("status_public").default(false),
  /** Free-form operator notes shown in the panel ("map rotation Tue", etc). */
  notes: text("notes"),
  /** Operator grouping labels ("tf2", "eu") — validated string[]. */
  tags: jsonb("tags"),
  /** Ephemeral servers: auto stop+delete when this instant passes. */
  expiresAt: timestamp("expires_at"),
  playerAlertThreshold: integer("player_alert_threshold"),
  playerAlertAbove: boolean("player_alert_above").default(false),
  // Timestamps
  lastStarted: timestamp("last_started"),
  lastStopped: timestamp("last_stopped"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    game_servers_user_id_idx: index("game_servers_user_id_idx").on(t.userId),
    game_servers_node_id_idx: index("game_servers_node_id_idx").on(t.nodeId),
    game_servers_game_id_idx: index("game_servers_game_id_idx").on(t.gameId),
}));

// ── Server metrics (monitoring) ────────────────────────────────
export const serverMetrics = pgTable("server_metrics", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id").references(() => gameServers.id),
  cpuPercent: real("cpu_percent"),
  ramUsedMb: real("ram_used_mb"),
  ramTotalMb: real("ram_total_mb"),
  ramBufferMb: real("ram_buffer_mb"),
  ramCachedMb: real("ram_cached_mb"),
  diskUsedMb: real("disk_used_mb"),
  diskTotalMb: real("disk_total_mb"),
  networkInKb: real("network_in_kb"),
  networkOutKb: real("network_out_kb"),
  playerCount: integer("player_count"),
  maxPlayers: integer("max_players"),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
}, (t) => ({
  server_metrics_server_id_idx: index("server_metrics_server_id_idx").on(t.serverId),
  server_metrics_recorded_at_idx: index("server_metrics_recorded_at_idx").on(t.recordedAt),
}));

// ── Forum categories ──────────────────────────────────────────
export const forumCategories = pgTable("forum_categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Forum threads ─────────────────────────────────────────────
export const forumThreads = pgTable("forum_threads", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id")
    .references(() => forumCategories.id)
    .notNull(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  title: varchar("title", { length: 256 }).notNull(),
  pinned: boolean("pinned").default(false),
  locked: boolean("locked").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    forum_threads_category_id_idx: index("forum_threads_category_id_idx").on(t.categoryId),
    forum_threads_user_id_idx: index("forum_threads_user_id_idx").on(t.userId),
}));

// ── Forum posts ───────────────────────────────────────────────
export const forumPosts = pgTable("forum_posts", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id")
    .references(() => forumThreads.id)
    .notNull(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
    forum_posts_thread_id_idx: index("forum_posts_thread_id_idx").on(t.threadId),
    forum_posts_user_id_idx: index("forum_posts_user_id_idx").on(t.userId),
}));

// ── League ladder standings ─────────────────────────────────
export const leagueLadderEntries = pgTable("league_ladder_entries", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => gameDefinitions.id),
  ladderName: varchar("ladder_name", { length: 128 }),
  season: varchar("season", { length: 64 }).notNull().default("S1"),
  teamName: varchar("team_name", { length: 128 }).notNull(),
  tag: varchar("tag", { length: 12 }),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  points: integer("points").notNull().default(0),
  streak: integer("streak").notNull().default(0),
  logoEmoji: varchar("logo_emoji", { length: 8 }).default("🎯"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Install log ───────────────────────────────────────────────
export const installLog = pgTable("install_log", {
  id: serial("id").primaryKey(),
  step: varchar("step", { length: 64 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  message: text("message"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Settings (key-value store for panel settings) ─────────────
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  value: text("value"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Player-count samples (idle + heatmap history) ───────────
export const playerSamples = pgTable("player_samples", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id").references(() => gameServers.id).notNull(),
  players: integer("players").notNull(),
  recordedAt: timestamp("recorded_at").defaultNow().notNull(),
});

// ── Tracked login sessions (revocable) ──────────────────────
export const authSessions = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: integer("user_id").references(() => users.id).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: varchar("user_agent", { length: 256 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
});

// ── Server change history (field-level diffs) ───────────────
export const serverChanges = pgTable("server_changes", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id").references(() => gameServers.id).notNull(),
  userId: integer("user_id").references(() => users.id),
  field: varchar("field", { length: 64 }).notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Idle detection state (zero-player streaks) ──────────────
export const serverIdleState = pgTable("server_idle_state", {
  serverId: integer("server_id").primaryKey().references(() => gameServers.id),
  zeroPlayersSince: timestamp("zero_players_since"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Server stability history (uptime samples) ───────────────
export const serverUptimeHistory = pgTable("server_uptime_history", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id").references(() => gameServers.id).notNull(),
  online: boolean("online").notNull(),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
});

// ── Panel access keys (CD-key gate) ─────────────────────────
export const accessKeys = pgTable("access_keys", {
  id: serial("id").primaryKey(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
  label: varchar("label", { length: 128 }),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
});

// ── Server presets (one-click setups) ────────────────────────
export const serverPresets = pgTable("server_presets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  gameId: integer("game_id").references(() => gameDefinitions.id).notNull(),
  variables: jsonb("variables"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Server lifecycle events (crash/restart history) ──────────
export const serverEvents = pgTable("server_events", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id").references(() => gameServers.id).notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Shop (sell license keys) ───────────────────────────────────
export const shopProducts = pgTable("shop_products", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  priceCents: integer("price_cents").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("usd"),
  maxActivations: integer("max_activations").notNull().default(1),
  durationDays: integer("duration_days"), // null = never expires
  active: boolean("active").notNull().default(true),
  kind: varchar("kind", { length: 12 }).notNull().default("onetime"), // onetime | subscription
  billingInterval: varchar("billing_interval", { length: 5 }), // month | year
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const shopCoupons = pgTable("shop_coupons", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  kind: varchar("kind", { length: 8 }).notNull().default("percent"), // percent | fixed
  value: integer("value").notNull(), // percent 1-100, or fixed cents
  maxUses: integer("max_uses"), // null = unlimited
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  active: boolean("active").notNull().default(true),
  productId: integer("product_id").references(() => shopProducts.id), // null = any product
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const shopResellers = pgTable("shop_resellers", {
  id: serial("id").primaryKey(),
  label: varchar("label", { length: 128 }).notNull(),
  email: varchar("email", { length: 254 }),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: varchar("token_prefix", { length: 12 }).notNull(),
  commissionPct: integer("commission_pct").notNull().default(10),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at"),
});

export const shopOrders = pgTable("shop_orders", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 254 }).notNull(),
  productId: integer("product_id").references(() => shopProducts.id).notNull(),
  provider: varchar("provider", { length: 16 }).notNull().default("manual"), // manual | stripe
  providerRef: text("provider_ref"), // stripe checkout session id
  providerSub: text("provider_sub"), // stripe subscription id (renewals)
  status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | paid | fulfilled | cancelled
  amountCents: integer("amount_cents").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("usd"),
  couponId: integer("coupon_id").references(() => shopCoupons.id),
  resellerId: integer("reseller_id").references(() => shopResellers.id),
  commissionCents: integer("commission_cents"),
  licenseKeyId: integer("license_key_id").references(() => licenseKeys.id),
  issuedKeyPlaintext: text("issued_key_plaintext"), // shown once to the buyer; emailed too
  createdAt: timestamp("created_at").defaultNow().notNull(),
  paidAt: timestamp("paid_at"),
  fulfilledAt: timestamp("fulfilled_at"),
});

// ── License keys (master-panel licensing) ──────────────────────
// This panel can act as the LICENSE SERVER: admins issue keys here and
// other installations must present one to install. Only the SHA-256 hash
// is stored; the plaintext key is shown exactly once at creation.
export const licenseKeys = pgTable("license_keys", {
  id: serial("id").primaryKey(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  label: varchar("label", { length: 128 }),
  maxActivations: integer("max_activations").notNull().default(1),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  expiryNotifiedAt: timestamp("expiry_notified_at"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const licenseActivations = pgTable("license_activations", {
  id: serial("id").primaryKey(),
  keyId: integer("key_id").references(() => licenseKeys.id, { onDelete: "cascade" }).notNull(),
  fingerprint: text("fingerprint").notNull(),
  hostname: text("hostname"),
  panelUrl: text("panel_url"),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
});

// ── Scheduled maintenance windows ──────────────────────────────
// Drain a node automatically at startsAt and release it at endsAt.
// appliedAt/completedAt let the scheduler know what it already did.
export const maintenanceWindows = pgTable("maintenance_windows", {
  id: serial("id").primaryKey(),
  nodeId: integer("node_id").references(() => nodes.id, { onDelete: "cascade" }).notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  reason: text("reason"),
  createdBy: integer("created_by").references(() => users.id),
  appliedAt: timestamp("applied_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Blueprints (multi-server deploy definitions) ───────────────
// A blueprint bundles preset deployments: "event night = 2x TF2 casual + 1x MvM".
// entries: Array<{ presetId: number; count: number; namePattern: string | null }>
export const serverBlueprints = pgTable("server_blueprints", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  name: varchar("name", { length: 128 }).notNull(),
  description: text("description"),
  entries: jsonb("entries").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Server collaborators (sharing) ───────────────────────────
// Owner/admin grants other users access to a single server.
//   viewer   — read-only: sees the server, may not control it
//   operator — may start/stop/restart, but not reconfigure or delete
export const serverCollaborators = pgTable("server_collaborators", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id").references(() => gameServers.id, { onDelete: "cascade" }).notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  role: varchar("role", { length: 16 }).notNull().default("viewer"),
  grantedBy: integer("granted_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Password reset links ─────────────────────────────────────
// The raw token lives only in the emailed link; the row stores its SHA-256
// hash, one unspent link per user, and a one-hour expiry.
export const passwordResets = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Discord GUID verifications ──────────────────────────────────
// Links a Discord account to an ET GUID (and optional panel user). This is
// what the chat bot's !etverify / !etsync / !desync commands read and write.
export const discordVerifications = pgTable("discord_verifications", {
  discordId: varchar("discord_id", { length: 32 }).primaryKey(),
  guid: varchar("guid", { length: 32 }).notNull().unique(),
  userId: integer("user_id").references(() => users.id),
  verifiedAt: timestamp("verified_at").defaultNow().notNull(),
  discordName: text("discord_name"),
});

// ── Scheduled Tasks ───────────────────────────────────────────
export const scheduledTasks = pgTable("scheduled_tasks", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id").references(() => gameServers.id),
  nodeId: integer("node_id").references(() => nodes.id),
  taskType: varchar("task_type", { length: 32 }).notNull(), // restart, backup, update, command
  cronExpression: varchar("cron_expression", { length: 64 }),
  command: text("command"),
  enabled: boolean("enabled").default(true),
  lastRun: timestamp("last_run"),
  nextRun: timestamp("next_run"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── API Keys ──────────────────────────────────────────────────
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: varchar("key_prefix", { length: 12 }).notNull(),
  permissions: jsonb("permissions"),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
    api_keys_user_id_idx: index("api_keys_user_id_idx").on(t.userId),
}));

// ── Audit Log ─────────────────────────────────────────────────
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  action: varchar("action", { length: 64 }).notNull(),
  entityType: varchar("entity_type", { length: 32 }),
  entityId: integer("entity_id"),
  details: jsonb("details"),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
    audit_log_user_id_idx: index("audit_log_user_id_idx").on(t.userId),
    audit_log_created_at_idx: index("audit_log_created_at_idx").on(t.createdAt),
}));

// ── Forum sandbox chat messages ───────────────────────────────
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
    chat_messages_created_at_idx: index("chat_messages_created_at_idx").on(t.createdAt),
    chat_messages_user_id_idx: index("chat_messages_user_id_idx").on(t.userId),
}));

// ── CMS: Pages / Blog Posts / Changelogs ──────────────────────
export const cmsPages = pgTable("cms_pages", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 256 }).notNull().unique(),
  title: varchar("title", { length: 256 }).notNull(),
  body: text("body").notNull(),
  type: varchar("type", { length: 20 }).notNull().default("blog"), // blog, changelog, page
  excerpt: text("excerpt"),
  coverImage: text("cover_image"),
  published: boolean("published").default(false),
  pinned: boolean("pinned").default(false),
  authorId: integer("author_id").references(() => users.id),
  tags: jsonb("tags"), // string[]
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
