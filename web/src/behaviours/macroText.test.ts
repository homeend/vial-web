import { describe, expect, it } from "vitest";
import type { Described } from "../api/types";
import type { Step } from "./macro";
import { appliedNote, macroText, qtAction } from "./macroText";

function key(code: string): Described {
  return {
    code, value: 4, kind: "basic", tap: code, legend: { main: code, shifted: null, altGr: null }, hold: null,
    layer: null, layerAction: null, index: null, description: null,
  };
}

/** Steps from Qt's text: what the server (POST /api/macros/parse) makes of it, the keys described */
function stepsOf(text: string): Step[] {
  return (JSON.parse(text) as (string | number)[][]).map(([type, ...rest]): Step => {
    if (type === "text") return { type, text: rest[0] as string, keys: [], delay: null };
    if (type === "delay") return { type, text: null, keys: [], delay: rest[0] as number };
    return { type: type as Step["type"], text: null, keys: rest.map((c) => key(c as string)), delay: null };
  });
}

// as Qt's text editor writes them: json.dumps([act.save() for act in actions]) (macro_tab.py on_text_window)
const QT = '[["text", "git status"], ["tap", "KC_ENTER"], ["down", "KC_LSHIFT"], ["tap", "KC_HOME", "KC_END"], ' +
  '["up", "KC_LSHIFT"], ["delay", 50], ["tap", "LCTL(KC_C)"]]';

describe("macroText", () => {
  it("writes the steps as Qt's text editor does, character for character", () => {
    expect(macroText(stepsOf(QT))).toBe(QT);
  });

  it("writes no step as an empty list", () => {
    expect(macroText([])).toBe("[]");
  });

  it("escapes text as Python's json.dumps does: quotes, backslashes, tabs, line breaks, and what isn't ASCII", () => {
    const text = 'say "a\\b"\there\nnow ~ \u007f é ☃ \u0001';
    expect(macroText([{ type: "text", text, keys: [], delay: null }]))
      .toBe('[["text", "say \\"a\\\\b\\"\\there\\nnow ~ \\u007f \\u00e9 \\u2603 \\u0001"]]');
  });

  it("writes a step not finished yet as Qt would: a key step without keys, a text step without text", () => {
    expect(qtAction({ type: "tap", text: null, keys: [], delay: null })).toEqual(["tap"]);
    expect(qtAction({ type: "text", text: null, keys: [], delay: null })).toEqual(["text", ""]);
    // a wait without its number stays without one: not a wait of 0 ms (the server reads null back as unfinished)
    expect(qtAction({ type: "delay", text: null, keys: [], delay: null })).toEqual(["delay", null]);
    expect(macroText([{ type: "delay", text: null, keys: [], delay: null }])).toBe('[["delay", null]]');
  });
});

describe("appliedNote", () => {
  it("says how many steps came from the text, which went, and that Cancel puts them back", () => {
    expect(appliedNote(3, 2)).toBe(
      "3 steps from the text, in place of the 2 steps there before. Cancel puts back the macro as the keyboard has it.");
    expect(appliedNote(1, 1)).toBe(
      "1 step from the text, in place of the 1 step there before. Cancel puts back the macro as the keyboard has it.");
    expect(appliedNote(0, 0)).toBe(
      "No step from the text, in place of none there before. Cancel puts back the macro as the keyboard has it.");
  });
});
