import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gameDefinitions, gameServers } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { gameTemplates, EXPECTED_ARTIFACTS_BY_SLUG } from "@/db/seeds";
import { eq, sql } from "drizzle-orm";
import { access, constants, readdir, stat } from "fs/promises";
import { join, dirname, basename } from "path";

interface AuditResult {
  slug: string;
  name: string;
  icon: string;
  category: string;
  source: "builtin" | "installed_only" | "custom";
  installMethod: string;
  expectedArtifacts: string[];
  startBinary: string;
  issues: string[];
  warnings: string[];
  ok: boolean;
  // Live check (if server exists)
  liveChecks?: {
    serverId: number;
    serverName: string;
    installPath: string;
    artifactResults: { artifact: string; found: boolean }[];
    allFound: boolean;
    fileCount: number;
    totalSizeMb: number;
  }[];
}

function detectInstallMethod(script: string): string {
  if (script.includes("steamcmd")) return "SteamCMD";
  if (script.includes("api.papermc.io")) return "PaperMC API";
  if (script.includes("launchermeta.mojang.com")) return "Mojang API";
  if (script.includes("api.github.com")) return "GitHub Release";
  if (script.includes("azureedge.net")) return "Mojang CDN";
  if (script.includes("factorio.com")) return "Factorio.com";
  if (script.includes("dl.xonotic.org")) return "Direct Download";
  if (script.includes("etlegacy.com")) return "ET:Legacy Archive";
  if (script.includes("mirror.etlegacy.com")) return "ET:Legacy Mirror";
  if (script.includes("curl") || script.includes("wget")) return "Direct Download";
  return "Unknown";
}

function extractStartBinary(startCommand: string): string {
  const m = startCommand.match(/\.\/([^\s;|&]+)/);
  if (m) return m[1];
  const jarM = startCommand.match(/-jar\s+([^\s]+)/);
  if (jarM) return jarM[1];
  if (startCommand.includes("java")) return "java -jar";
  if (startCommand.includes("wine")) return "wine (Windows binary)";
  return "unknown";
}

function auditScript(script: string, startCommand: string, slug: string): { issues: string[]; warnings: string[] } {
  const issues: string[] = [];
  const warnings: string[] = [];

  // Check INSTALL_PATH placeholder
  if (!script.includes("{{INSTALL_PATH}}") && !script.includes("INSTALL_DIR")) {
    issues.push("Install script does not reference {{INSTALL_PATH}} or INSTALL_DIR");
  }
  if (script.includes('INSTALL_DIR="{INSTALL_PATH}"')) {
    issues.push("Broken placeholder: {INSTALL_PATH} should be {{INSTALL_PATH}}");
  }

  // Check shebang
  if (!script.startsWith("#!/")) {
    warnings.push("Install script missing shebang (#!/bin/bash)");
  }

  // Check set -e
  if (!script.includes("set -e")) {
    warnings.push("Install script does not use 'set -e' — errors may be silently ignored");
  }

  // Check start command has INSTALL_PATH
  if (!startCommand.includes("{{INSTALL_PATH}}")) {
    warnings.push("Start command does not include {{INSTALL_PATH}}");
  }

  // Check SteamCMD scripts reference the right app ID
  const appIdMatch = script.match(/STEAM_APPID="(\d+)"/);
  const cmdAppMatch = script.match(/app_update\s+(\d+)/);
  if (appIdMatch && cmdAppMatch && appIdMatch[1] !== cmdAppMatch[1]) {
    issues.push(`SteamCMD app ID mismatch: variable=${appIdMatch[1]} vs command=${cmdAppMatch[1]}`);
  }

  // Check for wine requirement
  if (startCommand.includes("wine") && !script.includes("wine")) {
    warnings.push("Start command uses wine but install script does not install wine");
  }

  // Check expected artifacts defined
  const artifacts = EXPECTED_ARTIFACTS_BY_SLUG[slug];
  if (!artifacts || artifacts.length === 0) {
    warnings.push("No expected artifacts defined for this template");
  }

  return { issues, warnings };
}

async function pathExists(p: string): Promise<boolean> {
  try { await access(p, constants.F_OK); return true; } catch { return false; }
}

