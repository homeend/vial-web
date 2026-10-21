import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import type {
  ArrangedModel, Described, KeyboardEntry, KeyboardLanguage, KeyboardList, KeyboardModel, ServerEvent, Session, SettingField,
  UnlockState,
} from "../api/types";

vi.mock("../api/api", () => ({
  api: {
    session: vi.fn(),
    keyboards: vi.fn(),
    selectKeyboard: vi.fn(),
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
    shutdown: vi.fn(),
    arrangeLayers: vi.fn(),
    finishArrange: vi.fn(),
    putBackArrange: vi.fn(),
  },
}));
vi.mock("../api/events", () => ({ connectEvents: vi.fn(() => ({ close: vi.fn(), send: vi.fn() })) }));
vi.mock("../api/client", () => ({ DEFAULT_LANGUAGE: "en-us", setRequestLanguage: vi.fn(), setRequestKeyboard: vi.fn() }));

const { api } = await import("../api/api");
const { connectEvents } = await import("../api/events");
const { setRequestKeyboard, setRequestLanguage } = await import("../api/client");
const { KeyboardStore } = await import("./keyboard.svelte");
const { toasts } = await import("./toasts.svelte");
const { settingsEdits } = await import("../settings/state.svelte");

const SWAP = { type: "boolean", title: "Swap", qsid: 21, bit: 0 } as SettingField;

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
  mocked.keyboards.mockResolvedValue({ keyboards: [], chosen: null });
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
    const listReads = mocked.keyboards.mock.calls.length;
    expect(await store.setSettings([{ qsid: 7, value: 250 }, { qsid: 22, value: 5 }])).toBe(false);
    expect(mocked.setSetting.mock.calls).toEqual([[7, 250]]);
    expect(toasts.items.map((t) => t.message)).toEqual([
      "Saving the settings failed: another keyboard was plugged in; the settings not yet saved were left as they were"]);
    // not the server's refusal of a change meant for another keyboard (409): the list isn't read for it
    await settle();
    expect(mocked.keyboards.mock.calls.length).toBe(listReads);
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

  it("takes the keys held, sent while a change waits for its unlock, for no plug, also first on a new link", async () => {
    const { store, send, emit, link, saving } = await waitingForUnlock();
    store.watchMatrix();
    const matrix = { state: "locked" as const, pressed: [] };
    send({ type: "matrix", matrix });
    mocked.session.mockResolvedValue({ fake: true, unlock: UNLOCKING } as never);
    link("closed");
    link("open");
    // a reading before the server's first event: that one ("connected") still says the keyboard stayed
    send({ type: "matrix", matrix });
    emit("connected");
    await settle();
    send({ type: "unlock", unlock: UNLOCKED });
    expect(await saving).toBe(true);
    expect(mocked.setMacros).toHaveBeenCalledTimes(2);
    expect(toasts.items).toEqual([]);
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

  it("puts nothing back when the server says another keyboard is open now: nothing more is sent to it", async () => {
    const { store } = await twoKeys();
    const loads = mocked.keyboard.mock.calls.length;
    mocked.setKey.mockImplementationOnce(async (_l, _r, _c, code) => described(code))
      .mockRejectedValueOnce(new ApiError(409, "The keyboard changed (another one was opened): this change was not sent."));
    expect(await store.setCodes(0, swap, ACTION)).toBe(false);
    expect(sent()).toEqual(["0:0,1=KC_A", "0:0,0=KC_B"]);
    expect(messages()).toEqual([
      "Swapping the keys failed: The keyboard changed (another one was opened): this change was not sent. The key at " +
        "row 0, column 1 was already changed to KC_A: it wasn't put back, as the keyboard was unplugged or replaced.",
    ]);
    await settle();
    // what there is now is read
    expect(mocked.keyboard.mock.calls.length).toBeGreaterThan(loads);
    expect(mocked.keyboards).toHaveBeenCalled();
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
    // the save's reply, what the keyboard kept, is shown (a key on the keyboard may have changed it meanwhile)
    const kept = { vialrgb: { ...shown.vialrgb, mode: 5 } };
    mocked.saveLighting.mockResolvedValueOnce(kept as never);
    expect(await store.saveLighting()).toBe(true);
    expect(store.model!.lighting).toEqual(kept);
    mocked.setLighting.mockRejectedValueOnce(new ApiError(502));
    expect(await store.setLighting({ vialrgb: { mode: 4 } }, "Choosing the effect")).toBe(false);
    expect(toasts.items.map((t) => t.message)).toEqual(["Choosing the effect failed: The keyboard didn't respond."]);
    expect(store.model!.lighting).toEqual(kept);
  });

  it("says so when saving the lighting fails, and keeps what the keyboard showed", async () => {
    const { store } = await loaded();
    const shown = { backlight: { brightness: 170, effect: 0 } };
    store.model!.lighting = shown as never;
    mocked.saveLighting.mockRejectedValueOnce(new ApiError(502));
    expect(await store.saveLighting()).toBe(false);
    expect(store.model!.lighting).toEqual(shown);
    expect(toasts.items.map((t) => t.message)).toEqual(["Saving the lighting failed: The keyboard didn't respond."]);
  });

  it.each([502, 503])("sends a reboot that failed (%i) once: it isn't sent again", async (status) => {
    const { store } = await loaded();
    mocked.rebootToBootloader.mockRejectedValueOnce(new ApiError(status));
    expect(await store.rebootToBootloader()).toBe(false);
    expect(mocked.rebootToBootloader).toHaveBeenCalledTimes(1);
    expect(store.inBootloader).toBe(false);
    expect(toasts.items).toHaveLength(1);
  });

  it("forgets the keys held when the events link goes, and when the keyboard is plugged in or unplugged", async () => {
    const { store, send, emit, link } = await loaded();
    store.watchMatrix();
    const matrix = { state: "testing" as const, pressed: [{ row: 0, col: 1 }] };
    send({ type: "matrix", matrix });
    link("closed");
    expect(store.matrix).toBeNull();
    link("open");
    for (const type of ["disconnected", "connected"] as const) {
      send({ type: "matrix", matrix });
      expect(store.matrix).toEqual(matrix);
      emit(type);
      expect(store.matrix).toBeNull();
    }
  });

  it("reboots the keyboard into its bootloader after unlocking it, and shows it gone", async () => {
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

  it("says why a keyboard that can't be changed isn't rebooted", async () => {
    const { store, emit } = await loaded();
    emit("disconnected");
    expect(await store.rebootToBootloader()).toBe(false);
    expect(mocked.rebootToBootloader).not.toHaveBeenCalled();
    expect(toasts.items.map((t) => t.message))
      .toEqual(["Rebooting the keyboard into its bootloader failed: the keyboard can't be changed just now."]);
  });

  it("takes a keyboard that goes while the reboot is on its way for the reboot: the event comes before the reply",
    async () => {
      const { store, emit } = await loaded();
      const reply = deferred<Session>();
      mocked.rebootToBootloader.mockReturnValueOnce(reply.promise as never);
      const rebooting = store.rebootToBootloader();
      await settle();
      expect(store.rebooting).toBe(true);
      emit("disconnected");
      // what the page shows meanwhile is the bootloader's, not an unplug
      expect(store.connected).toBe(false);
      expect(store.rebooting || store.inBootloader).toBe(true);
      reply.resolve({ status: "disconnected", fake: true, unlock: LOCKED } as Session);
      expect(await rebooting).toBe(true);
      expect(store.rebooting).toBe(false);
      expect(store.inBootloader).toBe(true);
      expect(store.bootloaderUnanswered).toBe(false);
      expect(toasts.items).toEqual([]);
    });

  it("shows a reboot the keyboard got and didn't answer (504) as most likely done, not as a failure", async () => {
    const { store, emit } = await loaded();
    mocked.rebootToBootloader.mockRejectedValueOnce(new ApiError(504, "the keyboard didn't answer"));
    const rebooting = store.rebootToBootloader();
    emit("disconnected");
    expect(await rebooting).toBe(true);
    expect(store.inBootloader).toBe(true);
    expect(store.bootloaderUnanswered).toBe(true);
    expect(store.connected).toBe(false);
    expect(toasts.items).toEqual([]);
    // it was there after all, or is back: the hedge goes with the rest
    emit("connected");
    expect(store.inBootloader).toBe(false);
    expect(store.bootloaderUnanswered).toBe(false);
  });

  it("fails a reboot that wasn't sent (503), and doesn't show the bootloader's", async () => {
    const { store, emit } = await loaded();
    mocked.rebootToBootloader.mockRejectedValueOnce(new ApiError(503, "keyboard disconnected"));
    const rebooting = store.rebootToBootloader();
    emit("disconnected");
    expect(await rebooting).toBe(false);
    expect(store.inBootloader).toBe(false);
    expect(store.rebooting).toBe(false);
    expect(toasts.items.map((t) => t.message))
      .toEqual(["Rebooting the keyboard into its bootloader failed: The keyboard isn't connected."]);
  });

  it("ignores a reboot reply that comes after the keyboard was plugged in again", async () => {
    const { store, emit } = await loaded();
    const reply = deferred<Session>();
    mocked.rebootToBootloader.mockReturnValueOnce(reply.promise as never);
    const rebooting = store.rebootToBootloader();
    await settle();
    emit("disconnected");
    emit("connected");
    reply.resolve({ status: "disconnected", fake: true, unlock: LOCKED } as Session);
    expect(await rebooting).toBe(true);
    expect(store.inBootloader).toBe(false);
    expect(store.connected).toBe(true);
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

describe("the keyboard selector", () => {
  function entry(id: string, more: Partial<KeyboardEntry> = {}): KeyboardEntry {
    return {
      id, name: id.toUpperCase(), product: id.toUpperCase(), manufacturer: "", vendorId: 1, productId: 2, serial: null,
      path: `usb-${id}`, open: false, plugged: true, ...more,
    };
  }
  const TWO: KeyboardList = { keyboards: [entry("a", { open: true }), entry("b")], chosen: null };
  const session = (more: Partial<Session> = {}) =>
    ({ status: "connected", fake: true, unlock: LOCKED, keyboard: "a", platform: "win32", ...more }) as Session;
  /** model(code), as another keyboard */
  const other = (code: string) => ({ ...model(code), uid: "other", name: "Other" }) as KeyboardModel;

  it("reads the list when the events link opens", async () => {
    mocked.keyboards.mockResolvedValue(TWO);
    const { store } = started();
    await settle();
    expect(store.keyboards).toEqual(TWO);
  });

  it("reads the list and the session again on a keyboards event, which is no plug", async () => {
    const { store, send } = await loaded();
    const loads = mocked.keyboard.mock.calls.length;
    mocked.keyboards.mockResolvedValue(TWO);
    mocked.session.mockResolvedValue(session({ error: "bad" }));
    send({ type: "keyboards" });
    await settle();
    expect(store.keyboards).toEqual(TWO);
    expect(store.session?.error).toBe("bad");
    expect(mocked.keyboard.mock.calls.length).toBe(loads);
    expect(store.canEdit).toBe(true);
  });

  it("keeps the latest session read: one a list reading brings after a load's newer one is older", async () => {
    const { store, send } = await loaded();
    const older = deferred<Session>();
    mocked.keyboards.mockResolvedValue(TWO);
    mocked.session.mockReturnValueOnce(older.promise);
    send({ type: "keyboards" });
    mocked.session.mockResolvedValue(session());
    await store.load();
    expect(store.session?.error ?? null).toBeNull();
    older.resolve(session({ error: "gone by now" }));
    await settle();
    expect(store.keyboards).toEqual(TWO);
    expect(store.session?.error ?? null).toBeNull();
    // the next reading is newer
    mocked.session.mockResolvedValue(session({ error: "now" }));
    send({ type: "keyboards" });
    await settle();
    expect(store.session?.error).toBe("now");
  });

  it("shows an error that appears or clears while no keyboard is loaded", async () => {
    const { store, emit, send } = started();
    mocked.session.mockResolvedValue(session({ status: "disconnected", keyboard: null }));
    emit("disconnected");
    await settle();
    expect(store.session?.error ?? null).toBeNull();
    mocked.session.mockResolvedValue(session({ status: "disconnected", keyboard: null, error: "unsupported" }));
    send({ type: "keyboards" });
    await settle();
    expect(store.session?.error).toBe("unsupported");
    mocked.session.mockResolvedValue(session({ status: "disconnected", keyboard: null }));
    send({ type: "keyboards" });
    await settle();
    expect(store.session?.error ?? null).toBeNull();
  });

  it("opens another keyboard once the edits on their way are done, refusing new ones meanwhile", async () => {
    mocked.session.mockResolvedValue(session());
    const { store } = await loaded();
    const write = deferred<Described>();
    mocked.setKey.mockReturnValueOnce(write.promise);
    const editing = store.setCode(0, { kind: "key", index: 0 }, "KC_B");
    mocked.selectKeyboard.mockResolvedValue({ keyboards: [entry("a"), entry("b", { open: true })], chosen: "b" });
    mocked.session.mockResolvedValue(session({ keyboard: "b" }));
    mocked.keyboard.mockResolvedValue(other("KC_Z"));
    const switching = store.selectKeyboard("b");
    expect(store.switching).toBe("b");
    expect(store.canEdit).toBe(false);
    expect(await store.setCode(0, { kind: "key", index: 0 }, "KC_C")).toBe(false);
    await settle();
    expect(mocked.selectKeyboard).not.toHaveBeenCalled();
    write.resolve(described("KC_B"));
    expect(await editing).toBe(true);
    expect(await switching).toBe(true);
    expect(mocked.selectKeyboard).toHaveBeenCalledWith("b");
    expect(mocked.setKey).toHaveBeenCalledTimes(1);
    await settle();
    expect(store.model?.name).toBe("Other");
    expect(store.switching).toBeNull();
    expect(store.keyboards?.chosen).toBe("b");
    expect(store.canEdit).toBe(true);
  });

  it("keeps the keyboard shown, not editable, until the server has switched; a load on its way for it is not kept",
    async () => {
      mocked.session.mockResolvedValue(session());
      const { store, emit } = await loaded();
      const opened = store.opened;
      const late = deferred<KeyboardModel>();
      mocked.keyboard.mockReturnValueOnce(late.promise);
      emit("reloaded");
      const reply = deferred<KeyboardList>();
      mocked.selectKeyboard.mockReturnValueOnce(reply.promise);
      const switching = store.selectKeyboard("b");
      await settle();
      expect(store.model?.name).toBe("Test");
      expect(store.canEdit).toBe(false);
      expect(store.opened).toBe(opened);
      late.resolve(model("KC_OLD"));
      await settle();
      expect(store.model?.layers[0].keys[0].code).toBe("KC_A");
      expect(store.canEdit).toBe(false);
      mocked.keyboard.mockResolvedValue(other("KC_Z"));
      mocked.session.mockResolvedValue(session({ keyboard: "b" }));
      reply.resolve({ keyboards: [entry("a"), entry("b", { open: true })], chosen: "b" });
      await switching;
      expect(store.opened).toBeGreaterThan(opened);
      await settle();
      expect(store.model?.name).toBe("Other");
      expect(store.canEdit).toBe(true);
    });

  it("drops the work not saved once the server has switched, not before, and keeps it when the switch fails",
    async () => {
      mocked.session.mockResolvedValue(session());
      mocked.keyboards.mockResolvedValue(TWO);
      const { store } = await loaded();
      settingsEdits.follow("same");
      settingsEdits.toggle(SWAP, true, 0);
      const opened = store.opened;
      const refused = deferred<KeyboardList>();
      mocked.selectKeyboard.mockReturnValueOnce(refused.promise);
      const failing = store.selectKeyboard("b");
      await settle();
      expect(settingsEdits.keptFor("same")).toBe(true);
      refused.reject(new ApiError(404, "no keyboard b is plugged in"));
      expect(await failing).toBe(false);
      await settle();
      expect(settingsEdits.keptFor("same")).toBe(true);
      expect(store.opened).toBe(opened);

      const reply = deferred<KeyboardList>();
      mocked.selectKeyboard.mockReturnValueOnce(reply.promise);
      const switching = store.selectKeyboard("b");
      await settle();
      expect(settingsEdits.keptFor("same")).toBe(true);
      mocked.session.mockResolvedValue(session({ keyboard: "b" }));
      reply.resolve({ keyboards: [entry("a"), entry("b", { open: true })], chosen: "b" });
      expect(await switching).toBe(true);
      expect(settingsEdits.keptFor("same")).toBe(false);
      expect(store.opened).toBeGreaterThan(opened);
    });

  it("drops a toast whose action is on the keyboard shown (a move's Undo) once another keyboard is shown", async () => {
    mocked.session.mockResolvedValue(session());
    const { store } = await loaded();
    toasts.info("Swapped", { label: "Undo", run: () => true, onKeyboardShown: true });
    toasts.error("Something failed");
    mocked.selectKeyboard.mockResolvedValueOnce({ keyboards: [entry("a"), entry("b", { open: true })], chosen: "b" });
    mocked.session.mockResolvedValue(session({ keyboard: "b" }));
    expect(await store.selectKeyboard("b")).toBe(true);
    expect(toasts.items.map((t) => t.message)).toEqual(["Something failed"]);
  });

  it("takes a keyboard alike (the same uid) opened from another tab for another keyboard", async () => {
    const alike = { ...model("KC_A"), uid: "same" } as KeyboardModel;
    mocked.keyboard.mockResolvedValue(alike);
    mocked.session.mockResolvedValue(session());
    const { store, emit } = await loaded();
    expect(store.modelKeyboard).toBe("a");
    settingsEdits.follow("same");
    settingsEdits.toggle(SWAP, true, 0);
    const opened = store.opened;
    // read again, the same keyboard: nothing changes
    emit("reloaded");
    await settle();
    expect(store.opened).toBe(opened);
    expect(settingsEdits.keptFor("same")).toBe(true);
    // another tab opened the other one, just like it: its "connected" comes, and the session names it
    mocked.session.mockResolvedValue(session({ keyboard: "b" }));
    mocked.keyboard.mockResolvedValue({ ...alike });
    emit("connected");
    await settle();
    expect(store.modelKeyboard).toBe("b");
    expect(store.opened).toBeGreaterThan(opened);
    expect(settingsEdits.keptFor("same")).toBe(false);
  });

  it("doesn't send an edit that waited for an unlock again once a keyboard alike took the place", async () => {
    const alike = { ...model("KC_A"), uid: "same" } as KeyboardModel;
    mocked.keyboard.mockResolvedValue(alike);
    mocked.session.mockResolvedValue(session());
    const { store, send } = await loaded();
    mocked.setMacros.mockRejectedValueOnce(new ApiError(423, "locked"));
    mocked.unlockStart.mockResolvedValue(UNLOCKING);
    const saving = store.setMacros([[]]);
    await settle();
    send({ type: "unlock", unlock: UNLOCKING });
    mocked.session.mockResolvedValue(session({ keyboard: "b", unlock: UNLOCKED }));
    mocked.keyboard.mockResolvedValue({ ...alike });
    // a "keyboards" event, then the alike one's load (a reload brings no plug of its own)
    send({ type: "reloaded" });
    await settle();
    send({ type: "unlock", unlock: UNLOCKED });
    expect(await saving).toBe(false);
    expect(mocked.setMacros).toHaveBeenCalledTimes(1);
  });

  it("ends an unlock that edits wait for when another keyboard is opened: it was the one closed", async () => {
    mocked.session.mockResolvedValue(session());
    const { store, send } = await loaded();
    mocked.setMacros.mockRejectedValueOnce(new ApiError(423, "locked"));
    mocked.unlockStart.mockResolvedValue(UNLOCKING);
    const saving = store.setMacros([[]]);
    await settle();
    send({ type: "unlock", unlock: UNLOCKING });
    expect(store.unlock.open).toBe(true);
    mocked.session.mockResolvedValue(session({ keyboard: "b", unlock: UNLOCKED }));
    mocked.keyboard.mockResolvedValue(other("KC_Z"));
    // the selector can't be reached while the unlock dialog shows; another tab may switch meanwhile
    send({ type: "connected" });
    expect(await saving).toBe(false);
    expect(mocked.setMacros).toHaveBeenCalledTimes(1);
    await settle();
    expect(store.unlock.open).toBe(false);
  });

  it("puts the keyboard open back when the switch fails", async () => {
    mocked.session.mockResolvedValue(session());
    mocked.keyboards.mockResolvedValue(TWO);
    const { store } = await loaded();
    mocked.selectKeyboard.mockRejectedValueOnce(new ApiError(404, "no keyboard b is plugged in"));
    expect(await store.selectKeyboard("b")).toBe(false);
    await settle();
    expect(store.model?.name).toBe("Test");
    expect(store.canEdit).toBe(true);
    expect(store.switching).toBeNull();
    expect(toasts.items.map((t) => t.message)).toEqual(["Opening B failed: no keyboard b is plugged in"]);
  });

  it("does nothing when the keyboard is the one open, or a switch is on its way", async () => {
    mocked.keyboards.mockResolvedValue(TWO);
    mocked.session.mockResolvedValue(session());
    const { store } = await loaded();
    expect(await store.selectKeyboard("a")).toBe(true);
    expect(mocked.selectKeyboard).not.toHaveBeenCalled();
    const reply = deferred<KeyboardList>();
    mocked.selectKeyboard.mockReturnValueOnce(reply.promise);
    const first = store.selectKeyboard("b");
    expect(await store.selectKeyboard("b")).toBe(false);
    reply.resolve({ keyboards: [entry("a"), entry("b", { open: true })], chosen: "b" });
    expect(await first).toBe(true);
    expect(mocked.selectKeyboard).toHaveBeenCalledTimes(1);
  });

  it("sends each change for the keyboard shown, and for none once it is dropped", async () => {
    mocked.session.mockResolvedValue(session());
    const { store } = await loaded();
    expect(vi.mocked(setRequestKeyboard)).toHaveBeenLastCalledWith("a");
    const reply = deferred<KeyboardList>();
    mocked.selectKeyboard.mockReturnValueOnce(reply.promise);
    const switching = store.selectKeyboard("b");
    await settle();
    // until the server has switched, still the one shown
    expect(vi.mocked(setRequestKeyboard)).toHaveBeenLastCalledWith("a");
    const loading = deferred<KeyboardModel>();
    mocked.keyboard.mockReturnValueOnce(loading.promise);
    mocked.session.mockResolvedValue(session({ keyboard: "b" }));
    reply.resolve({ keyboards: [entry("a"), entry("b", { open: true })], chosen: "b" });
    await switching;
    expect(store.model).toBeNull();
    expect(vi.mocked(setRequestKeyboard)).toHaveBeenLastCalledWith(null);
    loading.resolve(other("KC_Z"));
    await settle();
    expect(vi.mocked(setRequestKeyboard)).toHaveBeenLastCalledWith("b");
  });

  it("takes a change refused as another keyboard is open for a failure, and reads what there is", async () => {
    mocked.session.mockResolvedValue(session());
    const { store } = await loaded();
    const loads = mocked.keyboard.mock.calls.length;
    mocked.setKey.mockRejectedValueOnce(
      new ApiError(409, "The keyboard changed (another one was opened): this change was not sent."));
    mocked.session.mockResolvedValue(session({ keyboard: "b" }));
    mocked.keyboard.mockResolvedValue(other("KC_Z"));
    expect(await store.setCode(0, { kind: "key", index: 0 }, "KC_B")).toBe(false);
    expect(toasts.items.map((t) => t.message)).toEqual([
      "Changing the key failed: The keyboard changed (another one was opened): this change was not sent."]);
    await settle();
    expect(mocked.keyboard.mock.calls.length).toBeGreaterThan(loads);
    expect(store.model?.name).toBe("Other");
    expect(store.model?.layers[0].keys[0].code).toBe("KC_Z");
  });

  it("drops a keyboard no longer chosen once none is open, and keeps the chosen one unplugged", async () => {
    mocked.session.mockResolvedValue(session());
    const { store, emit, send } = await loaded();
    // the chosen keyboard unplugged: shown greyed out until it comes back
    mocked.session.mockResolvedValue(session({ status: "disconnected", keyboard: null }));
    mocked.keyboards.mockResolvedValue({ keyboards: [entry("a", { plugged: false }), entry("b")], chosen: "a" });
    emit("disconnected");
    send({ type: "keyboards" });
    await settle();
    expect(store.model?.name).toBe("Test");
    // another tab chose another keyboard, which couldn't be read: this one isn't coming back
    mocked.session.mockResolvedValue(session({ status: "disconnected", keyboard: null, error: "unsupported" }));
    mocked.keyboards.mockResolvedValue({ keyboards: [entry("a"), entry("b")], chosen: "b" });
    send({ type: "keyboards" });
    await settle();
    expect(store.model).toBeNull();
    expect(store.session?.error).toBe("unsupported");
  });
});

describe("quitting Vial", () => {
  /** the events link the store opened */
  const eventsLink = () => vi.mocked(connectEvents).mock.results.at(-1)!.value as { close: ReturnType<typeof vi.fn> };

  it("quits: the server answered, so Vial has stopped and the events link is closed for good", async () => {
    const { store } = await loaded();
    const reply = deferred<null>();
    mocked.shutdown.mockReturnValueOnce(reply.promise);
    const quitting = store.quit();
    expect(store.quitting).toBe(true);
    expect(store.stopped).toBe(false);
    // pressed again meanwhile: asked once
    void store.quit();
    expect(mocked.shutdown).toHaveBeenCalledTimes(1);
    reply.resolve(null);
    expect(await quitting).toBe(true);
    expect(store.stopped).toBe(true);
    expect(store.quitting).toBe(false);
    expect(eventsLink().close).toHaveBeenCalled();
  });

  it("edits nothing while Quit is on its way or once Vial has stopped; a Quit that failed gives editing back", async () => {
    const { store, emit } = await loaded();
    expect(store.canEdit).toBe(true);
    const reply = deferred<null>();
    mocked.shutdown.mockReturnValueOnce(reply.promise);
    const quitting = store.quit();
    expect(store.canEdit).toBe(false);
    reply.reject(new ApiError(0));
    expect(await quitting).toBe(false);
    expect(store.canEdit).toBe(true);
    emit("stopped");
    expect(store.stopped).toBe(true);
    expect(store.canEdit).toBe(false);
  });

  it("says why Vial couldn't be quit, and goes on as before", async () => {
    const { store } = await loaded();
    mocked.shutdown.mockRejectedValueOnce(new ApiError(0));
    expect(await store.quit()).toBe(false);
    expect(store.stopped).toBe(false);
    expect(store.quitting).toBe(false);
    expect(toasts.items.map((t) => t.message)).toEqual(["Quitting Vial failed: Can't reach Vial. Is it still running?"]);
    expect(eventsLink().close).not.toHaveBeenCalled();
  });

  it("shows Vial stopped when another tab quit it (the stopped event)", async () => {
    const { store, emit } = await loaded();
    const keyboardReads = mocked.keyboard.mock.calls.length;
    const sessionReads = mocked.session.mock.calls.length;
    emit("stopped");
    await settle();
    expect(store.stopped).toBe(true);
    expect(eventsLink().close).toHaveBeenCalled();
    expect(mocked.shutdown).not.toHaveBeenCalled();
    // not an ordinary event: nothing is read again, and the keyboard isn't taken for gone
    expect(mocked.keyboard.mock.calls.length).toBe(keyboardReads);
    expect(mocked.session.mock.calls.length).toBe(sessionReads);
    expect(store.stale).toBe(false);
  });

  it("clears the toasts when Vial stops: they would show under 'Vial has stopped'", async () => {
    const { store, emit } = await loaded();
    toasts.error("Changing the key failed: Can't reach Vial. Is it still running?");
    toasts.info("Key changed", { label: "Undo", run: async () => true });
    expect(toasts.items.length).toBe(2);
    emit("stopped");
    expect(store.stopped).toBe(true);
    expect(toasts.items).toEqual([]);
  });

  it("doesn't report a failure when the stopped event came but the answer was lost", async () => {
    const { store, emit } = await loaded();
    mocked.shutdown.mockImplementationOnce(async () => {
      emit("stopped");
      throw new ApiError(0);
    });
    expect(await store.quit()).toBe(true);
    expect(store.stopped).toBe(true);
    expect(toasts.items).toEqual([]);
  });
});

describe("arranging the layers", () => {
  const UNFINISHED = { order: [0, 2, 1], done: 9, total: 94, namesOnly: false };

  /** The model an arrange answers: model(code) with its layout version and what it kept */
  function arranged(code: string, layoutVersion: number, kept = 0): ArrangedModel {
    return { ...model(code), layoutVersion, kept } as unknown as ArrangedModel;
  }

  /** The session the server answers from now on: connected, with this layout version and arrange left unfinished */
  function sessionNow(layoutVersion: number, arrange: typeof UNFINISHED | null = null) {
    mocked.session.mockResolvedValue({ fake: true, unlock: LOCKED, status: "connected", layoutVersion, arrange } as never);
  }

  it("sends the order with the layout version expected, keeps the model it answers, and reads the session again",
    async () => {
      const { store } = await loaded();
      const reads = mocked.session.mock.calls.length;
      mocked.arrangeLayers.mockResolvedValueOnce(arranged("KC_B", 4));
      // the reply is shown; the keyboard is read again after it (as after a layout file): it says the same
      mocked.keyboard.mockResolvedValue(model("KC_B"));
      sessionNow(4);
      const done = await store.arrangeLayers([0, 2, 1], 3);
      expect(mocked.arrangeLayers).toHaveBeenCalledWith([0, 2, 1], 3);
      expect(done?.layoutVersion).toBe(4);
      expect(store.model!.layers[0].keys[0].code).toBe("KC_B");
      expect(mocked.session.mock.calls.length).toBeGreaterThan(reads);
      expect(store.layoutVersion).toBe(4);
      expect(toasts.items).toEqual([]);
    });

  it("is unlocked for when the locked keyboard refuses it (423), and sent again once, the same order", async () => {
    const { store, send } = await loaded();
    mocked.arrangeLayers.mockRejectedValueOnce(new ApiError(423, "the keyboard is locked"))
      .mockResolvedValueOnce(arranged("KC_B", 1));
    mocked.unlockStart.mockResolvedValueOnce(UNLOCKING);
    mocked.keyboard.mockResolvedValue(model("KC_B"));
    const arranging = store.arrangeLayers([0, 2, 1], 0);
    await settle();
    expect(store.unlock.open).toBe(true);
    send({ type: "unlock", unlock: UNLOCKED });
    expect(await arranging).not.toBeNull();
    expect(mocked.arrangeLayers.mock.calls).toEqual([[[0, 2, 1], 0], [[0, 2, 1], 0]]);
    expect(store.model!.layers[0].keys[0].code).toBe("KC_B");
  });

  it("says why it stopped partway where the caller asks, not in a toast, and knows the arrange it left unfinished",
    async () => {
      const { store } = await loaded();
      sessionNow(0);
      await store.refreshSession();
      mocked.arrangeLayers.mockRejectedValueOnce(new ApiError(502, "the keyboard didn't respond: timeout"));
      sessionNow(1, UNFINISHED);
      const reported: [string, unknown][] = [];
      expect(await store.arrangeLayers([0, 2, 1], 0, (message, error) => reported.push([message, error]))).toBeNull();
      expect(reported.map(([message]) => message)).toEqual(["Arranging the layers failed: The keyboard didn't respond."]);
      expect((reported[0][1] as ApiError).status).toBe(502);
      expect(toasts.items).toEqual([]);
      // read again: the session says the arrange is unfinished
      expect(store.unfinishedArrange).toEqual(UNFINISHED);
      // this tab's arrange stopped it, at the layout version it left
      expect(store.unfinishedBy).toBe("arrange");
      sessionNow(2, UNFINISHED);
      await store.refreshSession();
      // something else wrote since (another tab's Finish that stopped, say): this tab no longer knows what stopped
      expect(store.unfinishedBy).toBeNull();
    });

  it("tells a stopped Finish and Put back apart", async () => {
    const { store } = await loaded();
    sessionNow(1, UNFINISHED);
    await store.refreshSession();
    mocked.putBackArrange.mockRejectedValueOnce(new ApiError(502));
    sessionNow(2, { ...UNFINISHED, done: 3, total: 10 });
    expect(await store.putBackArrange(() => undefined)).toBeNull();
    expect(store.unfinishedBy).toBe("put-back");
    mocked.finishArrange.mockRejectedValueOnce(new ApiError(502));
    sessionNow(3, { ...UNFINISHED, done: 2, total: 10 });
    expect(await store.finishArrange(() => undefined)).toBeNull();
    expect(store.unfinishedBy).toBe("finish");
    // refused before anything was written: what stopped it is still the Finish
    mocked.putBackArrange.mockRejectedValueOnce(new ApiError(423, "locked"));
    mocked.unlockStart.mockRejectedValueOnce(new ApiError(502));
    expect(await store.putBackArrange(() => undefined)).toBeNull();
    expect(store.unfinishedBy).toBe("finish");
  });

  it("is refused by the server when the layers changed since the version expected: said, and the keyboard read again",
    async () => {
      const { store } = await loaded();
      const loads = mocked.keyboard.mock.calls.length;
      mocked.arrangeLayers.mockRejectedValueOnce(
        new ApiError(409, "The layers changed since this was shown.", "layoutChanged"));
      const reported: [string, unknown][] = [];
      expect(await store.arrangeLayers([0, 2, 1], 3, (message, error) => reported.push([message, error]))).toBeNull();
      expect(reported[0][0]).toBe("Arranging the layers failed: The layers changed since this was shown.");
      expect((reported[0][1] as ApiError).code).toBe("layoutChanged");
      await settle();
      expect(mocked.keyboard.mock.calls.length).toBe(loads + 1);
    });

  it("sends nothing while the keyboard can't be changed, or another change is being saved, and says so", async () => {
    const { store, emit } = await loaded();
    const reported: string[] = [];
    const saving = deferred<never>();
    mocked.setMacros.mockReturnValueOnce(saving.promise);
    void store.setMacros([[]]);
    expect(await store.arrangeLayers([0, 2, 1], 0, (message) => reported.push(message))).toBeNull();
    saving.reject(new ApiError(502));
    await settle();
    toasts.items = [];
    emit("disconnected");
    expect(await store.finishArrange((message) => reported.push(message))).toBeNull();
    expect(await store.putBackArrange()).toBeNull();
    expect(mocked.arrangeLayers).not.toHaveBeenCalled();
    expect(mocked.finishArrange).not.toHaveBeenCalled();
    expect(mocked.putBackArrange).not.toHaveBeenCalled();
    expect(reported).toEqual([
      "Arranging the layers failed: another change was still being saved. Try again.",
      "Finishing the arrange failed: the keyboard can't be changed just now.",
    ]);
    expect(toasts.items.map((t) => t.message)).toEqual([
      "Putting the layers back failed: the keyboard can't be changed just now."]);
  });

  it("tells those listening when the layout version changes, not when it is read the same again", async () => {
    const { store } = await loaded();
    const heard: (number | null)[] = [];
    const stop = store.onLayoutVersion((version) => heard.push(version));
    sessionNow(0);
    await store.refreshSession();
    await store.refreshSession();
    sessionNow(2);
    await store.refreshSession();
    stop();
    sessionNow(3);
    await store.refreshSession();
    expect(heard).toEqual([0, 2]);
  });
});
