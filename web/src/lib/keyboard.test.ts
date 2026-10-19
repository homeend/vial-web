import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import type { Described, KeyboardLanguage, KeyboardModel, ServerEvent, UnlockState } from "../api/types";

vi.mock("../api/api", () => ({
  api: {
    session: vi.fn(),
    keyboard: vi.fn(),
    keycodes: vi.fn(),
    languages: vi.fn(),
    setKey: vi.fn(),
    setEncoder: vi.fn(),
    setTapDance: vi.fn(),
    setCombo: vi.fn(),
    setMacros: vi.fn(),
    setName: vi.fn(),
    unlockStart: vi.fn(),
    unlockCancel: vi.fn(),
    lock: vi.fn(),
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
    code, value: 4, kind: "basic", tap: code, legend: { main: code }, hold: null, layer: null, layerAction: null, index: null,
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
    macros: { count: 0, memory: 0, used: 0, items: [] },
  } as unknown as KeyboardModel;
}

const LOCKED: UnlockState = { state: "locked", keys: [], remaining: 0, total: 0 };
const UNLOCKING: UnlockState = { state: "unlocking", keys: [{ row: 0, col: 0 }], remaining: 0, total: 0 };
const UNLOCKED: UnlockState = { state: "unlocked", keys: [], remaining: 0, total: 0 };

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
  mocked.session.mockResolvedValue({ fake: true, unlock: LOCKED } as never);
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
  return { store, emit: (type: ServerEvent["type"]) => onEvent({ type, unlock: null }), send: onEvent };
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

    // still reading when the tap dance is made: every read, so neither the reload nor the edit's own read lands
    mocked.keyboard.mockReturnValue(new Promise(() => undefined));
    emit("reloaded");
    made.resolve({ ...free, tap: described("KC_A") } as never);
    expect(await turning).toBeNull();
    expect(mocked.setKey).not.toHaveBeenCalled();
    expect(toasts.items.map((t) => t.message).join()).toContain("couldn't be changed");
  });
});

describe("behaviour edits", () => {
  it("fill a combo's empty slots and put the keyboard's reply into the model", async () => {
    const { store } = await loaded();
    store.model!.combos = [{ index: 0, keys: [], output: described("KC_NO") }] as never;
    const reply = { index: 0, keys: ["KC_K", "KC_Y", "KC_NO", "KC_NO"].map(described), output: described("KC_ESC") };
    mocked.setCombo.mockResolvedValueOnce(reply);
    expect(await store.setCombo(0, ["KC_K", "KC_Y"], "KC_ESC")).toBe(true);
    expect(mocked.setCombo).toHaveBeenCalledWith(0, { keys: ["KC_K", "KC_Y", "KC_NO", "KC_NO"], output: "KC_ESC" });
    expect(store.model!.combos[0].output.code).toBe("KC_ESC");
  });

  it("refuse a combo of more than 4 keys", async () => {
    const { store } = await loaded();
    store.model!.combos = [{ index: 0, keys: [], output: described("KC_NO") }] as never;
    expect(() => store.setCombo(0, ["KC_A", "KC_B", "KC_C", "KC_D", "KC_E"], "KC_ESC")).toThrow("at most 4 keys");
    expect(mocked.setCombo).not.toHaveBeenCalled();
  });

  it("name a tap dance or a macro", async () => {
    const { store } = await loaded();
    store.model!.macros = { count: 1, memory: 100, used: 1, items: [{ index: 0, name: "", customName: false, actions: [] }] };
    mocked.setName.mockResolvedValueOnce({ kind: "macros", index: 0, name: "git status", customName: true });
    expect(await store.rename("macros", 0, "git status")).toBe(true);
    expect(mocked.setName).toHaveBeenCalledWith("macros", 0, "git status");
    expect(store.model!.macros.items[0]).toMatchObject({ name: "git status", customName: true });
  });

  it.each([
    ["layers", (m: KeyboardModel) => m.layers[0]],
    ["tapDance", (m: KeyboardModel) => m.tapDance[0]],
  ] as const)("name %s, and give one its default name back", async (kind, item) => {
    const { store } = await loaded();
    store.model!.tapDance = [{ index: 0, name: "Tap dance 0", customName: false }] as never;
    mocked.setName.mockResolvedValueOnce({ kind, index: 0, name: "nav", customName: true });
    expect(await store.rename(kind, 0, "nav")).toBe(true);
    expect(mocked.setName).toHaveBeenCalledWith(kind, 0, "nav");
    expect(item(store.model!)).toMatchObject({ name: "nav", customName: true });

    mocked.setName.mockResolvedValueOnce({ kind, index: 0, name: "Default 0", customName: false });
    expect(await store.rename(kind, 0, "")).toBe(true);
    expect(item(store.model!)).toMatchObject({ name: "Default 0", customName: false });
  });

  it("refuse to name something that isn't there", async () => {
    const { store } = await loaded();
    expect(() => store.rename("macros", 3, "x")).toThrow("there is no macro 3");
    expect(() => store.rename("layers", 1, "x")).toThrow("there is no layer 1");
    expect(mocked.setName).not.toHaveBeenCalled();
  });
});

