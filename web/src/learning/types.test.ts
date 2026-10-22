import { describe, expect, it } from "vitest";
import set from "../../../docs/learning/examples/corne-sim-en.json";
import { readLessonSet } from "./types";

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
    expect(() => readLessonSet({ ...set, lessons: {} })).toThrow("lessons");
    expect(() => readLessonSet({ ...set, lessons: [{ id: "01" }] })).toThrow("lesson 01");
    const lesson = set.lessons[0];
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
