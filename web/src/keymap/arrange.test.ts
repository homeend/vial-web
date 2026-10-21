import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArrangePreview } from "../api/types";
import {
  arrangeBlocked, canStep, currentOrder, dropPosition, isCurrent, keptText, layersChangedText, moveStep, moveTo, nameAfter,
  positionAfter, PREVIEW_PAUSE_MS, PreviewFollower, reverseOrder, savedDefaultWarning, stoppedText, summaryText,
  triLayerWarning, unsavedQuestion, writingLabel, type PreviewState,
} from "./arrange";

const NONE = { keymap: 0, encoders: 0, tapDance: 0, combos: 0, keyOverrides: 0, altRepeatKeys: 0, macros: 0 };

function preview(fields: Partial<ArrangePreview> = {}): ArrangePreview {
  return {
    moves: [{ layer: 3, to: 1 }, { layer: 1, to: 2 }, { layer: 2, to: 3 }], keys: 94, references: { ...NONE },
    keyOverrides: 0, triLayer: null, savedDefault: [], problems: [], writes: 94, needsUnlock: false, layoutVersion: 0,
    ...fields,
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

  it("puts a dragged row after every other row whose middle the pointer has passed", () => {
    // the other movable rows, 30 px tall with 6 px between: their middles at 15, 51 and 87
    const rows = [{ top: 0, height: 30 }, { top: 36, height: 30 }, { top: 72, height: 30 }];
    expect(dropPosition(rows, -40)).toBe(1);
    expect(dropPosition(rows, 15)).toBe(1);
    expect(dropPosition(rows, 16)).toBe(2);
    expect(dropPosition(rows, 60)).toBe(3);
    expect(dropPosition(rows, 500)).toBe(4);
    expect(dropPosition([], 10)).toBe(1);
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
    // nothing changes for them: no warning
    expect(triLayerWarning([1, 2, 3], (l) => names[l], false)).toBeNull();
    expect(triLayerWarning([1, 2, null], (l) => names[l], true)).toBeNull();
  });

  it("warns that a start-up layer a PDF key saved keeps its number, naming the layer and the key's new one", () => {
    const names = [null, null, null, "Num", null, null];
    expect(savedDefaultWarning([], (l) => names[l])).toBeNull();
    expect(savedDefaultWarning([{ layer: 3, to: 5 }], (l) => names[l])).toBe(
      "If a PDF key saved layer 3 (“Num”) as the start-up layer, the keyboard still starts on layer 3 after a " +
      "restart, which is now a different layer. Press the PDF key (now for layer 5) once to save it again.");
    expect(savedDefaultWarning([{ layer: 1, to: 2 }, { layer: 2, to: 1 }], (l) => names[l])).toBe(
      "If a PDF key saved layer 1 as the start-up layer, the keyboard still starts on layer 1 after a restart, " +
      "which is now a different layer. Press the PDF key (now for layer 2) once to save it again. If a PDF key saved " +
      "layer 2 as the start-up layer, the keyboard still starts on layer 2 after a restart, which is now a different " +
      "layer. Press the PDF key (now for layer 1) once to save it again.");
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
    // with encoders, the keys count their directions too: not called keys
    expect(writingLabel(preview(), true)).toBe("Writing 94 changes…");
  });

  it("says how far an arrange got before it stopped, and which of this tab's stopped it", () => {
    const unfinished = { order: [0, 3, 1, 2], done: 40, total: 96, namesOnly: false };
    expect(stoppedText(unfinished, "arrange")).toBe("Arranging the layers stopped after 40 of 96 writes. The " +
      "keyboard may hold part of the new order: finish it, or put it back as it was. Names move once it is finished.");
    expect(stoppedText({ ...unfinished, done: 0 }, "arrange")).toMatch(/^Arranging the layers stopped at its first write\. /);
    // a Finish or a Put back of its own writes: its own count
    expect(stoppedText({ ...unfinished, done: 3, total: 10 }, "finish")).toMatch(
      /^Finishing the arrange stopped after 3 of its 10 writes\. The keyboard may hold part of the new order/);
    expect(stoppedText({ ...unfinished, done: 3, total: 10 }, "put-back")).toMatch(
      /^Putting the layers back stopped after 3 of its 10 writes\. /);
    // not known which (another tab's, or the page opened since): the count is the last try's
    expect(stoppedText({ ...unfinished, done: 3, total: 10 }, null)).toMatch(
      /^Arranging the layers stopped partway: the last try stopped after 3 of its 10 writes\. /);
    expect(stoppedText({ ...unfinished, done: 0, total: 10 }, null)).toMatch(/the last try stopped at its first write\. /);
    // why, when this tab saw it stop
    expect(stoppedText(unfinished, "arrange", "The keyboard didn't respond.")).toMatch(
      /^Arranging the layers stopped after 40 of 96 writes: the keyboard didn't respond\. The keyboard may hold/);
    expect(stoppedText(unfinished, "finish", "Can't reach Vial. Is it still running?")).toMatch(
      /^Finishing the arrange stopped after 40 of its 96 writes: can't reach Vial\. Is it still running\? The keyboard/);
  });

  it("says when only the layer names are left to save, never a count", () => {
    const text = "The layers are arranged; only the layer names still need saving. Finish saves them; Put back " +
      "puts the layers back as they were.";
    // the server logs why (vial.log); a cause would only say again that the names weren't saved
    expect(stoppedText({ order: [0, 3, 1, 2], done: 94, total: 94, namesOnly: true }, "arrange",
      "The layer names couldn't be saved (see vial.log).")).toBe(text);
    expect(stoppedText({ order: [0, 3, 1, 2], done: 0, total: 0, namesOnly: true }, null)).toBe(
      "The layers are arranged; only the layer names still need saving. Finish saves them; Put back puts the " +
      "layers back as they were.");
  });

  it("says what Finish and Put back kept as it was", () => {
    expect(keptText(1)).toBe("1 change made since the stop was kept as it is (a key, a tap dance, combo, key override " +
      "or alt-repeat key, or a macro).");
    expect(keptText(4, true)).toBe("4 changes made since the stop were kept as they are (keys, encoder directions, " +
      "tap dances, combos, key overrides, alt-repeat keys or macros).");
  });

  it("says the layers changed while the dialog was open", () => {
    expect(layersChangedText(true, false)).toBe("The layers were arranged again or a layout file was loaded since " +
      "this was shown (in another tab, say), so Apply wrote nothing. The rows keep your order, with the layers as " +
      "they are now: check it, then Apply.");
    expect(layersChangedText(false, true)).toBe("The layers were arranged again or a layout file was loaded while " +
      "this was open (in another tab, say). The number of layers changed: the order shown is the current one again.");
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

  it("waits again when asked again (the keyboard changed): the answer shown is no longer the one to apply", async () => {
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    asked[0].answer("before");
    await vi.runAllTimersAsync();
    follower.refresh([0, 2, 1, 3]);
    expect(last()).toEqual({ state: "waiting" });
    asked[1].answer("after");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "ready", preview: "after" });
  });

  it("A, then B, then A again: A's first answer, late, is used only if no later answer was", async () => {
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    follower.follow([0, 1, 3, 2]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    expect(asked.map((a) => a.order)).toEqual([[0, 2, 1, 3], [0, 1, 3, 2], [0, 2, 1, 3]]);
    // B's answer: its order is no longer shown
    asked[1].answer("B");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "waiting" });
    // A's second answer, then its first, late: the first is older, and dropped
    asked[2].answer("A again");
    await vi.runAllTimersAsync();
    asked[0].answer("A first");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "ready", preview: "A again" });
    expect(shown.filter((s) => s.state === "ready")).toHaveLength(1);
  });

  it("A, then B, then A again: A's first answer, before the second, is shown until the second comes", async () => {
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    follower.follow([0, 1, 3, 2]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    follower.follow([0, 2, 1, 3]);
    vi.advanceTimersByTime(PREVIEW_PAUSE_MS);
    // for the order shown, from the same keyboard: the second replaces it once it comes
    asked[0].answer("A first");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "ready", preview: "A first" });
    asked[2].answer("A again");
    await vi.runAllTimersAsync();
    expect(last()).toEqual({ state: "ready", preview: "A again" });
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
