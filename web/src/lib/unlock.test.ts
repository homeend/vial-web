import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import type { UnlockState } from "../api/types";

vi.mock("../api/api", () => ({ api: { unlockStart: vi.fn(), unlockCancel: vi.fn(), lock: vi.fn() } }));

const { api } = await import("../api/api");
const { isWaiting, LOCKED, unlockProgress, Unlocker } = await import("./unlock.svelte");
const { toasts } = await import("./toasts.svelte");
const mocked = vi.mocked(api);

const state = (fields: Partial<UnlockState>): UnlockState => ({ ...LOCKED, ...fields });
const UNLOCKING = state({ state: "unlocking", keys: [{ row: 0, col: 0 }, { row: 4, col: 0 }] });
const UNLOCKED = state({ state: "unlocked" });
const CANCELLED = { ...UNLOCKING, state: "cancelled" } as const;

/** A promise the test settles by hand */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every settled promise run its callbacks */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  toasts.items = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("unlockProgress", () => {
  it("is how much of the countdown has passed", () => {
    expect(unlockProgress(state({ state: "unlocking", remaining: 50, total: 50 }))).toBe(0);
    expect(unlockProgress(state({ state: "unlocking", remaining: 20, total: 50 }))).toBe(0.6);
    expect(unlockProgress(UNLOCKED)).toBe(1);
  });

  it("is nothing before the keyboard's first reading, or when it is locked", () => {
    expect(unlockProgress(UNLOCKING)).toBe(0);
    expect(unlockProgress(LOCKED)).toBe(0);
  });
});

describe("isWaiting", () => {
  it("is true while the keyboard waits for its unlock keys, followed or not", () => {
    expect([LOCKED, UNLOCKING, state({ state: "cancelled" }), UNLOCKED].map(isWaiting))
      .toEqual([false, true, true, false]);
  });
});

