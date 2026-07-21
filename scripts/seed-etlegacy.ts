/**
 * Seed Script: ET: Legacy (Wolfenstein: Enemy Territory)
 * 
 * This script adds ET: Legacy to an existing GamePanel installation.
 * 
 * Usage:
 *   npx tsx scripts/seed-etlegacy.ts
 * 
 * Or via npm script:
 *   npm run seed:etlegacy
 */

import { config } from "dotenv";
config();

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { games } from "../src/db/schema";
import { eq } from "drizzle-orm";

const ETLEGACY_TEMPLATE = {
  name: "ET: Legacy",
  slug: "etlegacy",
  description: "Open-source Wolfenstein: Enemy Territory with modern improvements",
  defaultPort: 27960,
  steamAppId: null,
  installScript: `#!/bin/bash
set -e
cd /servers/{id}

# Download ET: Legacy server
ETLEGACY_VERSION="2.82.1"
wget -q https://www.etlegacy.com/download/file/550 -O etlegacy-v\${ETLEGACY_VERSION}-x86_64.tar.gz
tar -xzf etlegacy-v\${ETLEGACY_VERSION}-x86_64.tar.gz --strip-components=1
rm etlegacy-v\${ETLEGACY_VERSION}-x86_64.tar.gz

# Download required pak files (from official ET)
mkdir -p etmain
cd etmain
wget -q https://mirror.etlegacy.com/etmain/pak0.pk3
wget -q https://mirror.etlegacy.com/etmain/pak1.pk3
wget -q https://mirror.etlegacy.com/etmain/pak2.pk3

# Create default server config
cat > server.cfg << 'ETCONFIG'
// ET: Legacy Server Configuration
set sv_hostname "{name}"
set sv_maxclients {slots}
set g_password ""
set sv_privateClients 0
set sv_privatPassword ""
set rconPassword "{rconPassword}"
set refereePassword ""
set g_heavyWeaponRestriction 100
set g_antilag 1
set g_altStopwatch 0
set g_autofireteams 1
set g_complaintlimit 6
set g_ipcomplaintlimit 3
set g_fastres 0
set g_friendlyFire 1
set g_gametype 4
set g_minGameClients 2
set g_maxlives 0
set g_alliedmaxlives 0
set g_axismaxlives 0
set g_teamforcebalance 1
set g_noTeamSwitching 0
set g_voiceChatsAllowed 5
set g_doWarmup 0
set g_warmup 60
set g_lms_roundlimit 3
set g_lms_matchlimit 2
set g_lms_followTeamOnly 1
set g_lms_lockTeams 0
set match_latejoin 1
set match_minplayers 2
set match_mutespecs 0
set match_readypercent 100
set match_warmupDamage 1
set team_maxplayers 0
set team_nocontrols 0
set sv_floodProtect 1
set sv_pure 1
set sv_allowDownload 1
set sv_dl_maxRate 42000
set sv_wwwDownload 0
set sv_wwwBaseUrl ""
set sv_wwwDlDisconnected 0
set sv_wwwFallbackURL ""
ETCONFIG

echo "ET: Legacy server installed successfully!"`,
  startCommand: "./etlded +set fs_basepath /servers/{id} +set fs_homepath /servers/{id} +set net_port {port} +exec server.cfg +map oasis",
  configTemplate: {
    maxPlayers: 32,
    gametype: 4,
    map: "oasis",
    hostname: "ET: Legacy Server",
    rconPassword: "",
    password: "",
    punkbuster: false,
    antilag: true,
    friendlyFire: true,
  },
  isActive: true,
};

async function seedETLegacy() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  console.log("🪖 ET: Legacy Seed Script");
  console.log("========================\n");

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    // Check if already exists
    const existing = await db.select().from(games).where(eq(games.slug, "etlegacy")).limit(1);
    
    if (existing.length > 0) {
      console.log("⚠️  ET: Legacy already exists in the database (ID: " + existing[0].id + ")");
      console.log("   Updating existing entry...\n");
      
      await db.update(games).set({
        name: ETLEGACY_TEMPLATE.name,
        description: ETLEGACY_TEMPLATE.description,
        defaultPort: ETLEGACY_TEMPLATE.defaultPort,
        steamAppId: ETLEGACY_TEMPLATE.steamAppId,
        installScript: ETLEGACY_TEMPLATE.installScript,
        startCommand: ETLEGACY_TEMPLATE.startCommand,
        configTemplate: ETLEGACY_TEMPLATE.configTemplate,
        isActive: ETLEGACY_TEMPLATE.isActive,
      }).where(eq(games.slug, "etlegacy"));
      
      console.log("✅ ET: Legacy updated successfully!\n");
    } else {
      console.log("📦 Adding ET: Legacy to the database...\n");
      
      const result = await db.insert(games).values(ETLEGACY_TEMPLATE).returning();
      
      console.log("✅ ET: Legacy added successfully!");
      console.log("   Game ID: " + result[0].id);
      console.log("   Slug: " + result[0].slug);
      console.log("   Default Port: " + result[0].defaultPort + "\n");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📋 ET: Legacy Configuration Summary");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  Name:         " + ETLEGACY_TEMPLATE.name);
    console.log("  Slug:         " + ETLEGACY_TEMPLATE.slug);
    console.log("  Default Port: " + ETLEGACY_TEMPLATE.defaultPort);
    console.log("  Max Players:  " + ETLEGACY_TEMPLATE.configTemplate.maxPlayers);
    console.log("  Default Map:  " + ETLEGACY_TEMPLATE.configTemplate.map);
    console.log("  Gametype:     " + ETLEGACY_TEMPLATE.configTemplate.gametype + " (Campaign)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("🎮 Available Maps:");
    console.log("   • oasis       - Axis must defend the old city guns");
    console.log("   • goldrush    - Allies must steal Nazi gold");
    console.log("   • battery     - Coastal assault map");
    console.log("   • radar       - Destroy radar equipment");
    console.log("   • railgun     - Destroy the railgun");
    console.log("   • fuel_dump   - Destroy the fuel depot");
    console.log("   • siwa_oasis  - Capture the oasis\n");

    console.log("🎯 Gametypes:");
    console.log("   • 2 - Single-Map Objective (sw)");
    console.log("   • 3 - Stopwatch (sw)");
    console.log("   • 4 - Campaign (default)");
    console.log("   • 5 - Last Man Standing (lms)\n");

  } catch (error) {
    console.error("❌ Error seeding ET: Legacy:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }

  console.log("🚀 You can now create ET: Legacy servers from the panel!");
  console.log("   Navigate to Servers → Create Server → Select ET: Legacy\n");
}

seedETLegacy();
