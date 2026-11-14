import { isValidWebhookUrl, toChannelName } from "./discord";

/**
 * Browser-safe helpers for the Discord settings screen.
 *
 * Secrets are deliberately separate from the rest of the form: an empty input
 * means "keep the stored credential", never "delete it". Only changed values
 * are sent to the API, and validation uses the same webhook/channel helpers as
 * the integration itself.
 */
export type DiscordSettingsTab = "guide" | "notifications" | "bot" | "boards" | "signin";

export interface DiscordConfigResponse {
  panelWebhook: string;
  panelWebhookValid: boolean;
  hasBotToken: boolean;
  guildId: string;
  categoryId: string;
  autoChannel: boolean;
  channelPrefix: string;
  extraServers: string;
  masterUrls: string;
  botReady: boolean;
  bot?: {
    state: "stopped" | "unconfigured" | "connecting" | "online" | "error" | "disabled";
    tag: string | null;
    error: string | null;
    since: number;
    commandsHandled: number;
    lastCommandAt: number | null;
  };
  oauthClientId: string;
  oauthConfigured: boolean;
}

export interface DiscordFormValues {
  panelWebhook: string;
  botToken: string;
  guildId: string;
  categoryId: string;
  channelPrefix: string;
  autoChannel: boolean;
  extraServers: string;
  masterUrls: string;
  oauthClientId: string;
  oauthClientSecret: string;
}

export type DiscordFormField = keyof DiscordFormValues;
export type DiscordFormErrors = Partial<Record<DiscordFormField, string>>;

export const DISCORD_FORM_TABS: ReadonlyArray<{ id: DiscordSettingsTab; label: string }> = [
  { id: "guide", label: "Setup guide" },
  { id: "notifications", label: "Notifications" },
  { id: "bot", label: "Bot & channels" },
  { id: "boards", label: "Status boards" },
  { id: "signin", label: "Discord sign-in" },
];

const FIELD_META: Record<DiscordFormField, { label: string; tab: DiscordSettingsTab }> = {
  panelWebhook: { label: "Panel webhook", tab: "notifications" },
  botToken: { label: "Bot token", tab: "bot" },
  guildId: { label: "Discord server ID", tab: "bot" },
  categoryId: { label: "Category ID", tab: "bot" },
  channelPrefix: { label: "Channel prefix", tab: "bot" },
  autoChannel: { label: "Automatic channels", tab: "bot" },
  extraServers: { label: "Extra ET servers", tab: "bot" },
  masterUrls: { label: "ET master servers", tab: "bot" },
  oauthClientId: { label: "OAuth client ID", tab: "signin" },
  oauthClientSecret: { label: "OAuth client secret", tab: "signin" },
};

export function discordFormFromConfig(cfg: DiscordConfigResponse): DiscordFormValues {
  return {
    panelWebhook: cfg.panelWebhook || "",
    botToken: "",
    guildId: cfg.guildId || "",
    categoryId: cfg.categoryId || "",
    channelPrefix: cfg.channelPrefix || "",
    autoChannel: Boolean(cfg.autoChannel),
    extraServers: cfg.extraServers || "",
    masterUrls: cfg.masterUrls || "",
    oauthClientId: cfg.oauthClientId || "",
    oauthClientSecret: "",
  };
}

export function discordFormChanges(
  draft: DiscordFormValues,
  saved: DiscordFormValues,
): Array<{ key: DiscordFormField; label: string; tab: DiscordSettingsTab }> {
  return (Object.keys(FIELD_META) as DiscordFormField[]).flatMap((key) => {
    const value = draft[key];
    const previous = saved[key];
    const changed = typeof value === "boolean"
      ? value !== previous
      : typeof previous === "string" && value.trim() !== previous.trim();
    return changed ? [{ key, ...FIELD_META[key] }] : [];
  });
}

/** Never include an untouched secret, even when other fields changed. */
export function discordFormPayload(
  draft: DiscordFormValues,
  changes: ReturnType<typeof discordFormChanges>,
): Record<string, string | boolean> {
  const payload: Record<string, string | boolean> = {};
  for (const { key } of changes) {
    const value = draft[key];
    payload[key] = typeof value === "string" ? value.trim() : value;
  }
  return payload;
}

export function validateDiscordForm(values: DiscordFormValues): DiscordFormErrors {
  const errors: DiscordFormErrors = {};
  if (values.panelWebhook.trim() && !isValidWebhookUrl(values.panelWebhook)) {
    errors.panelWebhook = "Paste the full HTTPS webhook URL from Discord, not a channel link.";
  }
  for (const key of ["guildId", "categoryId", "oauthClientId"] as const) {
    if (values[key].trim() && !/^\d{5,25}$/.test(values[key].trim())) {
      errors[key] = "Use the numeric Discord ID (5–25 digits), without spaces or # symbols.";
    }
  }
  return errors;
}

export function discordChannelPreview(prefix: string, name = "My Game Server"): string {
  return `#${toChannelName(name, prefix)}`;
}

/**
 * Least-privilege invite for the features actually implemented by this panel.
 * Administrator is never requested. The optional ET bundle adds role/nickname
 * management and message deletion (used to hide GUIDs and tidy cooldowns).
 */
export const DISCORD_BOT_PERMISSIONS = {
  ViewChannel: 1024,
  SendMessages: 2048,
  ManageMessages: 8192,
  EmbedLinks: 16384,
  ReadMessageHistory: 65536,
  ManageChannels: 16,
  ManageWebhooks: 536870912,
  ManageNicknames: 134217728,
  ManageRoles: 268435456,
} as const;

export function discordBotInviteUrl(applicationId: string, includeEtCommands = false): string | null {
  const id = applicationId.trim();
  if (!/^\d{5,25}$/.test(id)) return null;
  const permissions = Object.entries(DISCORD_BOT_PERMISSIONS)
    .filter(([name]) => includeEtCommands || !["ManageMessages", "ManageNicknames", "ManageRoles"].includes(name))
    .reduce((sum, [, bit]) => sum + bit, 0);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", id);
  url.searchParams.set("scope", "bot");
  url.searchParams.set("permissions", String(permissions));
  return url.toString();
}
