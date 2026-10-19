// How a key shows the combos it is part of, along its bottom edge: one combo, an underline in the combo's colour;
// several, a row of dots, one per combo in its colour, as many as fit, then "+n" for the rest.

export type ComboMarks =
  | { type: "none" }
  | { type: "line"; colour: number }
  | { type: "dots"; colours: number[]; more: number };

export interface DotSizes {
  /** a dot's diameter, in pixels */
  dot: number;
  /** the space between two dots */
  gap: number;
  /** the width "+n" takes, its space before it included */
  more: number;
}

/** The marks of a key in the combos of these colours (palette indexes, one per combo, in combo order), along a bottom
 * edge `width` pixels wide */
export function comboMarks(colours: number[], width: number, sizes: DotSizes): ComboMarks {
  if (colours.length === 0) return { type: "none" };
  if (colours.length === 1) return { type: "line", colour: colours[0] };
  const step = sizes.dot + sizes.gap;
  const fit = Math.max(0, Math.floor((width + sizes.gap) / step));
  if (colours.length <= fit) return { type: "dots", colours, more: 0 };
  const shown = Math.max(0, Math.floor((width - sizes.more + sizes.gap) / step));
  return { type: "dots", colours: colours.slice(0, shown), more: colours.length - shown };
}

/** Dot sizes for a key of `u` pixels a key unit: the dots stay at least 4 px wide on the smallest keys */
export function dotSizes(u: number): DotSizes {
  const dot = Math.max(4, u * 0.11);
  return { dot, gap: dot * 0.6, more: Math.max(12, u * 0.32) };
}
