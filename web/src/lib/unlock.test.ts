import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnlockState } from "../api/types";

vi.mock("../api/api", () => ({ api: { unlockStart: vi.fn(), unlockCancel: vi.fn(), lock: vi.fn() } }));

const { api } = await import("../api/api");
const { isWaiting, LOCKED, unlockProgress, Unlocker } = await import("./unlock.svelte");
const { toasts } = await import("./toasts.svelte");
const mocked = vi.mocked(api);

const state = (fields: Partial<UnlockState>): UnlockState => ({ ...LOCKED, ...fields });
const UNLOCKING = state({ state: "unlocking", keys: [{ row: 0, col: 0 }, { row: 4, col: 0 }] });

beforeEach(() => {
  vi.clearAllMocks();
  toasts.items = [];
});

describe("unlockProgress", () => {
  it("is how much of the countdown has passed", () => {
    expect(unlockProgress(state({ state: "unlocking", remaining: 50, total: 50 }))).toBe(0);
    expect(unlockProgress(state({ state: "unlocking", remaining: 20, total: 50 }))).toBe(0.6);
    expect(unlockProgress(state({ state: "unlocked" }))).toBe(1);
  });

  it("is nothing before the keyboard's first reading, or when it is locked", () => {
    expect(unlockProgress(UNLOCKING)).toBe(0);
    expect(unlockProgress(LOCKED)).toBe(0);
  });
});

describe("isWaiting", () => {
  it("is true while the keyboard waits for its unlock keys, followed or not", () => {
    expect([LOCKED, UNLOCKING, state({ state: "cancelled" }), state({ state: "unlocked" })].map(isWaiting))
      .toEqual([false, true, true, false]);
  });
});

describe("Unlocker", () => {
  it("starts an unlock, shows the dialog and tells once the keyboard is unlocked", async () => {
    const unlocker = new Unlocker();
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    const unlocking = unlocker.unlock();
    expect(unlocker.open).toBe(true);
    await vi.waitFor(() => expect(unlocker.state).toEqual(UNLOCKING));
    unlocker.update(state({ state: "unlocking", remaining: 10, total: 50 }));
    expect(unlocker.open).toBe(true);
    unlocker.update(state({ state: "unlocked" }));
    expect(await unlocking).toBe(true);
    expect(unlocker.open).toBe(false);
  });

  it("tells at once when the keyboard is unlocked already", async () => {
    const unlocker = new Unlocker();
    unlocker.update(state({ state: "unlocked" }));
    expect(await unlocker.unlock()).toBe(true);
    expect(mocked.unlockStart).not.toHaveBeenCalled();
  });

  it("tells false when cancelled, or when the unlock can't start", async () => {
    const unlocker = new Unlocker();
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    mocked.unlockCancel.mockResolvedValueOnce({ ...UNLOCKING, state: "cancelled" });
    const cancelled = unlocker.unlock();
    await vi.waitFor(() => expect(unlocker.state).toEqual(UNLOCKING));
    await unlocker.cancel();
    expect(await cancelled).toBe(false);
    expect(unlocker.open).toBe(false);

    mocked.unlockStart.mockRejectedValueOnce(new Error("no"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await unlocker.unlock()).toBe(false);
    expect(toasts.items.map((t) => t.message)).toEqual(["Unlocking the keyboard failed: Unexpected error in the page."]);
  });

  it("shows the dialog for an unlock started elsewhere (another tab, or one interrupted earlier)", () => {
    const unlocker = new Unlocker();
    unlocker.update(UNLOCKING);
    expect(unlocker.open).toBe(true);
    unlocker.update(LOCKED); // unplugged meanwhile
    expect(unlocker.open).toBe(false);
  });
});
