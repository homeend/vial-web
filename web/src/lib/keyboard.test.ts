import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import type { Described, KeyboardLanguage, KeyboardModel } from "../api/types";

vi.mock("../api/api", () => ({
  api: {
    session: vi.fn(),
    keyboard: vi.fn(),
    keycodes: vi.fn(),
    languages: vi.fn(),
    setKey: vi.fn(),
    setEncoder: vi.fn(),
    setTapDance: vi.fn(),
    setLayerName: vi.fn(),
  },
}));
vi.mock("../api/events", () => ({ connectEvents: vi.fn(() => () => undefined) }));
vi.mock("../api/client", () => ({ DEFAULT_LANGUAGE: "en-us", setRequestLanguage: vi.fn() }));

const { api } = await import("../api/api");
const { connectEvents } = await import("../api/events");
const { setRequestLanguage } = await import("../api/client");
const { KeyboardStore } = await import("./keyboard.svelte");
const { toasts } = await import("./toasts.svelte");

const mocked = vi.mocked(api);

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

function described(code: string): Described {
  return {
    code, kind: "basic", tap: code, legend: { main: code }, hold: null, layer: null, layerAction: null, index: null,
    description: null,
  };
}

/** One key at (0, 0) with `code` on layer 0, and a second key with no matrix position */
function model(code: string): KeyboardModel {
  return {
    name: "Test",
    keys: [{ row: 0, col: 0 }, { row: null, col: null }],
    encoders: [],
    layers: [{ name: "Layer 0", customName: false, keys: [described(code), described("KC_NO")], encoders: [] }],
    tapDance: [],
    combos: [],
    keyOverrides: [],
    altRepeatKeys: [],
  } as unknown as KeyboardModel;
}

const LANGUAGES: KeyboardLanguage[] = [{ id: "en-us", name: "English (US)" }, { id: "pl", name: "Polish (QWERTY)" }];

