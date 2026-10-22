import { describe, expect, it } from "vitest";
import set from "../../../docs/learning/examples/corne-sim-en.json";
import layout from "../../../docs/learning/examples/corne-sim-layout-export.json";
import { readLayoutExport, readLessonSet } from "./types";

describe("readLessonSet", () => {
  it("reads the worked example", () => {
    const read = readLessonSet(set);
    expect(read.id).toBe("corne-sim-en");
    expect(read.lessons).toHaveLength(2);
    expect(read.lessons[0].exercises[0].kind).toBe("new-keys");
    expect(read.lessons[0].new[0]).toEqual({ char: "s", key: "r1c1", layer: 0, via: "tap" });
  });

  it("says what is wrong with a file that isn't a lesson set", () => {
    expect(() => readLessonSet(null)).toThrow("not a lesson set");
    expect(() => readLessonSet("text")).toThrow("not a lesson set");
    expect(() => readLessonSet({ ...set, format: "vial-web-lessons/2" })).toThrow("format");
    expect(() => readLessonSet({ ...set, id: "" })).toThrow("id");
    expect(() => readLessonSet({ ...set, id: "bad id!" })).toThrow("id");
    expect(() => readLessonSet({ ...set, id: "-leading" })).toThrow("id");
    expect(() => readLessonSet({ ...set, id: "x".repeat(65) })).toThrow("id");
    expect(readLessonSet({ ...set, id: "x".repeat(64) }).id).toBe("x".repeat(64));
    expect(() => readLessonSet({ ...set, lessons: {} })).toThrow("lessons");
    expect(() => readLessonSet({ ...set, lessons: [] })).toThrow("no lessons");
    expect(() => readLessonSet({ ...set, lessons: [{ id: "01" }] })).toThrow("lesson 01");
    const lesson = set.lessons[0];
    expect(() => readLessonSet({ ...set, lessons: [{ ...lesson, exercises: [] }] })).toThrow("lesson 01 has no exercises");
    for (const bad of [{}, { char: "" }, { char: "ab" }, { char: 7 }, "s"]) {
      expect(() => readLessonSet({ ...set, lessons: [{ ...lesson, new: [bad] }] })).toThrow("lesson 01: each entry of new");
    }
    // a review lesson adds nothing; a character outside the BMP is still one character
    expect(readLessonSet({ ...set, lessons: [{ ...lesson, new: [] }] }).lessons[0].new).toEqual([]);
    expect(readLessonSet({ ...set, lessons: [{ ...lesson, new: [{ char: "𝄞" }] }] }).lessons[0].new).toEqual([{ char: "𝄞" }]);
    expect(() => readLessonSet({ ...set, lessons: [{ ...lesson, exercises: [{ id: "x" }] }] }))
      .toThrow("exercise x");
    expect(() => readLessonSet({ ...set, lessons: [{ ...lesson, exercises: [{ id: "x", kind: "song", lines: ["a"] }] }] }))
      .toThrow("kind");
    expect(() => readLessonSet({ ...set, lessons: [{ ...lesson, exercises: [{ id: "x", kind: "text", lines: [] }] }] }))
      .toThrow("lines");
    expect(() => readLessonSet({ ...set, lessons: [{ ...lesson, exercises: [{ id: "x", kind: "text", lines: [3] }] }] }))
      .toThrow("lines");
  });
});

describe("readLayoutExport", () => {
  it("reads the worked example", () => {
    const read = readLayoutExport(layout);
    expect(read.format).toBe("vial-web-layout-export/1");
    expect(read.hash).toBe(layout.hash);
    expect(read.layers).toHaveLength(4);
    expect(read.shiftKeys[0]).toEqual({ key: "r1c4", hand: "left", label: "T (hold)" });
    expect(read.keys[0].id).toBe("r0c0");
  });

  it("says what is wrong with a reply that isn't a layout export", () => {
    expect(() => readLayoutExport(null)).toThrow("not a layout export");
    expect(() => readLayoutExport([])).toThrow("not a layout export");
    expect(() => readLayoutExport({ ...layout, format: "vial-web-layout-export/2" })).toThrow("format");
    expect(() => readLayoutExport({ ...layout, hash: 7 })).toThrow("hash");
    expect(() => readLayoutExport({ ...layout, layers: {} })).toThrow("layers");
    expect(() => readLayoutExport({ ...layout, shiftKeys: null })).toThrow("shiftKeys");
    expect(() => readLayoutExport({ ...layout, keys: "r0c0" })).toThrow("keys");
    expect(() => readLayoutExport({ ...layout, keys: [layout.keys[0], { hand: "left" }] })).toThrow("key 2");
    expect(() => readLayoutExport({ ...layout, keys: ["r0c0"] })).toThrow("key 1");
    expect(readLayoutExport({ ...layout, keys: [] }).keys).toEqual([]);
  });
});
