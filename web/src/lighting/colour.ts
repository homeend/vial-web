// Colours as the keyboard takes them: hue, saturation and brightness each from 0 to 255 (QMK's HSV), as Qt converts
// them (QColor.fromHsvF(h / 255, s / 255, v / 255)), and as the page shows them: degrees and percentages.

export type Rgb = [number, number, number];

/** A QMK hue, saturation and brightness (0-255 each) as red, green and blue (0-255 each) */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hue = ((h / 255) * 360) % 360;
  const sat = s / 255;
  const val = v / 255;
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((n) => Math.round((n + m) * 255)) as Rgb;
}

/** Red, green and blue (0-255 each) as a QMK hue, saturation and brightness (0-255 each); a grey has hue 0 */
export function rgbToHsv([r, g, b]: Rgb): Rgb {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return [Math.round((hue / 360) * 255) % 256, max === 0 ? 0 : Math.round((d / max) * 255), max];
}

/** "#ff8000" */
export function rgbToHex(rgb: Rgb): string {
  return `#${rgb.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** "#ff8000" -> [255, 128, 0]; null for anything else */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** The hue and saturation of a colour picked (e.g. from the browser's colour picker); a grey keeps `hue`, as it has
 * none of its own. Its brightness is left to the brightness slider. */
export function pickedHueSat(hex: string, hue: number): { hue: number; saturation: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [h, s] = rgbToHsv(rgb);
  return { hue: s === 0 ? hue : h, saturation: s };
}

/** A hue in degrees: "210°" */
export function degrees(h: number): string {
  return `${Math.round((h / 255) * 360) % 360}°`;
}

/** A level (saturation, brightness, speed) as a percentage of 255: "75 %" */
export function percent(n: number): string {
  return `${Math.round((n / 255) * 100)} %`;
}

/** The track of a hue slider: every hue, as a CSS gradient */
export const HUE_TRACK = `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360]
  .map((d) => `hsl(${d} 100% 50%)`).join(", ")})`;

/** A brightness as a percentage of the most the keyboard allows: "64 %" */
export function percentOf(n: number, most: number): string {
  return most > 0 ? `${Math.round((n / most) * 100)} %` : "0 %";
}

/** The track of a brightness slider for a colour, up to the most the keyboard allows: from black to the colour */
export function brightnessTrack(h: number, s: number, most = 255): string {
  return `linear-gradient(to right, #000000, ${rgbToHex(hsvToRgb(h, s, most))})`;
}

/** The track of a saturation slider for a hue: from grey to the full colour */
export function saturationTrack(h: number): string {
  return `linear-gradient(to right, ${rgbToHex(hsvToRgb(h, 0, 255))}, ${rgbToHex(hsvToRgb(h, 255, 255))})`;
}
