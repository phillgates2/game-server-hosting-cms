/**
 * Seed Script: Satisfactory
 * 
 * This script adds Satisfactory Dedicated Server to an existing GamePanel installation.
 * Satisfactory is a first-person factory building game set in an alien world.
 * 
 * Usage:
 *   npx tsx scripts/seed-satisfactory.ts
 * 
 * Or via npm script:
 *   npm run seed:satisfactory
 */

import { config } from "dotenv";
config();

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { games } from "../src/db/schema";
import { eq } from "drizzle-orm";

const SATISFACTORY_TEMPLATE = {
  name: "Satisfactory",
  slug: "satisfactory",
  description: "First-person factory building game in an alien world",
  defaultPort: 7777,
  steamAppId: "1690800",
  installScript: `#!/bin/bash
set -e
cd /servers/{id}

# Install Satisfactory Dedicated Server via SteamCMD
steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 1690800 validate +quit

# Create config directory
mkdir -p FactoryGame/Saved/Config/LinuxServer

# Create Engine.ini for server settings
cat > FactoryGame/Saved/Config/LinuxServer/Engine.ini << 'ENGINECONFIG'
[/Script/SocketSubsystemEpic.EpicNetDriver]
MaxClientRate=104857600
MaxInternetClientRate=104857600

[/Script/OnlineSubsystemUtils.IpNetDriver]
MaxClientRate=104857600
MaxInternetClientRate=104857600

[/Script/Engine.Player]
ConfiguredInternetSpeed=104857600
ConfiguredLanSpeed=104857600

[/Script/Engine.GameNetworkManager]
TotalNetBandwidth=104857600
MaxDynamicBandwidth=104857600
MinDynamicBandwidth=10485760
ENGINECONFIG

# Create Game.ini
cat > FactoryGame/Saved/Config/LinuxServer/Game.ini << 'GAMECONFIG'
[/Script/Engine.GameSession]
MaxPlayers={slots}
GAMECONFIG

# Create GameUserSettings.ini
cat > FactoryGame/Saved/Config/LinuxServer/GameUserSettings.ini << 'USERSETTINGS'
[/Script/FactoryGame.FGGameUserSettings]
mFloatValues=(("FG.AutosaveInterval", 300))
mIntValues=(("FG.NetworkQuality", 3))
USERSETTINGS

# Create ServerSettings.ini
cat > FactoryGame/Saved/Config/LinuxServer/ServerSettings.ini << 'SERVERSETTINGS'
[/Script/FactoryGame.FGServerSubsystem]
mServerName={name}
mServerPassword={password}
mAdminPassword={adminPassword}
mAutoLoadSessionName=
SERVERSETTINGS

echo "Satisfactory server installed successfully!"`,
  startCommand: "./FactoryServer.sh -Port={port} -BeaconPort=15000 -ServerQueryPort=15777 -multihome=0.0.0.0",
  configTemplate: {
    maxPlayers: 4,
    serverName: "Satisfactory Server",
    password: "",
    adminPassword: "",
    autosaveInterval: 300,
    networkQuality: 3,
    autoLoadSession: "",
  },
  isActive: true,
};

async function seedSatisfactory() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  console.log("🏭 Satisfactory Seed Script");
  console.log("===========================\n");

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    const existing = await db.select().from(games).where(eq(games.slug, "satisfactory")).limit(1);
    
    if (existing.length > 0) {
      console.log("⚠️  Satisfactory already exists in the database (ID: " + existing[0].id + ")");
      console.log("   Updating existing entry...\n");
      
      await db.update(games).set({
        name: SATISFACTORY_TEMPLATE.name,
        description: SATISFACTORY_TEMPLATE.description,
        defaultPort: SATISFACTORY_TEMPLATE.defaultPort,
        steamAppId: SATISFACTORY_TEMPLATE.steamAppId,
        installScript: SATISFACTORY_TEMPLATE.installScript,
        startCommand: SATISFACTORY_TEMPLATE.startCommand,
        configTemplate: SATISFACTORY_TEMPLATE.configTemplate,
        isActive: SATISFACTORY_TEMPLATE.isActive,
      }).where(eq(games.slug, "satisfactory"));
      
      console.log("✅ Satisfactory updated successfully!\n");
    } else {
      console.log("📦 Adding Satisfactory to the database...\n");
      
      const result = await db.insert(games).values(SATISFACTORY_TEMPLATE).returning();
      
      console.log("✅ Satisfactory added successfully!");
      console.log("   Game ID: " + result[0].id);
      console.log("   Slug: " + result[0].slug);
      console.log("   Default Port: " + result[0].defaultPort + "\n");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📋 Satisfactory Configuration Summary");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  Name:          " + SATISFACTORY_TEMPLATE.name);
    console.log("  Steam App ID:  " + SATISFACTORY_TEMPLATE.steamAppId);
    console.log("  Default Port:  " + SATISFACTORY_TEMPLATE.defaultPort);
    console.log("  Max Players:   " + SATISFACTORY_TEMPLATE.configTemplate.maxPlayers);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("🌐 Required Ports:");
    console.log("   • 7777/UDP  - Game server");
    console.log("   • 15000/UDP - Beacon port");
    console.log("   • 15777/UDP - Server query port\n");

    console.log("📁 Config Files:");
    console.log("   • FactoryGame/Saved/Config/LinuxServer/Engine.ini");
    console.log("   • FactoryGame/Saved/Config/LinuxServer/Game.ini");
    console.log("   • FactoryGame/Saved/Config/LinuxServer/GameUserSettings.ini");
    console.log("   • FactoryGame/Saved/Config/LinuxServer/ServerSettings.ini\n");

    console.log("⚙️  Network Quality Settings:");
    console.log("   • 0 = Low");
    console.log("   • 1 = Medium");
    console.log("   • 2 = High");
    console.log("   • 3 = Ultra (default)\n");

    console.log("💡 Server Commands:");
    console.log("   • server.SaveGame - Save current game");
    console.log("   • server.Shutdown - Graceful shutdown");
    console.log("   • FG.AutosaveInterval - Set autosave (seconds)\n");

    console.log("📝 Notes:");
    console.log("   • First connection will need to claim the server");
    console.log("   • Admin password grants full server control");
    console.log("   • Sessions are saved in FactoryGame/Saved/SaveGames/server/\n");

  } catch (error) {
    console.error("❌ Error seeding Satisfactory:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }

  console.log("🚀 You can now create Satisfactory servers from the panel!");
  console.log("   Navigate to Servers → Create Server → Select Satisfactory\n");
}

seedSatisfactory();
