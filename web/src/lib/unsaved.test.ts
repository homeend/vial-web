import { afterEach, describe, expect, it } from "vitest";
import type { KeyboardModel, Lighting, SettingField } from "../api/types";
import { lightingBaseline } from "../lighting/state.svelte";
import { matrixTest } from "../matrix/state.svelte";
import { settingsEdits } from "../settings/state.svelte";
import { dropUnsavedWork, trackDraft, unsavedWork } from "./unsaved";

const LIT: Lighting = { backlight: { brightness: 2, effect: 0 } };
const BRIGHTER: Lighting = { backlight: { brightness: 3, effect: 0 } };

function model(uid: string, lighting: Lighting = LIT): KeyboardModel {
  return { uid, lighting } as unknown as KeyboardModel;
}

const swap = { type: "boolean", title: "Swap", qsid: 21, bit: 0 } as SettingField;

const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  dropUnsavedWork();
});

describe("unsavedWork", () => {
  it("is nothing by default", () => {
    expect(unsavedWork(null)).toEqual([]);
    expect(unsavedWork(model("A"))).toEqual([]);
  });

  it("lists what the pages showing have open, while they track it", () => {
    let open: string | null = "the combo being edited";
    const stop = trackDraft(() => open);
    stops.push(stop);
    expect(unsavedWork(model("A"))).toEqual(["the combo being edited"]);
    open = null;
    expect(unsavedWork(model("A"))).toEqual([]);
    open = "the macro being edited";
    stop();
    expect(unsavedWork(model("A"))).toEqual([]);
  });

  it("has the Settings page's changes for the keyboard shown, wherever they were made", () => {
    settingsEdits.follow("A");
    settingsEdits.toggle(swap, true, 0);
    expect(unsavedWork(model("A"))).toEqual(["the changes on the Settings page"]);
    expect(unsavedWork(model("B"))).toEqual([]);
  });

  it("has lighting the keyboard shows and hasn't saved", () => {
    lightingBaseline.follow("A", LIT);
    expect(unsavedWork(model("A", LIT))).toEqual([]);
    expect(unsavedWork(model("A", BRIGHTER))).toEqual([
      "the lighting changes (the keyboard shows them until it is unplugged)"]);
    // the baseline is another keyboard's
    expect(unsavedWork(model("B", BRIGHTER))).toEqual([]);
  });
});

describe("dropUnsavedWork", () => {
  it("forgets the Settings page's changes and the lighting baseline, for whichever keyboard comes next", () => {
    settingsEdits.follow("A");
    settingsEdits.toggle(swap, true, 0);
    lightingBaseline.follow("A", LIT);
    dropUnsavedWork();
    expect(unsavedWork(model("A", BRIGHTER))).toEqual([]);
    // the same keyboard (or one just like it) starts over too
    lightingBaseline.follow("A", BRIGHTER);
    expect(lightingBaseline.lighting).toBe(BRIGHTER);
  });

  it("forgets the keys the matrix tester saw pressed, even for a keyboard alike", () => {
    matrixTest.follow("A");
    matrixTest.tested = new Set(["0,1"]);
    matrixTest.follow("A");
    expect(matrixTest.tested.size).toBe(1);
    dropUnsavedWork();
    matrixTest.follow("A");
    expect(matrixTest.tested.size).toBe(0);
  });
});
