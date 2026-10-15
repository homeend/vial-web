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
