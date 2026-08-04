/**
 * WCAG 2.x contrast utilities.
 *
 * `getContrastColor(bg)` — given any CSS colour string (hex or rgb/rgba),
 * returns '#000000' or '#ffffff', whichever achieves the higher contrast
 * ratio against that background (targeting WCAG AA ≥ 4.5 : 1).
 *
 * All calculations happen at call-time (synchronous, no DOM reads), so it is
 * safe to call during React render and inside `style` prop computations.
 */

/** Parse a 3- or 6-character hex colour string to [r, g, b] 0–255. */
function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.replace(/^\s*#/, "").trim();
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  if (h.length === 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  return null;
}

/** Parse rgb() / rgba() strings to [r, g, b] 0–255. */
function rgbStringToRgb(color: string): [number, number, number] | null {
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

/** Relative luminance per WCAG 2.x (IEC 61966-2-1 sRGB linearisation). */
function getLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (always ≥ 1). */
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker  = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Given a CSS background colour (hex, rgb, or rgba string), return the
 * foreground colour — '#000000' or '#ffffff' — that achieves the greater
 * contrast ratio against that background.
 *
 * Falls back to '#000000' (black) when the input cannot be parsed.
 */
export function getContrastColor(
  bg: string | null | undefined
): "#000000" | "#ffffff" {
  if (!bg) return "#000000";

  const rgb = bg.trimStart().startsWith("#")
    ? hexToRgb(bg)
    : rgbStringToRgb(bg);

  if (!rgb) return "#000000";

  const lum           = getLuminance(...rgb);
  const vsWhite       = contrastRatio(1.0, lum);
  const vsBlack       = contrastRatio(0.0, lum);
  return vsWhite >= vsBlack ? "#ffffff" : "#000000";
}
