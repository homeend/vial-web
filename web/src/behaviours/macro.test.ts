import { describe, expect, it } from "vitest";
import { described } from "../analysis/testing";
import type { Described } from "../api/types";
import {
  changeKind, macroBytes, macroSentence, memoryLevel, memoryUsed, moveStep, newStep, sameSteps, stepBytes, stepProblem,
  stepRequest, stepWhat, type Step,
} from "./macro";

const key = (code: string, value: number, tap: string): Described => ({ ...described(code), value, tap });
const ENTER = key("KC_ENTER", 0x28, "Enter");
const HOME = key("KC_HOME", 0x4a, "Home");
const END = key("KC_END", 0x4d, "End");
const SHIFT = key("KC_LSHIFT", 0xe1, "LShift");
const CTRL_C = key("LCTL(KC_C)", 0x0106, "Ctrl+C");

const text = (t: string): Step => ({ type: "text", text: t, keys: [], delay: null });
const keys = (type: "tap" | "down" | "up", ...k: Described[]): Step => ({ type, text: null, keys: k, delay: null });
const wait = (ms: number): Step => ({ type: "delay", text: null, keys: [], delay: ms });

// the simulated Corne's two macros (simulator/corne.py)
const M0 = [text("git status"), keys("tap", ENTER)];
const M1 = [keys("tap", HOME), keys("down", SHIFT), keys("tap", END), keys("up", SHIFT), wait(50), keys("tap", CTRL_C)];

describe("macro sizes", () => {
  it("count a byte a character, three a key (four for a keycode of 256 or more) and four a wait", () => {
    expect(stepBytes(text("git status"), 6)).toBe(10);
    expect(stepBytes(keys("tap", ENTER), 6)).toBe(3);
    expect(stepBytes(keys("tap", CTRL_C), 6)).toBe(4);
    expect(stepBytes(keys("tap", HOME, END), 6)).toBe(6);
    expect(stepBytes(wait(50), 6)).toBe(4);
  });

  it("have no prefix byte before protocol 2", () => {
    expect(stepBytes(keys("tap", ENTER), 1)).toBe(2);
    expect(stepBytes(keys("tap", CTRL_C), 1)).toBe(3);
  });

  it("add up as the server counts the macro memory: a 0 byte ends each macro", () => {
    expect(macroBytes(M0, 6)).toBe(13);
    expect(macroBytes(M1, 6)).toBe(20);
    // 16 macros, as the simulated Corne has
    expect(memoryUsed([M0, M1, ...Array.from({ length: 14 }, () => [])], 6)).toBe(13 + 1 + 20 + 1 + 14);
  });
});

describe("memoryLevel", () => {
  it("turns amber near full, and says when it is over", () => {
    expect(memoryLevel(50, 900)).toBe("ok");
    expect(memoryLevel(765, 900)).toBe("near");
    expect(memoryLevel(900, 900)).toBe("near");
    expect(memoryLevel(901, 900)).toBe("over");
  });
});

describe("macro steps in words", () => {
  it("chain the steps", () => {
    expect(macroSentence(M0)).toBe("type “git status” → tap Enter");
    expect(macroSentence(M1)).toBe("tap Home → press LShift → tap End → release LShift → wait 50 ms → tap Ctrl+C");
    expect(macroSentence([])).toBe("Does nothing yet.");
  });

  it("show line breaks and tabs in text", () => {
    expect(stepWhat(text("a\tb\n"))).toBe("“a⇥b⏎”");
    expect(stepWhat(keys("tap", HOME, END))).toBe("Home, End");
  });
});

describe("stepProblem", () => {
  it("wants text the keyboard can type, a key, and a wait it can do", () => {
    expect(stepProblem(text(""), 6)).toBe("Type the text to send.");
    expect(stepProblem(text("zażółć"), 6)).toMatch(/plain ASCII/);
    expect(stepProblem(text("ok\n"), 6)).toBeNull();
    expect(stepProblem(keys("tap"), 6)).toBe("Choose a key.");
    expect(stepProblem(wait(64001), 6)).toBe("Wait 0 to 64000 ms.");
    expect(stepProblem(wait(10), 1)).toMatch(/no waits/);
    expect(stepProblem(wait(0), 6)).toBeNull();
  });
});

describe("editing steps", () => {
  it("makes new steps of each kind", () => {
    expect(newStep("text")).toEqual(text(""));
    expect(newStep("delay")).toEqual(wait(100));
    expect(newStep("up")).toEqual(keys("up"));
  });

  it("keeps the keys when a step changes between tap, press and release", () => {
    expect(changeKind(keys("tap", ENTER), "down")).toEqual(keys("down", ENTER));
    expect(changeKind(keys("tap", ENTER), "text")).toEqual(text(""));
  });

  it("moves a step", () => {
    expect(moveStep(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveStep(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveStep(["a", "b"], 1, 2)).toEqual(["a", "b"]);
  });

  it("sends the steps as the server takes them, and compares them so", () => {
    expect(M1.map(stepRequest)[5]).toEqual({ type: "tap", text: null, keys: ["LCTL(KC_C)"], delay: null });
    expect(stepRequest(text("hi"))).toEqual({ type: "text", text: "hi", keys: [], delay: null });
    expect(sameSteps(M0, [text("git status"), keys("tap", { ...ENTER, tap: "Return" })])).toBe(true);
    expect(sameSteps(M0, [text("git status")])).toBe(false);
  });
});
