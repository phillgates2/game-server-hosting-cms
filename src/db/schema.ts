import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
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
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorSecret: text("two_factor_secret"),
  maxServers: integer("max_servers").default(5),
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
  sshPassword: text("ssh_password"), // encrypted
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
});

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
  // Timestamps
  lastStarted: timestamp("last_started"),
  lastStopped: timestamp("last_stopped"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
});

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
});

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
});

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
});

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
