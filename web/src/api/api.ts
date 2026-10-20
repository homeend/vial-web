// The server's routes the UI uses.
import { download, request } from "./client";
import type { AltRepeatKeyIn, ComboIn, KeyOverrideIn, LightingIn, MacroActionIn, Named, TapDanceIn } from "./types";

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
  setName: (kind: Named["kind"], index: number, name: string) =>
    request("put", "/api/names/{kind}/{index}", { params: { kind, index }, body: { name } }),
  unlockStart: () => request("post", "/api/unlock/start"),
  unlockCancel: () => request("post", "/api/unlock/cancel"),
  lock: () => request("post", "/api/lock"),
  /** the keyboard restarts into its bootloader and leaves; answers the session without it */
  rebootToBootloader: () => request("post", "/api/bootloader"),
};
