// The Learning feature's files as TypeScript (docs/learning/lesson-format.md). What the server models itself (the
// progress, an attempt, the settings, the fingers reply) comes from its generated schema; what it passes through as
// plain dicts (the lesson set, the layout export's layers and keys) is written out here.
import type { components } from "../api/schema";
import { NAME } from "../lib/route";

type Schemas = components["schemas"];

export type ExerciseKind = "new-keys" | "keys" | "words" | "blind" | "text" | "extra-keys" | "extra-words";

export const EXERCISE_KINDS: readonly ExerciseKind[] = [
  "new-keys", "keys", "words", "blind", "text", "extra-keys", "extra-words",
];

export type Via = "tap" | "shift" | "altGr";

/** A character a lesson introduces, and where it is */
export interface NewChar {
  /** one character */
  char: string;
  /** export key id, "r1c4" */
  key: string;
  layer: number;
  via: Via;
  /** a label for the way there, "hold Space" */
  path?: string;
}

export interface Exercise {
  id: string;
  kind: ExerciseKind;
  title: string;
  /** one screen line per entry */
  lines: string[];
}

export interface Lesson {
  id: string;
  title: string;
  new: NewChar[];
  /** a lesson that adds nothing (All keys) */
  review?: boolean;
  /** the finger text, plain words */
  guidance: string;
  exercises: Exercise[];
}

export interface LessonSet {
  format: "vial-web-lessons/1";
  /** file name without .json: letters, digits, - and _ */
  id: string;
  title: string;
  /** BCP-47 primary tag: "en", "pl" */
  language: string;
  layout: { name: string; uid: string; hash: string };
  generatedBy?: { tool: string; model?: string; at: string };
  notes?: string;
  lessons: Lesson[];
}

/** Which finger types a key, and from where: the server's proposal, or the user's correction */
export type FingerKey = Schemas["FingerKey"];
export type Hand = FingerKey["hand"];
export type Finger = FingerKey["finger"];
export type Reach = FingerKey["reach"];
/** "number" | "top" | "home" | "bottom" | "thumb", as the server names the rows */
export type KeyRow = FingerKey["row"];
/** how a key reaches a layer: MO/TT hold it, OSL for one key, TG toggles, TO/DF switch to it */
export type LayerHow = "hold" | "oneShot" | "toggle" | "switch";

/** What a key types on one layer; left out of a layer where it types nothing printable */
export interface LayerChars {
  tap?: string;
  shift?: string;
  altGr?: string;
  /** what holding does: "Shift", "Ctrl", "layer 2" */
  hold?: string;
}

export interface ExportKey {
  id: string;
  hand: Hand;
  finger: Finger;
  row: KeyRow;
  reach: Reach;
  /** a resting key */
  home: boolean;
  /** centre in key units */
  x: number;
  y: number;
  /** by layer index, as a string: "0", "1", … */
  chars: Record<string, LayerChars>;
  layerKey?: { layer: number; how: LayerHow };
}

export interface LayerAccess {
  key: string;
  how: LayerHow;
  /** "hold Space", "tap OSL 3" */
  label: string;
}

export interface ExportLayer {
  index: number;
  name: string;
  reachedBy: LayerAccess[];
}

export interface ShiftKey {
  key: string;
  hand: Hand;
  label: string;
}

export interface LayoutExport {
  format: "vial-web-layout-export/1";
  keyboard: { name: string; uid: string };
  /** over the character map only: a lesson set built from another hash is out of date */
  hash: string;
  exportedAt: string;
  language: string;
  layers: ExportLayer[];
  shiftKeys: ShiftKey[];
  keys: ExportKey[];
}

/** One finished attempt at an exercise, with the accuracy and WPM the server computed */
export type Attempt = Schemas["Attempt"];
/** done, the best attempt (the highest accuracy, then the highest WPM) and all attempts */
export type ExerciseProgress = Schemas["ExerciseProgress"];
/** the pass accuracy in percent, the WPM for a star, and whether word exercises show the keyboard picture; kept by
 * the server in settings.json, not in the progress */
export type LearningSettings = Schemas["LearningSettings"];
/** The progress on one lesson set: the exercises by id; layoutHash is the hash the set was built for, when known */
export type Progress = Schemas["Progress"];
/** The fingers reply: the app's proposal merged with the user's corrections; `proposal` says nothing is corrected yet */
export type Fingers = Schemas["Fingers"];

/** a lesson set id (the schema's pattern): the lesson set's file name, and one name of the Learning address */
const ID = NAME;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The lesson set a parsed file holds, or an Error saying what is wrong with its shape (the format, the id, the lessons
 * array and each lesson's new characters and exercises, each exercise's kind and lines). The server checks the content
 * fully; this guards the client. */
export function readLessonSet(json: unknown): LessonSet {
  if (!isRecord(json)) throw new Error("not a lesson set: not a JSON object");
  if (json.format !== "vial-web-lessons/1") throw new Error(`not a lesson set: the format is ${String(json.format)}`);
  if (typeof json.id !== "string" || !ID.test(json.id)) {
    throw new Error("the lesson set's id must be up to 64 letters, digits, - and _, starting with a letter or digit");
  }
  if (!Array.isArray(json.lessons)) throw new Error("the lesson set has no lessons array");
  if (json.lessons.length === 0) throw new Error("the lesson set has no lessons");
  json.lessons.forEach((lesson: unknown, i: number) => {
    const name = isRecord(lesson) && typeof lesson.id === "string" ? `lesson ${lesson.id}` : `lesson ${i + 1}`;
    if (!isRecord(lesson) || typeof lesson.id !== "string" || !Array.isArray(lesson.exercises)) {
      throw new Error(`${name} needs an id and an exercises array`);
    }
    if (lesson.exercises.length === 0) throw new Error(`${name} has no exercises`);
    if (!Array.isArray(lesson.new)) throw new Error(`${name} needs a new array (empty for a review lesson)`);
    if (lesson.new.some((entry: unknown) => !isRecord(entry) || typeof entry.char !== "string"
      || [...entry.char].length !== 1)) {
      throw new Error(`${name}: each entry of new needs a char, one character`);
    }
    lesson.exercises.forEach((exercise: unknown, j: number) => {
      const id = isRecord(exercise) && typeof exercise.id === "string" ? `exercise ${exercise.id}` : `exercise ${j + 1}`;
      if (!isRecord(exercise) || typeof exercise.id !== "string") throw new Error(`${name}: ${id} needs an id`);
      if (!EXERCISE_KINDS.includes(exercise.kind as ExerciseKind)) {
        throw new Error(`${name}: ${id} has the kind ${String(exercise.kind)}, not one of ${EXERCISE_KINDS.join(", ")}`);
      }
      if (!Array.isArray(exercise.lines) || exercise.lines.length === 0
        || exercise.lines.some((line: unknown) => typeof line !== "string")) {
        throw new Error(`${name}: ${id} needs lines, an array of strings`);
      }
    });
  });
  return json as unknown as LessonSet;
}
