import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArrangePreview } from "../api/types";
import {
  arrangeBlocked, canStep, currentOrder, isCurrent, moveStep, moveTo, nameAfter, positionAfter, PREVIEW_PAUSE_MS,
  PreviewFollower,
  reverseOrder, stoppedText, summaryText, triLayerWarning, unsavedQuestion, writingLabel, type PreviewState,
} from "./arrange";

const NONE = { keymap: 0, encoders: 0, tapDance: 0, combos: 0, keyOverrides: 0, altRepeatKeys: 0, macros: 0 };

function preview(fields: Partial<ArrangePreview> = {}): ArrangePreview {
  return {
    moves: [{ layer: 3, to: 1 }, { layer: 1, to: 2 }, { layer: 2, to: 3 }], keys: 94, references: { ...NONE },
    keyOverrides: 0, triLayer: null, problems: [], writes: 94, needsUnlock: false, ...fields,
  };
}

describe("the order", () => {
  it("moves a layer, the ones between shifting by one", () => {
    expect(moveTo([0, 1, 2, 3], 3, 1)).toEqual([0, 3, 1, 2]);
    expect(moveTo([0, 1, 2, 3], 1, 3)).toEqual([0, 2, 3, 1]);
    expect(moveTo([0, 1, 2, 3], 2, 2)).toEqual([0, 1, 2, 3]);
  });

  it("never moves layer 0, nor anything into its place", () => {
    expect(moveTo([0, 1, 2, 3], 0, 2)).toEqual([0, 1, 2, 3]);
    expect(moveTo([0, 1, 2, 3], 2, 0)).toEqual([0, 2, 1, 3]);
    expect(moveTo([0, 1, 2, 3], 2, -5)).toEqual([0, 2, 1, 3]);
    expect(moveTo([0, 1, 2, 3], 1, 99)).toEqual([0, 2, 3, 1]);
  });

  it("goes one step with ↑ and ↓ (and Alt+↑, Alt+↓), not past either end", () => {
    expect(moveStep([0, 1, 2, 3], 2, -1)).toEqual([0, 2, 1, 3]);
    expect(moveStep([0, 1, 2, 3], 2, 1)).toEqual([0, 1, 3, 2]);
    expect(moveStep([0, 1, 2, 3], 1, -1)).toEqual([0, 1, 2, 3]);
    expect(moveStep([0, 1, 2, 3], 3, 1)).toEqual([0, 1, 2, 3]);
    expect([canStep([0, 1, 2, 3], 1, -1), canStep([0, 1, 2, 3], 1, 1)]).toEqual([false, true]);
    expect([canStep([0, 1, 2, 3], 3, -1), canStep([0, 1, 2, 3], 3, 1)]).toEqual([true, false]);
    expect([canStep([0, 1, 2, 3], 0, -1), canStep([0, 1, 2, 3], 0, 1)]).toEqual([false, false]);
  });

  it("is reset to the current order", () => {
    expect(currentOrder(4)).toEqual([0, 1, 2, 3]);
    expect(isCurrent(currentOrder(5))).toBe(true);
    expect(isCurrent([0, 2, 1])).toBe(false);
  });

  it("is undone by the reverse order", () => {
    for (const order of [[0, 3, 1, 2], [0, 2, 3, 1], [0, 4, 3, 2, 1], [0, 1, 2]]) {
      const back = reverseOrder(order);
      // the layer at each position after the order, then the reverse, is the one that was there
      expect(back.map((position) => order[position])).toEqual(currentOrder(order.length));
    }
    expect(reverseOrder([0, 3, 1, 2])).toEqual([0, 2, 3, 1]);
  });

  it("tells where a layer goes, for the Edit view to follow it", () => {
    expect(positionAfter([0, 3, 1, 2], 3)).toBe(1);
    expect(positionAfter([0, 3, 1, 2], 1)).toBe(2);
    expect(positionAfter([0, 3, 1, 2], 0)).toBe(0);
  });
});

