// The keyboard picture while typing (design § 3): the next character's key lit, the Shift or layer key that reaches it
// pressed, the rest faded in the new-key exercises. Keyboard.svelte takes the three arrays as they are, aligned with
// placement.items. A key is named as the export names it, "r1c4": row and column of its geometry.
import type { Placement } from "../keyboard/geometry";
import type { ExportKey, LayerAccess, LayoutExport, LessonSet, Via } from "./types";

/** where a character is: the export key id, the layer, and how (tap, with Shift, with AltGr); `path` the lesson's own
 * name of the way to the layer, when it gives one ("hold Space") */
export interface PlaceOf {
  key: string;
  layer: number;
  via: Via;
  path?: string;
}

/** the key's row and column as an export key id; null for a key with none (an encoder) */
export function keyIdOf(geometry: { row?: number | null; col?: number | null }): string | null {
  return geometry.row == null || geometry.col == null ? null : `r${geometry.row}c${geometry.col}`;
}

/** The placement's item that is the export key `id`, or null */
export function keyIndex(placement: Placement, id: string): number | null {
  const i = placement.items.findIndex((item) => item.kind === "key" && keyIdOf(item.geometry) === id);
  return i === -1 ? null : i;
}

/** Where every character a lesson set teaches is: the `new` entries of every lesson, the first listing of a character
 * winning; the space from the export, as the layer-0 key that taps it (of two, the one a touch typist uses: a resting
 * key, else a thumb key). An entry without a key (the checker allows one) places nothing; a missing layer is 0, a
 * missing via a tap. */
export function placeOfChars(set: LessonSet, layout: LayoutExport): Map<string, PlaceOf> {
  const places = new Map<string, PlaceOf>();
  const spaces = layout.keys.filter((key) => key.chars["0"]?.tap === " ").map((key) => ({ key: key.id }));
  const space = preferred(layout, spaces);
  if (space) places.set(" ", { key: space.key, layer: 0, via: "tap" });
  for (const lesson of set.lessons) {
    for (const { char, key, layer = 0, via = "tap", path } of lesson.new) {
      if (!key || places.has(char)) continue;
      places.set(char, path ? { key, layer, via, path } : { key, layer, via });
    }
  }
  return places;
}

export interface Picture {
  /** the next character's key */
  highlights: boolean[];
  /** the Shift and layer keys held for it */
  pressed: boolean[];
  /** everything else, when asked */
  faded: boolean[];
}

function exportKey(layout: LayoutExport, id: string): ExportKey | undefined {
  return layout.keys.find((key) => key.id === id);
}

/** Of several keys that do the same (the Shifts of a hand, the keys reaching a layer), the one a touch typist holds:
 * a resting key (`home`, usually a thumb), else one on the thumb row, else the first listed; undefined for none */
function preferred<T extends { key: string }>(layout: LayoutExport, candidates: T[]): T | undefined {
  const keyOf = (c: T) => exportKey(layout, c.key);
  return candidates.find((c) => keyOf(c)?.home) ?? candidates.find((c) => keyOf(c)?.row === "thumb") ?? candidates[0];
}

/** the Shift key to hold for a character on `key`: the other hand's, as a touch typist does; failing that, any */
function shiftKeyFor(layout: LayoutExport, key: ExportKey | undefined): string | null {
  const others = key ? layout.shiftKeys.filter((shift) => shift.hand !== key.hand) : [];
  return preferred(layout, others.length ? others : layout.shiftKeys)?.key ?? null;
}

/** the way to a layer the picture shows: the preferred of the export's `reachedBy`, undefined for an unknown layer */
function layerAccessFor(layout: LayoutExport, layer: number): LayerAccess | undefined {
  return preferred(layout, layout.layers.find((l) => l.index === layer)?.reachedBy ?? []);
}

