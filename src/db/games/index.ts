// Built-in game template library.
//
// Each game lives in its own module so a template can be reviewed, diffed and
// fixed in isolation. Add a new game by creating the module and appending it to
// `gameTemplates` below.

import type { GameTemplate } from "./types";

import { minecraftJava } from "./minecraft-java";
import { minecraftPaper } from "./minecraft-paper";
import { minecraftBedrock } from "./minecraft-bedrock";
import { cs2 } from "./cs2";
import { tf2 } from "./tf2";
import { gmod } from "./gmod";
import { l4d2 } from "./l4d2";
import { rust } from "./rust";
import { ark } from "./ark";
import { valheim } from "./valheim";
import { sevenDaysToDie } from "./7dtd";
import { palworld } from "./palworld";
import { satisfactory } from "./satisfactory";
import { terraria } from "./terraria";
import { enshrouded } from "./enshrouded";
import { insurgencySandstorm } from "./insurgency-sandstorm";
import { squad } from "./squad";
import { arma3 } from "./arma3";
import { wolfensteinET } from "./wolfenstein-et";
import { openra } from "./openra";
import { quakeLive } from "./quake-live";
import { xonotic } from "./xonotic";
import { vrising } from "./vrising";
import { projectZomboid } from "./project-zomboid";
import { factorio } from "./factorio";
import { dontStarveTogether } from "./dont-starve-together";
import { assettoCorsa } from "./assetto-corsa";

export * from "./types";
export { steamInstallScript } from "./steamcmd";

/** Every built-in template, in the order they appear in the panel. */
export const gameTemplates: GameTemplate[] = [
  // Minecraft
  minecraftJava,
  minecraftPaper,
  minecraftBedrock,
  // Valve / Source engine
  cs2,
  tf2,
  gmod,
  l4d2,
  // Survival
  rust,
  ark,
  valheim,
  sevenDaysToDie,
  palworld,
  enshrouded,
  projectZomboid,
  // Sandbox
  satisfactory,
  terraria,
  factorio,
  dontStarveTogether,
  // Tactical FPS
  insurgencySandstorm,
  squad,
  arma3,
  // Classics
  wolfensteinET,
  openra,
  quakeLive,
  xonotic,
  // RPG / Racing
  vrising,
  assettoCorsa,
];

/**
 * Runtime files verified after an install finishes. A pattern may contain a
 * trailing wildcard or `a|b` alternatives.
 */
export const EXPECTED_ARTIFACTS_BY_SLUG: Record<string, string[]> = {
  "minecraft-java": ["server.jar"],
  "minecraft-paper": ["server.jar"],
  "minecraft-bedrock": ["bedrock_server"],
  "cs2": ["game/bin/linuxsteamrt64/cs2"],
  "tf2": ["srcds_run"],
  "gmod": ["srcds_run"],
  "l4d2": ["srcds_run"],
  "rust": ["RustDedicated"],
  "ark": ["ShooterGame/Binaries/Linux/ShooterGameServer"],
  "valheim": ["valheim_server.x86_64"],
  "7dtd": ["7DaysToDieServer.x86_64"],
  "palworld": ["PalServer.sh"],
  "satisfactory": ["Engine/Binaries/Linux/*-Linux-Shipping"],
  "terraria": ["TShock.Server"],
  "enshrouded": ["enshrouded_server"],
  "insurgency-sandstorm": ["Insurgency/Binaries/Linux/InsurgencyServer-Linux-Shipping"],
  "squad": ["SquadGame/Binaries/Linux/SquadGameServer*"],
  "arma3": ["arma3server_x64"],
  "wolfenstein-et": ["etlded", "etmain/pak0.pk3"],
  "openra": ["OpenRA.AppImage|openra-extracted/AppRun"],
  "quake-live": ["run_server_x64.sh"],
  "xonotic": ["xonotic-linux64-dedicated"],
  "vrising": ["VRisingServer.exe"],
  "project-zomboid": ["start-server.sh"],
  "factorio": ["bin/x64/factorio"],
  "dont-starve-together": ["bin64/dontstarve_dedicated_server_nullrenderer_x64"],
  "assetto-corsa": ["AssettoServer"],
};

export function getExpectedArtifactsBySlug(slug: string): string[] {
  return EXPECTED_ARTIFACTS_BY_SLUG[slug] || [];
}

/** Group templates by their display category. */
export function getTemplatesByCategory(): Record<string, GameTemplate[]> {
  const byCategory: Record<string, GameTemplate[]> = {};
  for (const template of gameTemplates) {
    if (!byCategory[template.category]) {
      byCategory[template.category] = [];
    }
    byCategory[template.category].push(template);
  }
  return byCategory;
}

/** Look up one template by slug, with its expected artifacts attached. */
export function getTemplateBySlug(slug: string): GameTemplate | undefined {
  const t = gameTemplates.find((template) => template.slug === slug);
  return t ? { ...t, expectedArtifacts: getExpectedArtifactsBySlug(slug) } : undefined;
}
