import { describe, expect, it } from "vitest";
import setJson from "../../../docs/learning/examples/corne-sim-en.json";
import type { LessonSetSummary } from "../api/types";
import {
  DEFAULT_SETTINGS, exerciseResult, isMain, lessonStatus, MAIN_KINDS, nextExercise, outOfDate, setToOpen,
} from "./state";
import { readLessonSet, type Attempt, type Progress } from "./types";

const set = readLessonSet(setJson);
const [lesson1, lesson2] = set.lessons;
const settings = { passAccuracy: 95, targetWpm: 30 };

const attempt = (accuracy: number, wpm: number): Attempt =>
  ({ at: "2026-10-22T07:40:12Z", chars: 228, errors: 3, accuracy, wpm, seconds: 88 });

/** progress with a best for each exercise id given */
function progress(bests: Record<string, [accuracy: number, wpm: number]>): Progress {
  const exercises: Progress["exercises"] = {};
  for (const [id, [accuracy, wpm]] of Object.entries(bests)) {
    exercises[id] = { done: true, best: attempt(accuracy, wpm), attempts: [attempt(accuracy, wpm)] };
  }
  return { format: "vial-web-progress/1", lessonSet: set.id, layoutHash: set.layout.hash, exercises };
}

describe("MAIN_KINDS", () => {
  it("are the ten exercises of a lesson, not the extras", () => {
    expect(MAIN_KINDS).toEqual(["new-keys", "keys", "words", "blind", "text"]);
    expect(isMain({ id: "x", kind: "extra-keys", title: "", lines: ["a"] })).toBe(false);
    expect(isMain({ id: "x", kind: "blind", title: "", lines: ["a"] })).toBe(true);
    expect(DEFAULT_SETTINGS).toEqual({ passAccuracy: 95, targetWpm: 30, pictureInWords: true });
  });
});

describe("lessonStatus", () => {
  it("is empty without progress", () => {
    expect(lessonStatus(lesson1, null, settings))
      .toEqual({ done: 0, of: 7, passed: false, star: false, bestAccuracy: null, bestWpm: null });
    expect(lessonStatus(lesson2, progress({}), settings).of).toBe(10);
  });

  it("counts the main exercises done, with the mean of their bests", () => {
    const status = lessonStatus(lesson1, progress({ "01-n1": [98.7, 31.2], "01-k1": [96.1, 25] }), settings);
    expect(status).toEqual({ done: 2, of: 7, passed: false, star: false, bestAccuracy: 97.4, bestWpm: 28.1 });
  });

  it("is passed when every main exercise reached the pass accuracy, and starred at the target WPM too", () => {
    const all = Object.fromEntries(lesson1.exercises.map((e) => [e.id, [97, 31] as [number, number]]));
    expect(lessonStatus(lesson1, progress(all), settings)).toMatchObject({ done: 7, passed: true, star: true });
    expect(lessonStatus(lesson1, progress({ ...all, "01-w1": [97, 29.9] }), settings))
      .toMatchObject({ passed: true, star: false });
    expect(lessonStatus(lesson1, progress({ ...all, "01-n2": [94.9, 40] }), settings))
      .toMatchObject({ done: 7, passed: false, star: false });
    // exactly the threshold passes; the settings decide
    expect(lessonStatus(lesson1, progress({ ...all, "01-n2": [95, 30] }), settings)).toMatchObject({ passed: true, star: true });
    expect(lessonStatus(lesson1, progress(all), { passAccuracy: 98, targetWpm: 30 })).toMatchObject({ passed: false });
  });

  it("leaves the extras out, and a finished exercise with no best counts as done", () => {
    const withExtra = { ...lesson1, exercises: [...lesson1.exercises,
      { id: "01-x1", kind: "extra-keys" as const, title: "Extra key exercise", lines: ["sa sa"] }] };
    const all = Object.fromEntries(lesson1.exercises.map((e) => [e.id, [97, 31] as [number, number]]));
    const p = progress({ ...all, "01-x1": [10, 1] });
    expect(lessonStatus(withExtra, p, settings)).toEqual({ done: 7, of: 7, passed: true, star: true, bestAccuracy: 97, bestWpm: 31 });
    const noBest = progress({});
    noBest.exercises["01-n1"] = { done: true, attempts: [] };
    expect(lessonStatus(lesson1, noBest, settings)).toMatchObject({ done: 1, passed: false, bestAccuracy: null });
  });

  it("takes best: null as no best, and a progress without layoutHash", () => {
    const p: Progress = { format: "vial-web-progress/1", lessonSet: set.id, exercises: {
      "01-n1": { done: true, best: null, attempts: [] }, "01-k1": { done: false, best: attempt(96, 20), attempts: [] } } };
    expect(p.layoutHash).toBeUndefined();
    expect(lessonStatus(lesson1, p, settings))
      .toEqual({ done: 2, of: 7, passed: false, star: false, bestAccuracy: 96, bestWpm: 20 });
    const nulled: Progress = { ...p, layoutHash: null };
    expect(lessonStatus(lesson1, nulled, settings).done).toBe(2);
  });

  it("isn't passed with nothing to pass", () => {
    expect(lessonStatus({ ...lesson1, exercises: [] }, progress({}), settings))
      .toEqual({ done: 0, of: 0, passed: false, star: false, bestAccuracy: null, bestWpm: null });
  });
});