describe("the summary", () => {
  it("says what moves, how many keys and references change, and the key overrides", () => {
    expect(summaryText(preview({ references: { ...NONE, keymap: 8, combos: 2, tapDance: 2 }, keyOverrides: 1 })))
      .toBe("Will change: 3 layers move · 94 keys rewritten · 12 layer keys renumbered (8 in the keymap, 2 in tap " +
        "dances, 2 in combos) · the layers of 1 key override.");
    expect(summaryText(preview({ references: { ...NONE, macros: 1, encoders: 1 }, keys: 1, keyOverrides: 2 }), true))
      .toBe("Will change: 3 layers move · 1 key or encoder direction rewritten · 2 layer keys renumbered (1 on an " +
        "encoder, 1 in a macro) · the layers of 2 key overrides.");
  });

  it("says when there is nothing to change", () => {
    expect(summaryText(preview({ moves: [], keys: 0, writes: 0 }))).toBe("Nothing to change.");
  });

  it("warns that the tri-layer keys keep their layer numbers, naming the layers they reach", () => {
    const names = [null, "Sym", null, "Num"];
    expect(triLayerWarning([3, 1, 2], (l) => names[l], false)).toBe(
      "Fn1 and Fn2 (FN_MO13, FN_MO23) don't follow their layers: they use layers 1, 2 and 3 by number. After " +
      "this, Fn1 turns on the layer that was 3 (“Num”) instead of the one that was 1 (“Sym”); Fn2 turns on the " +
      "layer that was 1 (“Sym”) instead of the one that was 2; both held turn on the layer that was 2 instead of " +
      "the one that was 3 (“Num”).");
    // a layer that stays isn't named; the keyboard may have no layer 3
    expect(triLayerWarning([2, 1, null], (l) => names[l], true)).toContain(
      "(the firmware's tri-layer layers, unless its code sets others). After this, Fn1 turns on the layer that " +
      "was 2 instead of the one that was 1 (“Sym”); Fn2 turns on the layer that was 1 (“Sym”) instead of the one " +
      "that was 2.");
    expect(triLayerWarning([1, 3, 2], (l) => names[l], false)).toMatch(/After this, Fn2 turns on the layer that was 3/);
  });

  it("names each row as it will be named: its own name, else its new position's default name", () => {
    expect(nameAfter({ name: "Num", customName: true }, 1)).toBe("Num");
    // "Layer 3", never named, moved to position 1 is "Layer 1" after Apply
    expect(nameAfter({ name: "Layer 3", customName: false }, 1)).toBe("Layer 1");
    expect(nameAfter({ name: "Base", customName: false }, 0)).toBe("Base");
    expect(nameAfter(undefined, 2)).toBe("Layer 2");
  });

  it("says what Apply writes", () => {
    expect(writingLabel(preview())).toBe("Writing 94 keys…");
    expect(writingLabel(preview({ keys: 1, writes: 1 }))).toBe("Writing 1 key…");
    expect(writingLabel(preview({ writes: 97 }))).toBe("Writing 97 changes…");
    expect(writingLabel(null)).toBe("Writing…");
  });

  it("says how far an arrange got before it stopped", () => {
    expect(stoppedText({ order: [0, 3, 1, 2], done: 40, total: 96 })).toMatch(
      /^Arranging the layers stopped after 40 of 96 writes\. The keyboard may hold part of the new order/);
    expect(stoppedText({ order: [0, 3, 1, 2], done: 0, total: 96 })).toMatch(/stopped at its first write\./);
  });
});

describe("PreviewFollower", () => {
  let shown: PreviewState<string>[];
  let asked: { order: number[]; answer: (text: string) => void; fail: (error: unknown) => void }[];
  let follower: PreviewFollower<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    shown = [];
    asked = [];
    follower = new PreviewFollower<string>(
      (order) => new Promise((answer, fail) => asked.push({ order, answer, fail })),
      (state) => shown.push(state),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const last = () => shown.at(-1);

  it("asks once after the pause, however many quick moves came", async () => {
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS - 1);
    follower.follow([0, 2, 3, 1]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS - 1);
    expect(asked).toEqual([]);
    expect(last()).toEqual({ state: "waiting" });
    vi.advanceTimersByTime(1);
    expect(asked.map((a) => a.order)).toEqual([[0, 2, 3, 1]]);
    asked[0].answer("A");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "ready", preview: "A" });
  });

  it("drops an answer for an order no longer shown", async () => {
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    follower.follow([0, 1, 3, 2]);
    asked[0].answer("old order");
    await vi.runAllTimersAsync();
    expect(shown.some((s) => s.state === "ready" && s.preview === "old order")).toBe(false);
    asked[1].answer("new order");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "ready", preview: "new order" });
  });

  it("keeps a newer answer over an older one for the same order", async () => {
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    follower.refresh([0, 2, 1, 3]);
    asked[1].answer("newer");
    await vi.runAllTimersAsync();
    asked[0].answer("older");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "ready", preview: "newer" });
    expect(shown.filter((s) => s.state === "ready")).toHaveLength(1);
  });

  it("shows a failure, and nothing once stopped", async () => {
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    asked[0].fail(new Error("gone"));
    await vi.runAllTimersAsync();
    expect(last()?.state).toBe("failed");
    follower.follow([0, 1, 3, 2]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    follower.stop();
    asked[1].answer("late");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "waiting" });
    follower.follow([0, 3, 2, 1]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    expect(asked).toHaveLength(2);
  });
});

describe("around the dialog", () => {
  it("says why the button does nothing", () => {
    expect(arrangeBlocked(2, true)).toMatch(/3 layers or more/);
    expect(arrangeBlocked(4, false)).toBe("The keyboard can't be changed just now.");
    expect(arrangeBlocked(3, true)).toBeNull();
  });

  it("asks about the work not saved", () => {
    expect(unsavedQuestion(["the changes on the Settings page"])).toBe(
      "Not saved yet: the changes on the Settings page. Arranging the layers doesn't save it and doesn't change it: " +
      "a layer named there by its number keeps that number, whichever layer is at it afterwards.");
    expect(unsavedQuestion(["a", "b"])).toMatch(/^Not saved yet: a and b\. Arranging the layers doesn't save them/);
  });
});
