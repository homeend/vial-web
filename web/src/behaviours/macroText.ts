// A macro as text, as Qt's text editor has it ("Open Text Editor..." on its Macros tab): the JSON of each step's
// save() (src/main/python/macro/macro_action.py), e.g. [["text", "hi"], ["tap", "KC_ENTER", "KC_A"], ["delay", 50]].
// Written here character for character as Qt writes it, so that text copied from one goes into the other; read by the
// server (POST /api/macros/parse), which checks it as a .vil file's macros are checked.
import type { Step } from "./macro";
import { stepRequest } from "./macro";

/** A step as Qt saves it: its tag, then its text, its delay or its keys */
export function qtAction(step: Step): (string | number)[] {
  const r = stepRequest(step);
  switch (r.type) {
    case "text":
      return ["text", r.text ?? ""];
    case "delay":
      return ["delay", r.delay ?? 0];
    default:
      return [r.type, ...(r.keys ?? [])];
  }
}

/** A value as Python's json.dumps writes it: what isn't printable ASCII as \uXXXX (DEL too), as ensure_ascii does */
function pythonJson(value: string | number): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** The steps as Qt's text editor shows them: json.dumps of the list, ", " between items */
export function macroText(steps: Step[]): string {
  return `[${steps.map((step) => `[${qtAction(step).map(pythonJson).join(", ")}]`).join(", ")}]`;
}

/** What the macro editor says once text was applied: `made` steps from it, in place of `before` */
export function appliedNote(made: number, before: number): string {
  const steps = (n: number) => `${n} ${n === 1 ? "step" : "steps"}`;
  return `${made === 0 ? "No step" : steps(made)} from the text, in place of ${before === 0 ? "none" : `the ${steps(before)}`} ` +
    "there before. Cancel puts back the macro as the keyboard has it.";
}
