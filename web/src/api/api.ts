// The server's routes the UI uses.
import { request } from "./client";
import type { ComboIn, MacroActionIn, Named, TapDanceIn } from "./types";

export const api = {
  session: () => request("get", "/api/session"),
  keyboard: () => request("get", "/api/keyboard"),
  keycodes: () => request("get", "/api/keycodes"),
  languages: () => request("get", "/api/keyboard-languages"),
  parse: (expression: string) => request("post", "/api/keycodes/parse", { body: { expression } }),
  setKey: (layer: number, row: number, col: number, code: string) =>
    request("put", "/api/keymap/{layer}/{row}/{col}", { params: { layer, row, col }, body: { code } }),
  setEncoder: (layer: number, index: number, direction: number, code: string) =>
    request("put", "/api/encoders/{layer}/{index}/{direction}", { params: { layer, index, direction }, body: { code } }),
  setTapDance: (index: number, body: TapDanceIn) =>
    request("put", "/api/tap-dance/{index}", { params: { index }, body }),
  setCombo: (index: number, body: ComboIn) => request("put", "/api/combos/{index}", { params: { index }, body }),
  /** every macro: they share the keyboard's macro memory */
  setMacros: (items: MacroActionIn[][]) => request("put", "/api/macros", { body: { items } }),
  setName: (kind: Named["kind"], index: number, name: string) =>
    request("put", "/api/names/{kind}/{index}", { params: { kind, index }, body: { name } }),
  unlockStart: () => request("post", "/api/unlock/start"),
  unlockCancel: () => request("post", "/api/unlock/cancel"),
  lock: () => request("post", "/api/lock"),
};
