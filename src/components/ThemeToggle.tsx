"use client";

import { useEffect, useRef, useState } from "react";

type ThemeName = "nebula-dark" | "cloud-light" | "ember-sun" | "forest-command";
type LayoutMode = "compact" | "cozy" | "spacious";

const THEME_OPTIONS: Array<{ id: ThemeName; label: string; swatch: string; scheme: "light" | "dark" }> = [
  { id: "nebula-dark", label: "Nebula Dark", swatch: "#22d3ee", scheme: "dark" },
  { id: "cloud-light", label: "Cloud Light", swatch: "#0284c7", scheme: "light" },
  { id: "ember-sun", label: "Ember Sun", swatch: "#ef6c00", scheme: "light" },
  { id: "forest-command", label: "Forest Command", swatch: "#16a34a", scheme: "dark" },
];

const LAYOUT_OPTIONS: Array<{ id: LayoutMode; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "cozy", label: "Cozy" },
  { id: "spacious", label: "Spacious" },
];

function applyThemeToDocument(theme: ThemeName) {
  const option = THEME_OPTIONS.find((item) => item.id === theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = option?.scheme || "dark";
}

function applyLayoutToDocument(layout: LayoutMode) {
  document.documentElement.dataset.layout = layout;
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeName>("nebula-dark");
  const [layout, setLayoutState] = useState<LayoutMode>("cozy");

  useEffect(() => {
    const savedTheme = localStorage.getItem("gsm-theme-v2") as ThemeName | null;
    const savedLayout = localStorage.getItem("gsm-layout") as LayoutMode | null;
    const legacyTheme = localStorage.getItem("gsm-theme") as "dark" | "light" | null;

    const nextTheme = savedTheme || (legacyTheme === "light" ? "cloud-light" : "nebula-dark");
    const nextLayout = savedLayout || "cozy";

    const timer = window.setTimeout(() => {
      setThemeState(nextTheme);
      setLayoutState(nextLayout);
      applyThemeToDocument(nextTheme);
      applyLayoutToDocument(nextLayout);
      document.documentElement.classList.toggle("light", nextTheme === "cloud-light");
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function setTheme(t: ThemeName) {
    setThemeState(t);
    localStorage.setItem("gsm-theme-v2", t);
    localStorage.setItem("gsm-theme", t === "cloud-light" ? "light" : "dark");
    applyThemeToDocument(t);
    document.documentElement.classList.toggle("light", t === "cloud-light");
  }

  function setLayout(nextLayout: LayoutMode) {
    setLayoutState(nextLayout);
    localStorage.setItem("gsm-layout", nextLayout);
    applyLayoutToDocument(nextLayout);
  }

  function toggle() {
    setTheme(theme === "nebula-dark" ? "cloud-light" : "nebula-dark");
  }

  function resetAppearance() {
    setTheme("nebula-dark");
    setLayout("cozy");
  }

  return { theme, setTheme, layout, setLayout, toggle, resetAppearance };
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

  const activeTheme = THEME_OPTIONS.find((item) => item.id === theme) || THEME_OPTIONS[0];

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
