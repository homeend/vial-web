import { describe, expect, it } from "vitest";
import { hasAnyProgress } from "./state";
import type { Attempt, Progress } from "./types";

const attempt: Attempt = { at: "2026-10-22T07:40:12Z", chars: 228, errors: 3, accuracy: 98.7, wpm: 31.2, seconds: 88 };

function progress(exercises: Progress["exercises"]): Progress {
  return { format: "vial-web-progress/1", lessonSet: "corne-sim-en", exercises };
}

describe("hasAnyProgress", () => {
  it("is false with no progress, or none recorded", () => {
    expect(hasAnyProgress(null)).toBe(false);
    expect(hasAnyProgress(progress({}))).toBe(false);
    // done with neither a best nor an attempt: nothing a reset would change
    expect(hasAnyProgress(progress({ "01-n1": { done: true, best: null, attempts: [] } }))).toBe(false);
  });

  it("is true with a best only", () => {
    expect(hasAnyProgress(progress({ "01-n1": { done: true, best: attempt, attempts: [] } }))).toBe(true);
  });

  it("is true with attempts only", () => {
    expect(hasAnyProgress(progress({ "01-n1": { done: false, attempts: [attempt] } }))).toBe(true);
  });
});
