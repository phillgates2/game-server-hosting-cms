// Game Server Installation Templates & Manager
// In production, this would SSH into nodes and run SteamCMD/scripts.
// Here we simulate the installation pipeline.

export interface GameTemplate {
  name: string;
  slug: string;
  steamAppId: string;
  defaultPort: number;
  description: string;
  iconEmoji: string;
  installScript: string;
  startCommand: string;
  configTemplate: Record<string, unknown>;
}

export const GAME_TEMPLATES: GameTemplate[] = [
  {
    name: "Counter-Strike 2",
    slug: "cs2",
    steamAppId: "730",
    defaultPort: 27015,
    description: "Valve's premier tactical FPS with competitive gameplay",
    iconEmoji: "🔫",
    installScript: "steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 730 validate +quit",
    startCommand: "./cs2 -dedicated -port {port} +maxplayers {slots} +map de_dust2",
    configTemplate: { maxPlayers: 16, tickRate: 128, mapGroup: "mg_active" },
  },
  {
    name: "Minecraft Java",
    slug: "minecraft",
    steamAppId: "",
    defaultPort: 25565,
    description: "The world's best-selling sandbox game server",
    iconEmoji: "⛏️",
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
    iconEmoji: "🏗️",
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
    iconEmoji: "🦖",
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
    iconEmoji: "🔧",
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
    iconEmoji: "⚔️",
    installScript: "steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 896660 validate +quit",
    startCommand: "./valheim_server.x86_64 -name \"{name}\" -port {port} -world Dedicated",
    configTemplate: { maxPlayers: 10, worldName: "Dedicated", password: "" },
  },
  {
    name: "Team Fortress 2",
    slug: "tf2",
    steamAppId: "232250",
    defaultPort: 27015,
    description: "Class-based multiplayer FPS with unique gameplay",
    iconEmoji: "🎩",
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
    iconEmoji: "🧟",
    installScript: "steamcmd +force_install_dir /servers/{id} +login anonymous +app_update 294420 validate +quit",
    startCommand: "./7DaysToDieServer.x86_64 -configfile=serverconfig.xml",
    configTemplate: { maxPlayers: 8, worldGenSeed: "random", difficulty: 2 },
  },
  {
    name: "ET: Legacy",
    slug: "etlegacy",
    steamAppId: "",
    defaultPort: 27960,
    description: "Open-source Wolfenstein: Enemy Territory with modern improvements",
    iconEmoji: "🪖",
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
  },
  {
    name: "OpenRA",
    slug: "openra",
    steamAppId: "",
    defaultPort: 1234,
    description: "Open-source RTS engine for classic Command & Conquer games",
    iconEmoji: "🎖️",
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
  },
  {
    name: "Palworld",
    slug: "palworld",
    steamAppId: "2394010",
    defaultPort: 8211,
    description: "Multiplayer creature-collection survival game with Pals",
    iconEmoji: "🦊",
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
  },
  {
    name: "Satisfactory",
    slug: "satisfactory",
    steamAppId: "1690800",
    defaultPort: 7777,
    description: "First-person factory building game in an alien world",
    iconEmoji: "🏭",
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
  },
  {
    name: "Terraria",
    slug: "terraria",
    steamAppId: "105600",
    defaultPort: 7777,
    description: "2D sandbox adventure game with exploration and building",
    iconEmoji: "⛏️",
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

# Journey mode power permissions (0=locked for everyone, 1=can only be changed by host, 2=can be changed by everyone)
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
  },
];

export interface InstallStep {
  step: number;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  log: string;
}

export function getInstallSteps(gameSlug: string): InstallStep[] {
  const game = GAME_TEMPLATES.find(g => g.slug === gameSlug);
  const useSteam = game?.steamAppId !== "";

  const steps: InstallStep[] = [
    { step: 1, name: "Creating directory structure", status: "pending", progress: 0, log: "" },
    { step: 2, name: "Allocating resources", status: "pending", progress: 0, log: "" },
  ];

  if (useSteam) {
    steps.push({ step: 3, name: "Running SteamCMD", status: "pending", progress: 0, log: "" });
    steps.push({ step: 4, name: "Downloading game files", status: "pending", progress: 0, log: "" });
    steps.push({ step: 5, name: "Validating installation", status: "pending", progress: 0, log: "" });
  } else {
    steps.push({ step: 3, name: "Downloading server files", status: "pending", progress: 0, log: "" });
  }

  steps.push({ step: steps.length + 1, name: "Applying configuration", status: "pending", progress: 0, log: "" });
  steps.push({ step: steps.length + 1, name: "Finalizing setup", status: "pending", progress: 0, log: "" });

  return steps;
}
