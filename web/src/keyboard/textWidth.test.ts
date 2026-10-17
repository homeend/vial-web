import { describe, expect, it, vi } from "vitest";
import { estimatedWidth } from "./labels";
import { LegendFont, measuredWidth, type FontDocument, type TextContext } from "./textWidth.svelte";

/** A canvas context whose font draws every character `em` of the font size wide, rounded up to whole pixels as a
 * hinted font is at small sizes */
function fakeContext(em: number) {
  const context = {
    font: "",
    fonts: [] as string[],
    measureText: vi.fn((text: string) => {
      context.fonts.push(context.font);
      const px = Number(/([\d.]+)px/.exec(context.font)?.[1] ?? 10);
      return { width: [...text].length * Math.ceil(em * px) };
    }),
  };
  return context satisfies TextContext;
}

function fakeDocument(context: TextContext | null, family = "Verdana, sans-serif") {
  let fontsReady!: () => void;
  const listeners: (() => void)[] = [];
  const doc = {
    body: {} as Element,
    defaultView: { getComputedStyle: vi.fn(() => ({ fontFamily: family })) },
    createElement: vi.fn(() => ({ getContext: () => context })),
    fonts: {
      ready: new Promise<void>((resolve) => (fontsReady = resolve)),
      addEventListener: (_type: "loadingdone", listener: () => void) => listeners.push(listener),
    },
  };
  return {
    doc: doc satisfies FontDocument,
    fontsReady: () => fontsReady(),
    loadingDone: () => listeners.forEach((listener) => listener()),
  };
}

describe("measuredWidth", () => {
  it("measures in the font family, as a share of the font size, with a little room", () => {
    const context = fakeContext(0.7);
    const width = measuredWidth(context, `"DejaVu Sans", sans-serif`);
    expect(width("Caps", 100)).toBeGreaterThanOrEqual(4 * 0.7);
    expect(width("Caps", 100)).toBeLessThan(4 * 0.7 * 1.05);
    expect(context.fonts[0]).toMatch(/^\d+ 100px "DejaVu Sans", sans-serif$/);
  });

  it("measures at the size asked for, as small text is not simply scaled down", () => {
    const context = fakeContext(0.55);
    const width = measuredWidth(context, "Tahoma");
    // 5 px a character at 8 px (0.625 of the font size), 55 px at 100 px (0.55)
    expect(width("Lock", 8)).toBeGreaterThan(width("Lock", 100) * 1.1);
    expect(context.fonts).toEqual([expect.stringContaining(" 8px Tahoma"), expect.stringContaining(" 100px Tahoma")]);
  });

  it("measures each text once at each size", () => {
    const context = fakeContext(0.5);
    const width = measuredWidth(context, "Verdana");
    expect(width("Tab", 9)).toBe(width("Tab", 9));
    width("Lock", 9);
    width("Tab", 10);
    expect(context.measureText).toHaveBeenCalledTimes(3);
  });

  it("measures at 100 px when there is no size", () => {
    const context = fakeContext(0.5);
    measuredWidth(context, "Verdana")("A", 0);
    expect(context.fonts[0]).toContain(" 100px ");
  });

  it("sets its font for every measurement, as another measure may have changed the context's", () => {
    const context = fakeContext(0.5);
    const width = measuredWidth(context, "Verdana");
    context.font = "10px serif";
    width("A", 12);
    expect(context.fonts[0]).toContain("12px Verdana");
  });

  it("estimates without a canvas or a font family", () => {
    expect(measuredWidth(null, "Verdana")).toBe(estimatedWidth);
    expect(measuredWidth(fakeContext(0.5), " ")).toBe(estimatedWidth);
  });
});

describe("LegendFont", () => {
  it("estimates without a document (unit tests, no browser)", () => {
    expect(new LegendFont().width).toBe(estimatedWidth);
  });

  it("estimates in a browser without a 2D canvas", () => {
    const { doc } = fakeDocument(null);
    expect(new LegendFont(doc).width("Tab / Caps Lock", 9)).toBe(estimatedWidth("Tab / Caps Lock", 9));
  });

  it("measures in the body's font family, read on the first measurement, not before", () => {
    const context = fakeContext(0.8);
    const { doc } = fakeDocument(context, "Verdana, sans-serif");
    const font = new LegendFont(doc);
    expect(doc.defaultView.getComputedStyle).not.toHaveBeenCalled();
    expect(font.width("Lock", 10)).toBeGreaterThan(estimatedWidth("Lock", 10));
    expect(context.fonts[0]).toContain("Verdana, sans-serif");
  });

  it("measures again once the fonts are ready, and whenever more fonts load", async () => {
    const context = fakeContext(0.6);
    const { doc, fontsReady, loadingDone } = fakeDocument(context);
    const font = new LegendFont(doc);
    const first = font.width;
    first("Tab", 10);

    fontsReady();
    await doc.fonts.ready;
    const second = font.width;
    expect(second).not.toBe(first);
    second("Tab", 10); // forgot what it measured: measures again
    expect(context.measureText).toHaveBeenCalledTimes(2);

    loadingDone();
    expect(font.width).not.toBe(second);
  });
});
