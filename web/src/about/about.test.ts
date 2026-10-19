import { describe, expect, it } from "vitest";
import { simulatedCorne } from "../analysis/testing";
import type { KeyboardModel } from "../api/types";
import { aboutFacts, aboutText } from "./about";

function corne(change: Partial<KeyboardModel> = {}): KeyboardModel {
  return {
    ...simulatedCorne(), uid: "5EEDC0DE00420042", features: ["caps_word", "layer_lock", "persistent_default_layer"],
    settings: [{ qsid: 7, value: 200 }, { qsid: 22, value: 0 }], ...change,
  };
}

const value = (model: KeyboardModel, label: string) =>
  aboutFacts(model).flatMap((g) => g.facts).find((f) => f.label === label)?.value;

describe("aboutFacts", () => {
  it("says what Qt's About keyboard says", () => {
    const model = corne();
    expect(aboutFacts(model).map((g) => g.title)).toEqual(["Keyboard", "Memory and entries", "Features"]);
    expect(value(model, "Name")).toBe("Test Corne");
    expect(value(model, "Keyboard ID")).toBe("5EEDC0DE00420042");
    expect(value(model, "Protocols")).toBe("VIA 9, Vial 6");
    expect(value(model, "Matrix")).toBe("8 rows × 6 columns");
    expect(value(model, "Keys")).toBe("42");
    expect(value(model, "Layers")).toBe("4");
    expect(value(model, "Macros")).toBe("3, sharing 900 bytes (0 used)");
    expect(value(model, "Delays in macros")).toBe("yes");
    expect(value(model, "Tap dances")).toBe("3");
    expect(value(model, "QMK settings")).toBe("2");
    expect(value(model, "Caps Word")).toBe("yes");
    expect(value(model, "Repeat Key")).toBe("no (turned off in the firmware)");
  });

  it("says why something is missing: old firmware, or turned off", () => {
    const old = corne({ vialProtocol: 3, keyOverrides: [], altRepeatKeys: [], settings: [], features: [] });
    expect(value(old, "Key overrides")).toBe("no (the Vial firmware is too old)");
    expect(value(old, "Two-byte keycodes in macros")).toBe("no (the Vial firmware is too old)");
    expect(value(old, "QMK settings")).toBe("no (the Vial firmware is too old)");
    expect(value(old, "Caps Word")).toBe("no (the Vial firmware is too old)");
    expect(value(corne({ keyOverrides: [] }), "Key overrides")).toBe("no (turned off in the firmware)");
  });

  it("counts encoders by number, not by direction, and lists features it doesn't know by name", () => {
    const geometry = { ...simulatedCorne().keys[0], row: null, col: null };
    const model = corne({
      encoders: [{ ...geometry, encoder: 0, direction: 0 }, { ...geometry, encoder: 0, direction: 1 }],
      features: ["caps_word", "new_thing"],
    });
    expect(value(model, "Keys")).toBe("42, and 1 encoder");
    expect(value(model, "new_thing")).toBe("yes");
  });

  it("is text to paste, one fact a line", () => {
    const text = aboutText(aboutFacts(corne()));
    expect(text.split("\n").slice(0, 3)).toEqual(["Keyboard", "  Name: Test Corne", "  Keyboard ID: 5EEDC0DE00420042"]);
  });
});
