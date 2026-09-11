/**
 * Command palette selection math — keeps arrow navigation inside the list
 * no matter how the results resize between keystrokes.
 */

/** Clamp a stored index into a list that may have shrunk or emptied. */
export function clampPaletteIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(length - 1, Math.floor(index)));
}

/** Move one step up (-1) or down (+1), stopping at the edges. */
export function stepPaletteIndex(index: number, length: number, dir: 1 | -1): number {
  if (length <= 0) return 0;
  const next = clampPaletteIndex(index, length) + dir;
  return Math.max(0, Math.min(length - 1, next));
}
