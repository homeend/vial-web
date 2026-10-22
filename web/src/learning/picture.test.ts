import { describe, expect, it } from "vitest";
import exportJson from "../../../docs/learning/examples/corne-sim-layout-export.json";
import setJson from "../../../docs/learning/examples/corne-sim-en.json";
import { simulatedCorne } from "../analysis/testing";
import { placeKeyboard } from "../keyboard/geometry";
import { heldKeysFor, keyIndex, nextKeyLabel, pictureFor, pictureForAll, placeOfChars, type PlaceOf } from "./picture";
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

  it("takes the resting key, then a thumb key, of two that tap the space", () => {
    // the bottom-row / (r2c5, listed before the thumb) taps a space too
    const twoSpaces = (thumbHome: boolean) => ({
      ...layout, keys: layout.keys.map((key) => key.id === "r2c5" ? { ...key, chars: { "0": { tap: " " } } }
        : key.id === "r3c4" ? { ...key, home: thumbHome } : key),
    });
    expect(placeOfChars(set, twoSpaces(true)).get(" ")?.key).toBe("r3c4");
    // neither resting: the thumb key
    expect(placeOfChars(set, twoSpaces(false)).get(" ")?.key).toBe("r3c4");
    // neither resting nor on the thumb row: the first listed
    const noThumb = { ...layout, keys: twoSpaces(false).keys.filter((key) => key.id !== "r3c4") };
    expect(placeOfChars(set, noThumb).get(" ")?.key).toBe("r2c5");
  });

  it("keeps the lesson's own path label", () => {
    const withPath = { ...set, lessons: [{ ...set.lessons[0], new: [{ char: "(", key: "r1c3", layer: 1, via: "tap" as const, path: "hold the left thumb" }] }] };
    expect(placeOfChars(withPath, layout).get("(")).toEqual({ key: "r1c3", layer: 1, via: "tap", path: "hold the left thumb" });
    expect(placeOfChars(set, layout).get("s")).not.toHaveProperty("path");
  });

  it("skips an entry without a key and defaults a missing layer and via, as the checker allows them", () => {
    // the server accepts a bare char: the type leaves the key, layer and via optional
    const loose = { ...set, lessons: [{ ...set.lessons[0], new: [{ char: "x" }, { char: "y", key: "r1c1" }] }] };
    const got = placeOfChars(loose, layout);
    expect(got.has("x")).toBe(false);
    expect(got.get("y")).toEqual({ key: "r1c1", layer: 0, via: "tap" });
    const picture = pictureFor("x", got, placement, layout, { fadeOthers: true });
    expect(picture.highlights).not.toContain(true);
    expect(picture.pressed).not.toContain(true);
    expect(picture.faded).not.toContain(true);
    expect(marked(pictureFor("y", got, placement, layout, { fadeOthers: false }).highlights)).toEqual(["r1c1"]);
    expect(nextKeyLabel(got.get("y")!, layout)).toBe("S");
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

describe("heldKeysFor", () => {
  it("holds the layer key and the other hand's Shift for a shifted character on a layer", () => {
    // ~ is Shift + ` on layer 1 (held by the left thumb, r3c4); ` is on the left: the right Shift, I (hold)
    expect(heldKeysFor({ key: "r1c1", layer: 1, via: "shift" }, layout)).toEqual(["r3c4", "r5c1"]);
    expect(heldKeysFor({ key: "r1c1", layer: 1, via: "tap" }, layout)).toEqual(["r3c4"]);
    expect(heldKeysFor({ key: "r1c1", layer: 0, via: "shift" }, layout)).toEqual(["r5c1"]);
    expect(heldKeysFor({ key: "r1c1", layer: 0, via: "tap" }, layout)).toEqual([]);
    // a layer the export doesn't have: nothing to hold for it
    expect(heldKeysFor({ key: "r1c1", layer: 7, via: "shift" }, layout)).toEqual(["r5c1"]);
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

  it("presses a plain AltGr key, which the export marks by its hold alone", () => {
    const polish = new Map<string, PlaceOf>([["ą", { key: "r5c4", layer: 0, via: "altGr" }]]);
    const altGrThumb = (chars: LayoutExport["keys"][number]["chars"]) => layout.keys.map((key) =>
      key.id === "r7c5" ? { ...key, chars: { "0": { hold: "AltGr" } } } : key.id === "r5c3" ? { ...key, chars } : key);
    // the right outer thumb is AltGr, E is a plain letter
    let keys = altGrThumb({ "0": { tap: "e", shift: "E" } });
    expect(marked(pictureFor("ą", polish, placement, { ...layout, keys }, { fadeOthers: false }).pressed)).toEqual(["r7c5"]);
    // both: E is a resting key, so it wins over the thumb
    keys = altGrThumb(layout.keys.find((key) => key.id === "r5c3")!.chars);
    expect(marked(pictureFor("ą", polish, placement, { ...layout, keys }, { fadeOthers: false }).pressed)).toEqual(["r5c3"]);
  });

  it("prefers a resting key, then a thumb key, among several Shift or layer keys", () => {
    // layer 2 is reached by B (top row) and by S (a resting key): S is pressed
    const onLayer2 = new Map<string, PlaceOf>([["q", { key: "r4c5", layer: 2, via: "tap" }]]);
    expect(marked(pictureFor("q", onLayer2, placement, layout, { fadeOthers: false }).pressed)).toEqual(["r1c1"]);
    // the right-hand Shifts listed as the bottom-row Shift first, then I (hold), a resting key: I is pressed
    const capitals = new Map<string, PlaceOf>([["S", { key: "r1c1", layer: 0, via: "shift" }]]);
    const shiftsReversed = { ...layout, shiftKeys: [...layout.shiftKeys].reverse() };
    expect(marked(pictureFor("S", capitals, placement, shiftsReversed, { fadeOthers: false }).pressed)).toEqual(["r5c1"]);
    // no resting key among them: a thumb key, else the first listed
    const reachedBy = (keys: string[]) => ({
      ...layout, layers: layout.layers.map((l) => l.index === 2
        ? { ...l, reachedBy: keys.map((key) => ({ key, how: "hold" as const, label: `hold ${key}` })) } : l),
    });
    expect(marked(pictureFor("q", onLayer2, placement, reachedBy(["r0c3", "r3c3", "r2c1"]), { fadeOthers: false }).pressed))
      .toEqual(["r3c3"]);
    expect(marked(pictureFor("q", onLayer2, placement, reachedBy(["r0c3", "r2c1"]), { fadeOthers: false }).pressed))
      .toEqual(["r0c3"]);
    expect(nextKeyLabel({ key: "r4c5", layer: 2, via: "tap" }, reachedBy(["r0c3", "r3c3"]))).toBe("hold r3c3 → Q");
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
    // the way to a layer is the key the picture presses: S (a resting key), not B
    expect(nextKeyLabel({ key: "r4c5", layer: 2, via: "tap" }, layout)).toBe("hold S → Q");
  });

  it("names the way to a layer as the lesson's path when it has one", () => {
    expect(nextKeyLabel({ key: "r1c3", layer: 1, via: "tap", path: "hold the left thumb" }, layout))
      .toBe("hold the left thumb → (");
    expect(nextKeyLabel({ key: "r1c1", layer: 7, via: "shift", path: "tap Fn" }, layout)).toBe("tap Fn → Shift + S");
    // on layer 0 there is no way to name
    expect(nextKeyLabel({ key: "r1c1", layer: 0, via: "tap", path: "hold Space" }, layout)).toBe("S");
  });

  it("says what it can about a key or layer the export doesn't have", () => {
    expect(nextKeyLabel({ key: "r9c9", layer: 0, via: "tap" }, layout)).toBe("r9c9");
    expect(nextKeyLabel({ key: "r1c1", layer: 7, via: "tap" }, layout)).toBe("layer 7 → S");
  });

  it("keeps a letter whose capital isn't one character, and capitalises one outside ASCII", () => {
    const taps = (tap: string) => ({
      ...layout, keys: layout.keys.map((key) => key.id === "r1c1" ? { ...key, chars: { "0": { tap } } } : key),
    });
    // "ß".toUpperCase() is "SS"
    expect(nextKeyLabel({ key: "r1c1", layer: 0, via: "tap" }, taps("ß"))).toBe("ß");
    expect(nextKeyLabel({ key: "r1c1", layer: 0, via: "tap" }, taps("ą"))).toBe("Ą");
    expect(nextKeyLabel({ key: "r1c1", layer: 0, via: "shift" }, taps("ß"))).toBe("Shift + ß");
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
