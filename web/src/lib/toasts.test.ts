import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHOW_MS, Toasts } from "./toasts.svelte";

let toasts: Toasts;

beforeEach(() => {
  vi.useFakeTimers();
  toasts = new Toasts();
});

afterEach(() => {
  vi.useRealTimers();
});

const messages = () => toasts.items.map((t) => t.message);

describe("toasts", () => {
  it("go away on their own after a while", () => {
    toasts.error("one");
    vi.advanceTimersByTime(SHOW_MS - 1);
    expect(messages()).toEqual(["one"]);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it("wait while hovered or focused, then get the full time again", () => {
    toasts.error("one");
    const [{ id }] = toasts.items;
    vi.advanceTimersByTime(SHOW_MS - 100);
    toasts.hold(id, "hover", true);
    toasts.hold(id, "focus", true);
    vi.advanceTimersByTime(SHOW_MS * 3);
    toasts.hold(id, "hover", false);
    vi.advanceTimersByTime(SHOW_MS * 3);
    expect(messages()).toEqual(["one"]); // still focused

    toasts.hold(id, "focus", false);
    vi.advanceTimersByTime(SHOW_MS - 1);
    expect(messages()).toEqual(["one"]);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it("only the one being read waits", () => {
    toasts.error("one");
    toasts.error("two");
    toasts.hold(toasts.items[0].id, "hover", true);
    vi.advanceTimersByTime(SHOW_MS);
    expect(messages()).toEqual(["one"]);
  });

  it("can be dismissed at once, and a dismissed one can't be held", () => {
    toasts.error("one");
    const [{ id }] = toasts.items;
    toasts.dismiss(id);
    expect(messages()).toEqual([]);
    toasts.hold(id, "hover", false);
    vi.advanceTimersByTime(SHOW_MS);
    expect(messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("toasts that say something went well", () => {
  it("are told apart from errors, and go away on their own too", () => {
    toasts.info("saved");
    toasts.error("failed");
    expect(toasts.items.map((t) => [t.message, t.tone])).toEqual([["saved", "info"], ["failed", "error"]]);
    vi.advanceTimersByTime(SHOW_MS);
    expect(messages()).toEqual([]);
  });

  it("can offer an action: running it removes the toast", async () => {
    const run = vi.fn(() => true);
    toasts.info("swapped", { label: "Undo", run });
    const [toast] = toasts.items;
    expect(toast.action?.label).toBe("Undo");
    await toasts.act(toast.id);
    expect(run).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keep their toast when the action says it didn't run, and run it once at a time", async () => {
    let finish!: (done: boolean) => void;
    const run = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    toasts.info("swapped", { label: "Undo", run });
    const [{ id }] = toasts.items;
    const acting = toasts.act(id);
    await toasts.act(id); // pressed again while the first one runs
    expect(run).toHaveBeenCalledTimes(1);
    finish(false);
    await acting;
    expect(messages()).toEqual(["swapped"]);
    const again = toasts.act(id);
    expect(run).toHaveBeenCalledTimes(2);
    finish(true);
    await again;
    expect(messages()).toEqual([]);
  });

  it("don't run the action of a toast that has gone", async () => {
    const run = vi.fn(() => true);
    toasts.info("swapped", { label: "Undo", run });
    const [{ id }] = toasts.items;
    vi.advanceTimersByTime(SHOW_MS);
    await toasts.act(id);
    expect(run).not.toHaveBeenCalled();
  });
});