/** the key held for AltGr: a layer-0 key the export says holds it (a mod-tap's hold, or a plain AltGr key) */
function altGrKeyFor(layout: LayoutExport): string | null {
  const holders = layout.keys.filter((key) => key.chars["0"]?.hold === "AltGr").map((key) => ({ key: key.id }));
  return preferred(layout, holders)?.key ?? null;
}

/** the keys held to type a character at `place`, in the export's ids */
export function heldKeysFor(place: PlaceOf, layout: LayoutExport): string[] {
  const held: (string | null)[] = [];
  if (place.layer !== 0) held.push(layerAccessFor(layout, place.layer)?.key ?? null);
  if (place.via === "shift") held.push(shiftKeyFor(layout, exportKey(layout, place.key)));
  if (place.via === "altGr") held.push(altGrKeyFor(layout));
  return held.filter((id): id is string => id !== null);
}

/** The picture for the character to type next: its key lit, the keys held for it pressed, the rest faded when
 * `fadeOthers`. A character `places` doesn't know marks nothing. */
export function pictureFor(
  char: string, places: Map<string, PlaceOf>, placement: Placement, layout: LayoutExport,
  { fadeOthers }: { fadeOthers: boolean },
): Picture {
  const count = placement.items.length;
  const highlights = Array<boolean>(count).fill(false);
  const pressed = Array<boolean>(count).fill(false);
  const faded = Array<boolean>(count).fill(false);
  const place = places.get(char);
  if (!place) return { highlights, pressed, faded };
  const lit = keyIndex(placement, place.key);
  if (lit !== null) highlights[lit] = true;
  for (const id of heldKeysFor(place, layout)) {
    const i = keyIndex(placement, id);
    if (i !== null) pressed[i] = true;
  }
  if (fadeOthers) {
    for (let i = 0; i < count; i++) faded[i] = !highlights[i] && !pressed[i];
  }
  return { highlights, pressed, faded };
}

/** The picture for several characters at once (a lesson's new keys): every one's key lit and the keys held for them
 * pressed; the rest faded when `fadeOthers` */
export function pictureForAll(
  chars: string[], places: Map<string, PlaceOf>, placement: Placement, layout: LayoutExport,
  { fadeOthers }: { fadeOthers: boolean },
): Picture {
  const count = placement.items.length;
  const highlights = Array<boolean>(count).fill(false);
  const pressed = Array<boolean>(count).fill(false);
  for (const char of chars) {
    const one = pictureFor(char, places, placement, layout, { fadeOthers: false });
    one.highlights.forEach((on, i) => (highlights[i] ||= on));
    one.pressed.forEach((on, i) => (pressed[i] ||= on));
  }
  const faded = highlights.map((on, i) => fadeOthers && !on && !pressed[i]);
  return { highlights, pressed, faded };
}

/** a key's legend on a layer: "Space", a letter in capitals (as it is when its capital isn't one character: "ß" would
 * be "SS"), or the character; the layer-0 one when the layer has none; the key id when the export has no such key */
function legendOf(layout: LayoutExport, id: string, layer: number): string {
  const key = exportKey(layout, id);
  const tap = key?.chars[String(layer)]?.tap ?? key?.chars["0"]?.tap;
  if (tap === undefined) return id;
  if (tap === " ") return "Space";
  const upper = tap.toUpperCase();
  return /^\p{L}$/u.test(tap) && Array.from(upper).length === 1 ? upper : tap;
}

/** The status line's name of the key to press: "S", "Space", "Shift + S", "hold Space → (", "tap OSL 3 → Shift + 1".
 * The way to a layer is the lesson's own `path` when it has one, else the label of the key the picture presses */
export function nextKeyLabel(place: PlaceOf, layout: LayoutExport): string {
  const legend = legendOf(layout, place.key, place.layer);
  const modified = place.via === "shift" ? `Shift + ${legend}` : place.via === "altGr" ? `AltGr + ${legend}` : legend;
  if (place.layer === 0) return modified;
  const how = place.path ?? layerAccessFor(layout, place.layer)?.label ?? `layer ${place.layer}`;
  return `${how} → ${modified}`;
}
