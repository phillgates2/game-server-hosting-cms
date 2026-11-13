"use client";

import {
  fieldsForSection,
  type PanelSettingKey,
  type PanelSettingsSection,
} from "@/lib/panel-settings";

/**
 * The screens the Settings page is split into.
 *
 * The old page was one long column of every setting, which made "the setting I
 * need" a scroll hunt and made the single Save button ambiguous — half the
 * cards saved instantly and half waited for it. Each screen now has one job,
 * one save model, and says which model it uses.
 */

export type SettingsSectionId =
  | "accounts"
  | "signin"
  | "retention"
  | "automation"
  | "alerts"
  | "webhook"
  | "discord"
  | "status";

export type SettingsGroupId = "access" | "operations" | "integrations";

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  title: string;
  icon: string;
  group: SettingsGroupId;
  blurb: string;
  /** Extra search terms; the field registry supplies its own. */
  keywords: readonly string[];
  /**
   * "draft" screens are staged and applied with one Save; "immediate" screens
   * have their own save buttons and take effect as soon as those are pressed.
   */
  saveMode: "draft" | "immediate";
  /** Columns shown on this screen, in registry order (empty for immediate). */
  fieldKeys: readonly PanelSettingKey[];
  /** Only on draft screens: the registry section used for defaults/reset. */
  draftSection?: PanelSettingsSection;
}

const draftKeys = (section: PanelSettingsSection): readonly PanelSettingKey[] =>
  fieldsForSection(section).map((field) => field.key);

export const SETTINGS_GROUPS: ReadonlyArray<{
  id: SettingsGroupId;
  label: string;
}> = [
  { id: "access", label: "Access" },
  { id: "operations", label: "Operations" },
  { id: "integrations", label: "Integrations" },
];

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  {
    id: "accounts",
    title: "Accounts & registration",
    icon: "🧑‍🤝‍🧑",
    group: "access",
    blurb:
      "Who may sign up, how many servers a new account gets, and the age gate.",
    keywords: ["users", "register", "signup", "quota", "age", "terms", "invite"],
    saveMode: "draft",
    fieldKeys: draftKeys("accounts"),
    draftSection: "accounts",
  },
  {
    id: "signin",
    title: "Sign-in & sessions",
    icon: "🔐",
    group: "access",
    blurb:
      "Brute-force throttling, how long a login lasts, and which networks may reach the panel.",
    keywords: ["login", "password", "session", "throttle", "ip", "allowlist", "firewall", "brute force"],
    saveMode: "draft",
    fieldKeys: draftKeys("signin"),
    draftSection: "signin",
  },
  {
    id: "retention",
    title: "Retention & backups",
    icon: "🗄️",
    group: "operations",
    blurb:
      "How much history is kept, how many restore points survive, and how the panel is backed up.",
    keywords: ["metrics", "audit", "history", "prune", "backup", "restore point", "export", "import"],
    saveMode: "draft",
    fieldKeys: draftKeys("retention"),
    draftSection: "retention",
  },
  {
    id: "automation",
    title: "Automation",
    icon: "🤖",
    group: "operations",
    blurb:
      "Idle auto-stop, the weekly fleet digest, and Discord announcements for scheduled tasks.",
    keywords: ["idle", "auto stop", "digest", "schedule", "cron", "weekly", "announce"],
    saveMode: "draft",
    fieldKeys: draftKeys("automation"),
    draftSection: "automation",
  },
  {
    id: "alerts",
    title: "Host alerts",
    icon: "🚨",
    group: "operations",
    blurb:
      "Discord alerts when the machine itself runs short of CPU, RAM or disk — and quiet periods during planned work.",
    keywords: ["alert", "cpu", "ram", "memory", "disk", "threshold", "mute", "monitoring"],
    saveMode: "draft",
    fieldKeys: draftKeys("alerts"),
    draftSection: "alerts",
  },
  {
    id: "webhook",
    title: "Outbound webhook",
    icon: "📡",
    group: "integrations",
    blurb:
      "Push every panel event to your own HTTP endpoint, with an optional signature.",
    keywords: ["webhook", "events", "http", "integration", "hmac", "signature", "deliveries"],
    saveMode: "immediate",
    fieldKeys: [],
  },
  {
    id: "discord",
    title: "Discord",
    icon: "🔔",
    group: "integrations",
    blurb:
      "Connect your community with a guided setup: notifications, automatic channels, live status boards and Discord sign-in.",
    keywords: ["discord", "bot", "channel", "webhook", "notifications", "backfill", "guild", "setup", "guide", "how to", "token", "intents", "permissions", "oauth", "login", "status board", "commands"],
    saveMode: "immediate",
    fieldKeys: [],
  },
  {
    id: "status",
    title: "Public status page",
    icon: "🌐",
    group: "integrations",
    blurb:
      "Share or embed the public status board that lists servers their owners made public.",
    keywords: ["status", "public", "embed", "iframe", "widget", "uptime"],
    saveMode: "immediate",
    fieldKeys: [],
  },
];

export function settingsSection(id: SettingsSectionId): SettingsSectionMeta {
  return SETTINGS_SECTIONS.find((section) => section.id === id) ?? SETTINGS_SECTIONS[0];
}

export function sectionForSettingKey(
  key: PanelSettingKey
): SettingsSectionMeta | null {
  return (
    SETTINGS_SECTIONS.find((section) => section.fieldKeys.includes(key)) ?? null
  );
}
