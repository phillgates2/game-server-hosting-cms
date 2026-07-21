import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { installLog, settings, users, forumCategories } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { gameTemplates } from "@/db/seeds";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const rows = await db.select().from(settings).where(eq(settings.key, "installed")).limit(1);
    const installed = rows.length > 0 && rows[0].value === "true";
    let logs: Array<{ id: number; step: string; status: string; message: string | null }> = [];
    try {
      logs = await db
        .select({ id: installLog.id, step: installLog.step, status: installLog.status, message: installLog.message })
        .from(installLog);
    } catch {
      // table may not exist yet
    }
    return NextResponse.json({ installed, logs });
  } catch {
    return NextResponse.json({ installed: false, logs: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { adminUsername, adminEmail, adminPassword, panelName } = body;

    if (!adminUsername || !adminEmail || !adminPassword) {
      return NextResponse.json({ error: "Admin credentials required" }, { status: 400 });
    }

    // Step 1: Create database schema with multi-node support
    await logStep("schema", "running", "Creating database tables with multi-node support...");

    await pool.query(`
      -- Users
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        avatar_url TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Nodes (Multi-Server Support)
      CREATE TABLE IF NOT EXISTS nodes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        description TEXT,
        hostname VARCHAR(255) NOT NULL,
        ipv4 VARCHAR(45),
        ipv6 VARCHAR(45),
        ssh_port INTEGER DEFAULT 22,
        ssh_user VARCHAR(64),
        ssh_key_path TEXT,
        ssh_password TEXT,
        api_url TEXT,
        api_key TEXT,
        max_servers INTEGER DEFAULT 10,
        max_ram_mb INTEGER DEFAULT 16384,
        max_disk_mb INTEGER DEFAULT 100000,
        game_server_path TEXT DEFAULT '/opt/gameservers',
        steamcmd_path TEXT DEFAULT '/opt/steamcmd',
        status VARCHAR(20) NOT NULL DEFAULT 'offline',
        is_local BOOLEAN DEFAULT FALSE,
        is_default BOOLEAN DEFAULT FALSE,
        last_heartbeat TIMESTAMP,
        location VARCHAR(128),
        provider VARCHAR(64),
        tags JSONB,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Node Metrics
      CREATE TABLE IF NOT EXISTS node_metrics (
        id SERIAL PRIMARY KEY,
        node_id INTEGER REFERENCES nodes(id) NOT NULL,
        cpu_percent REAL,
        cpu_load_1 REAL,
        cpu_load_5 REAL,
        cpu_load_15 REAL,
        ram_used_mb REAL,
        ram_total_mb REAL,
        ram_buffer_mb REAL,
        ram_cached_mb REAL,
        disk_used_mb REAL,
        disk_total_mb REAL,
        network_rx_mb REAL,
        network_tx_mb REAL,
        server_count INTEGER,
        ipv6_enabled BOOLEAN,
        recorded_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Game Definitions
      CREATE TABLE IF NOT EXISTS game_definitions (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(128) NOT NULL,
        engine VARCHAR(64),
        default_port INTEGER NOT NULL,
        steam_app_id VARCHAR(32),
        install_script TEXT NOT NULL,
        start_command TEXT NOT NULL,
        stop_command TEXT,
        config_files JSONB,
        default_config JSONB,
        supports_ipv6 BOOLEAN DEFAULT FALSE,
        icon_emoji VARCHAR(8) DEFAULT '🎮',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Game Servers
      CREATE TABLE IF NOT EXISTS game_servers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        node_id INTEGER REFERENCES nodes(id),
        game_id INTEGER REFERENCES game_definitions(id) NOT NULL,
        name VARCHAR(128) NOT NULL,
        ipv4 VARCHAR(45),
        ipv6 VARCHAR(45),
        port INTEGER NOT NULL,
        query_port INTEGER,
        rcon_port INTEGER,
        install_path TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'stopped',
        pid INTEGER,
        config JSONB,
        variables JSONB,
        auto_restart BOOLEAN DEFAULT TRUE,
        auto_start BOOLEAN DEFAULT FALSE,
        max_ram_mb INTEGER,
        max_cpu_percent INTEGER,
        discord_webhook TEXT,
        discord_notify_start BOOLEAN DEFAULT TRUE,
        discord_notify_stop BOOLEAN DEFAULT TRUE,
        discord_notify_restart BOOLEAN DEFAULT TRUE,
        discord_notify_crash BOOLEAN DEFAULT TRUE,
        last_started TIMESTAMP,
        last_stopped TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Server Metrics
      CREATE TABLE IF NOT EXISTS server_metrics (
        id SERIAL PRIMARY KEY,
        server_id INTEGER REFERENCES game_servers(id),
        cpu_percent REAL,
        ram_used_mb REAL,
        ram_total_mb REAL,
        ram_buffer_mb REAL,
        ram_cached_mb REAL,
        disk_used_mb REAL,
        disk_total_mb REAL,
        network_in_kb REAL,
        network_out_kb REAL,
        player_count INTEGER,
        max_players INTEGER,
        recorded_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Forum Categories
      CREATE TABLE IF NOT EXISTS forum_categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        slug VARCHAR(128) NOT NULL UNIQUE,
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Forum Threads
      CREATE TABLE IF NOT EXISTS forum_threads (
        id SERIAL PRIMARY KEY,
        category_id INTEGER REFERENCES forum_categories(id) NOT NULL,
        user_id INTEGER REFERENCES users(id) NOT NULL,
        title VARCHAR(256) NOT NULL,
        pinned BOOLEAN DEFAULT FALSE,
        locked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Forum Posts
      CREATE TABLE IF NOT EXISTS forum_posts (
        id SERIAL PRIMARY KEY,
        thread_id INTEGER REFERENCES forum_threads(id) NOT NULL,
        user_id INTEGER REFERENCES users(id) NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Install Log
      CREATE TABLE IF NOT EXISTS install_log (
        id SERIAL PRIMARY KEY,
        step VARCHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        message TEXT,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Settings
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(128) NOT NULL UNIQUE,
        value TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Scheduled Tasks
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id SERIAL PRIMARY KEY,
        server_id INTEGER REFERENCES game_servers(id),
        node_id INTEGER REFERENCES nodes(id),
        task_type VARCHAR(32) NOT NULL,
        cron_expression VARCHAR(64),
        command TEXT,
        enabled BOOLEAN DEFAULT TRUE,
        last_run TIMESTAMP,
        next_run TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Audit Log
      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        action VARCHAR(64) NOT NULL,
        entity_type VARCHAR(32),
        entity_id INTEGER,
        details JSONB,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    await logStep("schema", "done", "Database tables created with multi-node support");

    // Step 2: Create admin user
    await logStep("admin_user", "running", "Creating admin user...");
    const passwordHash = await hashPassword(adminPassword);

    const existingAdmin = await db.select().from(users).where(eq(users.username, adminUsername)).limit(1);
    if (existingAdmin.length === 0) {
      await db.insert(users).values({
        username: adminUsername,
        email: adminEmail,
        passwordHash,
        role: "admin",
      });
    }
    await logStep("admin_user", "done", `Admin user '${adminUsername}' created`);

    // Step 3: Note about game templates (NOT auto-seeded)
    await logStep("game_templates", "done", `${gameTemplates.length} game templates available. Install from Games panel.`);

    // Step 4: Create forum categories
    await logStep("forum", "running", "Creating forum categories...");
    const forumCats = [
      { name: "Announcements", slug: "announcements", description: "Official announcements and updates", sortOrder: 0 },
      { name: "General Discussion", slug: "general", description: "General gaming discussion", sortOrder: 1 },
      { name: "Server Support", slug: "server-support", description: "Help with game server setup", sortOrder: 2 },
      { name: "Bug Reports", slug: "bugs", description: "Report bugs and issues", sortOrder: 3 },
      { name: "Feature Requests", slug: "features", description: "Suggest new features", sortOrder: 4 },
    ];
    for (const cat of forumCats) {
      const existing = await db.select().from(forumCategories).where(eq(forumCategories.slug, cat.slug)).limit(1);
      if (existing.length === 0) {
        await db.insert(forumCategories).values(cat);
      }
    }
    await logStep("forum", "done", `${forumCats.length} forum categories created`);

    // Step 5: Save settings
    await logStep("settings", "running", "Saving panel settings...");
    const settingsData = [
      { key: "panel_name", value: panelName || "GameServer Manager" },
      { key: "installed", value: "true" },
      { key: "install_date", value: new Date().toISOString() },
      { key: "version", value: "1.0.0" },
      { key: "multi_node_enabled", value: "true" },
      { key: "ipv6_enabled", value: "true" },
      { key: "buffer_threshold_percent", value: "80" },
      { key: "discord_enabled", value: "true" },
      { key: "available_templates", value: String(gameTemplates.length) },
    ];
    for (const s of settingsData) {
      const existing = await db.select().from(settings).where(eq(settings.key, s.key)).limit(1);
      if (existing.length === 0) {
        await db.insert(settings).values(s);
      } else {
        await db.update(settings).set({ value: s.value, updatedAt: new Date() }).where(eq(settings.key, s.key));
      }
    }
    await logStep("settings", "done", "Panel settings saved");

    return NextResponse.json({ 
      ok: true, 
      message: "Installation complete!",
      stats: {
        templatesAvailable: gameTemplates.length,
        forumCategories: forumCats.length,
        multiNodeEnabled: true,
      }
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function logStep(step: string, status: string, message: string) {
  try {
    const existing = await db.select().from(installLog).where(eq(installLog.step, step)).limit(1);
    if (existing.length === 0) {
      await db.insert(installLog).values({
        step,
        status,
        message,
        completedAt: status === "done" ? new Date() : null,
      });
    } else {
      await db
        .update(installLog)
        .set({ status, message, completedAt: status === "done" ? new Date() : null })
        .where(eq(installLog.step, step));
    }
  } catch {
    // Log table may not exist during early steps
  }
}
