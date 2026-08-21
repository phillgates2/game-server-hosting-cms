import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { db, pool } from "@/db";
import { installLog, settings, users, forumCategories, roles } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { getCurrentUser } from "@/lib/auth";
import { gameTemplates } from "@/db/seeds";
import { DEFAULT_ROLES, hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";
import { apiError } from "@/lib/api-error";

function buildDatabaseUrlWithPassword(databaseUrl: string, password: string) {
  try {
    const parsed = new URL(databaseUrl);
    parsed.password = password;
    return parsed.toString();
  } catch {
    return `postgresql://gsmadmin:${encodeURIComponent(password)}@127.0.0.1:5432/gameserver_db`;
  }
}

async function writeDatabaseUrlToEnv(databaseUrl: string) {
  const envPath = path.join(process.cwd(), ".env");
  let contents = "";
  try {
    contents = await fs.readFile(envPath, "utf8");
  } catch {
    // .env may not exist yet; create it from scratch.
  }

  const lines = contents
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("DATABASE_URL="));
  lines.push(`DATABASE_URL=${databaseUrl}`);
  await fs.writeFile(envPath, `${lines.join("\n")}\n`, "utf8");
}

async function restartPanelProcess() {
  await new Promise<void>((resolve) => {
    execFile("pm2", ["restart", "gsm-panel"], (error: Error | null) => {
      if (error) {
        resolve();
        return;
      }
      resolve();
    });
  });
}

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
    let alreadyInstalled = false;
    try {
      const installedRows = await db.select().from(settings).where(eq(settings.key, "installed")).limit(1);
      alreadyInstalled = installedRows.length > 0 && installedRows[0].value === "true";
    } catch {
      // settings table may not exist yet on first install — that's fine
    }

    if (alreadyInstalled) {
      const auth = await getCurrentUser(req.headers);
      if (!auth || !(await hasPermission(auth.userId, "panel.install"))) {
        return NextResponse.json({ error: "Permission denied" }, { status: 403 });
      }
    }

    const body = await req.json();
    const { adminUsername, adminEmail, adminPassword, panelName, databasePassword } = body;
    let pendingDatabaseUrlUpdate: string | null = null;

    if (!adminUsername || !adminEmail || !adminPassword) {
      return NextResponse.json({ error: "Admin credentials required" }, { status: 400 });
    }

    if (databasePassword) {
      const currentDatabaseUrl = process.env.DATABASE_URL || "";
      await pool.query("ALTER ROLE gsmadmin WITH PASSWORD $1", [databasePassword]);
      pendingDatabaseUrlUpdate = buildDatabaseUrlWithPassword(currentDatabaseUrl, databasePassword);
      await logStep("database", "running", "Updated database role password. Will refresh panel connection settings at the end...");
    }

    // Step 1: Create database schema with multi-node support
    await logStep("schema", "running", "Creating database tables with multi-node support...");

    await pool.query(`
      -- Roles & Permissions
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(64) NOT NULL UNIQUE,
        display_name VARCHAR(128) NOT NULL,
        color VARCHAR(7) DEFAULT '#3b82f6',
        icon VARCHAR(8) DEFAULT '👤',
        is_system BOOLEAN DEFAULT FALSE,
        is_default BOOLEAN DEFAULT FALSE,
        priority INTEGER DEFAULT 0,
        permissions JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      -- Users
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(64) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        role_id INTEGER REFERENCES roles(id),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        avatar_url TEXT,
        bio TEXT,
        location VARCHAR(128),
        website VARCHAR(256),
        theme_config JSONB,
        two_factor_enabled BOOLEAN DEFAULT FALSE,
        two_factor_secret TEXT,
        max_servers INTEGER DEFAULT 5,
        last_login_at TIMESTAMP,
        last_login_ip VARCHAR(45),
        login_count INTEGER DEFAULT 0,
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
      
        -- League ladder standings
        CREATE TABLE IF NOT EXISTS league_ladder_entries (
          id SERIAL PRIMARY KEY,
          game_id INTEGER REFERENCES game_definitions(id),
          season VARCHAR(64) NOT NULL DEFAULT 'S1',
          team_name VARCHAR(128) NOT NULL,
          tag VARCHAR(12),
          wins INTEGER NOT NULL DEFAULT 0,
          losses INTEGER NOT NULL DEFAULT 0,
          draws INTEGER NOT NULL DEFAULT 0,
          points INTEGER NOT NULL DEFAULT 0,
          streak INTEGER NOT NULL DEFAULT 0,
          logo_emoji VARCHAR(8) DEFAULT '🎯',
          notes TEXT,
          created_by INTEGER REFERENCES users(id),
          updated_by INTEGER REFERENCES users(id),
          created_at TIMESTAMP DEFAULT NOW() NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW() NOT NULL
        );

        CREATE INDEX IF NOT EXISTS league_ladder_entries_game_season_idx
          ON league_ladder_entries (game_id, season);

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

      -- CMS Pages / Blog / Changelogs
      CREATE TABLE IF NOT EXISTS cms_pages (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(256) NOT NULL UNIQUE,
        title VARCHAR(256) NOT NULL,
        body TEXT NOT NULL,
        type VARCHAR(20) NOT NULL DEFAULT 'blog',
        excerpt TEXT,
        cover_image TEXT,
        published BOOLEAN DEFAULT FALSE,
        pinned BOOLEAN DEFAULT FALSE,
        author_id INTEGER REFERENCES users(id),
        tags JSONB,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);
    await logStep("schema", "done", "Database tables created with role-based permissions");

    // Step 2: Seed default roles
    await logStep("roles", "running", "Creating roles...");
    let adminRoleId: number | null = null;
    for (const roleDef of DEFAULT_ROLES) {
      const existing = await db.select().from(roles).where(eq(roles.name, roleDef.name)).limit(1);
      if (existing.length === 0) {
        const [created] = await db.insert(roles).values({
          name: roleDef.name,
          displayName: roleDef.displayName,
          color: roleDef.color,
          icon: roleDef.icon,
          isSystem: roleDef.isSystem,
          isDefault: roleDef.isDefault,
          priority: roleDef.priority,
          permissions: roleDef.permissions,
        }).returning();
        if (roleDef.name === "admin") adminRoleId = created.id;
      } else {
          if (roleDef.isSystem) {
            const mergedPermissions = {
              ...(existing[0].permissions as Record<string, boolean> || {}),
              ...roleDef.permissions,
            };
            await db.update(roles).set({
              displayName: roleDef.displayName,
              color: roleDef.color,
              icon: roleDef.icon,
              priority: roleDef.priority,
              isSystem: roleDef.isSystem,
              isDefault: roleDef.isDefault,
              permissions: mergedPermissions,
              updatedAt: new Date(),
            }).where(eq(roles.id, existing[0].id));
          }
        if (roleDef.name === "admin") adminRoleId = existing[0].id;
      }
    }
    await logStep("roles", "done", `${DEFAULT_ROLES.length} roles created (admin, moderator, user)`);

    // Step 3: Create admin user
    await logStep("admin_user", "running", "Creating admin user...");
    const passwordHash = await hashPassword(adminPassword);

    const existingAdmin = await db.select().from(users).where(eq(users.username, adminUsername)).limit(1);
    if (existingAdmin.length === 0) {
      await db.insert(users).values({
        username: adminUsername,
        email: adminEmail,
        passwordHash,
        role: "admin",
        roleId: adminRoleId,
      });
    }
    await logStep("admin_user", "done", `Admin user '${adminUsername}' created`);

    // Step 4: Note about game templates (NOT auto-seeded)
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

    if (pendingDatabaseUrlUpdate) {
      process.env.DATABASE_URL = pendingDatabaseUrlUpdate;
      await writeDatabaseUrlToEnv(pendingDatabaseUrlUpdate);
      await restartPanelProcess();
      await logStep("database", "done", "Database connection settings refreshed and panel restart requested.");
    }

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
    return apiError(e, "Unknown error", 500);
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
