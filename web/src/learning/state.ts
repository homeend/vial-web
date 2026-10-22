// A lesson's state for the list rows (design § 1), the pass and star rules (lesson-format.md § 4), and which set a
// listing opens.
import type { LessonSetSummary } from "../api/types";
import { tenths } from "./format";
import type { Attempt, Exercise, ExerciseKind, LearningSettings, Lesson, LessonSet, Progress } from "./types";

/** the exercises that count towards passing a lesson: the extras don't */
export const MAIN_KINDS: readonly ExerciseKind[] = ["new-keys", "keys", "words", "blind", "text"];

export const DEFAULT_SETTINGS: LearningSettings = { passAccuracy: 95, targetWpm: 30, pictureInWords: true };

export type PassSettings = Pick<LearningSettings, "passAccuracy" | "targetWpm">;

export function isMain(exercise: Exercise): boolean {
  return MAIN_KINDS.includes(exercise.kind);
}

export interface LessonStatus {
  /** main exercises finished at least once */
  done: number;
  /** main exercises in all */
  of: number;
  /** every main exercise has a best at the pass accuracy or above */
  passed: boolean;
  /** passed, and every best at the target WPM or above */
  star: boolean;
  /** the mean of the bests' accuracy over the main exercises that have one, one decimal; null with none */
  bestAccuracy: number | null;
  bestWpm: number | null;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : tenths(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Whether one attempt passed, and earned a star */
export function exerciseResult(attempt: Pick<Attempt, "accuracy" | "wpm">, settings: PassSettings): { passed: boolean; star: boolean } {
  const passed = attempt.accuracy >= settings.passAccuracy;
  return { passed, star: passed && attempt.wpm >= settings.targetWpm };
}

/** A lesson's row in the list: how many of its main exercises are done, whether it is passed (with a star), and the
 * mean of their best results */
export function lessonStatus(lesson: Lesson, progress: Progress | null | undefined, settings: PassSettings): LessonStatus {
  const main = lesson.exercises.filter(isMain);
  const records = main.map((exercise) => progress?.exercises[exercise.id]);
  const bests = records.flatMap((record) => (record?.best ? [record.best] : []));
  const done = records.filter((record) => record?.done || record?.best).length;
  const results = bests.map((best) => exerciseResult(best, settings));
  const passed = main.length > 0 && bests.length === main.length && results.every((r) => r.passed);
  return {
    done, of: main.length, passed, star: passed && results.every((r) => r.star),
    bestAccuracy: mean(bests.map((b) => b.accuracy)), bestWpm: mean(bests.map((b) => b.wpm)),
  };
}

/** The exercise after one: the next in its lesson, else the first of the next lesson that has an
 * exercise (an empty lesson is skipped), else null */
export function nextExercise(set: LessonSet, lessonId: string, exerciseId: string): { lessonId: string; exerciseId: string } | null {
  const l = set.lessons.findIndex((lesson) => lesson.id === lessonId);
  if (l === -1) return null;
  const lesson = set.lessons[l];
  const e = lesson.exercises.findIndex((exercise) => exercise.id === exerciseId);
  if (e === -1) return null;
  const after = lesson.exercises[e + 1];
  if (after) return { lessonId, exerciseId: after.id };
  for (const next of set.lessons.slice(l + 1)) {
    const first = next.exercises[0];
    if (first) return { lessonId: next.id, exerciseId: first.id };
  }
  return null;
}

/** Whether the set was built from another character map than the keyboard's export has now; false with no export */
export function outOfDate(set: LessonSet, exportHash: string | null | undefined): boolean {
  return !!exportHash && set.layout.hash !== exportHash;
}

/** The set to open from a listing: the one chosen if it is still listed and readable, else the first readable, else the
 * first listed (a broken file: its error shows, and it can be removed); null with none listed */
export function setToOpen(sets: LessonSetSummary[], chosen: string | null): string | null {
  if (chosen !== null && sets.some((s) => s.id === chosen && !s.error)) return chosen;
  return sets.find((s) => !s.error)?.id ?? sets[0]?.id ?? null;
}
