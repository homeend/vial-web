import { describe, expect, it } from "vitest";
import { createEngine, expectedOf, LINE_END, press, progressOf, resultOf, segments, type EngineState } from "./engine";
import type { Exercise } from "./types";

const groups: Exercise = { id: "01-n1", kind: "new-keys", title: "New key exercise 1", lines: ["sa sa", "ei ei"] };
const text: Exercise = { id: "02-t1", kind: "text", title: "Text exercise 1", lines: ["the sea", "a tide"] };

/** the state after typing `keys` one by one, a second apart from `from` */
function type(state: EngineState, keys: string[], from = 1000): EngineState {
  return keys.reduce((s, key, i) => press(s, key, from + i * 1000), state);
}

describe("createEngine", () => {
  it("joins the lines of a group or word exercise with one space", () => {
    expect(expectedOf(groups).join("")).toBe("sa sa ei ei");
    const state = createEngine(groups);
    expect(state.position).toBe(0);
    expect(state.done).toBe(false);
    expect(state.errors).toBe(0);
    expect(state.startedAt).toBeNull();
  });

  it("keeps the lines of a text exercise apart, each but the last ended by Enter", () => {
    expect(expectedOf(text)).toEqual([..."the sea", "\n", ..."a tide"]);
  });

  it("gives a one-line text exercise no line end", () => {
    const oneLine: Exercise = { id: "x", kind: "text", title: "", lines: ["the sea"] };
    expect(expectedOf(oneLine)).toEqual([..."the sea"]);
    expect(expectedOf(oneLine)).not.toContain(LINE_END);
    const state = type(createEngine(oneLine), [..."the sea"]);
    expect(state.done).toBe(true);
    expect(segments(state).some((s) => s.lineBreak)).toBe(false);
  });
});