async function wildcardExists(installPath: string, pattern: string): Promise<boolean> {
  if (pattern.includes("|")) {
    for (const alt of pattern.split("|")) {
      if (await wildcardExists(installPath, alt.trim())) return true;
    }
    return false;
  }
  if (!pattern.includes("*")) {
    return pathExists(join(installPath, pattern));
  }
  const dir = dirname(pattern);
  const base = basename(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const rx = new RegExp(`^${base}$`);
  try {
    const entries = await readdir(join(installPath, dir === "." ? "" : dir));
    return entries.some((n: string) => rx.test(n));
  } catch { return false; }
}

async function dirStats(dirPath: string): Promise<{ count: number; sizeMb: number }> {
  let count = 0;
  let size = 0;
  try {
    const entries = await readdir(dirPath);
    for (const entry of entries) {
      try {
        const s = await stat(join(dirPath, entry));
        count++;
        size += s.size;
      } catch { /* skip */ }
    }
  } catch { /* dir may not exist */ }
  return { count, sizeMb: Math.round(size / 1024 / 1024 * 10) / 10 };
}

export async function GET(req: NextRequest) {
  const auth = await getCurrentUser(req.headers);
  if (!auth || !(await hasPermission(auth.userId, "games.install"))) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  try {
    // Get installed games
    const installed = await db.select().from(gameDefinitions);
    const installedSlugs = new Set(installed.map((g) => g.slug));

    // Get servers for live checks
    const servers = await db.select({
      id: gameServers.id,
      name: gameServers.name,
      installPath: gameServers.installPath,
      gameId: gameServers.gameId,
    }).from(gameServers);

    const results: AuditResult[] = [];

    // Audit built-in templates
    for (const tmpl of gameTemplates) {
      const artifacts = EXPECTED_ARTIFACTS_BY_SLUG[tmpl.slug] || [];
      const startBin = extractStartBinary(tmpl.startCommand);
      const method = detectInstallMethod(tmpl.installScript);
      const { issues, warnings } = auditScript(tmpl.installScript, tmpl.startCommand, tmpl.slug);

      const result: AuditResult = {
        slug: tmpl.slug,
        name: tmpl.name,
        icon: tmpl.iconEmoji,
        category: tmpl.category,
        source: installedSlugs.has(tmpl.slug) ? "builtin" : "builtin",
        installMethod: method,
        expectedArtifacts: artifacts,
        startBinary: startBin,
        issues,
        warnings,
        ok: issues.length === 0,
      };

      // Live check against installed servers
      const installedGame = installed.find((g) => g.slug === tmpl.slug);
      if (installedGame) {
        const gameServersForThis = servers.filter((s) => s.gameId === installedGame.id);
        if (gameServersForThis.length > 0) {
          result.liveChecks = [];
          for (const srv of gameServersForThis) {
            const artifactResults: { artifact: string; found: boolean }[] = [];
            for (const art of artifacts) {
              artifactResults.push({ artifact: art, found: await wildcardExists(srv.installPath, art) });
            }
            const stats = await dirStats(srv.installPath);
            result.liveChecks.push({
              serverId: srv.id,
              serverName: srv.name,
              installPath: srv.installPath,
              artifactResults,
              allFound: artifactResults.every((a) => a.found),
              fileCount: stats.count,
              totalSizeMb: stats.sizeMb,
            });
          }
        }
      }

      results.push(result);
    }

    // Audit installed-only (custom) games not in built-in templates
    for (const game of installed) {
      if (gameTemplates.some((t) => t.slug === game.slug)) continue;

      const startBin = extractStartBinary(game.startCommand);
      const method = detectInstallMethod(game.installScript);
      const { issues, warnings } = auditScript(game.installScript, game.startCommand, game.slug);

      results.push({
        slug: game.slug,
        name: game.name,
        icon: game.iconEmoji || "🎮",
        category: "Custom",
        source: "custom",
        installMethod: method,
        expectedArtifacts: [],
        startBinary: startBin,
        issues,
        warnings: [...warnings, "Custom template — no built-in artifact verification"],
        ok: issues.length === 0,
      });
    }

    const summary = {
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      issues: results.filter((r) => !r.ok).length,
      warnings: results.filter((r) => r.warnings.length > 0).length,
      withLiveChecks: results.filter((r) => r.liveChecks && r.liveChecks.length > 0).length,
      liveAllPassed: results.filter((r) => r.liveChecks?.every((l) => l.allFound)).length,
      liveSomeFailed: results.filter((r) => r.liveChecks?.some((l) => !l.allFound)).length,
    };

    return NextResponse.json({ results, summary });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Audit failed" }, { status: 500 });
  }
}
