// The typing engine: what an exercise expects, what was typed so far, the errors, and the result. Pure: no DOM, no
// clock (the caller passes `now` in milliseconds), and every press makes a new state.
//
// A group or word exercise is its lines joined by one space, typed character by character, spaces included. A text
// exercise keeps its lines apart: each line but the last ends with Enter (a "\n" among the expected characters). A wrong
// key counts an error and the position stays until the right key comes (Backspace only clears the mark). Backspace
// otherwise goes back one character, but never past the start of the current group, word or line (R4 of
// course-method.md): a space or a line end ends a group. Going back doesn't take an error away.
import type { Exercise } from "./types";

/** the key of a line's end in a text exercise, typed with Enter */
export const LINE_END = "\n";

export interface EngineState {
  /** the characters to type, in order; LINE_END for a text line's end */
  readonly expected: readonly string[];
  /** index of the next character */
  readonly position: number;
  /** wrong keys pressed so far, corrected ones included */
  readonly errors: number;
  /** a wrong key is shown at the position, not yet corrected */
  readonly wrongNow: boolean;
  /** that wrong key, or null */
  readonly wrong: string | null;
  /** `now` of the first press; null before */
  readonly startedAt: number | null;
  /** `now` of the press that typed the last character; null before */
  readonly finishedAt: number | null;
  /** the last character is typed */
  readonly done: boolean;
}

/** The characters an exercise expects: its lines joined by one space, or kept apart by LINE_END for a text exercise */
export function expectedOf(exercise: Exercise): string[] {
  const separator = exercise.kind === "text" ? LINE_END : " ";
  return Array.from(exercise.lines.join(separator));
}

export function createEngine(exercise: Exercise): EngineState {
  return {
    expected: expectedOf(exercise), position: 0, errors: 0, wrongNow: false, wrong: null, startedAt: null,
    finishedAt: null, done: false,
  };
}

/** where the group, word or line the position is in starts: just after the last separator before it */
function groupStart(expected: readonly string[], position: number): number {
  for (let i = position - 1; i >= 0; i--) {
    if (expected[i] === " " || expected[i] === LINE_END) return i + 1;
  }
  return 0;
}

/** `key` is one character, "Backspace" or "Enter" (a text line's end); any other key changes nothing. `now` is the
 * press's time in milliseconds (performance.now() or Date.now(), the same throughout) */
export function press(state: EngineState, key: string, now: number): EngineState {
  if (state.done) return state;
  const char = key === "Enter" ? LINE_END : key;
  if (char !== "Backspace" && Array.from(char).length !== 1) return state;
  const startedAt = state.startedAt ?? now;
  if (char === "Backspace") {
    if (state.wrongNow) return { ...state, startedAt, wrongNow: false, wrong: null };
    const position = Math.max(state.position - 1, groupStart(state.expected, state.position));
    return { ...state, startedAt, position };
  }
  if (char !== state.expected[state.position]) {
    return { ...state, startedAt, errors: state.errors + 1, wrongNow: true, wrong: key };
  }
  const position = state.position + 1;
  const done = position === state.expected.length;
  return { ...state, startedAt, position, wrongNow: false, wrong: null, done, finishedAt: done ? now : null };
}

export interface Result {
  /** characters the exercise expects (a text line's Enter is one) */
  chars: number;
  errors: number;
  /** 100 · (chars − errors) / chars, one decimal, never below 0 */
  accuracy: number;
  /** chars / 5 per minute, one decimal */
  wpm: number;
  /** from the first press to the last, whole seconds */
  seconds: number;
}

function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function accuracyOf(chars: number, errors: number): number {
  return chars === 0 ? 100 : Math.max(0, tenths((100 * (chars - errors)) / chars));
}

function wpmOf(chars: number, ms: number): number {
  return ms <= 0 ? 0 : tenths(chars / 5 / (ms / 60_000));
}

/** The result of a finished exercise, as the progress file records it; throws before the end */
export function resultOf(state: EngineState): Result {
  if (!state.done || state.startedAt === null || state.finishedAt === null) throw new Error("the exercise is not finished");
  const chars = state.expected.length;
  const ms = state.finishedAt - state.startedAt;
  return { chars, errors: state.errors, accuracy: accuracyOf(chars, state.errors), wpm: wpmOf(chars, ms),
    seconds: Math.round(ms / 1000) };
}

export interface Progress {
  /** characters typed so far */
  typed: number;
  /** characters in all */
  of: number;
  errors: number;
  /** over the characters typed so far; 100 before the first */
  accuracy: number;
  wpm: number;
  /** since the first press, whole seconds; the clock stops at the end */
  seconds: number;
}

/** The status line's numbers while typing, at `now` */
export function progressOf(state: EngineState, now: number): Progress {
  const end = state.finishedAt ?? now;
  const ms = state.startedAt === null ? 0 : end - state.startedAt;
  return {
    typed: state.position, of: state.expected.length, errors: state.errors,
    accuracy: accuracyOf(state.position, state.errors), wpm: wpmOf(state.position, ms), seconds: Math.round(ms / 1000),
  };
}

export type SegmentStatus = "typed" | "wrong" | "next" | "todo";

export interface Segment {
  text: string;
  status: SegmentStatus;
  /** a text line's end: the run is its LINE_END, and the line breaks after it */
  lineBreak?: boolean;
}

/** The expected text as runs for the view: the typed part, the wrong character (the expected one, to be shown struck
 * out), the next character (to be underlined), the rest; a text line's end as a run of its own */
export function segments(state: EngineState): Segment[] {
  const runs: Segment[] = [];
  state.expected.forEach((char, i) => {
    const status: SegmentStatus = i < state.position ? "typed"
      : i > state.position ? "todo" : state.wrongNow ? "wrong" : "next";
    const last = runs[runs.length - 1];
    if (char === LINE_END) runs.push({ text: char, status, lineBreak: true });
    else if (last && !last.lineBreak && last.status === status) last.text += char;
    else runs.push({ text: char, status });
  });
  return runs;
}
