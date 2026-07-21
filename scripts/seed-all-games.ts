/**
 * Seed Script: All Games
 * 
 * This script seeds all supported games into an existing GamePanel installation.
 * It will update existing games and add new ones.
 * 
 * Usage:
 *   npx tsx scripts/seed-all-games.ts
 * 
 * Or via npm script:
 *   npm run seed:all
 */

import { config } from "dotenv";
config();

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { games } from "../src/db/schema";
import { eq } from "drizzle-orm";

const ALL_GAMES = [
  {
    name: "Counter-Strike 2",
    slug: "cs2",
    steamAppId: "730",
    defaultPort: 27015,
    description: "Valve's premier tactical FPS with competitive gameplay",
    installScript: "steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 730 validate +quit",
    startCommand: "./cs2 -dedicated -port {port} +maxplayers {slots} +map de_dust2",
    configTemplate: { maxPlayers: 16, tickRate: 128, mapGroup: "mg_active" },
  },
  {
    name: "Minecraft Java",
    slug: "minecraft",
    steamAppId: null,
    defaultPort: 25565,
    description: "The world's best-selling sandbox game server",
    installScript: "mkdir -p /servers/{id} && cd /servers/{id} && curl -o server.jar https://piston-data.mojang.com/v1/objects/server.jar",
    startCommand: "java -Xmx{ram}M -jar server.jar nogui",
    configTemplate: { maxPlayers: 20, difficulty: "normal", gamemode: "survival" },
  },
  {
    name: "Rust",
    slug: "rust",
    steamAppId: "258550",
    defaultPort: 28015,
    description: "Multiplayer survival game in a harsh open world",
    installScript: "steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 258550 validate +quit",
    startCommand: "./RustDedicated -batchmode +server.port {port} +server.maxplayers {slots}",
    configTemplate: { maxPlayers: 100, worldSize: 4000, seed: 12345 },
  },
  {
    name: "ARK: Survival Evolved",
    slug: "ark",
    steamAppId: "376030",
    defaultPort: 7777,
    description: "Dinosaur survival game with base building and taming",
    installScript: "steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 376030 validate +quit",
    startCommand: "ShooterGameServer TheIsland?listen?MaxPlayers={slots} -server -log",
    configTemplate: { maxPlayers: 70, difficulty: 1.0, map: "TheIsland" },
  },
  {
    name: "Garry's Mod",
    slug: "gmod",
    steamAppId: "4020",
    defaultPort: 27015,
    description: "Physics sandbox for creating and sharing game modes",
    installScript: "steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 4020 validate +quit",
    startCommand: "./srcds_run -game garrysmod +maxplayers {slots} +map gm_flatgrass -port {port}",
    configTemplate: { maxPlayers: 32, gamemode: "sandbox", map: "gm_flatgrass" },
  },
  {
    name: "Valheim",
    slug: "valheim",
    steamAppId: "896660",
    defaultPort: 2456,
    description: "Viking survival and exploration in a procedural world",
    installScript: "steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 896660 validate +quit",
    startCommand: './valheim_server.x86_64 -name "{name}" -port {port} -world Dedicated',
    configTemplate: { maxPlayers: 10, worldName: "Dedicated", password: "" },
  },
  {
    name: "Team Fortress 2",
    slug: "tf2",
    steamAppId: "232250",
    defaultPort: 27015,
    description: "Class-based multiplayer FPS with unique gameplay",
    installScript: "steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 232250 validate +quit",
    startCommand: "./srcds_run -game tf +maxplayers {slots} +map ctf_2fort -port {port}",
    configTemplate: { maxPlayers: 24, map: "ctf_2fort" },
  },
  {
    name: "7 Days to Die",
    slug: "7dtd",
    steamAppId: "294420",
    defaultPort: 26900,
    description: "Open-world zombie survival with crafting and building",
    installScript: "steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 294420 validate +quit",
    startCommand: "./7DaysToDieServer.x86_64 -configfile=serverconfig.xml",
    configTemplate: { maxPlayers: 8, worldGenSeed: "random", difficulty: 2 },
  },
  {
    name: "ET: Legacy",
    slug: "etlegacy",
    steamAppId: null,
    defaultPort: 27960,
    description: "Open-source Wolfenstein: Enemy Territory with modern improvements",
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
set sv_hostname "{name}"
set sv_maxclients {slots}
set g_password ""
set rconPassword "{rconPassword}"
set g_antilag 1
set g_friendlyFire 1
set g_gametype 4
set sv_pure 1
set sv_allowDownload 1
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
      antilag: true,
      friendlyFire: true,
    },
  },
  {
    name: "OpenRA",
    slug: "openra",
    steamAppId: null,
    defaultPort: 1234,
    description: "Open-source RTS engine for classic Command & Conquer games",
    installScript: `#!/bin/bash
set -e
cd /servers/{id}

ARCH=$(uname -m)
OPENRA_VERSION="20231010"

wget -q "https://github.com/OpenRA/OpenRA/releases/download/release-\${OPENRA_VERSION}/OpenRA-Red-Alert-\${OPENRA_VERSION}.\${ARCH}.AppImage" -O OpenRA-RA.AppImage
wget -q "https://github.com/OpenRA/OpenRA/releases/download/release-\${OPENRA_VERSION}/OpenRA-Tiberian-Dawn-\${OPENRA_VERSION}.\${ARCH}.AppImage" -O OpenRA-TD.AppImage
wget -q "https://github.com/OpenRA/OpenRA/releases/download/release-\${OPENRA_VERSION}/OpenRA-Dune-2000-\${OPENRA_VERSION}.\${ARCH}.AppImage" -O OpenRA-D2K.AppImage

chmod +x OpenRA-*.AppImage
./OpenRA-RA.AppImage --appimage-extract && mv squashfs-root openra-ra
./OpenRA-TD.AppImage --appimage-extract && mv squashfs-root openra-td
./OpenRA-D2K.AppImage --appimage-extract && mv squashfs-root openra-d2k

for mod in ra td d2k; do
  cat > start-\$mod.sh << SCRIPT
#!/bin/bash
cd /servers/{id}/openra-\$mod
./AppRun --server Server.Name="{name}" Server.ListenPort={port} Server.AdvertiseOnline={advertise}
SCRIPT
  chmod +x start-\$mod.sh
done

rm -f OpenRA-*.AppImage
echo "OpenRA installed successfully!"`,
    startCommand: "./start-{mod}.sh",
    configTemplate: {
      maxPlayers: 8,
      mod: "ra",
      map: "random",
      hostname: "OpenRA Server",
      password: "",
      advertise: true,
      gameSpeed: "default",
    },
  },
  {
    name: "Palworld",
    slug: "palworld",
    steamAppId: "2394010",
    defaultPort: 8211,
    description: "Multiplayer creature-collection survival game with Pals",
    installScript: `#!/bin/bash
set -e
cd /servers/{id}
steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 2394010 validate +quit
mkdir -p Pal/Saved/Config/LinuxServer
cat > Pal/Saved/Config/LinuxServer/PalWorldSettings.ini << 'EOF'
[/Script/Pal.PalGameWorldSettings]
OptionSettings=(ServerName="{name}",ServerPassword="{password}",AdminPassword="{adminPassword}",ServerPlayerMaxNum={slots},PublicPort={port},RCONEnabled=True,RCONPort=25575,bIsMultiplay=True,bIsPvP=False,DeathPenalty=All,ExpRate=1.0,PalCaptureRate=1.0)
EOF
echo "Palworld installed!"`,
    startCommand: "./PalServer.sh -port={port} -players={slots} EpicApp=PalServer",
    configTemplate: {
      maxPlayers: 32,
      serverName: "Palworld Server",
      password: "",
      adminPassword: "",
      rconPort: 25575,
      enablePvP: false,
      expRate: 1.0,
    },
  },
  {
    name: "Satisfactory",
    slug: "satisfactory",
    steamAppId: "1690800",
    defaultPort: 7777,
    description: "First-person factory building game in an alien world",
    installScript: `#!/bin/bash
set -e
cd /servers/{id}
steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 1690800 validate +quit
mkdir -p FactoryGame/Saved/Config/LinuxServer
cat > FactoryGame/Saved/Config/LinuxServer/ServerSettings.ini << 'EOF'
[/Script/FactoryGame.FGServerSubsystem]
mServerName={name}
mServerPassword={password}
mAdminPassword={adminPassword}
EOF
echo "Satisfactory installed!"`,
    startCommand: "./FactoryServer.sh -Port={port} -BeaconPort=15000 -ServerQueryPort=15777",
    configTemplate: {
      maxPlayers: 4,
      serverName: "Satisfactory Server",
      password: "",
      adminPassword: "",
      autosaveInterval: 300,
    },
  },
  {
    name: "Terraria",
    slug: "terraria",
    steamAppId: "105600",
    defaultPort: 7777,
    description: "2D sandbox adventure game with exploration and building",
    installScript: `#!/bin/bash
set -e
cd /servers/{id}
steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 105600 validate +quit
mkdir -p Worlds
cat > serverconfig.txt << 'EOF'
world=/servers/{id}/Worlds/{worldName}.wld
autocreate={worldSize}
worldname={worldName}
maxplayers={slots}
port={port}
password={password}
motd=Welcome to {name}!
difficulty={difficulty}
secure=1
EOF
cat > start.sh << 'EOF'
#!/bin/bash
./TerrariaServer.bin.x86_64 -config serverconfig.txt
EOF
chmod +x start.sh
echo "Terraria installed!"`,
    startCommand: "./start.sh",
    configTemplate: {
      maxPlayers: 16,
      worldName: "World1",
      worldSize: 2,
      difficulty: 0,
      password: "",
    },
  },
];

