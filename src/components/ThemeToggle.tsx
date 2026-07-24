"use client";

import { useEffect, useState } from "react";

export function useTheme() {
  const [theme, setThemeState] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("gsm-theme") as "dark" | "light" | null;
    if (saved) {
      setThemeState(saved);
      document.documentElement.classList.toggle("light", saved === "light");
    }
  }, []);

  function setTheme(t: "dark" | "light") {
    setThemeState(t);
    localStorage.setItem("gsm-theme", t);
    document.documentElement.classList.toggle("light", t === "light");
  }

  function toggle() { setTheme(theme === "dark" ? "light" : "dark"); }

  return { theme, setTheme, toggle };
}

export function ThemeToggleButton({ compact }: { compact?: boolean }) {
  const { theme, toggle } = useTheme();

  if (compact) {
    return (
      <button onClick={toggle} className="px-2 py-1.5 bg-bg-tertiary hover:bg-bg-hover text-text-muted text-xs rounded transition-colors" title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
        {theme === "dark" ? "☀️" : "🌙"}
      </button>
    );
  }

  return (
    <button onClick={toggle} className="flex items-center gap-2 px-3 py-2 bg-bg-secondary border border-border hover:bg-bg-hover rounded-lg text-sm transition-colors">
      <span>{theme === "dark" ? "☀️" : "🌙"}</span>
      <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
    </button>
  );
}
