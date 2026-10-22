// The fingers as the Fingers view and the lesson guidance name and colour them (the tokens are in app.css).
import type { Finger, Hand } from "./types";

/** from the outside in, then the thumb: the order a hand's keys are listed */
export const FINGERS: readonly Finger[] = ["pinky", "ring", "middle", "index", "thumb"];

/** each finger's colour on the keyboard picture, as a CSS value */
export const FINGER_COLOURS: Record<Finger, string> = {
  index: "var(--finger-index)",
  middle: "var(--finger-middle)",
  ring: "var(--finger-ring)",
  pinky: "var(--finger-pinky)",
  thumb: "var(--finger-thumb)",
};

/** "left index", "right thumb" */
export function fingerLabel(finger: Finger, hand: Hand): string {
  return `${hand} ${finger}`;
}
