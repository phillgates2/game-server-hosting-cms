/**
 * Seed Script: Palworld
 * 
 * This script adds Palworld Dedicated Server to an existing GamePanel installation.
 * Palworld is a multiplayer creature-collection survival game.
 * 
 * Usage:
 *   npx tsx scripts/seed-palworld.ts
 * 
 * Or via npm script:
 *   npm run seed:palworld
 */

import { config } from "dotenv";
config();

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { games } from "../src/db/schema";
import { eq } from "drizzle-orm";

const PALWORLD_TEMPLATE = {
  name: "Palworld",
  slug: "palworld",
  description: "Multiplayer creature-collection survival game with Pals",
  defaultPort: 8211,
  steamAppId: "2394010",
  installScript: `#!/bin/bash
set -e
cd /servers/{id}

# Install Palworld Dedicated Server via SteamCMD
steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 2394010 validate +quit

# Create Pal directory structure
mkdir -p Pal/Saved/Config/LinuxServer

# Create default server settings
cat > Pal/Saved/Config/LinuxServer/PalWorldSettings.ini << 'PALCONFIG'
[/Script/Pal.PalGameWorldSettings]
OptionSettings=(Difficulty=None,DayTimeSpeedRate=1.000000,NightTimeSpeedRate=1.000000,ExpRate=1.000000,PalCaptureRate=1.000000,PalSpawnNumRate=1.000000,PalDamageRateAttack=1.000000,PalDamageRateDefense=1.000000,PlayerDamageRateAttack=1.000000,PlayerDamageRateDefense=1.000000,PlayerStomachDecreaceRate=1.000000,PlayerStaminaDecreaceRate=1.000000,PlayerAutoHPRegeneRate=1.000000,PlayerAutoHpRegeneRateInSleep=1.000000,PalStomachDecreaceRate=1.000000,PalStaminaDecreaceRate=1.000000,PalAutoHPRegeneRate=1.000000,PalAutoHpRegeneRateInSleep=1.000000,BuildObjectDamageRate=1.000000,BuildObjectDeteriorationDamageRate=1.000000,CollectionDropRate=1.000000,CollectionObjectHpRate=1.000000,CollectionObjectRespawnSpeedRate=1.000000,EnemyDropItemRate=1.000000,DeathPenalty=All,bEnablePlayerToPlayerDamage=False,bEnableFriendlyFire=False,bEnableInvaderEnemy=True,bActiveUNKO=False,bEnableAimAssistPad=True,bEnableAimAssistKeyboard=False,DropItemMaxNum=3000,DropItemMaxNum_UNKO=100,BaseCampMaxNum=128,BaseCampWorkerMaxNum=15,DropItemAliveMaxHours=1.000000,bAutoResetGuildNoOnlinePlayers=False,AutoResetGuildTimeNoOnlinePlayers=72.000000,GuildPlayerMaxNum=20,PalEggDefaultHatchingTime=72.000000,WorkSpeedRate=1.000000,bIsMultiplay=True,bIsPvP=False,bCanPickupOtherGuildDeathPenaltyDrop=False,bEnableNonLoginPenalty=True,bEnableFastTravel=True,bIsStartLocationSelectByMap=True,bExistPlayerAfterLogout=False,bEnableDefenseOtherGuildPlayer=False,CoopPlayerMaxNum={slots},ServerPlayerMaxNum={slots},ServerName="{name}",ServerDescription="Palworld Dedicated Server",AdminPassword="{adminPassword}",ServerPassword="{password}",PublicPort={port},PublicIP="",RCONEnabled=True,RCONPort={rconPort},Region="",bUseAuth=True,BanListURL="https://api.palworldgame.com/api/banlist.txt")
PALCONFIG

echo "Palworld server installed successfully!"`,
  startCommand: "./PalServer.sh -port={port} -players={slots} EpicApp=PalServer",
  configTemplate: {
    maxPlayers: 32,
    serverName: "Palworld Server",
    serverDescription: "Palworld Dedicated Server",
    password: "",
    adminPassword: "",
    rconPort: 25575,
    difficulty: "Normal",
    deathPenalty: "All",
    enablePvP: false,
    expRate: 1.0,
    palCaptureRate: 1.0,
  },
  isActive: true,
};

async function seedPalworld() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  console.log("🦊 Palworld Seed Script");
  console.log("=======================\n");

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    const existing = await db.select().from(games).where(eq(games.slug, "palworld")).limit(1);
    
    if (existing.length > 0) {
      console.log("⚠️  Palworld already exists in the database (ID: " + existing[0].id + ")");
      console.log("   Updating existing entry...\n");
      
      await db.update(games).set({
        name: PALWORLD_TEMPLATE.name,
        description: PALWORLD_TEMPLATE.description,
        defaultPort: PALWORLD_TEMPLATE.defaultPort,
        steamAppId: PALWORLD_TEMPLATE.steamAppId,
        installScript: PALWORLD_TEMPLATE.installScript,
        startCommand: PALWORLD_TEMPLATE.startCommand,
        configTemplate: PALWORLD_TEMPLATE.configTemplate,
        isActive: PALWORLD_TEMPLATE.isActive,
      }).where(eq(games.slug, "palworld"));
      
      console.log("✅ Palworld updated successfully!\n");
    } else {
      console.log("📦 Adding Palworld to the database...\n");
      
      const result = await db.insert(games).values(PALWORLD_TEMPLATE).returning();
      
      console.log("✅ Palworld added successfully!");
      console.log("   Game ID: " + result[0].id);
      console.log("   Slug: " + result[0].slug);
      console.log("   Default Port: " + result[0].defaultPort + "\n");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📋 Palworld Configuration Summary");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  Name:          " + PALWORLD_TEMPLATE.name);
    console.log("  Steam App ID:  " + PALWORLD_TEMPLATE.steamAppId);
    console.log("  Default Port:  " + PALWORLD_TEMPLATE.defaultPort);
    console.log("  Max Players:   " + PALWORLD_TEMPLATE.configTemplate.maxPlayers);
    console.log("  RCON Port:     " + PALWORLD_TEMPLATE.configTemplate.rconPort);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("🌐 Required Ports:");
    console.log("   • 8211/UDP  - Game server");
    console.log("   • 25575/TCP - RCON (optional)\n");

    console.log("⚙️  Key Settings:");
    console.log("   • DeathPenalty: None, Item, ItemAndEquipment, All");
    console.log("   • ExpRate: 0.1 - 20.0 (multiplier)");
    console.log("   • PalCaptureRate: 0.5 - 2.0 (multiplier)");
    console.log("   • DayTimeSpeedRate: 0.1 - 5.0");
    console.log("   • NightTimeSpeedRate: 0.1 - 5.0\n");

    console.log("💡 RCON Commands:");
    console.log("   • /Shutdown {Seconds} {Message}");
    console.log("   • /Broadcast {Message}");
    console.log("   • /KickPlayer {SteamID}");
    console.log("   • /BanPlayer {SteamID}");
    console.log("   • /Save\n");

  } catch (error) {
    console.error("❌ Error seeding Palworld:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }

  console.log("🚀 You can now create Palworld servers from the panel!");
  console.log("   Navigate to Servers → Create Server → Select Palworld\n");
}

seedPalworld();
