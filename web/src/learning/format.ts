// The Learning page's texts: a lesson row's state, an exercise's best, the status line while typing, the result card.
import type { Result, TypingProgress } from "./engine";
import type { LessonStatus } from "./state";
import { safeFileName } from "../lib/fileName";
import type { Attempt } from "./types";

/** rounded to one decimal: 66.66 → 66.7 */
export function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "0:48", "12:05"; minutes keep counting past an hour ("60:00" for 3600 s) */
export function clockText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Words per minute, whole: "31" */
function wholeWpm(value: number): string {
  return String(Math.round(value));
}

/** "98 %" (whole percents, for a lesson row) */
function percent(value: number): string {
  return `${Math.round(value)} %`;
}

/** "99.1 %" (one decimal, for one attempt) */
function percentTenths(value: number): string {
  return `${value.toFixed(1)} %`;
}

/** A lesson row's state: "★ passed · 98 % · 34 wpm", "passed · 96 % · 27 wpm", "3 of 10 done", or "" before anything
 * was typed */
export function lessonStateText(status: LessonStatus): string {
  if (status.passed) {
    const numbers = `${percent(status.bestAccuracy ?? 0)} · ${wholeWpm(status.bestWpm ?? 0)} wpm`;
    return `${status.star ? "★ " : ""}passed · ${numbers}`;
  }
  return status.done > 0 ? `${status.done} of ${status.of} done` : "";
}

/** An exercise's best: "99.1 % · 31 wpm", or "—" with none */
export function bestText(best: Pick<Attempt, "accuracy" | "wpm"> | null | undefined): string {
  return best ? `${percentTenths(best.accuracy)} · ${wholeWpm(best.wpm)} wpm` : "—";
}

/** The status line while typing: "23 of 312 · 1 error · 99.1 % · 31 wpm · 0:48" */
export function statusText(progress: TypingProgress): string {
  const errors = `${progress.errors} ${progress.errors === 1 ? "error" : "errors"}`;
  return [`${progress.typed} of ${progress.of}`, errors, percentTenths(progress.accuracy), `${wholeWpm(progress.wpm)} wpm`,
    clockText(progress.seconds)].join(" · ");
}

/** The result card's lines: accuracy, speed, time, errors */
export function resultLines(result: Result): { label: string; value: string }[] {
  return [
    { label: "Accuracy", value: percentTenths(result.accuracy) },
    { label: "Speed", value: `${result.wpm.toFixed(1)} wpm` },
    { label: "Time", value: clockText(result.seconds) },
    { label: "Errors", value: String(result.errors) },
  ];
}

/** "Passed" or "Not passed (needs ≥ 95 %)" */
export function passText(passed: boolean, passAccuracy: number): string {
  return passed ? "Passed" : `Not passed (needs ≥ ${passAccuracy} %)`;
}

/** The checker's findings as the import shows them: at most `max` lines, then "and n more" */
export function listedErrors(errors: string[], max = 10): string[] {
  if (errors.length <= max) return errors;
  const more = errors.length - max;
  return [...errors.slice(0, max), `and ${more} more`];
}

/** "Simulated Corne-layout-export.json": the keyboard's name, made safe for file systems */
export function exportFileName(keyboardName: string): string {
  return `${safeFileName(keyboardName)}-layout-export.json`;
}