describe("Unlocker", () => {
  it("starts an unlock, shows the dialog and tells once the keyboard is unlocked", async () => {
    const unlocker = new Unlocker();
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    const unlocking = unlocker.unlock();
    await vi.waitFor(() => expect(unlocker.state).toEqual(UNLOCKING));
    expect(unlocker.open).toBe(true);
    unlocker.update(state({ state: "unlocking", remaining: 10, total: 50 }));
    expect(unlocker.open).toBe(true);
    unlocker.update(UNLOCKED);
    expect(await unlocking).toBe(true);
    expect(unlocker.open).toBe(false);
  });

  it("asks the server even when the keyboard seems unlocked, and tells at once when it is", async () => {
    // a change was just refused as the keyboard is locked: an "unlocked" here may be stale
    const unlocker = new Unlocker();
    unlocker.update(UNLOCKED);
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKED);
    expect(await unlocker.unlock()).toBe(true);
    expect(mocked.unlockStart).toHaveBeenCalledTimes(1);
    expect(unlocker.open).toBe(false);
  });

  it("tells false when cancelled, or when the unlock can't start", async () => {
    const unlocker = new Unlocker();
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    mocked.unlockCancel.mockResolvedValueOnce(CANCELLED);
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

  it("sends one start for unlocks asked at once, and tells each of them", async () => {
    const unlocker = new Unlocker();
    const started = deferred<UnlockState>();
    mocked.unlockStart.mockReturnValueOnce(started.promise);
    const first = unlocker.unlock();
    const second = unlocker.unlock();
    expect(mocked.unlockStart).toHaveBeenCalledTimes(1);
    started.resolve(UNLOCKING);
    await vi.waitFor(() => expect(unlocker.open).toBe(true));
    unlocker.update(UNLOCKED);
    expect(await Promise.all([first, second])).toEqual([true, true]);

    // once a start is answered, the next unlock sends its own, even from a caller told by that answer
    mocked.unlockStart.mockResolvedValue(UNLOCKED);
    expect(await unlocker.unlock().then(() => unlocker.unlock())).toBe(true);
    expect(mocked.unlockStart).toHaveBeenCalledTimes(3);
  });

  it("fails every unlock asked at once when their one start fails", async () => {
    const unlocker = new Unlocker();
    mocked.unlockStart.mockRejectedValueOnce(new ApiError(502));
    expect(await Promise.all([unlocker.unlock(), unlocker.unlock()])).toEqual([false, false]);
    expect(mocked.unlockStart).toHaveBeenCalledTimes(1);
    expect(toasts.items.map((t) => t.message)).toEqual(["Unlocking the keyboard failed: The keyboard didn't respond."]);
  });

  it("leaves a start's failure to quiet callers to report, and tells them why", async () => {
    const unlocker = new Unlocker();
    const failure = new ApiError(502);
    mocked.unlockStart.mockRejectedValueOnce(failure);
    expect(await Promise.all([unlocker.unlockQuietly(), unlocker.unlockQuietly()]))
      .toEqual([{ unlocked: false, failure }, { unlocked: false, failure }]);
    expect(mocked.unlockStart).toHaveBeenCalledTimes(1);
    expect(toasts.items).toEqual([]);
    expect(unlocker.open).toBe(false);

    // told as unlock() is otherwise
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    const unlocking = unlocker.unlockQuietly();
    await vi.waitFor(() => expect(unlocker.open).toBe(true));
    unlocker.update(UNLOCKED);
    expect(await unlocking).toEqual({ unlocked: true });
  });

  it.each([
    ["a start asked for directly", (u: InstanceType<typeof Unlocker>) => void u.start()],
    ["an unlock that isn't quiet", (u: InstanceType<typeof Unlocker>) => void u.unlock()],
  ])("shows a start's failure when %s waits for it too, and then doesn't hand it to quiet callers", async (_, other) => {
    const unlocker = new Unlocker();
    const started = deferred<UnlockState>();
    mocked.unlockStart.mockReturnValueOnce(started.promise);
    const quiet = unlocker.unlockQuietly();
    other(unlocker);
    started.reject(new ApiError(502));
    expect(await quiet).toEqual({ unlocked: false });
    expect(mocked.unlockStart).toHaveBeenCalledTimes(1);
    expect(toasts.items.map((t) => t.message)).toEqual(["Unlocking the keyboard failed: The keyboard didn't respond."]);
  });

  it("shows the failure of a start asked for directly", async () => {
    const unlocker = new Unlocker();
    mocked.unlockStart.mockRejectedValueOnce(new ApiError(502));
    await unlocker.start();
    expect(toasts.items.map((t) => t.message)).toEqual(["Unlocking the keyboard failed: The keyboard didn't respond."]);

    // the next start, asked for by a quiet caller, is quiet again
    mocked.unlockStart.mockRejectedValueOnce(new ApiError(502));
    expect((await unlocker.unlockQuietly()).unlocked).toBe(false);
    expect(toasts.items).toHaveLength(1);
  });

  it("takes an event over an answer that comes after it", async () => {
    const unlocker = new Unlocker();
    const started = deferred<UnlockState>();
    mocked.unlockStart.mockReturnValueOnce(started.promise);
    const unlocking = unlocker.unlock();
    unlocker.update(LOCKED); // a session read sent before the start, answered after it was sent
    expect(await unlocking).toBe(false);
    started.resolve(UNLOCKING);
    await vi.waitFor(() => expect(unlocker.busy).toBe(false));
    expect(unlocker.state).toEqual(LOCKED);
    expect(unlocker.open).toBe(false);

    // the server's event for the start arrives before the start's answer, which is older than the event's reading
    const again = deferred<UnlockState>();
    mocked.unlockStart.mockReturnValueOnce(again.promise);
    const second = unlocker.unlock();
    const counting = state({ ...UNLOCKING, remaining: 40, total: 50 });
    unlocker.update(counting);
    again.resolve(UNLOCKING);
    await vi.waitFor(() => expect(unlocker.busy).toBe(false));
    expect(unlocker.state).toEqual(counting);
    expect(unlocker.open).toBe(true);
    unlocker.update(UNLOCKED);
    expect(await second).toBe(true);
  });

  it("tells its callers when the start answers that the keyboard is unlocked, even after an event", async () => {
    // the server sends no event then
    const unlocker = new Unlocker();
    const started = deferred<UnlockState>();
    mocked.unlockStart.mockReturnValueOnce(started.promise);
    const unlocking = unlocker.unlock();
    unlocker.update(UNLOCKING);
    started.resolve(UNLOCKED);
    expect(await unlocking).toBe(true);
  });

  it("stays cancelled when the cancel is answered before the start it cancelled", async () => {
    const unlocker = new Unlocker();
    const started = deferred<UnlockState>();
    mocked.unlockStart.mockReturnValueOnce(started.promise);
    mocked.unlockCancel.mockResolvedValueOnce(CANCELLED);
    const unlocking = unlocker.unlock();
    await unlocker.cancel();
    expect(await unlocking).toBe(false);
    started.resolve(UNLOCKING);
    await settle();
    expect(unlocker.state).toEqual(CANCELLED);
    expect(unlocker.open).toBe(false);
    expect(unlocker.busy).toBe(false);
  });

  it("keeps the event's state when a cancel's answer comes after it", async () => {
    const unlocker = new Unlocker();
    unlocker.update(UNLOCKING);
    const cancelling = deferred<UnlockState>();
    mocked.unlockCancel.mockReturnValueOnce(cancelling.promise);
    const cancel = unlocker.cancel();
    unlocker.update(CANCELLED);
    expect(unlocker.open).toBe(false);
    cancelling.resolve(UNLOCKING); // a reading older than the event's
    await cancel;
    expect(unlocker.state).toEqual(CANCELLED);
    expect(unlocker.open).toBe(false);
    expect(unlocker.busy).toBe(false);
  });

  it("locks the keyboard, busy while the request is on its way", async () => {
    const unlocker = new Unlocker();
    unlocker.update(UNLOCKED);
    expect(unlocker.busy).toBe(false);
    const locked = deferred<UnlockState>();
    mocked.lock.mockReturnValueOnce(locked.promise);
    const locking = unlocker.lock();
    expect(unlocker.busy).toBe(true);
    locked.resolve(LOCKED);
    await locking;
    expect(unlocker.busy).toBe(false);
    expect(unlocker.state).toEqual(LOCKED);
    expect(unlocker.open).toBe(false);

    mocked.lock.mockRejectedValueOnce(new ApiError(502));
    unlocker.update(UNLOCKED);
    await unlocker.lock();
    expect(unlocker.busy).toBe(false);
    expect(unlocker.state).toEqual(UNLOCKED);
    expect(toasts.items.map((t) => t.message)).toEqual(["Locking the keyboard failed: The keyboard didn't respond."]);
  });

  it("shows the dialog for an unlock started elsewhere (another tab, or one interrupted earlier)", () => {
    const unlocker = new Unlocker();
    unlocker.update(UNLOCKING);
    expect(unlocker.open).toBe(true);
    unlocker.update(LOCKED); // unplugged meanwhile
    expect(unlocker.open).toBe(false);
  });
});