let storage: Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  toasts.items = [];
  storage = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
  });
  mocked.session.mockResolvedValue({ fake: true } as never);
  mocked.keycodes.mockResolvedValue([]);
  mocked.languages.mockResolvedValue(LANGUAGES);
  mocked.keyboard.mockResolvedValue(model("KC_A"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A started store whose events link is open; `emit` sends it a server event */
function started() {
  const store = new KeyboardStore();
  store.start();
  const [onEvent, onLink] = vi.mocked(connectEvents).mock.calls.at(-1)!;
  onLink("open");
  return { store, emit: onEvent };
}

/** A started store that has loaded model("KC_A") and can edit */
async function loaded() {
  const s = started();
  s.emit("connected");
  await settle();
  expect(s.store.canEdit).toBe(true);
  return s;
}

describe("a stale model", () => {
  it.each(["connected", "reloaded"] as const)("can't be edited while the keyboard is read again after %s", async (event) => {
    const { store, emit } = await loaded();
    const next = deferred<KeyboardModel>();
    mocked.keyboard.mockReturnValueOnce(next.promise);

    emit(event);
    expect(store.stale).toBe(true);
    expect(store.canEdit).toBe(false);
    expect(await store.setCode(0, { kind: "key", index: 0 }, "KC_B")).toBe(false);
    expect(mocked.setKey).not.toHaveBeenCalled();

    next.resolve(model("KC_C"));
    await settle();
    expect(store.stale).toBe(false);
    expect(store.canEdit).toBe(true);
  });

  it("is stale after an unplug and while a language change loads", async () => {
    const { store, emit } = await loaded();
    emit("disconnected");
    expect(store.stale).toBe(true);
    emit("connected");
    await settle();
    expect(store.canEdit).toBe(true);

    const next = deferred<KeyboardModel>();
    mocked.keyboard.mockReturnValueOnce(next.promise);
    const changing = store.setLanguage("pl");
    expect(store.canEdit).toBe(false);
    next.resolve(model("KC_A"));
    await changing;
    expect(store.canEdit).toBe(true);
  });

  it("stays stale until the latest load succeeds", async () => {
    const { store, emit } = await loaded();
    const first = deferred<KeyboardModel>();
    const second = deferred<KeyboardModel>();
    mocked.keyboard.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    emit("reloaded");
    emit("reloaded");
    first.resolve(model("KC_X"));
    await settle();
    expect(store.stale).toBe(true);
    expect(store.model?.layers[0].keys[0].code).toBe("KC_A"); // the older load isn't kept

    second.reject(new ApiError(502));
    await settle();
    expect(store.stale).toBe(true);
    expect(store.loadError).toContain("didn't respond");

    emit("reloaded");
    await settle();
    expect(store.stale).toBe(false);
    expect(store.loadError).toBeNull();
  });
});

describe("an edit that overlaps a load", () => {
  it("reads the keyboard again, so its result isn't lost with the replaced model", async () => {
    const { store, emit } = await loaded();
    const write = deferred<Described>();
    mocked.setKey.mockReturnValueOnce(write.promise);
    const editing = store.setCode(0, { kind: "key", index: 0 }, "KC_B");

    mocked.keyboard.mockResolvedValueOnce(model("KC_A")); // read before the edit reached the keyboard
    emit("reloaded");
    await settle();
    expect(store.model?.layers[0].keys[0].code).toBe("KC_A");

    mocked.keyboard.mockResolvedValueOnce(model("KC_B"));
    write.resolve(described("KC_B"));
    expect(await editing).toBe(true);
    await settle();
    expect(mocked.keyboard).toHaveBeenCalledTimes(3);
    expect(store.model?.layers[0].keys[0].code).toBe("KC_B");
  });

  it("reads the keyboard again when the overlapping load finishes after the edit", async () => {
    const { store, emit } = await loaded();
    const write = deferred<Described>();
    mocked.setKey.mockReturnValueOnce(write.promise);
    const editing = store.setCode(0, { kind: "key", index: 0 }, "KC_B");

    const before = deferred<KeyboardModel>(); // read before the edit reached the keyboard, but lands after it
    mocked.keyboard.mockReturnValueOnce(before.promise);
    emit("reloaded");

    mocked.keyboard.mockResolvedValueOnce(model("KC_B"));
    write.resolve(described("KC_B"));
    expect(await editing).toBe(true);
    before.resolve(model("KC_A"));
    await settle();
    expect(mocked.keyboard).toHaveBeenCalledTimes(3);
    expect(store.model?.layers[0].keys[0].code).toBe("KC_B");
  });

  it("doesn't read the keyboard again once it is unplugged", async () => {
    const { store, emit } = await loaded();
    const write = deferred<Described>();
    mocked.setKey.mockReturnValueOnce(write.promise);
    const editing = store.setCode(0, { kind: "key", index: 0 }, "KC_B");
    emit("disconnected");
    write.resolve(described("KC_B"));
    expect(await editing).toBe(true);
    await settle();
    expect(mocked.keyboard).toHaveBeenCalledTimes(1);
  });

  it("isn't needed when the model wasn't replaced", async () => {
    const { store } = await loaded();
    mocked.setKey.mockResolvedValueOnce(described("KC_B"));
    expect(await store.setCode(0, { kind: "key", index: 0 }, "KC_B")).toBe(true);
    await settle();
    expect(mocked.keyboard).toHaveBeenCalledTimes(1);
    expect(store.model?.layers[0].keys[0].code).toBe("KC_B");
  });
});

describe("a remembered language the server no longer has", () => {
  const unknown = () => new ApiError(422, "unknown keyboard language: xx");

  it("falls back to the default when the language list arrives", async () => {
    storage["vial.keyboardLanguage"] = "xx";
    const list = deferred<KeyboardLanguage[]>();
    mocked.languages.mockReturnValueOnce(list.promise);
    const { store, emit } = started();
    expect(store.language).toBe("xx");
    emit("connected");
    await settle();

    list.resolve(LANGUAGES);
    await settle();
    expect(store.language).toBe("en-us");
    expect(storage["vial.keyboardLanguage"]).toBe("en-us");
    expect(vi.mocked(setRequestLanguage)).toHaveBeenLastCalledWith("en-us");
    expect(mocked.keyboard).toHaveBeenCalledTimes(2);
    expect(store.canEdit).toBe(true);
  });

  it("falls back when the first load is refused before the list arrives", async () => {
    storage["vial.keyboardLanguage"] = "xx";
    const list = deferred<KeyboardLanguage[]>();
    mocked.languages.mockReturnValueOnce(list.promise);
    mocked.keyboard.mockRejectedValueOnce(unknown());
    const { store, emit } = started();
    emit("connected");
    await settle();
    expect(store.loadError).toBeNull(); // not until the list says whether the language exists

    list.resolve(LANGUAGES);
    await settle();
    expect(store.language).toBe("en-us");
    expect(store.loadError).toBeNull();
    expect(store.model).not.toBeNull();
    expect(store.canEdit).toBe(true);
  });

  it("falls back when the first load is refused after the list arrived", async () => {
    storage["vial.keyboardLanguage"] = "pl";
    mocked.languages.mockResolvedValueOnce([{ id: "en-us", name: "English (US)" }]);
    const load = deferred<KeyboardModel>();
    mocked.keyboard.mockReturnValueOnce(load.promise);
    const { store, emit } = started();
    emit("connected");
    await settle();
    load.reject(unknown());
    await settle();
    expect(store.language).toBe("en-us");
    expect(store.loadError).toBeNull();
    expect(store.model).not.toBeNull();
  });

  it("keeps a language the server has, and reports a refusal it has nothing to do with", async () => {
    storage["vial.keyboardLanguage"] = "pl";
    mocked.keyboard.mockRejectedValueOnce(new ApiError(422, "something else"));
    const { store, emit } = started();
    emit("connected");
    await settle();
    expect(store.language).toBe("pl");
    expect(store.loadError).toContain("something else");
  });

  it("reports the refusal when the language list can't be read", async () => {
    storage["vial.keyboardLanguage"] = "xx";
    mocked.languages.mockRejectedValueOnce(new ApiError(0));
    mocked.keyboard.mockRejectedValueOnce(unknown());
    const { store, emit } = started();
    emit("connected");
    await settle();
    expect(store.language).toBe("xx");
    expect(store.loadError).toContain("unknown keyboard language");
  });
});

describe("unplugging", () => {
  it("drops a load that was in flight, so it can't report an error", async () => {
    const { store, emit } = await loaded();
    const next = deferred<KeyboardModel>();
    mocked.keyboard.mockReturnValueOnce(next.promise);
    emit("reloaded");
    emit("disconnected");
    next.reject(new ApiError(502));
    await settle();
    expect(store.loadError).toBeNull();
    expect(store.connected).toBe(false);
  });

  it("clears an old load error when a load finds the keyboard gone", async () => {
    const { store, emit } = await loaded();
    mocked.keyboard.mockRejectedValueOnce(new ApiError(502));
    emit("reloaded");
    await settle();
    expect(store.loadError).not.toBeNull();
    mocked.keyboard.mockRejectedValueOnce(new ApiError(503));
    await store.load();
    expect(store.loadError).toBeNull();
    expect(store.connected).toBe(false);
  });
});

describe("refused edits", () => {
  it("refuses a key with no matrix position", async () => {
    const { store } = await loaded();
    expect(await store.setCode(0, { kind: "key", index: 1 }, "KC_B")).toBe(false);
    expect(mocked.setKey).not.toHaveBeenCalled();
    expect(toasts.items.map((t) => t.message).join()).toContain("that key has no matrix position");
  });

  it("says so when the tap dance was made but the key couldn't be changed", async () => {
    const { store, emit } = await loaded();
    const free = { index: 0, name: "", customName: false, tap: described("KC_NO"), hold: described("KC_NO"),
      doubleTap: described("KC_NO"), tapHold: described("KC_NO"), tappingTerm: 200 };
    for (const slot of ["tap", "hold", "doubleTap", "tapHold"] as const) free[slot].kind = "none";
    store.model!.tapDance = [free] as never;
    const made = deferred<never>();
    mocked.setTapDance.mockReturnValueOnce(made.promise);
    const turning = store.turnIntoTapDance(0, { kind: "key", index: 0 });

    mocked.keyboard.mockReturnValueOnce(new Promise(() => undefined)); // still reading when the tap dance is made
    emit("reloaded");
    made.resolve({ ...free, tap: described("KC_A") } as never);
    expect(await turning).toBe(false);
    expect(mocked.setKey).not.toHaveBeenCalled();
    expect(toasts.items.map((t) => t.message).join()).toContain("couldn't be changed");
  });
});
