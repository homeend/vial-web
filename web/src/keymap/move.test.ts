import { describe, expect, it } from "vitest";
import type { Described, KeyboardModel } from "../api/types";
import {
  DRAG_THRESHOLD, dropTarget, LONG_PRESS_MS, MENU_GAP, menuPlace, moveDone, movePlan, pickHint, pressState,
  stillApplies, TOUCH_SLOP, undoOf, unlockFirst, type Press,
} from "./move";

const mouse: Press = { x: 100, y: 100, time: 0, touch: false };
/** a finger or a pen: both hold the key before they drag it */
const finger: Press = { ...mouse, touch: true };

describe("pressState", () => {
  it("keeps a mouse press a click until it moves the threshold, in any direction", () => {
    expect(pressState(mouse, 100, 100, 5000)).toBe("press");
    expect(pressState(mouse, 100 + DRAG_THRESHOLD - 1, 100, 10)).toBe("press");
    expect(pressState(mouse, 100 + DRAG_THRESHOLD, 100, 10)).toBe("drag");
    expect(pressState(mouse, 100, 100 - DRAG_THRESHOLD, 10)).toBe("drag");
    // diagonally: the distance, not each axis
    expect(pressState(mouse, 105, 105, 10)).toBe("drag");
    expect(pressState(mouse, 104, 104, 10)).toBe("press");
  });

  it("lets a finger or pen that moves before it has held the key long enough scroll the page", () => {
    expect(pressState(finger, 100 + TOUCH_SLOP + 1, 100, LONG_PRESS_MS - 1)).toBe("scroll");
    expect(pressState(finger, 100, 100 + TOUCH_SLOP + 1, 10)).toBe("scroll");
    // a little wandering is still holding the key
    expect(pressState(finger, 100 + TOUCH_SLOP, 100, 10)).toBe("press");
  });

  it("drags with a finger or pen once it has held the key long enough", () => {
    expect(pressState(finger, 100, 100, LONG_PRESS_MS)).toBe("press");
    expect(pressState(finger, 100 + DRAG_THRESHOLD, 100, LONG_PRESS_MS)).toBe("drag");
    expect(pressState(finger, 300, 300, LONG_PRESS_MS + 500)).toBe("drag");
  });
});

describe("dropTarget", () => {
  const items = [
    { kind: "key" as const, index: 0 },
    { kind: "key" as const, index: 1 },
    { kind: "encoder" as const, index: 0 },
    { kind: "key" as const, index: 7 },
  ];

  it("is the key under the pointer", () => {
    expect(dropTarget(items, 0, "key:1")).toBe(1);
    expect(dropTarget(items, 1, "key:7")).toBe(3);
  });

  it("is nothing outside the keyboard, on the key dragged, or on a key not drawn", () => {
    expect(dropTarget(items, 0, null)).toBeNull();
    expect(dropTarget(items, 0, "key:0")).toBeNull();
    expect(dropTarget(items, 0, "key:5")).toBeNull();
  });

  it("is nothing for encoders, dragged or dropped on", () => {
    expect(dropTarget(items, 0, "encoder:0")).toBeNull();
    expect(dropTarget(items, 2, "key:1")).toBeNull();
  });

  it("is nothing when the key dragged isn't drawn", () => {
    expect(dropTarget(items, -1, "key:1")).toBeNull();
    expect(dropTarget(items, 9, "key:1")).toBeNull();
  });
});

const source = { ref: { kind: "key" as const, index: 0 }, code: "KC_A" };
const target = { ref: { kind: "key" as const, index: 1 }, code: "KC_B" };

