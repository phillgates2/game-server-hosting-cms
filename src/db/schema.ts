import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// ─── Site Settings (install wizard stores config here) ───
export const siteSettings = pgTable("site_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Users ───
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 50 }).notNull().default("user"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Game Definitions ───
export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  description: text("description"),
  iconUrl: text("icon_url"),
  defaultPort: integer("default_port").notNull().default(27015),
  steamAppId: varchar("steam_app_id", { length: 50 }),
  installScript: text("install_script"),
  startCommand: text("start_command"),
  configTemplate: jsonb("config_template"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Nodes (physical/virtual machines) ───
export const nodes = pgTable("nodes", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  ipAddress: varchar("ip_address", { length: 45 }).notNull(),
  ip6Address: varchar("ip6_address", { length: 128 }),
  ip6Enabled: boolean("ip6_enabled").notNull().default(false),
  port: integer("port").notNull().default(22),
  maxSlots: integer("max_slots").notNull().default(100),
  usedSlots: integer("used_slots").notNull().default(0),
  status: varchar("status", { length: 50 }).notNull().default("online"),
  location: varchar("location", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Game Servers ───
export const gameServers = pgTable("game_servers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  userId: integer("user_id").notNull(),
  gameId: integer("game_id").notNull(),
  nodeId: integer("node_id").notNull(),
  port: integer("port").notNull(),
  slots: integer("slots").notNull().default(16),
  status: varchar("status", { length: 50 }).notNull().default("stopped"),
  installStatus: varchar("install_status", { length: 50 }).notNull().default("pending"),
  ip6Bind: boolean("ip6_bind").notNull().default(false),
  configData: jsonb("config_data"),
  installLog: text("install_log"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Service Plans ───
export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  priceMonthly: integer("price_monthly").notNull(),
  slots: integer("slots").notNull().default(16),
  ramMb: integer("ram_mb").notNull().default(2048),
  diskMb: integer("disk_mb").notNull().default(10240),
  cpuPercent: integer("cpu_percent").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Forum Categories ───
export const forumCategories = pgTable("forum_categories", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Forum Topics ───
export const forumTopics = pgTable("forum_topics", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id").notNull(),
  userId: integer("user_id").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  slug: varchar("slug", { length: 500 }).notNull(),
  isPinned: boolean("is_pinned").notNull().default(false),
  isLocked: boolean("is_locked").notNull().default(false),
  viewCount: integer("view_count").notNull().default(0),
  replyCount: integer("reply_count").notNull().default(0),
  lastPostAt: timestamp("last_post_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Forum Posts ───
export const forumPosts = pgTable("forum_posts", {
  id: serial("id").primaryKey(),
  topicId: integer("topic_id").notNull(),
  userId: integer("user_id").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Support Tickets ───
export const tickets = pgTable("tickets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  status: varchar("status", { length: 50 }).notNull().default("open"),
  priority: varchar("priority", { length: 50 }).notNull().default("normal"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const ticketReplies = pgTable("ticket_replies", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id").notNull(),
  userId: integer("user_id").notNull(),
  content: text("content").notNull(),
  isStaff: boolean("is_staff").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Activity Log ───
export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  action: varchar("action", { length: 255 }).notNull(),
  details: text("details"),
  ipAddress: varchar("ip_address", { length: 128 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Server Monitor Snapshots ───
export const monitorSnapshots = pgTable("monitor_snapshots", {
  id: serial("id").primaryKey(),
  totalRam: integer("total_ram").notNull(),
  usedRam: integer("used_ram").notNull(),
  freeRam: integer("free_ram").notNull(),
  availableRam: integer("available_ram").notNull(),
  buffersRam: integer("buffers_ram").notNull(),
  cachedRam: integer("cached_ram").notNull(),
  swapTotal: integer("swap_total").notNull(),
  swapUsed: integer("swap_used").notNull(),
  cpuUsage: integer("cpu_usage").notNull().default(0),
  loadAvg1: varchar("load_avg_1", { length: 20 }),
  loadAvg5: varchar("load_avg_5", { length: 20 }),
  loadAvg15: varchar("load_avg_15", { length: 20 }),
  diskTotal: integer("disk_total"),
  diskUsed: integer("disk_used"),
  autoClearTriggered: boolean("auto_clear_triggered").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Monitor Cache Clear Events ───
export const monitorClearEvents = pgTable("monitor_clear_events", {
  id: serial("id").primaryKey(),
  trigger: varchar("trigger", { length: 50 }).notNull(),
  ramBeforeMb: integer("ram_before_mb").notNull(),
  buffersBeforeMb: integer("buffers_before_mb").notNull(),
  cachedBeforeMb: integer("cached_before_mb").notNull(),
  ramAfterMb: integer("ram_after_mb"),
  buffersAfterMb: integer("buffers_after_mb"),
  cachedAfterMb: integer("cached_after_mb"),
  freedMb: integer("freed_mb"),
  clearLevel: integer("clear_level").notNull().default(3),
  status: varchar("status", { length: 50 }).notNull().default("success"),
  errorLog: text("error_log"),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