describe("press", () => {
  it("types a group exercise through, timing from the first press", () => {
    let state = createEngine(groups);
    state = press(state, "s", 5000);
    expect(state.startedAt).toBe(5000);
    expect(state.position).toBe(1);
    state = type(state, [..."a sa ei e"], 6000);
    expect(state.position).toBe(10);
    expect(state.done).toBe(false);
    expect(state.finishedAt).toBeNull();
    state = press(state, "i", 20000);
    expect(state.done).toBe(true);
    expect(state.finishedAt).toBe(20000);
    expect(state.errors).toBe(0);
    // nothing more happens after the end
    expect(press(state, "x", 21000)).toBe(state);
  });

  it("types a text exercise, Enter ending a line", () => {
    let state = type(createEngine(text), [..."the sea"]);
    expect(state.position).toBe(7);
    state = press(state, " ", 9000);
    expect(state.errors).toBe(1);
    expect(state.wrongNow).toBe(true);
    expect(state.position).toBe(7);
    state = press(state, "Enter", 10000);
    expect(state.position).toBe(8);
    expect(state.wrongNow).toBe(false);
    state = type(state, [..."a tide"], 11000);
    expect(state.done).toBe(true);
    expect(state.errors).toBe(1);
  });

  it("counts a wrong character, and stays until the right one comes", () => {
    let state = type(createEngine(groups), ["s", "x"]);
    expect(state.errors).toBe(1);
    expect(state.position).toBe(1);
    expect(state.wrongNow).toBe(true);
    expect(state.wrong).toBe("x");
    state = press(state, "y", 3000);
    expect(state.errors).toBe(2);
    expect(state.position).toBe(1);
    state = press(state, "a", 4000);
    expect(state.errors).toBe(2);
    expect(state.position).toBe(2);
    expect(state.wrongNow).toBe(false);
    expect(state.wrong).toBeNull();
  });

  it("counts a space typed as the wrong key", () => {
    const state = type(createEngine(groups), [" "]);
    expect(state.errors).toBe(1);
    expect(state.position).toBe(0);
  });

  it("clears a wrong mark with Backspace, keeping the error", () => {
    let state = type(createEngine(groups), ["s", "x"]);
    state = press(state, "Backspace", 3000);
    expect(state.wrongNow).toBe(false);
    expect(state.position).toBe(1);
    expect(state.errors).toBe(1);
  });

  it("goes back within a group with Backspace, but not past the group's start", () => {
    let state = type(createEngine(groups), [..."sa s"]);
    expect(state.position).toBe(4);
    state = press(state, "Backspace", 5000);
    expect(state.position).toBe(3);
    // the start of "sa" (the second group): stays
    state = press(state, "Backspace", 6000);
    expect(state.position).toBe(3);
    expect(state.errors).toBe(0);
    // at the very start too
    expect(press(createEngine(groups), "Backspace", 1000).position).toBe(0);
  });

  it("doesn't go back past a line's start in a text exercise", () => {
    let state = type(createEngine(text), [..."the sea", "Enter", "a"]);
    expect(state.position).toBe(9);
    state = press(state, "Backspace", 10000);
    expect(state.position).toBe(8);
    state = press(state, "Backspace", 11000);
    expect(state.position).toBe(8);
  });

  it("starts the clock on a Backspace too, and ignores keys it doesn't know", () => {
    let state = press(createEngine(groups), "Backspace", 700);
    expect(state.startedAt).toBe(700);
    expect(press(state, "Shift", 800)).toBe(state);
    expect(press(state, "Tab", 800)).toBe(state);
    expect(press(createEngine(groups), "ArrowLeft", 1).startedAt).toBeNull();
  });

  it("starts the clock on a first press that is wrong", () => {
    const state = press(createEngine(groups), "x", 700);
    expect(state.startedAt).toBe(700);
    expect(state.errors).toBe(1);
    expect(state.wrongNow).toBe(true);
    expect(state.position).toBe(0);
    // the clock doesn't restart on the right key
    expect(press(state, "s", 900).startedAt).toBe(700);
  });

  it("counts Enter in a group exercise as a wrong key, the position staying", () => {
    let state = type(createEngine(groups), [..."sa"]);
    state = press(state, "Enter", 3000);
    expect(state.errors).toBe(1);
    expect(state.position).toBe(2);
    expect(state.wrongNow).toBe(true);
    expect(state.wrong).toBe("Enter");
    state = press(state, " ", 4000);
    expect(state.position).toBe(3);
    expect(state.errors).toBe(1);
  });

  it("clears the wrong mark with one Backspace and goes back within the word with the next", () => {
    let state = type(createEngine(groups), [..."sa s", "x"]);
    expect(state.position).toBe(4);
    expect(state.wrongNow).toBe(true);
    state = press(state, "Backspace", 6000);
    expect(state.wrongNow).toBe(false);
    expect(state.wrong).toBeNull();
    expect(state.position).toBe(4);
    state = press(state, "Backspace", 7000);
    expect(state.position).toBe(3);
    expect(state.wrongNow).toBe(false);
    expect(state.errors).toBe(1);
  });

  it("types characters outside ASCII and the basic plane", () => {
    const wide: Exercise = { id: "x", kind: "keys", title: "", lines: ["ą😀"] };
    expect(expectedOf(wide)).toEqual(["ą", "😀"]);
    let state = press(createEngine(wide), "ą", 1000);
    expect(state.position).toBe(1);
    expect(state.errors).toBe(0);
    state = press(state, "😀", 2000);
    expect(state.done).toBe(true);
    expect(state.errors).toBe(0);
    expect(resultOf(state).chars).toBe(2);
    expect(segments(state)).toEqual([{ text: "ą😀", status: "typed" }]);
  });

  it("doesn't change the state it is given", () => {
    const before = createEngine(groups);
    const snapshot = structuredClone(before);
    let state = press(before, "s", 1000);
    state = press(state, "x", 2000);
    state = press(state, "Backspace", 3000);
    state = press(state, "a", 4000);
    expect(before).toEqual(snapshot);
    expect(before.position).toBe(0);
    expect(before.expected).toEqual(snapshot.expected);
    const mid = type(createEngine(groups), ["s", "x"]);
    const midSnapshot = structuredClone(mid);
    press(mid, "Backspace", 3000);
    press(mid, "a", 3000);
    expect(mid).toEqual(midSnapshot);
  });
});

