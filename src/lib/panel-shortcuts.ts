/**
 * The panel's keyboard shortcuts, as data.
 *
 * The panel answers to single keys (`S` servers, `M` monitor, …) that are
 * advertised nowhere: the only hint was the letter on a menu entry, inside a
 * dropdown, behind a click. Worse, the table the cheat sheet shows and the
 * table the keyboard handler uses were two separate things that could drift.
 *
 * The panel entries are therefore *derived* from the same nav list the handler
 * builds its map from, so a shortcut cannot exist without appearing here, and
 * two panels cannot silently claim the same key.
 */

export interface ShortcutEntry {
  keys: string[];
  label: string;
}

export interface ShortcutGroup {
  title: string;
  entries: ShortcutEntry[];
}

export const GLOBAL_SHORTCUTS: ShortcutGroup = {
  title: "Anywhere in the panel",
  entries: [
    { keys: ["Ctrl/⌘", "K"], label: "Open quick jump" },
    { keys: ["?"], label: "Show this shortcut list" },
    { keys: ["Esc"], label: "Close a dialog, menu or quick jump" },
  ],
};

export const PALETTE_SHORTCUTS: ShortcutGroup = {
  title: "Inside quick jump",
  entries: [
    { keys: ["↑", "↓"], label: "Move through the results" },
    { keys: ["Enter"], label: "Open the highlighted result" },
    { keys: ["Esc"], label: "Close quick jump" },
  ],
};

/**
 * One row per panel that has a shortcut, keyed the way the handler matches it:
 * upper-case, first claim wins.
 */
export function buildPanelShortcuts(
  panels: ReadonlyArray<{ label: string; shortcut?: string | null }>
): ShortcutGroup {
  const seen = new Set<string>();
  const entries: ShortcutEntry[] = [];

  for (const panel of panels) {
    const key = panel.shortcut?.trim().toUpperCase();
    if (!key || key.length > 3 || seen.has(key)) continue;
    seen.add(key);
    entries.push({ keys: [key], label: panel.label });
  }

  return { title: "Jump straight to a panel", entries };
}

/** The full cheat sheet: global keys, panel keys, then quick-jump keys. */
export function buildShortcutGroups(
  panels: ReadonlyArray<{ label: string; shortcut?: string | null }>
): ShortcutGroup[] {
  const groups = [GLOBAL_SHORTCUTS, buildPanelShortcuts(panels), PALETTE_SHORTCUTS];
  return groups.filter((group) => group.entries.length > 0);
}
