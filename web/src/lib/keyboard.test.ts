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
    setKeyOverride: vi.fn(),
    setAltRepeatKey: vi.fn(),
    setSetting: vi.fn(),
    resetSettings: vi.fn(),
    loadLayoutFile: vi.fn(),
    setMacros: vi.fn(),
    setName: vi.fn(),
    unlockStart: vi.fn(),
    unlockCancel: vi.fn(),
    lock: vi.fn(),
    setLayoutOptions: vi.fn(),
    setLighting: vi.fn(),
    saveLighting: vi.fn(),
    rebootToBootloader: vi.fn(),
  },
}));
vi.mock("../api/events", () => ({ connectEvents: vi.fn(() => ({ close: vi.fn(), send: vi.fn() })) }));
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
  const events = vi.mocked(connectEvents).mock.results.at(-1)!.value as { send: ReturnType<typeof vi.fn> };
  onLink("open");
  // the server leaves out what an event doesn't carry
  const send = (event: Pick<ServerEvent, "type"> & Partial<ServerEvent>) => onEvent({ unlock: null, matrix: null, ...event });
  return { store, emit: (type: ServerEvent["type"]) => send({ type }), send, link: onLink,
    sent: events.send };
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

describe("key overrides, alt-repeat keys, QMK settings and layout files", () => {
  const override = {
    index: 0, trigger: described("KC_BSPC"), replacement: described("KC_DEL"), layers: 1, triggerMods: 2,
    negativeModMask: 0, suppressedMods: 2, options: 0x87, enabled: true,
  };
  const body = { trigger: "KC_BSPC", replacement: "KC_DEL", layers: 1, triggerMods: 2, negativeModMask: 0,
    suppressedMods: 2, options: 0x87 };

  it("put the keyboard's key override and alt-repeat key into the model", async () => {
    const { store } = await loaded();
    store.model!.keyOverrides = [{ ...override, trigger: described("KC_NO") }];
    mocked.setKeyOverride.mockResolvedValueOnce(override);
    expect(await store.setKeyOverride(0, body)).toBe(true);
    expect(mocked.setKeyOverride).toHaveBeenCalledWith(0, body);
    expect(store.model!.keyOverrides[0].trigger.code).toBe("KC_BSPC");

    const ark = { index: 0, keycode: described("KC_LEFT"), altKeycode: described("KC_RGHT"), allowedMods: 0, options: 8,
      enabled: true };
    store.model!.altRepeatKeys = [{ ...ark, keycode: described("KC_NO") }];
    mocked.setAltRepeatKey.mockResolvedValueOnce(ark);
    expect(await store.setAltRepeatKey(0, { keycode: "KC_LEFT", altKeycode: "KC_RGHT", allowedMods: 0, options: 8 }))
      .toBe(true);
    expect(store.model!.altRepeatKeys[0].keycode.code).toBe("KC_LEFT");
  });

  it("set QMK settings one after another; those set before one fails stay set", async () => {
    const { store } = await loaded();
    store.model!.settings = [{ qsid: 7, value: 200 }, { qsid: 22, value: 0 }, { qsid: 25, value: 100 }];
    mocked.setSetting.mockResolvedValueOnce({ qsid: 7, value: 250 })
      .mockRejectedValueOnce(new ApiError(422, "setting 22 must be a number from 0 to 255"));
    expect(await store.setSettings([{ qsid: 7, value: 250 }, { qsid: 22, value: 300 }, { qsid: 25, value: 90 }]))
      .toBe(false);
    expect(mocked.setSetting).toHaveBeenCalledTimes(2);
    expect(store.model!.settings).toEqual([{ qsid: 7, value: 250 }, { qsid: 22, value: 0 }, { qsid: 25, value: 100 }]);
    expect(toasts.items.map((t) => t.message)).toEqual([
      "Saving the settings failed: setting 22 must be a number from 0 to 255"]);
  });

  it("stop saving QMK settings when another keyboard is plugged in meanwhile", async () => {
    const { store, emit } = await loaded();
    store.model!.settings = [{ qsid: 7, value: 200 }, { qsid: 22, value: 0 }];
    mocked.setSetting.mockImplementationOnce(async () => {
      emit("connected"); // another keyboard, while the first setting's reply is on its way
      return { qsid: 7, value: 250 };
    });
    expect(await store.setSettings([{ qsid: 7, value: 250 }, { qsid: 22, value: 5 }])).toBe(false);
    expect(mocked.setSetting.mock.calls).toEqual([[7, 250]]);
    expect(toasts.items.map((t) => t.message)).toEqual([
      "Saving the settings failed: another keyboard was plugged in; the settings not yet saved were left as they were"]);
  });

  it("reset the QMK settings to what the keyboard says they are now", async () => {
    const { store } = await loaded();
    store.model!.settings = [{ qsid: 7, value: 250 }];
    mocked.resetSettings.mockResolvedValueOnce([{ qsid: 7, value: 200 }]);
    expect(await store.resetSettings()).toBe(true);
    expect(store.model!.settings).toEqual([{ qsid: 7, value: 200 }]);
  });

  it("say why the QMK settings weren't reset when the keyboard can't be changed just now", async () => {
    const { store, emit } = await loaded();
    // read again (a change made elsewhere): nothing can be changed until it is
    mocked.keyboard.mockReturnValue(new Promise(() => undefined));
    emit("reloaded");
    expect(store.canEdit).toBe(false);
    expect(await store.resetSettings()).toBe(false);
    expect(mocked.resetSettings).not.toHaveBeenCalled();
    expect(toasts.items.map((t) => t.message)).toEqual([
      "Resetting the settings failed: the keyboard can't be changed just now."]);
  });

  it("load a layout file: the model is the keyboard's reply", async () => {
    const { store } = await loaded();
    const after = model("KC_Z");
    mocked.loadLayoutFile.mockResolvedValueOnce(after);
    expect(await store.loadLayoutFile("{}")).toBe(true);
    expect(mocked.loadLayoutFile).toHaveBeenCalledWith("{}");
    expect(store.model!.layers[0].keys[0].code).toBe("KC_Z");
  });

  it("load a layout file: the reply isn't installed when a load replaced the model meanwhile; the keyboard is read again", async () => {
    const { store } = await loaded();
    const newer = model("KC_B");
    mocked.loadLayoutFile.mockImplementationOnce(async () => {
      store.model = newer; // a load landed while the file was being written
      return model("KC_Z");
    });
    mocked.keyboard.mockClear();
    expect(await store.loadLayoutFile("{}")).toBe(true);
    expect(store.model).toBe(newer);
    expect(mocked.keyboard).toHaveBeenCalledTimes(1);
  });

  it("load a layout file a locked keyboard refused once it is unlocked: the whole file again", async () => {
    const { store, send } = await loaded();
    mocked.loadLayoutFile.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked"))
      .mockResolvedValueOnce(model("KC_Z"));
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    const loading = store.loadLayoutFile("{\"macro\": []}");
    await settle();
    expect(store.unlock.open).toBe(true);
    send({ type: "unlock", unlock: UNLOCKED });
    expect(await loading).toBe(true);
    expect(mocked.loadLayoutFile.mock.calls).toEqual([["{\"macro\": []}"], ["{\"macro\": []}"]]);
    expect(store.model!.layers[0].keys[0].code).toBe("KC_Z");
    expect(toasts.items).toEqual([]);
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
    [["connected"]], // a keyboard plugged in, on a link that stayed open
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

  it("sends the change again when the events link comes back to the same keyboard", async () => {
    // the server's first event on the new link says "connected": the keyboard is still there, not plugged in again
    const { store, send, emit, link, saving } = await waitingForUnlock();
    mocked.session.mockResolvedValue({ fake: true, unlock: UNLOCKING } as never);
    link("closed");
    link("open");
    emit("connected");
    await settle();
    expect(store.canEdit).toBe(true);
    send({ type: "unlock", unlock: UNLOCKED });
    expect(await saving).toBe(true);
    expect(mocked.setMacros).toHaveBeenCalledTimes(2);
    expect(toasts.items).toEqual([]);
  });

  it("sends nothing to another keyboard found when the events link comes back", async () => {
    // plugged in while the link was down: only its model tells
    const { store, emit, link, saving } = await waitingForUnlock();
    mocked.keyboard.mockResolvedValue({ ...model("KC_A"), uid: "another" });
    mocked.session.mockResolvedValue({ fake: true, unlock: UNLOCKED } as never);
    link("closed");
    link("open");
    emit("connected");
    await settle();
    expect(store.pending).toBe(0);
    expect(await saving).toBe(false);
    expect(mocked.setMacros).toHaveBeenCalledTimes(1);
    expect(toasts.items.map((t) => t.message)).toEqual([NOT_UNLOCKED]);
  });

  it("fails the change when the events link comes back to no keyboard", async () => {
    const { store, emit, link, saving } = await waitingForUnlock();
    link("closed");
    link("open");
    emit("disconnected");
    await settle();
    expect(store.pending).toBe(0);
    expect(await saving).toBe(false);
    expect(mocked.setMacros).toHaveBeenCalledTimes(1);
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

describe("moving keycodes between keys", () => {
  const A = { kind: "key" as const, index: 0 };
  const B = { kind: "key" as const, index: 1 };
  // swapping KC_A (row 0, column 0) and KC_B (row 0, column 1): B first, then A
  const swap = [{ ref: B, code: "KC_A", was: "KC_B" }, { ref: A, code: "KC_B", was: "KC_A" }];
  const ACTION = "Swapping the keys";

  /** A loaded store with KC_A at (0, 0) and KC_B at (0, 1); the keyboard takes every keycode it is sent */
  async function twoKeys() {
    const two = model("KC_A");
    two.keys = [{ row: 0, col: 0 }, { row: 0, col: 1 }] as never;
    two.layers[0].keys = [described("KC_A"), described("KC_B")];
    mocked.keyboard.mockResolvedValue(two);
    mocked.setKey.mockImplementation(async (_layer, _row, _col, code) => described(code));
    const s = await loaded();
    return { ...s, codes: () => s.store.model!.layers[0].keys.map((k) => k.code) };
  }

  const sent = () => mocked.setKey.mock.calls.map(([layer, row, col, code]) => `${layer}:${row},${col}=${code}`);
  const messages = () => toasts.items.map((t) => t.message);

  it("writes each key in turn, and shows what the keyboard confirmed", async () => {
    const { store, codes } = await twoKeys();
    const moving = store.setCodes(0, swap, ACTION);
    expect(store.pending).toBe(1);
    expect(await moving).toBe(true);
    expect(sent()).toEqual(["0:0,1=KC_A", "0:0,0=KC_B"]);
    expect(codes()).toEqual(["KC_B", "KC_A"]);
    expect(store.pending).toBe(0);
    expect(messages()).toEqual([]);
  });

  it("puts the first key back when the second can't be written, and says so", async () => {
    const { store, codes } = await twoKeys();
    mocked.setKey.mockImplementationOnce(async (_l, _r, _c, code) => described(code))
      .mockRejectedValueOnce(new ApiError(502));
    expect(await store.setCodes(0, swap, ACTION)).toBe(false);
    expect(sent()).toEqual(["0:0,1=KC_A", "0:0,0=KC_B", "0:0,1=KC_B"]);
    expect(codes()).toEqual(["KC_A", "KC_B"]);
    expect(messages()).toEqual([
      "Swapping the keys failed: The keyboard didn't respond. The key at row 0, column 1 was put back as it was.",
    ]);
    expect(store.pending).toBe(0);
  });

  it("says which key kept its change, by what it does now, when putting it back fails too", async () => {
    const { store, codes } = await twoKeys();
    mocked.setKey.mockImplementationOnce(async (_l, _r, _c, code) => ({ ...described(code), tap: "A" }))
      .mockRejectedValue(new ApiError(502));
    expect(await store.setCodes(0, swap, ACTION)).toBe(false);
    expect(codes()).toEqual(["KC_A", "KC_A"]);
    expect(messages()).toEqual([
      "Swapping the keys failed: The keyboard didn't respond. The key at row 0, column 1 is now A: putting it back " +
        "failed too.",
    ]);
  });

  it("names the keys as the caller does", async () => {
    const { store } = await twoKeys();
    mocked.setKey.mockImplementationOnce(async (_l, _r, _c, code) => described(code))
      .mockRejectedValueOnce(new ApiError(502));
    const place = (ref: { index: number }) => ["left top row, 1st from the outside", "left top row, 2nd from the outside"][ref.index];
    expect(await store.setCodes(0, swap, ACTION, place)).toBe(false);
    expect(messages()).toEqual([
      "Swapping the keys failed: The keyboard didn't respond. Left top row, 2nd from the outside was put back as it was.",
    ]);
  });

  it("says the first key was already changed when the keyboard was unplugged before the second: nothing is put back", async () => {
    const { store, emit, codes } = await twoKeys();
    const second = deferred<Described>();
    mocked.setKey.mockImplementationOnce(async (_l, _r, _c, code) => ({ ...described(code), tap: "A" }))
      .mockReturnValueOnce(second.promise);
    const moving = store.setCodes(0, swap, ACTION);
    await settle();
    emit("disconnected");
    second.reject(new ApiError(503));
    expect(await moving).toBe(false);
    expect(sent()).toEqual(["0:0,1=KC_A", "0:0,0=KC_B"]);
    expect(codes()).toEqual(["KC_A", "KC_A"]);
    expect(messages()).toEqual([
      "Swapping the keys failed: The keyboard isn't connected. The key at row 0, column 1 was already changed to A: " +
        "it wasn't put back, as the keyboard was unplugged or replaced.",
    ]);
  });

  it("writes the bootloader key first; nothing is written when the unlock is refused", async () => {
    const { store, codes } = await twoKeys();
    // KC_A dragged onto QK_BOOT, swapped: QK_BOOT goes where KC_A was, which a locked keyboard refuses
    store.model!.layers[0].keys[1] = described("QK_BOOT");
    const bootSwap = [{ ref: B, code: "KC_A", was: "QK_BOOT" }, { ref: A, code: "QK_BOOT", was: "KC_A" }];
    mocked.setKey.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked"));
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    mocked.unlockCancel.mockResolvedValueOnce({ ...UNLOCKING, state: "cancelled" });
    const moving = store.setCodes(0, bootSwap, ACTION);
    await settle();
    await store.unlock.cancel();
    expect(await moving).toBe(false);
    expect(sent()).toEqual(["0:0,0=QK_BOOT"]);
    expect(codes()).toEqual(["KC_A", "QK_BOOT"]);
    expect(messages()).toEqual(["Swapping the keys failed: The keyboard is locked, and it wasn't unlocked."]);
  });

  it("writes nothing more, and puts nothing back, when the first key can't be written", async () => {
    const { store, codes } = await twoKeys();
    mocked.setKey.mockRejectedValueOnce(new ApiError(502));
    expect(await store.setCodes(0, swap, ACTION)).toBe(false);
    expect(sent()).toEqual(["0:0,1=KC_A"]);
    expect(codes()).toEqual(["KC_A", "KC_B"]);
    expect(messages()).toEqual(["Swapping the keys failed: The keyboard didn't respond."]);
  });

  it("goes on from the key a locked keyboard refused once it is unlocked", async () => {
    const { store, send, codes } = await twoKeys();
    mocked.setKey.mockImplementationOnce(async (_l, _r, _c, code) => described(code))
      .mockRejectedValueOnce(new ApiError(423, "the keyboard is locked"));
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    const moving = store.setCodes(0, swap, ACTION);
    await settle();
    expect(store.unlock.open).toBe(true);
    send({ type: "unlock", unlock: UNLOCKED });
    expect(await moving).toBe(true);
    expect(sent()).toEqual(["0:0,1=KC_A", "0:0,0=KC_B", "0:0,0=KC_B"]);
    expect(codes()).toEqual(["KC_B", "KC_A"]);
    expect(messages()).toEqual([]);
  });

  it("puts the first key back when the keyboard wasn't unlocked for the second", async () => {
    const { store, codes } = await twoKeys();
    mocked.setKey.mockImplementationOnce(async (_l, _r, _c, code) => described(code))
      .mockRejectedValueOnce(new ApiError(423, "the keyboard is locked"));
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    mocked.unlockCancel.mockResolvedValueOnce({ ...UNLOCKING, state: "cancelled" });
    const moving = store.setCodes(0, swap, ACTION);
    await settle();
    await store.unlock.cancel();
    expect(await moving).toBe(false);
    expect(codes()).toEqual(["KC_A", "KC_B"]);
    expect(messages()).toEqual([
      "Swapping the keys failed: The keyboard is locked, and it wasn't unlocked. The key at row 0, column 1 was put " +
        "back as it was.",
    ]);
  });

  it("refuses keys with no matrix position, writing none of them", async () => {
    const { store } = await loaded();
    const noPosition = [{ ref: A, code: "KC_B", was: "KC_A" }, { ref: { kind: "key" as const, index: 1 }, code: "KC_A", was: "KC_NO" }];
    expect(await store.setCodes(0, noPosition, ACTION)).toBe(false);
    expect(mocked.setKey).not.toHaveBeenCalled();
    expect(messages().join()).toContain("that key has no matrix position");
  });

  it("does nothing while the keyboard can't be changed", async () => {
    const { store, emit } = await twoKeys();
    emit("disconnected");
    expect(await store.setCodes(0, swap, ACTION)).toBe(false);
    expect(mocked.setKey).not.toHaveBeenCalled();
  });
});

describe("the phase 5b changes", () => {
  it("sets the layout options and keeps what the keyboard answered", async () => {
    const { store } = await loaded();
    store.model!.layoutOptions = { value: 0, labels: ["Split"] };
    mocked.setLayoutOptions.mockResolvedValueOnce({ value: 1 });
    expect(await store.setLayoutOptions(1)).toBe(true);
    expect(mocked.setLayoutOptions).toHaveBeenCalledWith(1);
    expect(store.model!.layoutOptions!.value).toBe(1);
  });

  it("changes and saves the lighting, showing what the keyboard answered", async () => {
    const { store } = await loaded();
    const shown = { vialrgb: { mode: 3, speed: 9, hsv: [1, 2, 3], maxBrightness: 200, supportedEffects: [0, 3] } };
    mocked.setLighting.mockResolvedValueOnce(shown as never);
    expect(await store.setLighting({ vialrgb: { mode: 3 } })).toBe(true);
    expect(store.model!.lighting).toEqual(shown);
    mocked.saveLighting.mockResolvedValueOnce(shown as never);
    expect(await store.saveLighting()).toBe(true);
    mocked.setLighting.mockRejectedValueOnce(new ApiError(502));
    expect(await store.setLighting({ vialrgb: { mode: 4 } }, "Choosing the effect")).toBe(false);
    expect(toasts.items.map((t) => t.message)).toEqual(["Choosing the effect failed: The keyboard didn't respond."]);
  });

  it("restarts the keyboard into its bootloader after unlocking it, and shows it gone", async () => {
    const { store, send, emit } = await loaded();
    mocked.rebootToBootloader.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked"))
      .mockResolvedValueOnce({ status: "disconnected", fake: true, unlock: LOCKED } as never);
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    const rebooting = store.rebootToBootloader();
    await settle();
    expect(store.unlock.open).toBe(true);
    send({ type: "unlock", unlock: UNLOCKED });
    expect(await rebooting).toBe(true);
    expect(mocked.rebootToBootloader).toHaveBeenCalledTimes(2);
    expect(store.inBootloader).toBe(true);
    expect(store.connected).toBe(false);
    expect(store.canEdit).toBe(false);
    emit("disconnected");
    expect(store.inBootloader).toBe(true);
    // flashed or plugged in again: back
    emit("connected");
    expect(store.inBootloader).toBe(false);
  });

  it("says why a keyboard that can't be changed isn't restarted", async () => {
    const { store, emit } = await loaded();
    emit("disconnected");
    expect(await store.rebootToBootloader()).toBe(false);
    expect(mocked.rebootToBootloader).not.toHaveBeenCalled();
    expect(toasts.items.map((t) => t.message))
      .toEqual(["Restarting the keyboard into its bootloader failed: the keyboard can't be changed just now."]);
  });

  it("asks for the keys held while a page watches, and again on a new link", async () => {
    const { store, sent, link, send } = await loaded();
    const stopFirst = store.watchMatrix();
    const stopSecond = store.watchMatrix();
    expect(sent.mock.calls).toEqual([[{ type: "matrix", watch: true }]]);
    const matrix = { state: "testing" as const, pressed: [{ row: 0, col: 1 }] };
    send({ type: "matrix", matrix });
    expect(store.matrix).toEqual(matrix);
    link("closed");
    link("open");
    expect(sent.mock.calls.at(-1)).toEqual([{ type: "matrix", watch: true }]);
    stopFirst();
    stopFirst();
    expect(sent.mock.calls.filter(([m]) => !m.watch)).toEqual([]);
    stopSecond();
    expect(sent.mock.calls.at(-1)).toEqual([{ type: "matrix", watch: false }]);
    expect(store.matrix).toBeNull();
    // a late reading after the page stopped watching is dropped
    send({ type: "matrix", matrix });
    expect(store.matrix).toBeNull();
  });
});