describe("resultOf", () => {
  it("has the chars, errors, accuracy, wpm and seconds of a finished exercise", () => {
    // 300 characters, 3 errors, 120 s
    const long: Exercise = { id: "x", kind: "keys", title: "", lines: ["a".repeat(300)] };
    let state = createEngine(long);
    state = press(state, "a", 0);
    state = type(state, ["b", "b", "b"], 100);
    state = type(state, Array(298).fill("a"), 1000);
    expect(state.done).toBe(false);
    state = press(state, "a", 120_000);
    expect(resultOf(state)).toEqual({ chars: 300, errors: 3, accuracy: 99, wpm: 30, seconds: 120 });
  });

  it("rounds to one decimal, and never says less than 0 %", () => {
    const short: Exercise = { id: "x", kind: "keys", title: "", lines: ["abc"] };
    let state = type(createEngine(short), ["a", "x", "x", "x", "x", "b", "c"], 0);
    // 3 chars, 4 errors, 6 s
    expect(resultOf(state)).toEqual({ chars: 3, errors: 4, accuracy: 0, wpm: 6, seconds: 6 });
    state = type(createEngine(short), ["a", "x", "b", "c"], 0);
    // 2 of 3 right: 66.7 %, 3 s
    expect(resultOf(state)).toEqual({ chars: 3, errors: 1, accuracy: 66.7, wpm: 12, seconds: 3 });
  });

  it("counts the Enter of a text line as a character", () => {
    const state = type(createEngine(text), [..."the sea", "Enter", ..."a tide"], 0);
    expect(resultOf(state).chars).toBe(14);
  });

  it("needs a finished exercise", () => {
    expect(() => resultOf(createEngine(groups))).toThrow("not finished");
    expect(() => resultOf(type(createEngine(groups), ["s"]))).toThrow("not finished");
  });

  it("says 0 wpm, not Infinity or NaN, when no time passed", () => {
    const one: Exercise = { id: "x", kind: "keys", title: "", lines: ["a"] };
    const state = press(createEngine(one), "a", 1000);
    expect(state.startedAt).toBe(state.finishedAt);
    const result = resultOf(state);
    expect(result).toEqual({ chars: 1, errors: 0, accuracy: 100, wpm: 0, seconds: 0 });
    expect(Number.isFinite(result.wpm)).toBe(true);
    expect(progressOf(state, 1000).wpm).toBe(0);
    // and while typing, before the first second passed by the same clock reading
    expect(progressOf(press(createEngine(groups), "s", 1000), 1000).wpm).toBe(0);
  });
});

describe("progressOf", () => {
  it("is the status line's numbers while typing", () => {
    expect(progressOf(createEngine(groups), 5000)).toEqual({ typed: 0, of: 11, errors: 0, accuracy: 100, wpm: 0, seconds: 0 });
    let state = type(createEngine(groups), ["s", "x", "a", " ", "s"], 0);
    // 4 typed of 11 (the x didn't count), 1 error, 4 s: 75 %, 4/5 of a word in 4 s: 12 wpm
    expect(progressOf(state, 4000)).toEqual({ typed: 4, of: 11, errors: 1, accuracy: 75, wpm: 12, seconds: 4 });
    state = type(state, [..."a ei ei"], 5000);
    // finished at 11 s: the clock stops there
    expect(progressOf(state, 60_000)).toEqual({ typed: 11, of: 11, errors: 1, accuracy: 90.9, wpm: 12, seconds: 11 });
  });
});

describe("segments", () => {
  const runs = (state: EngineState) => segments(state).map((s) => [s.text, s.status, s.lineBreak ?? false]);

  it("marks the typed part, the next character, and the rest", () => {
    expect(runs(createEngine(groups))).toEqual([["s", "next", false], ["a sa ei ei", "todo", false]]);
    expect(runs(type(createEngine(groups), [..."sa s"]))).toEqual([
      ["sa s", "typed", false], ["a", "next", false], [" ei ei", "todo", false],
    ]);
  });

  it("marks a wrong character where the next one is expected", () => {
    expect(runs(type(createEngine(groups), ["s", "x"]))).toEqual([
      ["s", "typed", false], ["a", "wrong", false], [" sa ei ei", "todo", false],
    ]);
  });

  it("is all typed at the end", () => {
    expect(runs(type(createEngine(groups), [..."sa sa ei ei"]))).toEqual([["sa sa ei ei", "typed", false]]);
  });

  it("shows no wrong run once a wrong key is corrected", () => {
    const state = type(createEngine(groups), ["s", "x", "Backspace", "a"]);
    expect(state.errors).toBe(1);
    expect(runs(state)).toEqual([["sa", "typed", false], [" ", "next", false], ["sa ei ei", "todo", false]]);
    expect(segments(state).some((s) => s.status === "wrong")).toBe(false);
  });

  it("gives a text exercise's line end its own run", () => {
    expect(runs(createEngine(text))).toEqual([
      ["t", "next", false], ["he sea", "todo", false], ["\n", "todo", true], ["a tide", "todo", false],
    ]);
    expect(runs(type(createEngine(text), [..."the sea"]))).toEqual([
      ["the sea", "typed", false], ["\n", "next", true], ["a tide", "todo", false],
    ]);
    expect(runs(type(createEngine(text), [..."the sea", "Enter"]))).toEqual([
      ["the sea", "typed", false], ["\n", "typed", true], ["a", "next", false], [" tide", "todo", false],
    ]);
  });
});
