/**
 * Seed Script: Terraria
 * 
 * This script adds Terraria Dedicated Server to an existing GamePanel installation.
 * Terraria is a 2D sandbox adventure game with exploration and building.
 * 
 * Usage:
 *   npx tsx scripts/seed-terraria.ts
 * 
 * Or via npm script:
 *   npm run seed:terraria
 */

import { config } from "dotenv";
config();

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { games } from "../src/db/schema";
import { eq } from "drizzle-orm";

const TERRARIA_TEMPLATE = {
  name: "Terraria",
  slug: "terraria",
  description: "2D sandbox adventure game with exploration and building",
  defaultPort: 7777,
  steamAppId: "105600",
  installScript: `#!/bin/bash
set -e
cd /servers/{id}

# Install Terraria Dedicated Server via SteamCMD
steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 105600 validate +quit

# Move to Linux server directory
cd /servers/{id}

# Find and setup the Linux server binary
if [ -d "Linux" ]; then
    cd Linux
elif [ -f "TerrariaServer.bin.x86_64" ]; then
    echo "Server binary found"
else
    # Download standalone server as fallback
    TERRARIA_VERSION="1449"
    wget -q "https://terraria.org/api/download/pc-dedicated-server/terraria-server-\${TERRARIA_VERSION}.zip" -O terraria-server.zip
    unzip -q terraria-server.zip
    mv \${TERRARIA_VERSION}/Linux/* .
    rm -rf terraria-server.zip \${TERRARIA_VERSION}
fi

chmod +x TerrariaServer.bin.x86_64 2>/dev/null || true

# Create server configuration
cat > serverconfig.txt << 'SERVERCONFIG'
# Terraria Server Configuration

# World file location
world=/servers/{id}/Worlds/{worldName}.wld

# Automatically create world if not found
autocreate={worldSize}

# World name
worldname={worldName}

# Max players
maxplayers={slots}

# Server port
port={port}

# Server password (leave blank for no password)
password={password}

# Message of the day
motd=Welcome to {name}!

# World difficulty (0=normal, 1=expert, 2=master, 3=journey)
difficulty={difficulty}

# Language
language=en-US

# Npc stream
npcstream=60

# Priority (0=realtime, 1=high, 2=above normal, 3=normal, 4=below normal, 5=idle)
priority=1

# Journey mode power permissions
journeypermission_time_setfrozen=2
journeypermission_time_setdawn=2
journeypermission_time_setnoon=2
journeypermission_time_setdusk=2
journeypermission_time_setmidnight=2
journeypermission_godmode=2
journeypermission_wind_setstrength=2
journeypermission_rain_setstrength=2
journeypermission_time_setspeed=2
journeypermission_rain_setfrozen=2
journeypermission_wind_setfrozen=2
journeypermission_increaseplacementrange=2
journeypermission_setdifficulty=2
journeypermission_biomespread_setfrozen=2
journeypermission_setspawnrate=2

# Secure mode
secure=1

# Banlist
banlist=banlist.txt
SERVERCONFIG

# Create worlds directory
mkdir -p /servers/{id}/Worlds

# Create startup script
cat > start.sh << 'STARTSCRIPT'
#!/bin/bash
cd /servers/{id}
./TerrariaServer.bin.x86_64 -config serverconfig.txt
STARTSCRIPT
chmod +x start.sh

echo "Terraria server installed successfully!"`,
  startCommand: "./start.sh",
  configTemplate: {
    maxPlayers: 16,
    worldName: "World1",
    worldSize: 2,
    difficulty: 0,
    password: "",
    motd: "Welcome to Terraria!",
    secure: true,
    language: "en-US",
  },
  isActive: true,
};

async function seedTerraria() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  console.log("⛏️  Terraria Seed Script");
  console.log("========================\n");

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    const existing = await db.select().from(games).where(eq(games.slug, "terraria")).limit(1);
    
    if (existing.length > 0) {
      console.log("⚠️  Terraria already exists in the database (ID: " + existing[0].id + ")");
      console.log("   Updating existing entry...\n");
      
      await db.update(games).set({
        name: TERRARIA_TEMPLATE.name,
        description: TERRARIA_TEMPLATE.description,
        defaultPort: TERRARIA_TEMPLATE.defaultPort,
        steamAppId: TERRARIA_TEMPLATE.steamAppId,
        installScript: TERRARIA_TEMPLATE.installScript,
        startCommand: TERRARIA_TEMPLATE.startCommand,
        configTemplate: TERRARIA_TEMPLATE.configTemplate,
        isActive: TERRARIA_TEMPLATE.isActive,
      }).where(eq(games.slug, "terraria"));
      
      console.log("✅ Terraria updated successfully!\n");
    } else {
      console.log("📦 Adding Terraria to the database...\n");
      
      const result = await db.insert(games).values(TERRARIA_TEMPLATE).returning();
      
      console.log("✅ Terraria added successfully!");
      console.log("   Game ID: " + result[0].id);
      console.log("   Slug: " + result[0].slug);
      console.log("   Default Port: " + result[0].defaultPort + "\n");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📋 Terraria Configuration Summary");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  Name:          " + TERRARIA_TEMPLATE.name);
    console.log("  Steam App ID:  " + TERRARIA_TEMPLATE.steamAppId);
    console.log("  Default Port:  " + TERRARIA_TEMPLATE.defaultPort);
    console.log("  Max Players:   " + TERRARIA_TEMPLATE.configTemplate.maxPlayers);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("🌐 Required Ports:");
    console.log("   • 7777/TCP - Game server (default)\n");

    console.log("🗺️  World Sizes (autocreate):");
    console.log("   • 1 = Small  (4200 x 1200 tiles)");
    console.log("   • 2 = Medium (6400 x 1800 tiles)");
    console.log("   • 3 = Large  (8400 x 2400 tiles)\n");

    console.log("⚔️  Difficulty Levels:");
    console.log("   • 0 = Classic/Normal");
    console.log("   • 1 = Expert");
    console.log("   • 2 = Master");
    console.log("   • 3 = Journey\n");

    console.log("💡 Server Commands:");
    console.log("   • help           - Show commands");
    console.log("   • playing        - Show players online");
    console.log("   • kick <player>  - Kick a player");
    console.log("   • ban <player>   - Ban a player");
    console.log("   • password <pw>  - Set password");
    console.log("   • save           - Save the world");
    console.log("   • exit           - Save and shutdown");
    console.log("   • exit-nosave    - Shutdown without saving");
    console.log("   • say <message>  - Broadcast message");
    console.log("   • settle         - Settle liquids");
    console.log("   • dawn/noon/dusk/midnight - Set time\n");

    console.log("📁 Important Paths:");
    console.log("   • Config: /servers/{id}/serverconfig.txt");
    console.log("   • Worlds: /servers/{id}/Worlds/");
    console.log("   • Banlist: /servers/{id}/banlist.txt\n");

  } catch (error) {
    console.error("❌ Error seeding Terraria:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }

  console.log("🚀 You can now create Terraria servers from the panel!");
  console.log("   Navigate to Servers → Create Server → Select Terraria\n");
}

seedTerraria();
