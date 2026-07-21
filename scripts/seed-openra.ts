/**
 * Seed Script: OpenRA
 * 
 * This script adds OpenRA to an existing GamePanel installation.
 * OpenRA is an open-source RTS engine that recreates classic Westwood games:
 * - Command & Conquer: Red Alert
 * - Command & Conquer: Tiberian Dawn
 * - Dune 2000
 * 
 * Usage:
 *   npx tsx scripts/seed-openra.ts
 * 
 * Or via npm script:
 *   npm run seed:openra
 */

import { config } from "dotenv";
config();

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { games } from "../src/db/schema";
import { eq } from "drizzle-orm";

const OPENRA_TEMPLATE = {
  name: "OpenRA",
  slug: "openra",
  description: "Open-source RTS engine for classic Command & Conquer games",
  defaultPort: 1234,
  steamAppId: null,
  installScript: `#!/bin/bash
set -e
cd /servers/{id}

# Detect system architecture
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
    APPIMAGE_ARCH="x86_64"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

# Download latest OpenRA release
OPENRA_VERSION="20231010"
echo "Downloading OpenRA release $OPENRA_VERSION..."

# Download AppImage for server
wget -q "https://github.com/OpenRA/OpenRA/releases/download/release-\${OPENRA_VERSION}/OpenRA-Red-Alert-\${OPENRA_VERSION}.\${APPIMAGE_ARCH}.AppImage" -O OpenRA-RA.AppImage
wget -q "https://github.com/OpenRA/OpenRA/releases/download/release-\${OPENRA_VERSION}/OpenRA-Tiberian-Dawn-\${OPENRA_VERSION}.\${APPIMAGE_ARCH}.AppImage" -O OpenRA-TD.AppImage
wget -q "https://github.com/OpenRA/OpenRA/releases/download/release-\${OPENRA_VERSION}/OpenRA-Dune-2000-\${OPENRA_VERSION}.\${APPIMAGE_ARCH}.AppImage" -O OpenRA-D2K.AppImage

chmod +x OpenRA-RA.AppImage OpenRA-TD.AppImage OpenRA-D2K.AppImage

# Extract AppImages for dedicated server use
./OpenRA-RA.AppImage --appimage-extract
mv squashfs-root openra-ra
./OpenRA-TD.AppImage --appimage-extract  
mv squashfs-root openra-td
./OpenRA-D2K.AppImage --appimage-extract
mv squashfs-root openra-d2k

# Create server launch scripts
cat > start-ra.sh << 'SERVERSCRIPT'
#!/bin/bash
cd /servers/{id}/openra-ra
./AppRun --server \\
    Server.Name="{name}" \\
    Server.ListenPort={port} \\
    Server.ExternalPort={port} \\
    Server.AdvertiseOnline={advertise} \\
    Server.Password="{password}" \\
    Server.EnableSingleplayer=false \\
    Server.Map="{map}"
SERVERSCRIPT

cat > start-td.sh << 'SERVERSCRIPT'
#!/bin/bash
cd /servers/{id}/openra-td
./AppRun --server \\
    Server.Name="{name}" \\
    Server.ListenPort={port} \\
    Server.ExternalPort={port} \\
    Server.AdvertiseOnline={advertise} \\
    Server.Password="{password}" \\
    Server.EnableSingleplayer=false \\
    Server.Map="{map}"
SERVERSCRIPT

cat > start-d2k.sh << 'SERVERSCRIPT'
#!/bin/bash
cd /servers/{id}/openra-d2k
./AppRun --server \\
    Server.Name="{name}" \\
    Server.ListenPort={port} \\
    Server.ExternalPort={port} \\
    Server.AdvertiseOnline={advertise} \\
    Server.Password="{password}" \\
    Server.EnableSingleplayer=false \\
    Server.Map="{map}"
SERVERSCRIPT

chmod +x start-ra.sh start-td.sh start-d2k.sh

# Create server configuration file
cat > server.yaml << 'SERVERCONFIG'
Server:
    Name: "{name}"
    ListenPort: {port}
    ExternalPort: {port}
    AdvertiseOnline: {advertise}
    Password: "{password}"
    RequireAuthentication: false
    ProfileIDBlacklist: []
    ProfileIDWhitelist: []
    EnableSingleplayer: false
    EnableSyncReports: false
    EnableGeoIP: true
    EnableLintChecks: true
    ShareAnonymizedIPs: true
    FloodLimitJoinCooldown: 5000
    
    # Game settings
    Map: "{map}"
    GameSpeed: default
    BatchSize: 1000
    RandomSeed: 0
    
    # Ban settings
    Ban:
        Ranges: []
SERVERCONFIG

# Cleanup AppImages
rm -f OpenRA-RA.AppImage OpenRA-TD.AppImage OpenRA-D2K.AppImage

echo "OpenRA server installed successfully!"
echo "Available mods: Red Alert (ra), Tiberian Dawn (td), Dune 2000 (d2k)"`,
  startCommand: "./start-{mod}.sh",
  configTemplate: {
    maxPlayers: 8,
    mod: "ra",
    map: "random",
    hostname: "OpenRA Server",
    password: "",
    advertise: true,
    enableSingleplayer: false,
    gameSpeed: "default",
    requireAuthentication: false,
  },
  isActive: true,
};

