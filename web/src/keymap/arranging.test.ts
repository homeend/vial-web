import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/errors";
import type { ArrangedModel, UnfinishedArrange } from "../api/types";
import type { Report } from "../lib/keyboard.svelte";

/** The keyboard store, as LayerArranger uses it: each test sets what it says and answers */
const fake = vi.hoisted(() => ({
  keyboard: {
    model: null as unknown,
    canEdit: true,
    pending: 0,
    opened: 1,
    layoutVersion: 0 as number | null,
    unfinishedArrange: null as UnfinishedArrange | null,
    arrangeLayers: vi.fn(),
    finishArrange: vi.fn(),
    putBackArrange: vi.fn(),
    listeners: [] as ((version: number | null) => void)[],
    onLayoutVersion(listener: (version: number | null) => void) {
      this.listeners.push(listener);
      return () => undefined;
    },
  },
}));
vi.mock("../lib/keyboard.svelte", () => ({ keyboard: fake.keyboard }));
vi.mock("../lib/unsaved", () => ({ unsavedWork: () => [] }));

const { LayerArranger, isLayoutChanged } = await import("./arranging.svelte");
const { toasts } = await import("../lib/toasts.svelte");
const { keymapState } = await import("./state.svelte");

const keyboard = fake.keyboard;

/** The model an arrange answers: what the arranger reads of it */
function arranged(layoutVersion: number, kept = 0, encoders = 0): ArrangedModel {
  return { layoutVersion, kept, encoders: new Array(encoders).fill({}) } as unknown as ArrangedModel;
}

/** The session says another layout version (another tab arranged, a layout file was loaded) */
function versionNow(version: number | null) {
  keyboard.layoutVersion = version;
  for (const listener of keyboard.listeners) listener(version);
}

const messages = () => toasts.items.map((t) => t.message);
const undoToast = () => toasts.items.find((t) => t.action?.label === "Undo");

let arranger: InstanceType<typeof LayerArranger>;

beforeEach(() => {
  vi.clearAllMocks();
  for (const toast of [...toasts.items]) toasts.dismiss(toast.id);
  Object.assign(keyboard, {
    canEdit: true, pending: 0, opened: 1, layoutVersion: 0, unfinishedArrange: null, listeners: [],
  });
  keymapState.layer = 0;
  arranger = new LayerArranger();
});

afterEach(() => {
  for (const toast of [...toasts.items]) toasts.dismiss(toast.id);
});

/** Apply [0, 3, 1, 2] from the Edit view showing `layer`; the server answers layout version 1 */
async function applied(layer = 3, report: Report = () => undefined) {
  keymapState.layer = layer;
  keyboard.arrangeLayers.mockImplementationOnce(async () => {
    keyboard.layoutVersion = 1;
    return arranged(1);
  });
  return arranger.apply([0, 3, 1, 2], 0, report);
}

describe("Apply", () => {
  it("sends the order with the layout version of its preview; the Edit view follows its layer; Undo is offered",
    async () => {
      expect(await applied(3)).toBe(true);
      expect(keyboard.arrangeLayers).toHaveBeenCalledWith([0, 3, 1, 2], 0, expect.any(Function));
      expect(keymapState.layer).toBe(1);
      expect(messages()).toEqual(["Layers arranged."]);
    });

  it("neither follows nor offers Undo when another keyboard was shown meanwhile", async () => {
    keymapState.layer = 3;
    keyboard.arrangeLayers.mockImplementationOnce(async () => {
      keyboard.opened = 2;
      keymapState.layer = 0;
      return arranged(1);
    });
    expect(await arranger.apply([0, 3, 1, 2], 0, () => undefined)).toBe(true);
    expect(keymapState.layer).toBe(0);
    expect(toasts.items).toEqual([]);
  });

  it("says why it wasn't done where the dialog asks, and offers nothing", async () => {
    const reported: string[] = [];
    keyboard.arrangeLayers.mockImplementationOnce(async (_order: number[], _expect: number, report: Report) => {
      report("Arranging the layers failed: The keyboard didn't respond.", new ApiError(502));
      return null;
    });
    expect(await arranger.apply([0, 3, 1, 2], 0, (message) => reported.push(message))).toBe(false);
    expect(reported).toEqual(["Arranging the layers failed: The keyboard didn't respond."]);
    expect(toasts.items).toEqual([]);
  });

  it("a second arrange takes the first one's Undo away", async () => {
    await applied(3);
    const first = undoToast()!.id;
    keyboard.arrangeLayers.mockResolvedValueOnce(arranged(2));
    await arranger.apply([0, 2, 1, 3], 1, () => undefined);
    expect(toasts.items.filter((t) => t.action?.label === "Undo")).toHaveLength(1);
    expect(undoToast()!.id).not.toBe(first);
  });

  it("tells the layers changed since (409 layoutChanged) from other refusals", () => {
    expect(isLayoutChanged(new ApiError(409, "The layers changed since this was shown.", "layoutChanged"))).toBe(true);
    expect(isLayoutChanged(new ApiError(409, "another keyboard is open"))).toBe(false);
    expect(isLayoutChanged(new Error("x"))).toBe(false);
  });
});

