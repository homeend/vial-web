import { describe, expect, it } from "vitest";
import exportJson from "../../../docs/learning/examples/corne-sim-layout-export.json";
import setJson from "../../../docs/learning/examples/corne-sim-en.json";
import { simulatedCorne } from "../analysis/testing";
import { placeKeyboard } from "../keyboard/geometry";
import { keyIndex, nextKeyLabel, pictureFor, pictureForAll, placeOfChars, type PlaceOf } from "./picture";
import { readLessonSet, type LayoutExport } from "./types";

const layout = exportJson as LayoutExport;
const set = readLessonSet(setJson);
const placement = placeKeyboard(simulatedCorne());
const places = placeOfChars(set, layout);

/** the key ids of the items marked true */
const marked = (flags: boolean[]) => flags.flatMap((on, i) => (on ? [keyId(i)] : []));
const keyId = (i: number) => `r${placement.items[i].geometry.row}c${placement.items[i].geometry.col}`;

describe("placeOfChars", () => {
  it("lists every new character of every lesson, the first listing winning", () => {
    expect(places.get("s")).toEqual({ key: "r1c1", layer: 0, via: "tap" });
    expect(places.get("r")).toEqual({ key: "r0c3", layer: 0, via: "tap" });
    expect(places.size).toBe(11);
    const twice = { ...set, lessons: [set.lessons[0], { ...set.lessons[1], new: [{ char: "s", key: "r9c9", layer: 2, via: "tap" as const }] }] };
    expect(placeOfChars(twice, layout).get("s")).toEqual({ key: "r1c1", layer: 0, via: "tap" });
  });

  it("knows the space from the export: the layer-0 key that taps it", () => {
    expect(places.get(" ")).toEqual({ key: "r3c4", layer: 0, via: "tap" });
    expect(placeOfChars(set, { ...layout, keys: [] }).has(" ")).toBe(false);
  });
});

describe("keyIndex", () => {
  it("is the placement's item for a key id, from its row and column", () => {
    expect(keyId(keyIndex(placement, "r1c4")!)).toBe("r1c4");
    expect(keyId(keyIndex(placement, "r7c3")!)).toBe("r7c3");
    expect(keyIndex(placement, "r9c9")).toBeNull();
    expect(keyIndex(placement, "junk")).toBeNull();
  });
});

describe("pictureFor", () => {
  it("lights the key of a plain letter, nothing pressed, the rest as it is", () => {
    const picture = pictureFor("s", places, placement, layout, { fadeOthers: false });
    expect(marked(picture.highlights)).toEqual(["r1c1"]);
    expect(marked(picture.pressed)).toEqual([]);
    expect(marked(picture.faded)).toEqual([]);
    expect(picture.highlights).toHaveLength(placement.items.length);
  });

  it("fades everything else when asked", () => {
    const picture = pictureFor("s", places, placement, layout, { fadeOthers: true });
    expect(marked(picture.faded)).toHaveLength(placement.items.length - 1);
    expect(marked(picture.faded)).not.toContain("r1c1");
  });

  it("presses the other hand's Shift for a capital", () => {
    const capitals = new Map<string, PlaceOf>([
      ["S", { key: "r1c1", layer: 0, via: "shift" }], ["A", { key: "r5c4", layer: 0, via: "shift" }],
    ]);
    // S is on the left: the export's first right-hand Shift is I (hold), r5c1
    let picture = pictureFor("S", capitals, placement, layout, { fadeOthers: true });
    expect(marked(picture.highlights)).toEqual(["r1c1"]);
    expect(marked(picture.pressed)).toEqual(["r5c1"]);
    expect(marked(picture.faded)).not.toContain("r5c1");
    // A is on the right: the first left-hand Shift is T (hold), r1c4
    picture = pictureFor("A", capitals, placement, layout, { fadeOthers: false });
    expect(marked(picture.pressed)).toEqual(["r1c4"]);
  });

  it("falls back to any Shift key when the other hand has none", () => {
    const capitals = new Map<string, PlaceOf>([["S", { key: "r1c1", layer: 0, via: "shift" }]]);
    const oneShift = { ...layout, shiftKeys: [layout.shiftKeys[0]] };
    expect(marked(pictureFor("S", capitals, placement, oneShift, { fadeOthers: false }).pressed)).toEqual(["r1c4"]);
    expect(marked(pictureFor("S", capitals, placement, { ...layout, shiftKeys: [] }, { fadeOthers: false }).pressed))
      .toEqual([]);
  });

  it("presses the layer key for a layer character", () => {
    const symbols = new Map<string, PlaceOf>([
      ["(", { key: "r1c3", layer: 1, via: "tap" }], ["~", { key: "r1c1", layer: 1, via: "shift" }],
      ["1", { key: "r1c1", layer: 3, via: "tap" }],
    ]);
    let picture = pictureFor("(", symbols, placement, layout, { fadeOthers: true });
    expect(marked(picture.highlights)).toEqual(["r1c3"]);
    expect(marked(picture.pressed)).toEqual(["r3c4"]);
    expect(marked(picture.faded)).not.toContain("r3c4");
    // shifted on a layer: the layer key and the other hand's Shift
    picture = pictureFor("~", symbols, placement, layout, { fadeOthers: false });
    expect(marked(picture.pressed).sort()).toEqual(["r3c4", "r5c1"]);
    // a one-shot layer key presses the same way
    expect(marked(pictureFor("1", symbols, placement, layout, { fadeOthers: false }).pressed)).toEqual(["r7c3"]);
  });

  it("presses the key that holds AltGr for an AltGr character", () => {
    const polish = new Map<string, PlaceOf>([["ą", { key: "r5c4", layer: 0, via: "altGr" }]]);
    const picture = pictureFor("ą", polish, placement, layout, { fadeOthers: false });
    expect(marked(picture.highlights)).toEqual(["r5c4"]);
    // E (hold) is AltGr in the export
    expect(marked(picture.pressed)).toEqual(["r5c3"]);
  });

  it("lights the space key", () => {
    const picture = pictureFor(" ", places, placement, layout, { fadeOthers: true });
    expect(marked(picture.highlights)).toEqual(["r3c4"]);
    expect(marked(picture.pressed)).toEqual([]);
  });

  it("marks nothing for a character it doesn't know", () => {
    const picture = pictureFor("ą", places, placement, layout, { fadeOthers: true });
    expect(picture.highlights).not.toContain(true);
    expect(picture.pressed).not.toContain(true);
    expect(picture.faded).not.toContain(true);
    expect(picture.highlights).toHaveLength(placement.items.length);
  });
});

