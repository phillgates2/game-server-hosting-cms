import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { eq } from "drizzle-orm";

// POST /api/games/import — Import a Pterodactyl egg JSON or AMP template
export async function POST(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "games.install"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { format, data } = body; // format: "pterodactyl" | "amp" | "auto"

    if (!data) {
      return NextResponse.json({ error: "Import data required" }, { status: 400 });
    }

    let parsed: Record<string, unknown>;
    if (typeof data === "string") {
      try { parsed = JSON.parse(data); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    } else {
      parsed = data;
    }

    const detectedFormat = format || detectFormat(parsed);

    let game;
    if (detectedFormat === "pterodactyl") {
      game = importPterodactyl(parsed);
    } else if (detectedFormat === "amp") {
      game = importAmp(parsed);
    } else {
      return NextResponse.json({ error: "Could not detect import format. Specify format: 'pterodactyl' or 'amp'" }, { status: 400 });
    }

    // Check for slug conflict
    const existing = await db.select().from(gameDefinitions).where(eq(gameDefinitions.slug, game.slug)).limit(1);
    if (existing.length > 0) {
      return NextResponse.json({ error: `Slug "${game.slug}" already exists. Uninstall it first or use a different name.` }, { status: 409 });
    }

    const [created] = await db.insert(gameDefinitions).values(game).returning();

    return NextResponse.json({
      ok: true,
      message: `Imported "${game.name}" from ${detectedFormat} format`,
      game: created,
      format: detectedFormat,
    }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed" }, { status: 500 });
  }
}

function detectFormat(data: Record<string, unknown>): string | null {
  if (data.meta && (data.meta as Record<string, unknown>).version === "PTDL_v2") return "pterodactyl";
  if (data.startup && data.variables && data.scripts) return "pterodactyl";
  if (typeof data["Meta.DisplayName"] === "string" || typeof data["App.DisplayName"] === "string") return "amp";
  return null;
}

function importPterodactyl(egg: Record<string, unknown>) {
  const name = (egg.name as string) || "Imported Game";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const startup = (egg.startup as string) || "";
  const desc = (egg.description as string) || "";
  const scripts = egg.scripts as Record<string, Record<string, unknown>> | undefined;
  const installScript = scripts?.installation?.script as string || `#!/bin/bash\nset -e\necho "No install script imported"\n`;
  const config = egg.config as Record<string, string> | undefined;
  const stopCmd = config?.stop || null;

  // Convert Pterodactyl variables
  const vars = (egg.variables as Array<Record<string, unknown>>) || [];
  const defaultConfig: Record<string, string> = {};
  for (const v of vars) {
    const envVar = v.env_variable as string;
    const defVal = v.default_value as string;
    if (envVar && defVal) defaultConfig[envVar] = defVal;
  }

  // Convert startup command — Pterodactyl uses {{ENV_VAR}} which matches our format
  const startCommand = `cd {{INSTALL_PATH}} && ${startup}`;

  return {
    slug,
    name,
    engine: null,
    defaultPort: 27015,
    steamAppId: null,
    installScript: installScript.replace(/\\/g, "").replace(/\\r\\n/g, "\n").replace(/\\r/g, "\n"),
    startCommand,
    stopCommand: stopCmd?.replace("^C", null as unknown as string) || null,
    configFiles: {},
    defaultConfig,
    supportsIpv6: false,
    iconEmoji: "🎮",
  };
}

function importAmp(kvp: Record<string, unknown>) {
  const name = (kvp["App.DisplayName"] as string) || (kvp["Meta.DisplayName"] as string) || "Imported Game";
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const cmdArgs = (kvp["App.CommandLineArgs"] as string) || "";
  const execLinux = (kvp["App.ExecutableLinux"] as string) || "";
  const startCommand = execLinux
    ? `cd {{INSTALL_PATH}} && ./${execLinux} ${cmdArgs}`
    : `cd {{INSTALL_PATH}} && echo "Configure start command"`;

  const maxUsers = (kvp["App.MaxUsers"] as number) || 32;

  return {
    slug,
    name,
    engine: null,
    defaultPort: 27015,
    steamAppId: null,
    installScript: `#!/bin/bash\nset -e\nINSTALL_DIR="{{INSTALL_PATH}}"\nmkdir -p "$INSTALL_DIR"\ncd "$INSTALL_DIR"\n\necho "AMP template imported — configure install script"\necho "Game: ${name}"\n`,
    startCommand,
    stopCommand: (kvp["App.ExitString"] as string) || null,
    configFiles: {},
    defaultConfig: { MAX_PLAYERS: String(maxUsers) },
    supportsIpv6: (kvp["App.SupportsIPv6"] as boolean) || false,
    iconEmoji: "🎮",
  };
}