describe("Undo", () => {
  it("arranges the reverse order, expecting the layout version its arrange left; the Edit view follows", async () => {
    await applied(3);
    expect(keymapState.layer).toBe(1);
    keyboard.arrangeLayers.mockImplementationOnce(async () => {
      versionNow(2);
      return arranged(2);
    });
    await toasts.act(undoToast()!.id);
    expect(keyboard.arrangeLayers).toHaveBeenLastCalledWith([0, 2, 3, 1], 1, expect.any(Function),
      "Undoing the arrange");
    expect(keymapState.layer).toBe(3);
    expect(toasts.items).toEqual([]);
  });

  it("goes once the layout version moves past the one its arrange left (another tab, a layout file loaded)",
    async () => {
      await applied(3);
      versionNow(1); // read again, the same
      expect(undoToast()).toBeDefined();
      versionNow(2);
      expect(undoToast()).toBeUndefined();
    });

  it("is refused, writing nothing, when the layers changed since and the toast is still there", async () => {
    await applied(3);
    keyboard.layoutVersion = 2; // the session said so; the toast's listener wasn't told (it stays, for the test)
    await toasts.act(undoToast()!.id);
    expect(keyboard.arrangeLayers).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([
      "Undoing the arrange failed: the layers were arranged again or a layout file was loaded since, so nothing was " +
      "written."]);
  });

  it("is refused by the server when the layers changed since: the toast goes, and says so", async () => {
    await applied(3);
    keyboard.arrangeLayers.mockImplementationOnce(async (_order: number[], _expect: number, report: Report) => {
      report("Undoing the arrange failed: The layers changed since this was shown.",
        new ApiError(409, "The layers changed since this was shown.", "layoutChanged"));
      return null;
    });
    await toasts.act(undoToast()!.id);
    expect(messages()).toEqual([
      "Undoing the arrange failed: the layers were arranged again or a layout file was loaded since, so nothing was " +
      "written."]);
    expect(keymapState.layer).toBe(1);
  });

  it("is refused for another keyboard, or with an arrange unfinished; waits while a change is being saved", async () => {
    await applied(3);
    keyboard.pending = 1;
    await toasts.act(undoToast()!.id);
    expect(undoToast()).toBeDefined();
    keyboard.pending = 0;
    keyboard.canEdit = false;
    await toasts.act(undoToast()!.id);
    expect(undoToast()).toBeDefined();
    keyboard.canEdit = true;
    keyboard.unfinishedArrange = { order: [0, 2, 1, 3], done: 1, total: 4, namesOnly: false };
    await toasts.act(undoToast()!.id);
    expect(undoToast()).toBeUndefined();
    expect(keyboard.arrangeLayers).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([
      "Undoing the arrange failed: another change was still being saved. Try again.",
      "Undoing the arrange failed: the keyboard can't be changed just now.",
      "Undoing the arrange failed: an arrange is unfinished. Finish it or put it back first.",
    ]);
    keyboard.unfinishedArrange = null;
    await applied(3);
    keyboard.opened = 2;
    await toasts.act(undoToast()!.id);
    expect(messages().at(-1)).toBe("Undoing the arrange failed: another keyboard is shown now.");
  });

  it("stays, to try again, when nothing was written (the keyboard wasn't unlocked, say)", async () => {
    await applied(3);
    keyboard.arrangeLayers.mockImplementationOnce(async (_order: number[], _expect: number, report: Report) => {
      report("Undoing the arrange failed: The keyboard is locked, and it wasn't unlocked.");
      return null;
    });
    await toasts.act(undoToast()!.id);
    expect(undoToast()).toBeDefined();
    // and still goes once the layers change elsewhere
    versionNow(5);
    expect(undoToast()).toBeUndefined();
  });
});

describe("Finish and Put back", () => {
  const UNFINISHED: UnfinishedArrange = { order: [0, 3, 1, 2], done: 9, total: 94, namesOnly: false };

  it("Finish: the Edit view follows the layer it showed, Undo is offered, and what was kept is said", async () => {
    keyboard.unfinishedArrange = UNFINISHED;
    keymapState.layer = 1;
    keyboard.finishArrange.mockResolvedValueOnce(arranged(3, 2));
    expect(await arranger.finish()).toBe(true);
    expect(keymapState.layer).toBe(2);
    expect(messages()).toEqual([
      "Layers arranged. 2 changes made since the stop were kept as they are (keys, tap dances, combos, key " +
      "overrides, alt-repeat keys or macros)."]);
    expect(undoToast()).toBeDefined();
  });

  it("Put back: says so, with what was kept; no Undo, and the Edit view stays", async () => {
    keyboard.unfinishedArrange = UNFINISHED;
    keymapState.layer = 2;
    keyboard.putBackArrange.mockResolvedValueOnce(arranged(3, 1, 2));
    expect(await arranger.putBack()).toBe(true);
    expect(keymapState.layer).toBe(2);
    expect(messages()).toEqual([
      "The layers were put back as they were. 1 change made since the stop was kept as it is (a key, an encoder " +
      "direction, a tap dance, combo, key override or alt-repeat key, or a macro)."]);
    expect(undoToast()).toBeUndefined();
  });

  it("Finish when another keyboard was shown meanwhile: no follow, no Undo", async () => {
    keyboard.unfinishedArrange = UNFINISHED;
    keymapState.layer = 1;
    keyboard.finishArrange.mockImplementationOnce(async () => {
      keyboard.opened = 2;
      return arranged(3);
    });
    expect(await arranger.finish()).toBe(true);
    expect(keymapState.layer).toBe(1);
    expect(toasts.items).toEqual([]);
  });
});
