"use client";

import { useEffect, useRef, useState } from "react";
import {
  applyThemePreference,
  DEFAULT_CUSTOM_THEME,
  getThemePreferenceFromStorage,
  LAYOUT_OPTIONS,
  persistThemePreference,
  THEME_OPTIONS,
  type CustomThemePalette,
  type LayoutMode,
  type ThemeName,
} from "@/lib/theme";

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>("nebula-dark");
  const [layout, setLayoutState] = useState<LayoutMode>("cozy");
  const [customTheme, setCustomThemeState] = useState<CustomThemePalette>(DEFAULT_CUSTOM_THEME);

  useEffect(() => {
    const saved = getThemePreferenceFromStorage();

    const timer = window.setTimeout(() => {
      setThemeState(saved.theme);
      setLayoutState(saved.layout);
      setCustomThemeState(saved.customTheme);
      applyThemePreference(saved);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function setTheme(t: ThemeName) {
    setThemeState(t);
    const preference = { theme: t, layout, customTheme };
    persistThemePreference(preference);
    applyThemePreference(preference);
  }

  function setLayout(nextLayout: LayoutMode) {
    setLayoutState(nextLayout);
    const preference = { theme, layout: nextLayout, customTheme };
    persistThemePreference(preference);
    applyThemePreference(preference);
  }

  function setCustomTheme(nextCustomTheme: CustomThemePalette) {
    setCustomThemeState(nextCustomTheme);
    const preference = { theme: "custom-user" as ThemeName, layout, customTheme: nextCustomTheme };
    setThemeState("custom-user");
    persistThemePreference(preference);
    applyThemePreference(preference);
  }

  function toggle() {
    setTheme(theme === "cloud-light" ? "nebula-dark" : "cloud-light");
  }

  function resetAppearance() {
    const preference = { theme: "nebula-dark" as ThemeName, layout: "cozy" as LayoutMode, customTheme: DEFAULT_CUSTOM_THEME };
    setThemeState(preference.theme);
    setLayoutState(preference.layout);
    setCustomThemeState(preference.customTheme);
    persistThemePreference(preference);
    applyThemePreference(preference);
  }

  return { theme, setTheme, layout, setLayout, customTheme, setCustomTheme, toggle, resetAppearance };
}

export function ThemeToggleButton({ compact }: { compact?: boolean }) {
  const { theme, setTheme, layout, setLayout, resetAppearance } = useTheme();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const activeTheme = theme === "custom-user"
    ? { label: "Custom Theme", swatch: "#7c3aed" }
    : (THEME_OPTIONS.find((item) => item.id === theme) || THEME_OPTIONS[0]);

  if (compact) {
    return (
      <div ref={panelRef} className="relative">
        <button onClick={() => setOpen((v) => !v)} className="px-2 py-1.5 bg-bg-tertiary hover:bg-bg-hover text-text-muted text-xs rounded transition-colors" title="Theme and layout settings">
          🎨
        </button>
        {open && <ThemeEditorPanel theme={theme} setTheme={setTheme} layout={layout} setLayout={setLayout} resetAppearance={resetAppearance} compact />}
      </div>
    );
  }

  return (
    <div ref={panelRef} className="relative">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border border-border hover:bg-bg-hover rounded-lg text-sm transition-colors">
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: activeTheme.swatch }} />
        <span>{activeTheme.label}</span>
      </button>
      {open && <ThemeEditorPanel theme={theme} setTheme={setTheme} layout={layout} setLayout={setLayout} resetAppearance={resetAppearance} />}
    </div>
  );
}

function ThemeEditorPanel({
  theme,
  setTheme,
  layout,
  setLayout,
  resetAppearance,
  compact,
}: {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  layout: LayoutMode;
  setLayout: (layout: LayoutMode) => void;
  resetAppearance: () => void;
  compact?: boolean;
}) {
  return (
    <div className={`absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-bg-card p-3 shadow-2xl ${compact ? "max-h-[70vh] overflow-y-auto" : ""}`}>
      <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted mb-2">Theme Presets</p>
      <div className="space-y-1.5 mb-3">
        <button
          onClick={() => setTheme("custom-user")}
          className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm border transition-colors ${theme === "custom-user" ? "border-accent/50 bg-accent/10 text-text-primary" : "border-border hover:bg-bg-hover text-text-secondary"}`}
        >
          <span className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#7c3aed" }} />
            Custom Theme
          </span>
          {theme === "custom-user" && <span className="text-accent text-xs">Active</span>}
        </button>
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => setTheme(option.id)}
            className={`w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm border transition-colors ${theme === option.id ? "border-accent/50 bg-accent/10 text-text-primary" : "border-border hover:bg-bg-hover text-text-secondary"}`}
          >
            <span className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: option.swatch }} />
              {option.label}
            </span>
            {theme === option.id && <span className="text-accent text-xs">Active</span>}
          </button>
        ))}
      </div>

      <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted mb-2">Layout Density</p>
      <div className="grid grid-cols-3 gap-1.5 mb-3">
        {LAYOUT_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => setLayout(option.id)}
            className={`rounded-lg border px-2 py-1.5 text-xs transition-colors ${layout === option.id ? "border-accent/50 bg-accent/10 text-text-primary" : "border-border hover:bg-bg-hover text-text-secondary"}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <button onClick={resetAppearance} className="w-full rounded-lg border border-border bg-bg-secondary px-2.5 py-2 text-xs text-text-secondary hover:bg-bg-hover">
        Reset To Default
      </button>
    </div>
  );
}
