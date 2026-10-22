// The server's routes the UI uses.
import { download, request } from "./client";
import type {
  AltRepeatKeyIn, AttemptIn, ComboIn, FingersIn, KeyOverrideIn, LearningSettingsIn, LightingIn, MacroActionIn, Named,
  TapDanceIn,
} from "./types";

export const api = {
  session: () => request("get", "/api/session"),
  /** the Vial keyboards plugged in, and the chosen one while it is unplugged */
  keyboards: () => request("get", "/api/keyboards"),
  /** closes the keyboard open and opens this one, kept as the choice while the server runs */
  selectKeyboard: (id: string) => request("post", "/api/keyboards/select", { body: { id } }),
  keyboard: () => request("get", "/api/keyboard"),
  keycodes: () => request("get", "/api/keycodes"),
  languages: () => request("get", "/api/keyboard-languages"),
  parse: (expression: string) => request("post", "/api/keycodes/parse", { body: { expression } }),
  setKey: (layer: number, row: number, col: number, code: string) =>
    request("put", "/api/keymap/{layer}/{row}/{col}", { params: { layer, row, col }, body: { code } }),
  setEncoder: (layer: number, index: number, direction: number, code: string) =>
    request("put", "/api/encoders/{layer}/{index}/{direction}", { params: { layer, index, direction }, body: { code } }),
  /** saved on the keyboard at once (via.c keeps them in its EEPROM) */
  setLayoutOptions: (value: number) => request("put", "/api/layout-options", { body: { value } }),
  setTapDance: (index: number, body: TapDanceIn) =>
    request("put", "/api/tap-dance/{index}", { params: { index }, body }),
  setCombo: (index: number, body: ComboIn) => request("put", "/api/combos/{index}", { params: { index }, body }),
  setKeyOverride: (index: number, body: KeyOverrideIn) =>
    request("put", "/api/key-overrides/{index}", { params: { index }, body }),
  setAltRepeatKey: (index: number, body: AltRepeatKeyIn) =>
    request("put", "/api/alt-repeat/{index}", { params: { index }, body }),
  /** every macro: they share the keyboard's macro memory */
  setMacros: (items: MacroActionIn[][]) => request("put", "/api/macros", { body: { items } }),
  /** a macro as Qt's text editor has it, read as steps for this keyboard (422: what is wrong); nothing is written */
  parseMacroText: (text: string) => request("post", "/api/macros/parse", { body: { text } }),
  settingDefinitions: () => request("get", "/api/qmk-settings/definitions"),
  setSetting: (qsid: number, value: number) =>
    request("put", "/api/qmk-settings/{qsid}", { params: { qsid }, body: { value } }),
  resetSettings: () => request("post", "/api/qmk-settings/reset"),
  /** shown at once, forgotten when the keyboard is unplugged unless saved (but backlight breathing, which the firmware
   * keeps at once with the backlight level it runs at); answers what the keyboard shows */
  setLighting: (body: LightingIn) => request("put", "/api/lighting", { body }),
  /** keeps the lighting the keyboard shows when it is unplugged */
  saveLighting: () => request("post", "/api/lighting/save"),
  /** the keyboard's layout as a .vil file, named after the keyboard */
  layoutFile: () => download("/api/layout-file", "keyboard.vil"),
  /** what loading a .vil file would change; nothing is written */
  previewLayoutFile: (text: string) => request("post", "/api/layout-file/preview", { raw: text }),
  /** writes a .vil file to the keyboard: the whole file, or nothing when it doesn't fit */
  loadLayoutFile: (text: string) => request("post", "/api/layout-file", { raw: text }),
  /** what arranging the layers in this order would change (order[position] = layer now); nothing is written */
  previewArrange: (order: number[]) => request("post", "/api/layers/arrange/preview", { body: { order } }),
  /** moves the layers to this order, every layer reference following, and their names; answers the new model with
   * its layout version. expect: the layout version the order was chosen for (a preview's): refused (409, code
   * "layoutChanged") when the layers changed since; null: whatever they are */
  arrangeLayers: (order: number[], expect: number | null = null) =>
    request("post", "/api/layers/arrange", { body: { order, expect } }),
  /** writes the rest of an arrange that stopped partway, then moves the names */
  finishArrange: () => request("post", "/api/layers/arrange/finish"),
  /** writes back what an arrange that stopped partway changed */
  putBackArrange: () => request("post", "/api/layers/arrange/put-back"),
  setName: (kind: Named["kind"], index: number, name: string) =>
    request("put", "/api/names/{kind}/{index}", { params: { kind, index }, body: { name } }),
  // Learning (docs/learning/lesson-format.md): the app's files for this keyboard, nothing on the keyboard
  /** which finger types each key: the app's proposal with the user's corrections on top */
  learningFingers: () => request("get", "/api/learning/fingers"),
  /** saves the corrections (all of them: it replaces what was saved); answers as learningFingers does */
  setLearningFingers: (body: FingersIn) => request("put", "/api/learning/fingers", { body }),
  /** forgets the corrections: back to the proposal */
  resetLearningFingers: () => request("delete", "/api/learning/fingers"),
  /** the layout export for the lesson generator, in the keyboard language shown */
  learningExport: () => request("get", "/api/learning/export"),
  /** the lesson sets of this keyboard, each with whether it is out of date */
  learningSets: () => request("get", "/api/learning/sets"),
  /** a lesson set file, checked and saved (201); 422 lists what is wrong with it (ApiError.errors) */
  importLearningSet: (text: string) => request("post", "/api/learning/sets", { raw: text }),
  learningSet: (set: string) => request("get", "/api/learning/sets/{set}", { params: { set } }),
  /** removes the set; its progress stays */
  deleteLearningSet: (set: string) => request("delete", "/api/learning/sets/{set}", { params: { set } }),
  learningProgress: (set: string) => request("get", "/api/learning/progress/{set}", { params: { set } }),
  /** an exercise typed to the end; the server computes accuracy and WPM and keeps the best */
  recordAttempt: (set: string, exercise: string, body: AttemptIn) =>
    request("put", "/api/learning/progress/{set}/{exercise}", { params: { set, exercise }, body }),
  learningSettings: () => request("get", "/api/learning/settings"),
  setLearningSettings: (body: LearningSettingsIn) => request("put", "/api/learning/settings", { body }),
  unlockStart: () => request("post", "/api/unlock/start"),
  unlockCancel: () => request("post", "/api/unlock/cancel"),
  lock: () => request("post", "/api/lock"),
  /** the keyboard reboots into its bootloader and leaves; answers the session without it. 504: it got the reboot and
   * didn't answer, so it most likely went (the server closed it) */
  rebootToBootloader: () => request("post", "/api/bootloader"),
  /** quits Vial: the keyboard is let go of, every tab gets a "stopped" event, and the server stops once it answered */
  shutdown: () => request("post", "/api/shutdown"),
};
