/**
 * Color name generator.
 *
 * Two jobs:
 *   1. a deterministic, human-friendly name for any hex color (hue bucket +
 *      saturation/lightness modifier), so a role or theme color can be
 *      described instead of remembered as "#e91e63";
 *   2. a pleasant random color with its name, for "surprise me" buttons in
 *      the role and theme editors.
 *
 * Pure functions — no DOM, no randomness beyond the injectable generator,
 * so everything is testable and names are stable across renders.
 */

export interface NamedColor {
  /** Human-friendly name, e.g. "Vivid Azurite". */
  name: string;
  /** Normalized lowercase hex, e.g. "#3b82f6". */
  hex: string;
  /** CSS rgb() string for inline styles. */
  css: string;
}

export interface Hsv {
  h: number; // 0-360
  s: number; // 0-1
  v: number; // 0-1
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** Parse a hex color (`#3b82f6` or `3b82f6`) into HSV, or null when invalid. */
export function parseHex(input: string): Hsv | null {
  const m = HEX_RE.exec(String(input).trim());
  if (!m) return null;
  const hex = m[1];
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  return rgbToHsv(r, g, b);
}

/** Standard RGB→HSV conversion; input channels in [0,1]. */
export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

/** HSV→RGB in [0,1], used by the random generator. */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return { r: rgb[0] + m, g: rgb[1] + m, b: rgb[2] + m };
}

function hexByte(n: number): string {
  return Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");
}

export function toHex(r: number, g: number, b: number): string {
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

/** Hue buckets: every hue gets a core noun, grays a material. */
const HUE_BUCKETS: Array<{ max: number; cores: string[] }> = [
  { max: 15, cores: ["Scarlet", "Ember"] },
  { max: 40, cores: ["Amber", "Copper"] },
  { max: 62, cores: ["Honey", "Topaz"] },
  { max: 90, cores: ["Citron", "Lime"] },
  { max: 150, cores: ["Emerald", "Jade"] },
  { max: 200, cores: ["Lagoon", "Teal"] },
  { max: 240, cores: ["Azurite", "Cobalt"] },
  { max: 275, cores: ["Sapphire", "Iris"] },
  { max: 310, cores: ["Violet", "Amethyst"] },
  { max: 345, cores: ["Orchid", "Fuchsia"] },
  { max: 360, cores: ["Rose", "Magenta"] },
];

const GRAY_CORES: Array<{ min: number; cores: string[] }> = [
  { min: 0.85, cores: ["Ivory", "Pearl"] },
  { min: 0.6, cores: ["Silver", "Frost"] },
  { min: 0.35, cores: ["Slate", "Ash"] },
  { min: 0, cores: ["Graphite", "Onyx"] },
];

/** Deterministic name for an HSV color. Same color, same name — always. */
export function nameForHsv(hsv: Hsv): string {
  const { h, s, v } = hsv;
  if (s < 0.08) {
    // Achromatic: pick the material for the lightness band.
    const band = GRAY_CORES.find((g) => v >= g.min) ?? GRAY_CORES[GRAY_CORES.length - 1];
    const idx = Math.floor(v * 10) % band.cores.length;
    return band.cores[idx];
  }

  const bucket = HUE_BUCKETS.find((b) => h <= b.max) ?? HUE_BUCKETS[HUE_BUCKETS.length - 1];
  // Vary the core by which third of the bucket the hue falls in, so colors
  // that are close-but-not-equal get close-but-not-equal names.
  const span = bucket.max - (HUE_BUCKETS[HUE_BUCKETS.indexOf(bucket) - 1]?.max ?? 0);
  const pos = span > 0 ? (h - (HUE_BUCKETS[HUE_BUCKETS.indexOf(bucket) - 1]?.max ?? 0)) / span : 0;
  const core = bucket.cores[Math.floor(pos * bucket.cores.length) % bucket.cores.length];

  // One modifier, most distinctive first: darkness reads "Deep" no matter
  // how saturated (a dark navy is deep, not vivid), then vivid, then bright,
  // then muted. A plain middle color keeps just its core name.
  let modifier = "";
  if (v < 0.35) modifier = "Deep";
  else if (s >= 0.75) modifier = "Vivid";
  else if (v >= 0.85) modifier = "Bright";
  else if (s < 0.38) modifier = "Muted";

  return modifier ? `${modifier} ${core}` : core;
}

/** Deterministic name for a hex color, or null for invalid input. */
export function colorNameFor(hex: string): string | null {
  const hsv = parseHex(hex);
  return hsv ? nameForHsv(hsv) : null;
}

/** A whole-color object with the name attached; null for invalid input. */
export function describeColor(hex: string): NamedColor | null {
  const hsv = parseHex(hex);
  if (!hsv) return null;
  const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
  return {
    name: nameForHsv(hsv),
    hex: toHex(r, g, b),
    css: `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`,
  };
}

/**
 * A pleasant random color with its name. The palette stays saturated but not
 * neon (s 0.45–0.92, v 0.35–0.85) so generated role badges look intentional.
 */
export function randomColorName(random: () => number = Math.random): NamedColor {
  const h = Math.floor(random() * 360);
  const s = 0.45 + random() * 0.47;
  const v = 0.35 + random() * 0.5;
  const { r, g, b } = hsvToRgb(h, s, v);
  const hex = toHex(r, g, b);
  const name = nameForHsv({ h, s, v });
  return {
    name,
    hex,
    css: `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`,
  };
}
