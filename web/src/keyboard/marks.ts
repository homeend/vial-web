// How a key shows the combos it is part of, along its bottom edge: one combo, an underline in the combo's colour;
// several, a row of dots, one per combo in its colour, as many as fit, then "+n" for the rest.

export type ComboMarks =
  | { type: "none" }
  | { type: "line"; colour: number }
  /** moreWidth: the width kept for "+n", its space before it included (0 when more is 0) */
  | { type: "dots"; colours: number[]; more: number; moreWidth: number };

export interface DotSizes {
  /** a dot's diameter, in pixels */
  dot: number;
  /** the space between two dots */
  gap: number;
  /** the width "+n" takes for a one-digit n, its space before it included */
  more: number;
}

/** The marks of a key in the combos of these colours (palette indexes, one per combo, in combo order), along a bottom
 * edge `width` pixels wide */
export function comboMarks(colours: number[], width: number, sizes: DotSizes): ComboMarks {
  if (colours.length === 0) return { type: "none" };
  if (colours.length === 1) return { type: "line", colour: colours[0] };
  const step = sizes.dot + sizes.gap;
  // a hair over, so that dots filling the width exactly still fit despite rounding
  const fits = (room: number) => Math.max(0, Math.floor((room + sizes.gap) / step + 1e-6));
  if (colours.length <= fits(width)) return { type: "dots", colours, more: 0, moreWidth: 0 };
  // "+12" is wider than "+3": half as wide again for each further digit (at most as many as the combos have)
  const moreWidth = sizes.more * (1 + 0.5 * (String(colours.length).length - 1));
  const shown = fits(width - moreWidth);
  return { type: "dots", colours: colours.slice(0, shown), more: colours.length - shown, moreWidth };
}

/** Dot sizes for a key of `u` pixels a key unit: the dots stay at least 4 px wide on the smallest keys */
export function dotSizes(u: number): DotSizes {
  const dot = Math.max(4, u * 0.11);
  return { dot, gap: dot * 0.6, more: Math.max(12, u * 0.32) };
}
