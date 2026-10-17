// How wide legends are in the font the browser draws them in. The app's font is the system's (system-ui), so it
// differs between systems: Segoe UI on Windows, often the much wider DejaVu Sans on Linux. An estimate from the number
// of characters can't fit labels in all of them, so text is measured on a canvas, in the font family of the page and
// at the size it is drawn at: small text isn't simply scaled down, as hinting rounds the width of each character
// (Tahoma's "Layer 2" is 3.7 font sizes wide at 100 px, 4.4 at 8.9 px).
import { estimatedWidth, type TextWidth } from "./labels";

/** What measures text: a canvas 2D context */
export interface TextContext {
  font: string;
  measureText(text: string): { width: number };
}

/** The document parts the measurement uses */
export interface FontDocument {
  body: Element | null;
  defaultView: { getComputedStyle(element: Element): { fontFamily: string } } | null;
  createElement(tag: "canvas"): { getContext(id: "2d"): TextContext | null };
  fonts?: {
    ready: Promise<unknown>;
    addEventListener(type: "loadingdone", listener: () => void): void;
  };
}

/** Text is measured in the boldest weight legends use (the Inspector's key cap) */
const WEIGHT = 650;
/** the size text is measured at when none is given, in pixels */
const SIZE = 100;
/** room for what a canvas measures differently from a laid out line (kerning across parts) */
const MARGIN = 1.03;
/** widths remembered at most: the sizes change with the window */
const REMEMBERED = 20_000;

/** Widths measured with a canvas context in a font family, as a share of the font size, each text at each size measured
 * once; the estimate when there is no context or family */
export function measuredWidth(context: TextContext | null, family: string): TextWidth {
  if (!context || !family.trim()) return estimatedWidth;
  const widths = new Map<string, number>();
  return (text, px) => {
    const size = px > 0 && Number.isFinite(px) ? px : SIZE;
    const key = `${size} ${text}`;
    let width = widths.get(key);
    if (width === undefined) {
      if (widths.size >= REMEMBERED) widths.clear();
      context.font = `${WEIGHT} ${size}px ${family}`;
      width = (context.measureText(text).width / size) * MARGIN;
      widths.set(key, width);
    }
    return width;
  };
}

/** Widths measured in the font family of the document's body (the keys inherit it). The family is read on the first
 * measurement, when the app's style sheet applies. */
function documentWidth(doc: FontDocument): TextWidth {
  let measure: TextWidth | undefined;
  return (text, px) => {
    if (!measure) {
      const family = doc.body && doc.defaultView ? doc.defaultView.getComputedStyle(doc.body).fontFamily : "";
      measure = measuredWidth(doc.createElement("canvas").getContext("2d"), family);
    }
    return measure(text, px);
  };
}

/** The width of text in the legends' font, for legendSizes: a new measure (and new sizes) whenever fonts finish
 * loading, as a font that arrives late draws text in other widths */
export class LegendFont {
  width = $state<TextWidth>(estimatedWidth);
  #doc: FontDocument | undefined;

  /** Without a document (unit tests, or no browser) the width is estimated */
  constructor(doc?: FontDocument) {
    this.#doc = doc;
    if (!doc) return;
    this.measureAgain();
    const again = () => this.measureAgain();
    void doc.fonts?.ready.then(again);
    doc.fonts?.addEventListener("loadingdone", again);
  }

  /** Forgets the widths measured so far, so the legends are sized again */
  measureAgain(): void {
    if (this.#doc) this.width = documentWidth(this.#doc);
  }
}

export const legendFont = new LegendFont(typeof document === "undefined" ? undefined : document);
