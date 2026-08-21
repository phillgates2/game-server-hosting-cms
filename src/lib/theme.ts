export type PresetThemeName = "nebula-dark" | "cloud-light" | "ember-sun" | "forest-command";
export type ThemeName = PresetThemeName | "custom-user";
export type LayoutMode = "compact" | "cozy" | "spacious";

export interface ThemeOption {
  id: PresetThemeName;
  label: string;
  swatch: string;
  scheme: "light" | "dark";
}

export interface CustomThemePalette {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgCard: string;
  bgHover: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  success: string;
  warning: string;
  danger: string;
  purple: string;
  auroraA: string;
  auroraB: string;
  bgDepth: string;
  scheme: "light" | "dark";
}

export interface ThemePreference {
  theme: ThemeName;
  layout: LayoutMode;
  customTheme: CustomThemePalette;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { id: "nebula-dark", label: "Nebula Dark", swatch: "#22d3ee", scheme: "dark" },
  { id: "cloud-light", label: "Cloud Light", swatch: "#0284c7", scheme: "light" },
  { id: "ember-sun", label: "Ember Sun", swatch: "#ef6c00", scheme: "light" },
  { id: "forest-command", label: "Forest Command", swatch: "#16a34a", scheme: "dark" },
];

export const LAYOUT_OPTIONS: Array<{ id: LayoutMode; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "cozy", label: "Cozy" },
  { id: "spacious", label: "Spacious" },
];

export const DEFAULT_CUSTOM_THEME: CustomThemePalette = {
  bgPrimary: "#070b14",
  bgSecondary: "#111a2b",
  bgTertiary: "#17243a",
  bgCard: "#111f34",
  bgHover: "#1d2e48",
  border: "#2a4264",
  textPrimary: "#eaf2ff",
  textSecondary: "#9db2d2",
  textMuted: "#6980a5",
  accent: "#22d3ee",
  accentHover: "#06b6d4",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  purple: "#f97316",
  auroraA: "rgba(34, 211, 238, 0.14)",
  auroraB: "rgba(239, 68, 68, 0.14)",
  bgDepth: "#091326",
  scheme: "dark",
};

export const THEME_STORAGE_KEYS = {
  themeV2: "gsm-theme-v2",
  layout: "gsm-layout",
  legacyTheme: "gsm-theme",
  customTheme: "gsm-custom-theme",
} as const;

function isPresetTheme(value: string): value is PresetThemeName {
  return THEME_OPTIONS.some((theme) => theme.id === value);
}

function isLayoutMode(value: string): value is LayoutMode {
  return value === "compact" || value === "cozy" || value === "spacious";
}

function looksLikeHexColor(value: string) {
  return /^#[0-9A-F]{6}$/i.test(value);
}

function looksLikeRgbaColor(value: string) {
  return /^rgba\((25[0-5]|2[0-4]\d|1?\d?\d),\s*(25[0-5]|2[0-4]\d|1?\d?\d),\s*(25[0-5]|2[0-4]\d|1?\d?\d),\s*(0(\.\d+)?|1(\.0+)?)\)$/i.test(value.trim());
}

function normalizeColor(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (looksLikeHexColor(trimmed) || looksLikeRgbaColor(trimmed)) return trimmed;
  return fallback;
}

export function normalizeCustomTheme(input: unknown): CustomThemePalette {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    bgPrimary: normalizeColor(source.bgPrimary, DEFAULT_CUSTOM_THEME.bgPrimary),
    bgSecondary: normalizeColor(source.bgSecondary, DEFAULT_CUSTOM_THEME.bgSecondary),
    bgTertiary: normalizeColor(source.bgTertiary, DEFAULT_CUSTOM_THEME.bgTertiary),
    bgCard: normalizeColor(source.bgCard, DEFAULT_CUSTOM_THEME.bgCard),
    bgHover: normalizeColor(source.bgHover, DEFAULT_CUSTOM_THEME.bgHover),
    border: normalizeColor(source.border, DEFAULT_CUSTOM_THEME.border),
    textPrimary: normalizeColor(source.textPrimary, DEFAULT_CUSTOM_THEME.textPrimary),
    textSecondary: normalizeColor(source.textSecondary, DEFAULT_CUSTOM_THEME.textSecondary),
    textMuted: normalizeColor(source.textMuted, DEFAULT_CUSTOM_THEME.textMuted),
    accent: normalizeColor(source.accent, DEFAULT_CUSTOM_THEME.accent),
    accentHover: normalizeColor(source.accentHover, DEFAULT_CUSTOM_THEME.accentHover),
    success: normalizeColor(source.success, DEFAULT_CUSTOM_THEME.success),
    warning: normalizeColor(source.warning, DEFAULT_CUSTOM_THEME.warning),
    danger: normalizeColor(source.danger, DEFAULT_CUSTOM_THEME.danger),
    purple: normalizeColor(source.purple, DEFAULT_CUSTOM_THEME.purple),
    auroraA: normalizeColor(source.auroraA, DEFAULT_CUSTOM_THEME.auroraA),
    auroraB: normalizeColor(source.auroraB, DEFAULT_CUSTOM_THEME.auroraB),
    bgDepth: normalizeColor(source.bgDepth, DEFAULT_CUSTOM_THEME.bgDepth),
    scheme: source.scheme === "light" ? "light" : "dark",
  };
}