describe("exerciseResult", () => {
  it("says whether one attempt passed, and earned a star", () => {
    expect(exerciseResult(attempt(98.7, 31.2), settings)).toEqual({ passed: true, star: true });
    expect(exerciseResult(attempt(95, 29.9), settings)).toEqual({ passed: true, star: false });
    expect(exerciseResult(attempt(94.9, 50), settings)).toEqual({ passed: false, star: false });
  });
});

describe("nextExercise", () => {
  it("is the next in the lesson, then the first of the next lesson, then nothing", () => {
    expect(nextExercise(set, "01", "01-n1")).toEqual({ lessonId: "01", exerciseId: "01-n2" });
    expect(nextExercise(set, "01", "01-w1")).toEqual({ lessonId: "02", exerciseId: "02-n1" });
    expect(nextExercise(set, "02", "02-t2")).toBeNull();
  });

  it("skips a lesson without exercises", () => {
    const [a, b, c] = [lesson1, lesson2, lesson2];
    const gappy = { ...set, lessons: [a, { ...b, id: "empty", exercises: [] }, { ...c, id: "later" }] };
    expect(nextExercise(gappy, "01", "01-w1")).toEqual({ lessonId: "later", exerciseId: "02-n1" });
    const tail = { ...set, lessons: [a, { ...b, id: "empty", exercises: [] }] };
    expect(nextExercise(tail, "01", "01-w1")).toBeNull();
  });

  it("is nothing for a lesson or exercise the set doesn't have", () => {
    expect(nextExercise(set, "09", "01-n1")).toBeNull();
    expect(nextExercise(set, "01", "02-n1")).toBeNull();
  });
});

describe("outOfDate", () => {
  it("is when the set was built from another character map", () => {
    expect(outOfDate(set, "sha256:e435c3da038f9048")).toBe(false);
    expect(outOfDate(set, "sha256:0000000000000000")).toBe(true);
    // no export to compare with: nothing to say
    expect(outOfDate(set, null)).toBe(false);
  });
});

describe("setToOpen", () => {
  const entry = (id: string, error: string | null = null): LessonSetSummary =>
    ({ id, title: id, language: "en", lessons: 2, layoutHash: null, outOfDate: false, error });
  const listed = [entry("broken", "not a JSON file"), entry("first"), entry("second")];

  it("is the set chosen when it is listed and readable", () => {
    expect(setToOpen(listed, "second")).toBe("second");
  });

  it("is the first readable when the one chosen is gone or can't be read", () => {
    expect(setToOpen(listed, "gone")).toBe("first");
    expect(setToOpen(listed, "broken")).toBe("first");
    expect(setToOpen(listed, null)).toBe("first");
  });

  it("is the first listed when none can be read, so that its error shows; null with none listed", () => {
    expect(setToOpen([entry("a", "bad"), entry("b", "worse")], "b")).toBe("a");
    expect(setToOpen([], "second")).toBeNull();
    expect(setToOpen([], null)).toBeNull();
  });
});
