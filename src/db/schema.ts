import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  bigint,
  real,
} from "drizzle-orm/pg-core";

// ── Users ──────────────────────────────────────────────────────
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("user"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Game definitions (seeds) ───────────────────────────────────
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
  gameId: integer("game_id")
    .references(() => gameDefinitions.id)
    .notNull(),
  name: varchar("name", { length: 128 }).notNull(),
  ipv4: varchar("ipv4", { length: 45 }),
  ipv6: varchar("ipv6", { length: 45 }),
  port: integer("port").notNull(),
  installPath: text("install_path").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("stopped"),
  pid: integer("pid"),
  config: jsonb("config"),
  autoRestart: boolean("auto_restart").default(true),
  discordWebhook: text("discord_webhook"),
  discordNotifyStart: boolean("discord_notify_start").default(true),
  discordNotifyStop: boolean("discord_notify_stop").default(true),
  discordNotifyRestart: boolean("discord_notify_restart").default(true),
  discordNotifyCrash: boolean("discord_notify_crash").default(true),
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
