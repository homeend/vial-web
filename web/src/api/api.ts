// The server's routes the UI uses.
import { request } from "./client";
import type { TapDanceIn } from "./types";

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
  setLayerName: (index: number, name: string) =>
    request("put", "/api/names/{kind}/{index}", { params: { kind: "layers", index }, body: { name } }),
};
