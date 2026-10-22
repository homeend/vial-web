// The Learning feature's files as TypeScript: the lesson set the generator writes, the layout export the app writes
// for it, the progress the app keeps, and the fingers reply (docs/learning/lesson-format.md).

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

export type Hand = "left" | "right";
export type Finger = "index" | "middle" | "ring" | "pinky" | "thumb";
export type Reach = "rest" | "up" | "down" | "inner" | "outer";
export type KeyRow = "top" | "home" | "bottom" | "thumb" | string;

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
  layerKey?: { layer: number; how: string };
}

export interface LayerAccess {
  key: string;
  how: "hold" | "oneShot" | "toggle" | string;
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

/** One finished attempt at an exercise */
export interface Attempt {
  at: string;
  chars: number;
  errors: number;
  accuracy: number;
  wpm: number;
  seconds: number;
}

export interface ExerciseProgress {
  done: boolean;
  /** the attempt with the highest accuracy, then the highest WPM */
  best?: Attempt | null;
  attempts: Attempt[];
}

export interface LearningSettings {
  /** a lesson passes when every main exercise reached this accuracy, in percent */
  passAccuracy: number;
  /** a star at this WPM */
  targetWpm: number;
  /** the keyboard picture in word exercises too */
  pictureInWords: boolean;
}

export interface Progress {
  format: "vial-web-progress/1";
  lessonSet: string;
  layoutHash: string;
  settings?: Partial<LearningSettings>;
  exercises: Record<string, ExerciseProgress>;
}

/** The fingers reply: the app's proposal merged with the user's corrections */
export interface Fingers {
  format: string;
  keys: Record<string, { hand: Hand; finger: Finger; row: KeyRow; reach: Reach; home: boolean }>;
  /** the resting keys */
  home: string[];
  /** all of it is the app's proposal: nothing corrected yet */
  proposal: boolean;
}

const ID = /^[A-Za-z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The lesson set a parsed file holds, or an Error saying what is wrong with its shape (the format, the id, the lessons
 * array, each exercise's kind and lines). The server checks the content fully; this guards the client. */
export function readLessonSet(json: unknown): LessonSet {
  if (!isRecord(json)) throw new Error("not a lesson set: not a JSON object");
  if (json.format !== "vial-web-lessons/1") throw new Error(`not a lesson set: the format is ${String(json.format)}`);
  if (typeof json.id !== "string" || !ID.test(json.id)) {
    throw new Error("the lesson set's id must be letters, digits, - and _");
  }
  if (!Array.isArray(json.lessons)) throw new Error("the lesson set has no lessons array");
  json.lessons.forEach((lesson: unknown, i: number) => {
    const name = isRecord(lesson) && typeof lesson.id === "string" ? `lesson ${lesson.id}` : `lesson ${i + 1}`;
    if (!isRecord(lesson) || typeof lesson.id !== "string" || !Array.isArray(lesson.exercises)) {
      throw new Error(`${name} needs an id and an exercises array`);
    }
    if (!Array.isArray(lesson.new)) throw new Error(`${name} needs a new array (empty for a review lesson)`);
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
