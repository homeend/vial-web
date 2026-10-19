// Macros as steps: what each step says, how many bytes of the keyboard's macro memory it takes, and editing them.
// The sizes follow the protocol's encoding (src/main/python/macro/macro_action.py): the keyboard stores all macros in
// one buffer, each ended by a 0 byte.
import type { Described, MacroAction, MacroActionIn } from "../api/types";

export type Step = MacroAction;
export type StepKind = Step["type"];

export const STEP_KINDS: { kind: StepKind; label: string }[] = [
  { kind: "text", label: "Type text" },
  { kind: "tap", label: "Tap a key" },
  { kind: "down", label: "Press a key" },
  { kind: "up", label: "Release a key" },
  { kind: "delay", label: "Wait" },
];

/** Vial protocol 2 brought delays, and a prefix byte before every key action */
export const ADVANCED_MACROS = 2;
/** the longest delay a step can have, in ms (as the server's MACRO_DELAY_MAX) */
export const DELAY_MAX = 64000;
/** the most steps a macro can have (as the server's MACRO_STEPS_MAX) */
export const STEPS_MAX = 256;
/** the share of the macro memory from which its bar turns amber */
export const NEAR_FULL = 0.85;
/** what a text step may hold: printable ASCII, tabs and line breaks (as the server's MACRO_TEXT) */
const TEXT = /^[\t\n\x20-\x7e]*$/;

/** Bytes a step takes: text one a character; a key action a byte for the action (and a prefix byte with protocol 2),
 * and one byte for a keycode under 256 or two for the others; a delay four */
export function stepBytes(step: Step, vialProtocol: number): number {
  const advanced = vialProtocol >= ADVANCED_MACROS;
  switch (step.type) {
    case "text":
      return new TextEncoder().encode(step.text ?? "").length;
    case "delay":
      return 4;
    default:
      return step.keys.reduce((sum, key) => sum + (advanced ? 1 : 0) + 1 + (key.value < 256 ? 1 : 2), 0);
  }
}

export function macroBytes(steps: Step[], vialProtocol: number): number {
  return steps.reduce((sum, step) => sum + stepBytes(step, vialProtocol), 0);
}

/** Bytes all macros take in the keyboard's memory, the 0 byte that ends each one included */
export function memoryUsed(macros: Step[][], vialProtocol: number): number {
  return macros.reduce((sum, steps) => sum + macroBytes(steps, vialProtocol) + 1, 0);
}

export type MemoryLevel = "ok" | "near" | "over";

export function memoryLevel(used: number, memory: number): MemoryLevel {
  if (used > memory) return "over";
  return memory > 0 && used >= memory * NEAR_FULL ? "near" : "ok";
}

/** What a step does, as a verb: "type", "tap", "press", "release", "wait" */
export function stepVerb(step: Step): string {
  return { text: "type", tap: "tap", down: "press", up: "release", delay: "wait" }[step.type];
}

function keyName(d: Described): string {
  return d.tap || d.code;
}

/** What it does it to: "“git status”", "Enter", "Home, End" (each in turn), "50 ms" */
export function stepWhat(step: Step): string {
  switch (step.type) {
    case "text":
      return `“${(step.text ?? "").replace(/\n/g, "⏎").replace(/\t/g, "⇥")}”`;
    case "delay":
      return `${step.delay ?? 0} ms`;
    default:
      return step.keys.length > 0 ? step.keys.map(keyName).join(", ") : "no key yet";
  }
}

/** The whole macro in words: 'type “git status” → tap Enter' */
export function macroSentence(steps: Step[]): string {
  return steps.length === 0 ? "Does nothing yet." : steps.map((s) => `${stepVerb(s)} ${stepWhat(s)}`).join(" → ");
}

/** Why a step can't be saved, or null */
export function stepProblem(step: Step, vialProtocol: number): string | null {
  switch (step.type) {
    case "text":
      if (!step.text) return "Type the text to send.";
      return TEXT.test(step.text) ? null : "The keyboard can only type plain ASCII characters, tabs and line breaks.";
    case "delay": {
      if (vialProtocol < ADVANCED_MACROS) return "This keyboard's firmware has no waits in macros.";
      const delay = step.delay ?? -1;
      return Number.isInteger(delay) && delay >= 0 && delay <= DELAY_MAX ? null : `Wait 0 to ${DELAY_MAX} ms.`;
    }
    default:
      return step.keys.length > 0 ? null : "Choose a key.";
  }
}

/** A new step of a kind: empty text, no keys yet, or a wait of 100 ms */
export function newStep(kind: StepKind): Step {
  return { type: kind, text: kind === "text" ? "" : null, keys: [], delay: kind === "delay" ? 100 : null };
}

/** The step turned into another kind, keeping its keys between tap, press and release */
export function changeKind(step: Step, kind: StepKind): Step {
  if (kind === step.type) return step;
  const keyed = (k: StepKind) => k === "tap" || k === "down" || k === "up";
  return keyed(kind) && keyed(step.type) ? { ...step, type: kind } : newStep(kind);
}

/** The steps with the one at `from` moved to `to` */
export function moveStep<T>(steps: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= steps.length || to >= steps.length) return steps;
  const out = [...steps];
  const [step] = out.splice(from, 1);
  out.splice(to, 0, step);
  return out;
}

/** A step as the server takes it */
export function stepRequest(step: Step): MacroActionIn {
  switch (step.type) {
    case "text":
      return { type: "text", text: step.text ?? "", keys: [], delay: null };
    case "delay":
      return { type: "delay", text: null, keys: [], delay: step.delay ?? 0 };
    default:
      return { type: step.type, text: null, keys: step.keys.map((k) => k.code), delay: null };
  }
}

/** Whether two step lists say the same */
export function sameSteps(a: Step[], b: Step[]): boolean {
  return JSON.stringify(a.map(stepRequest)) === JSON.stringify(b.map(stepRequest));
}