describe("movePlan", () => {
  it("replaces: only the target changes, to the source's keycode", () => {
    expect(movePlan("replace", source, target)).toEqual([{ ref: target.ref, code: "KC_A", was: "KC_B" }]);
  });

  it("swaps: the target first, then the source", () => {
    expect(movePlan("swap", source, target)).toEqual([
      { ref: target.ref, code: "KC_A", was: "KC_B" },
      { ref: source.ref, code: "KC_B", was: "KC_A" },
    ]);
  });

  it("writes nothing that wouldn't change", () => {
    const same = { ...target, code: "KC_A" };
    expect(movePlan("replace", source, same)).toEqual([]);
    expect(movePlan("swap", source, same)).toEqual([]);
  });

  it("writes the bootloader key first: a locked keyboard refuses it before anything else is written", () => {
    const boot = { ...target, code: "QK_BOOT" };
    const swap = movePlan("swap", source, boot);
    expect(unlockFirst(swap)).toEqual([
      { ref: source.ref, code: "QK_BOOT", was: "KC_A" },
      { ref: target.ref, code: "KC_A", was: "QK_BOOT" },
    ]);
    // undone too: the bootloader key goes back first
    expect(undoOf(swap)[0].code).toBe("KC_A");
    expect(unlockFirst(undoOf(swap))[0]).toEqual({ ref: target.ref, code: "QK_BOOT", was: "KC_A" });
    // otherwise in their order
    expect(unlockFirst(movePlan("swap", source, target))).toEqual(movePlan("swap", source, target));
  });

  it("is undone by writing what was there, the last change first", () => {
    const swap = movePlan("swap", source, target);
    expect(undoOf(swap)).toEqual([
      { ref: source.ref, code: "KC_A", was: "KC_B" },
      { ref: target.ref, code: "KC_B", was: "KC_A" },
    ]);
    expect(undoOf(undoOf(swap))).toEqual(swap);
  });
});

function described(code: string): Described {
  return { code } as Described;
}

describe("stillApplies", () => {
  const model = (a: string, b: string) =>
    ({ layers: [{ keys: [], encoders: [] }, { keys: [described(a), described(b)], encoders: [] }] }) as unknown as
      KeyboardModel;
  const swap = movePlan("swap", source, target);

  it("holds while the keys still have what the change wrote", () => {
    expect(stillApplies(model("KC_B", "KC_A"), 1, swap)).toBe(true);
  });

  it("fails once either key was changed since, or the layer is gone", () => {
    expect(stillApplies(model("KC_C", "KC_A"), 1, swap)).toBe(false);
    expect(stillApplies(model("KC_B", "KC_C"), 1, swap)).toBe(false);
    expect(stillApplies(model("KC_B", "KC_A"), 2, swap)).toBe(false);
  });
});

describe("phrases", () => {
  const w = { title: "W", where: "row 1, column 2" };
  const esc = { title: "Esc", where: "row 1, column 3" };

  it("say how to choose the other key, and that Esc cancels", () => {
    expect(pickHint("replace", "W")).toBe(
      "Choose the key to copy W to: click it, or move to it with the arrow keys and press Enter. Esc cancels.");
    expect(pickHint("swap", "W")).toBe(
      "Choose the key to swap W with: click it, or move to it with the arrow keys and press Enter. Esc cancels.");
  });

  it("say what a move did", () => {
    expect(moveDone("replace", w, esc)).toBe("Row 1, column 3 is now W (it was Esc).");
    expect(moveDone("swap", w, esc)).toBe("Swapped W (row 1, column 2) and Esc (row 1, column 3).");
  });
});

describe("menuPlace", () => {
  // the area holding the menu: 600 x 300 px, at (100, 200) in the window
  const area = { left: 100, top: 200, right: 700, bottom: 500 };
  const menu = { width: 200, height: 120 };
  const key = (left: number, top: number) => ({ left, top, right: left + 50, bottom: top + 50 });

  it("goes below the key, centred on it", () => {
    expect(menuPlace(key(300, 250), area, menu, 1000)).toEqual({ left: 125, top: 100 + MENU_GAP });
  });

  it("stays inside the area's width", () => {
    expect(menuPlace(key(110, 250), area, menu, 1000).left).toBe(0);
    expect(menuPlace(key(640, 250), area, menu, 1000).left).toBe(400);
  });

  it("goes above the key when the window has no room below it, but has above", () => {
    expect(menuPlace(key(300, 400), area, menu, 500)).toEqual({ left: 125, top: 200 - MENU_GAP - 120 });
    // no room above either: below, as the page scrolls
    expect(menuPlace(key(300, 100), { ...area, top: 50 }, menu, 200).top).toBe(100 + MENU_GAP);
  });
});