describe("a locked keyboard", () => {
  const macros = { count: 1, memory: 100, used: 4, items: [] };

  it("follows the unlock state from the session and the events", async () => {
    const { store, send } = await loaded();
    expect(store.unlock.state).toEqual(LOCKED);
    send({ type: "unlock", unlock: UNLOCKING });
    expect(store.unlock.state).toEqual(UNLOCKING);
    expect(store.unlock.open).toBe(true);
    send({ type: "unlock", unlock: UNLOCKED });
    expect(store.unlock.open).toBe(false);
    expect(mocked.keyboard).toHaveBeenCalledTimes(1); // an unlock event doesn't read the keyboard again
  });

  it("is unlocked when a change is refused, and the change is sent again once it is", async () => {
    const { store, send } = await loaded();
    mocked.setMacros.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked")).mockResolvedValueOnce(macros);
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    const saving = store.setMacros([[]]);
    await settle();
    expect(mocked.unlockStart).toHaveBeenCalledTimes(1);
    expect(store.unlock.open).toBe(true);
    send({ type: "unlock", unlock: UNLOCKED });
    expect(await saving).toBe(true);
    expect(mocked.setMacros).toHaveBeenCalledTimes(2);
    expect(store.model!.macros).toEqual(macros);
    expect(toasts.items).toEqual([]);
  });

  it("fails the change when the unlock is cancelled", async () => {
    const { store } = await loaded();
    mocked.setMacros.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked"));
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    mocked.unlockCancel.mockResolvedValueOnce({ ...UNLOCKING, state: "cancelled" });
    const saving = store.setMacros([[]]);
    await settle();
    await store.unlock.cancel();
    expect(await saving).toBe(false);
    expect(mocked.setMacros).toHaveBeenCalledTimes(1);
    expect(toasts.items.map((t) => t.message)).toEqual(["Saving the macro failed: The keyboard is locked, and it wasn't unlocked."]);
  });

  it("sends a change refused while another unlock runs again once that one ends", async () => {
    const { store, send } = await loaded();
    send({ type: "unlock", unlock: UNLOCKING });
    mocked.setMacros.mockRejectedValueOnce(new ApiError(423, "waiting for its unlock keys")).mockResolvedValueOnce(macros);
    const saving = store.setMacros([[]]);
    await settle();
    expect(mocked.unlockStart).not.toHaveBeenCalled();
    send({ type: "unlock", unlock: UNLOCKED });
    expect(await saving).toBe(true);
  });

  /** A macro save refused as the keyboard is locked, waiting for the unlock it started */
  async function waitingForUnlock() {
    const s = await loaded();
    mocked.setMacros.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked")).mockResolvedValue(macros);
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    const saving = s.store.setMacros([[]]);
    await settle();
    expect(s.store.unlock.open).toBe(true);
    expect(s.store.pending).toBe(1);
    return { ...s, saving };
  }

  const NOT_UNLOCKED = "Saving the macro failed: The keyboard is locked, and it wasn't unlocked.";

  it("fails the change waiting for its unlock when the keyboard is unplugged, even if the session can't be read", async () => {
    const { store, emit, saving } = await waitingForUnlock();
    mocked.session.mockRejectedValueOnce(new ApiError(0));
    emit("disconnected");
    await settle();
    expect(store.unlock.open).toBe(false);
    expect(store.pending).toBe(0);
    expect(await saving).toBe(false);
    expect(mocked.setMacros).toHaveBeenCalledTimes(1);
    expect(toasts.items.map((t) => t.message)).toEqual([NOT_UNLOCKED]);
  });

  it.each([
    [["disconnected", "connected"]],
    [["connected"]], // the events link was down while the first one was unplugged
  ] as const)("sends nothing to another, unlocked keyboard plugged in meanwhile (%j)", async (events) => {
    const { store, emit, saving } = await waitingForUnlock();
    mocked.session.mockResolvedValue({ fake: true, unlock: UNLOCKED } as never);
    for (const event of events) emit(event);
    await settle();
    expect(store.pending).toBe(0);
    expect(await saving).toBe(false);
    expect(mocked.setMacros).toHaveBeenCalledTimes(1);
    expect(toasts.items.map((t) => t.message)).toEqual([NOT_UNLOCKED]);
  });

  it("sends the change again after a reload while it waited for its unlock", async () => {
    const { send, emit, saving } = await waitingForUnlock();
    mocked.session.mockResolvedValue({ fake: true, unlock: UNLOCKING } as never);
    emit("reloaded");
    await settle();
    send({ type: "unlock", unlock: UNLOCKED });
    expect(await saving).toBe(true);
    expect(mocked.setMacros).toHaveBeenCalledTimes(2);
  });

  it("fails once, with one message, when the change sent again is refused again", async () => {
    const { store, send, saving } = await waitingForUnlock();
    mocked.setMacros.mockRejectedValue(new ApiError(423, "the keyboard is locked: unlock it to make this change"));
    send({ type: "unlock", unlock: UNLOCKED });
    expect(await saving).toBe(false);
    await settle();
    expect(mocked.setMacros).toHaveBeenCalledTimes(2);
    expect(mocked.unlockStart).toHaveBeenCalledTimes(1);
    expect(store.pending).toBe(0);
    expect(toasts.items.map((t) => t.message))
      .toEqual(["Saving the macro failed: the keyboard is locked: unlock it to make this change"]);
  });

  it("fails with one message when the unlock can't start", async () => {
    const { store } = await loaded();
    mocked.setMacros.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked"));
    mocked.unlockStart.mockRejectedValueOnce(new ApiError(502));
    expect(await store.setMacros([[]])).toBe(false);
    expect(mocked.setMacros).toHaveBeenCalledTimes(1);
    expect(store.unlock.open).toBe(false);
    expect(toasts.items.map((t) => t.message))
      .toEqual(["Saving the macro failed: The keyboard is locked, and unlocking it failed: The keyboard didn't respond."]);
  });
});