async function seedAllGames() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  console.log("🎮 GamePanel - Seed All Games");
  console.log("==============================\n");

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  let added = 0;
  let updated = 0;
  let errors = 0;

  for (const game of ALL_GAMES) {
    try {
      const existing = await db.select().from(games).where(eq(games.slug, game.slug)).limit(1);

      if (existing.length > 0) {
        await db.update(games).set({
          name: game.name,
          description: game.description,
          defaultPort: game.defaultPort,
          steamAppId: game.steamAppId,
          installScript: game.installScript,
          startCommand: game.startCommand,
          configTemplate: game.configTemplate,
          isActive: true,
        }).where(eq(games.slug, game.slug));
        console.log(`  ✏️  Updated: ${game.name}`);
        updated++;
      } else {
        await db.insert(games).values({
          ...game,
          isActive: true,
        });
        console.log(`  ✅ Added: ${game.name}`);
        added++;
      }
    } catch (error) {
      console.error(`  ❌ Error with ${game.name}:`, error);
      errors++;
    }
  }

  await pool.end();

  console.log("\n==============================");
  console.log(`📊 Summary:`);
  console.log(`   Added:   ${added}`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Errors:  ${errors}`);
  console.log(`   Total:   ${ALL_GAMES.length} games`);
  console.log("==============================\n");

  if (errors > 0) {
    process.exit(1);
  }
}

seedAllGames();