async function seedOpenRA() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  console.log("🎖️  OpenRA Seed Script");
  console.log("======================\n");

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);

  try {
    // Check if already exists
    const existing = await db.select().from(games).where(eq(games.slug, "openra")).limit(1);
    
    if (existing.length > 0) {
      console.log("⚠️  OpenRA already exists in the database (ID: " + existing[0].id + ")");
      console.log("   Updating existing entry...\n");
      
      await db.update(games).set({
        name: OPENRA_TEMPLATE.name,
        description: OPENRA_TEMPLATE.description,
        defaultPort: OPENRA_TEMPLATE.defaultPort,
        steamAppId: OPENRA_TEMPLATE.steamAppId,
        installScript: OPENRA_TEMPLATE.installScript,
        startCommand: OPENRA_TEMPLATE.startCommand,
        configTemplate: OPENRA_TEMPLATE.configTemplate,
        isActive: OPENRA_TEMPLATE.isActive,
      }).where(eq(games.slug, "openra"));
      
      console.log("✅ OpenRA updated successfully!\n");
    } else {
      console.log("📦 Adding OpenRA to the database...\n");
      
      const result = await db.insert(games).values(OPENRA_TEMPLATE).returning();
      
      console.log("✅ OpenRA added successfully!");
      console.log("   Game ID: " + result[0].id);
      console.log("   Slug: " + result[0].slug);
      console.log("   Default Port: " + result[0].defaultPort + "\n");
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📋 OpenRA Configuration Summary");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  Name:         " + OPENRA_TEMPLATE.name);
    console.log("  Slug:         " + OPENRA_TEMPLATE.slug);
    console.log("  Default Port: " + OPENRA_TEMPLATE.defaultPort);
    console.log("  Max Players:  " + OPENRA_TEMPLATE.configTemplate.maxPlayers);
    console.log("  Default Mod:  " + OPENRA_TEMPLATE.configTemplate.mod);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    console.log("🎮 Available Mods:");
    console.log("   ┌─────────────────────────────────────────────────────┐");
    console.log("   │  Mod ID  │  Full Name                │  Era        │");
    console.log("   ├─────────────────────────────────────────────────────┤");
    console.log("   │  ra      │  Command & Conquer: Red Alert │  Cold War   │");
    console.log("   │  td      │  Command & Conquer: Tiberian Dawn │  Modern     │");
    console.log("   │  d2k     │  Dune 2000                │  Sci-Fi     │");
    console.log("   └─────────────────────────────────────────────────────┘\n");

    console.log("🗺️  Map Selection:");
    console.log("   • Use 'random' for random map selection");
    console.log("   • Specific maps can be set by their hash ID");
    console.log("   • Custom maps are supported\n");

    console.log("⚙️  Server Settings:");
    console.log("   • Server.ListenPort      - UDP port for game traffic (default: 1234)");
    console.log("   • Server.ExternalPort    - External port if behind NAT");
    console.log("   • Server.AdvertiseOnline - List on master server (true/false)");
    console.log("   • Server.Password        - Server password (empty = public)");
    console.log("   • Server.RequireAuth     - Require OpenRA account (true/false)\n");

    console.log("🎯 Game Speeds:");
    console.log("   • slowest  - 40% speed");
    console.log("   • slower   - 60% speed");
    console.log("   • default  - 100% speed");
    console.log("   • fast     - 125% speed");
    console.log("   • faster   - 150% speed");
    console.log("   • fastest  - 200% speed\n");

  } catch (error) {
    console.error("❌ Error seeding OpenRA:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }

  console.log("🚀 You can now create OpenRA servers from the panel!");
  console.log("   Navigate to Servers → Create Server → Select OpenRA\n");
  console.log("💡 Tip: To run different mods, change 'mod' in config to: ra, td, or d2k\n");
}

seedOpenRA();