describe("nextKeyLabel", () => {
  it("names the key, with Shift, or with the way to its layer", () => {
    expect(nextKeyLabel({ key: "r1c1", layer: 0, via: "tap" }, layout)).toBe("S");
    expect(nextKeyLabel({ key: "r3c4", layer: 0, via: "tap" }, layout)).toBe("Space");
    expect(nextKeyLabel({ key: "r1c5", layer: 0, via: "tap" }, layout)).toBe(",");
    expect(nextKeyLabel({ key: "r1c1", layer: 0, via: "shift" }, layout)).toBe("Shift + S");
    expect(nextKeyLabel({ key: "r1c5", layer: 0, via: "shift" }, layout)).toBe("Shift + ,");
    expect(nextKeyLabel({ key: "r1c3", layer: 1, via: "tap" }, layout)).toBe("hold Space → (");
    expect(nextKeyLabel({ key: "r1c1", layer: 1, via: "shift" }, layout)).toBe("hold Space → Shift + `");
    expect(nextKeyLabel({ key: "r1c1", layer: 3, via: "tap" }, layout)).toBe("tap OSL 3 → 1");
    expect(nextKeyLabel({ key: "r1c1", layer: 0, via: "altGr" }, layout)).toBe("AltGr + S");
  });

  it("says what it can about a key or layer the export doesn't have", () => {
    expect(nextKeyLabel({ key: "r9c9", layer: 0, via: "tap" }, layout)).toBe("r9c9");
    expect(nextKeyLabel({ key: "r1c1", layer: 7, via: "tap" }, layout)).toBe("layer 7 → S");
  });
});

describe("pictureForAll", () => {
  it("lights every character's key and presses every key held for them, fading the rest", () => {
    const capitals = new Map<string, PlaceOf>([
      ["s", { key: "r1c1", layer: 0, via: "tap" }], ["A", { key: "r5c4", layer: 0, via: "shift" }],
    ]);
    const picture = pictureForAll(["s", "A"], capitals, placement, layout, { fadeOthers: true });
    expect(marked(picture.highlights)).toEqual(["r1c1", "r5c4"]);
    expect(marked(picture.pressed)).toEqual(["r1c4"]);
    expect(marked(picture.faded)).toHaveLength(placement.items.length - 3);
    expect(marked(pictureForAll([], capitals, placement, layout, { fadeOthers: true }).faded))
      .toHaveLength(placement.items.length);
    expect(marked(pictureForAll(["s"], capitals, placement, layout, { fadeOthers: false }).faded)).toEqual([]);
  });
});
