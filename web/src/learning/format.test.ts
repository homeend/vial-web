import { describe, expect, it } from "vitest";
import {
  bestText, clockText, exportFileName, lessonStateText, listedErrors, passText, resultLines, statusText,
} from "./format";
import type { LessonStatus } from "./state";

const status = (over: Partial<LessonStatus>): LessonStatus =>
  ({ done: 0, of: 7, passed: false, star: false, bestAccuracy: null, bestWpm: null, ...over });

describe("lessonStateText", () => {
  it("says passed with a star, passed, how many are done, or nothing", () => {
    expect(lessonStateText(status({ done: 7, passed: true, star: true, bestAccuracy: 98.4, bestWpm: 34.2 })))
      .toBe("★ passed · 98 % · 34 wpm");
    expect(lessonStateText(status({ done: 7, passed: true, bestAccuracy: 96, bestWpm: 27.5 }))).toBe("passed · 96 % · 28 wpm");
    expect(lessonStateText(status({ done: 3, of: 10 }))).toBe("3 of 10 done");
    expect(lessonStateText(status({}))).toBe("");
  });
});

describe("bestText and statusText", () => {
  it("show one decimal of accuracy and whole words per minute", () => {
    expect(bestText({ accuracy: 99.1, wpm: 31.4 })).toBe("99.1 % · 31 wpm");
    expect(bestText(null)).toBe("—");
    expect(statusText({ typed: 23, of: 312, errors: 1, accuracy: 99.1, wpm: 31.2, seconds: 48 }))
      .toBe("23 of 312 · 1 error · 99.1 % · 31 wpm · 0:48");
    expect(statusText({ typed: 0, of: 312, errors: 0, accuracy: 100, wpm: 0, seconds: 0 }))
      .toBe("0 of 312 · 0 errors · 100.0 % · 0 wpm · 0:00");
    expect(statusText({ typed: 9, of: 312, errors: 2, accuracy: 77.8, wpm: 12.5, seconds: 20 }))
      .toBe("9 of 312 · 2 errors · 77.8 % · 13 wpm · 0:20");
  });
});

describe("clockText", () => {
  it("is minutes and two digits of seconds", () => {
    expect(clockText(0)).toBe("0:00");
    expect(clockText(65)).toBe("1:05");
    expect(clockText(725)).toBe("12:05");
    expect(clockText(3600)).toBe("60:00");
  });
});

describe("the result card", () => {
  it("lists accuracy, speed, time and errors, and says whether it passed", () => {
    expect(resultLines({ chars: 228, errors: 3, accuracy: 98.7, wpm: 31.2, seconds: 88 })).toEqual([
      { label: "Accuracy", value: "98.7 %" }, { label: "Speed", value: "31.2 wpm" }, { label: "Time", value: "1:28" },
      { label: "Errors", value: "3" },
    ]);
    expect(resultLines({ chars: 228, errors: 0, accuracy: 100, wpm: 31.2, seconds: 88 })[3]).toEqual({ label: "Errors", value: "0" });
    expect(passText(true, 95)).toBe("Passed");
    expect(passText(false, 95)).toBe("Not passed (needs ≥ 95 %)");
  });
});

describe("listedErrors", () => {
  it("shows at most ten, then how many more", () => {
    const errors = Array.from({ length: 13 }, (_, i) => `error ${i + 1}`);
    expect(listedErrors(errors.slice(0, 10))).toHaveLength(10);
    const listed = listedErrors(errors);
    expect(listed).toHaveLength(11);
    expect(listed[10]).toBe("and 3 more");
    expect(listedErrors(errors.slice(0, 11))).toEqual([...errors.slice(0, 10), "and 1 more"]);
    expect(listedErrors(errors, 2)).toEqual(["error 1", "error 2", "and 11 more"]);
    expect(listedErrors(errors.slice(0, 2), 2)).toEqual(["error 1", "error 2"]);
  });
});

describe("exportFileName", () => {
  it("names the download after the keyboard, without characters file systems refuse", () => {
    expect(exportFileName("Simulated Corne")).toBe("Simulated Corne-layout-export.json");
    expect(exportFileName("W-CORNE: v2/3")).toBe("W-CORNE_ v2_3-layout-export.json");
    expect(exportFileName("")).toBe("keyboard-layout-export.json");
    expect(exportFileName("k".repeat(150))).toBe(`${"k".repeat(100)}-layout-export.json`);
  });
});
