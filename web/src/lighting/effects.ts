// The lighting effects by name, as Qt's Lighting tab names them (editor/rgb_configurator.py), and what the firmware
// does with the colour under some of them (vial-qmk quantum/rgblight/rgblight.c, quantum/rgb_matrix/rgb_matrix.c).

/** VialRGB effects by their VialRGB number (vialrgb_effects.inc: never reordered, only added to) */
export const VIALRGB_EFFECTS = [
  "Disable", "Direct Control", "Solid Color", "Alphas Mods", "Gradient Up Down", "Gradient Left Right", "Breathing",
  "Band Sat", "Band Val", "Band Pinwheel Sat", "Band Pinwheel Val", "Band Spiral Sat", "Band Spiral Val", "Cycle All",
  "Cycle Left Right", "Cycle Up Down", "Rainbow Moving Chevron", "Cycle Out In", "Cycle Out In Dual", "Cycle Pinwheel",
  "Cycle Spiral", "Dual Beacon", "Rainbow Beacon", "Rainbow Pinwheels", "Raindrops", "Jellybean Raindrops",
  "Hue Breathing", "Hue Pendulum", "Hue Wave", "Typing Heatmap", "Digital Rain", "Solid Reactive Simple",
  "Solid Reactive", "Solid Reactive Wide", "Solid Reactive Multiwide", "Solid Reactive Cross",
  "Solid Reactive Multicross", "Solid Reactive Nexus", "Solid Reactive Multinexus", "Splash", "Multisplash",
  "Solid Splash", "Solid Multisplash", "Pixel Rain", "Pixel Fractal",
] as const;

/** VialRGB's "Disable": the RGB matrix is off */
export const VIALRGB_OFF = 0;

/** QMK RGB light effects by number, as Qt lists them: the numbers they have with every effect built in */
export const RGBLIGHT_EFFECTS = [
  "All Off", "Solid Color", "Breathing 1", "Breathing 2", "Breathing 3", "Breathing 4", "Rainbow Mood 1",
  "Rainbow Mood 2", "Rainbow Mood 3", "Rainbow Swirl 1", "Rainbow Swirl 2", "Rainbow Swirl 3", "Rainbow Swirl 4",
  "Rainbow Swirl 5", "Rainbow Swirl 6", "Snake 1", "Snake 2", "Snake 3", "Snake 4", "Snake 5", "Snake 6", "Knight 1",
  "Knight 2", "Knight 3", "Christmas", "Gradient 1", "Gradient 2", "Gradient 3", "Gradient 4", "Gradient 5",
  "Gradient 6", "Gradient 7", "Gradient 8", "Gradient 9", "Gradient 10", "RGB Test", "Alternating",
] as const;

export interface EffectChoice {
  value: number;
  label: string;
}

function nameOf(list: readonly string[], value: number): string {
  return list[value] ?? `Effect ${value}`;
}

/** The VialRGB effects the keyboard has, in order, by name; the one it runs is listed even if it isn't among them */
export function vialRgbChoices(supported: number[], current: number): EffectChoice[] {
  const values = [...new Set([...supported, current])].sort((a, b) => a - b);
  return values.map((value) => ({ value, label: nameOf(VIALRGB_EFFECTS, value) }));
}

/** Every QMK RGB light effect Vial names; one the keyboard runs beyond them is added by its number */
export function rgbLightChoices(current: number): EffectChoice[] {
  const values = RGBLIGHT_EFFECTS.map((_, value) => value);
  if (!values.includes(current)) values.push(current);
  return values.map((value) => ({ value, label: nameOf(RGBLIGHT_EFFECTS, value) }));
}

/** What the keyboard does with colour changes under a VialRGB effect, when it ignores some; null otherwise */
export function vialRgbNote(mode: number): string | null {
  // rgb_matrix_sethsv_noeeprom does nothing while the matrix is off
  if (mode === VIALRGB_OFF) return "The lights are off: the keyboard takes no colour or brightness until an effect is chosen.";
  return null;
}

/** What the keyboard does with colour changes under a QMK RGB light effect, when it ignores some; null otherwise.
 * By the numbers of a keyboard with every effect built in (rgblight_sethsv_eeprom_helper). */
export function rgbLightNote(effect: number): string | null {
  if (effect === 0) return "The light is off: the keyboard takes no colour or brightness until an effect is chosen.";
  if (effect >= 2 && effect <= 5) return "Breathing keeps its brightness: the keyboard ignores brightness changes while it runs.";
  if (effect >= 6 && effect <= 14) return "This effect runs through the hues itself: the keyboard ignores hue changes while it runs.";
  return null;
}