export function getThemePreferenceFromStorage(): ThemePreference {
  if (typeof window === "undefined") {
    return { theme: "nebula-dark", layout: "cozy", customTheme: DEFAULT_CUSTOM_THEME };
  }

  const savedTheme = localStorage.getItem(THEME_STORAGE_KEYS.themeV2);
  const savedLegacyTheme = localStorage.getItem(THEME_STORAGE_KEYS.legacyTheme);
  const savedLayout = localStorage.getItem(THEME_STORAGE_KEYS.layout);
  const savedCustomTheme = localStorage.getItem(THEME_STORAGE_KEYS.customTheme);

  const parsedTheme: ThemeName = savedTheme === "custom-user" || (savedTheme && isPresetTheme(savedTheme))
    ? savedTheme
    : (savedLegacyTheme === "light" ? "cloud-light" : "nebula-dark");

  const parsedLayout: LayoutMode = savedLayout && isLayoutMode(savedLayout) ? savedLayout : "cozy";
  const customTheme = normalizeCustomTheme(savedCustomTheme ? JSON.parse(savedCustomTheme) : null);

  return {
    theme: parsedTheme,
    layout: parsedLayout,
    customTheme,
  };
}

export function persistThemePreference(preference: ThemePreference) {
  if (typeof window === "undefined") return;

  localStorage.setItem(THEME_STORAGE_KEYS.themeV2, preference.theme);
  localStorage.setItem(THEME_STORAGE_KEYS.layout, preference.layout);
  localStorage.setItem(THEME_STORAGE_KEYS.customTheme, JSON.stringify(preference.customTheme));

  const isLightScheme = preference.theme === "custom-user"
    ? preference.customTheme.scheme === "light"
    : THEME_OPTIONS.find((theme) => theme.id === preference.theme)?.scheme === "light";
  localStorage.setItem(THEME_STORAGE_KEYS.legacyTheme, isLightScheme ? "light" : "dark");
}

function clearCustomThemeVariables() {
  const vars = [
    "--color-bg-primary",
    "--color-bg-secondary",
    "--color-bg-tertiary",
    "--color-bg-card",
    "--color-bg-hover",
    "--color-border",
    "--color-text-primary",
    "--color-text-secondary",
    "--color-text-muted",
    "--color-accent",
    "--color-accent-hover",
    "--color-success",
    "--color-warning",
    "--color-danger",
    "--color-purple",
    "--color-aurora-a",
    "--color-aurora-b",
    "--color-bg-depth",
  ];
  for (const variable of vars) {
    document.documentElement.style.removeProperty(variable);
  }
}

export function applyThemePreference(preference: ThemePreference) {
  if (typeof document === "undefined") return;

  document.documentElement.dataset.layout = preference.layout;

  if (preference.theme === "custom-user") {
    const theme = preference.customTheme;
    document.documentElement.dataset.theme = "custom-user";
    document.documentElement.style.setProperty("--color-bg-primary", theme.bgPrimary);
    document.documentElement.style.setProperty("--color-bg-secondary", theme.bgSecondary);
    document.documentElement.style.setProperty("--color-bg-tertiary", theme.bgTertiary);
    document.documentElement.style.setProperty("--color-bg-card", theme.bgCard);
    document.documentElement.style.setProperty("--color-bg-hover", theme.bgHover);
    document.documentElement.style.setProperty("--color-border", theme.border);
    document.documentElement.style.setProperty("--color-text-primary", theme.textPrimary);
    document.documentElement.style.setProperty("--color-text-secondary", theme.textSecondary);
    document.documentElement.style.setProperty("--color-text-muted", theme.textMuted);
    document.documentElement.style.setProperty("--color-accent", theme.accent);
    document.documentElement.style.setProperty("--color-accent-hover", theme.accentHover);
    document.documentElement.style.setProperty("--color-success", theme.success);
    document.documentElement.style.setProperty("--color-warning", theme.warning);
    document.documentElement.style.setProperty("--color-danger", theme.danger);
    document.documentElement.style.setProperty("--color-purple", theme.purple);
    document.documentElement.style.setProperty("--color-aurora-a", theme.auroraA);
    document.documentElement.style.setProperty("--color-aurora-b", theme.auroraB);
    document.documentElement.style.setProperty("--color-bg-depth", theme.bgDepth);
    document.documentElement.style.colorScheme = theme.scheme;
    document.documentElement.classList.toggle("light", theme.scheme === "light");
    return;
  }

  clearCustomThemeVariables();
  const selected = THEME_OPTIONS.find((theme) => theme.id === preference.theme) || THEME_OPTIONS[0];
  document.documentElement.dataset.theme = selected.id;
  document.documentElement.style.colorScheme = selected.scheme;
  document.documentElement.classList.toggle("light", selected.scheme === "light");
}
