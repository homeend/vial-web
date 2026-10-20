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

  it("says a feature is missing for old firmware by the protocol that brought it", () => {
    // Persistent default layer and Repeat Key came with Vial protocol 5 (protocol/dynamic.py); Caps Word with 4
    const four = corne({ vialProtocol: 4, features: [] });
    expect(value(four, "Persistent default layer")).toBe("no (the Vial firmware is too old)");
    expect(value(four, "Repeat Key")).toBe("no (the Vial firmware is too old)");
    expect(value(four, "Caps Word")).toBe("no (turned off in the firmware)");
  });

  it("counts the keys of the layout options chosen, not every choice's", () => {
    const keys = simulatedCorne().keys;
    const model = corne({
      layoutOptions: { value: 1, labels: ["Split Backspace"] },
      keys: [
        ...keys,
        { ...keys[0], layoutIndex: 0, layoutOption: 0 },
        { ...keys[0], layoutIndex: 0, layoutOption: 1 },
        { ...keys[0], layoutIndex: 0, layoutOption: 1 },
        { ...keys[0], decal: true },
      ],
    });
    expect(value(model, "Keys")).toBe(String(keys.length + 2));
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

describe("aboutFacts of the USB device", () => {
  const usb = {
    manufacturer: "Wcorne", name: "W-CORNE", vendorId: 0x55d4, productId: 0x461,
    path: "\\\\?\\HID#VID_55D4&PID_0461&MI_01#8&1f2&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}",
  };
  const usbFacts = (entry: typeof usb | null) => aboutFacts(corne(), entry).find((g) => g.title === "USB device");

  it("says what Qt's About keyboard says of it: the IDs as four hex digits, upper case", () => {
    const group = usbFacts(usb);
    expect(group?.facts.map((f) => [f.label, f.value])).toEqual([
      ["Manufacturer", "Wcorne"], ["Product", "W-CORNE"], ["VID", "55D4"], ["PID", "0461"], ["Device", usb.path],
    ]);
    expect(group?.facts.find((f) => f.label === "Device")).toMatchObject({ code: true, copy: true, long: true });
    expect(usbFacts({ ...usb, vendorId: 1, productId: 0xcafe })?.facts.slice(2, 4).map((f) => f.value))
      .toEqual(["0001", "CAFE"]);
  });

  it("comes after the keyboard's own facts, and says when the keyboard gives no manufacturer", () => {
    expect(aboutFacts(corne(), usb).map((g) => g.title))
      .toEqual(["Keyboard", "USB device", "Memory and entries", "Features"]);
    expect(usbFacts({ ...usb, manufacturer: "" })?.facts[0].value).toBe("none given");
  });

  it("isn't there when the keyboard isn't listed (unplugged, and not the one chosen)", () => {
    expect(usbFacts(null)).toBeUndefined();
    expect(aboutFacts(corne()).map((g) => g.title)).not.toContain("USB device");
  });

  it("is in the text to paste", () => {
    const text = aboutText(aboutFacts(corne(), usb));
    expect(text).toContain("USB device\n  Manufacturer: Wcorne\n  Product: W-CORNE\n  VID: 55D4\n  PID: 0461\n");
    expect(text).toContain(`  Device: ${usb.path}`);
  });
});
