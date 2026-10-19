import { describe, expect, it } from "vitest";
import { KeymapState } from "./state.svelte";

describe("KeymapState", () => {
  it("keeps the layer, the selection and the find text for the same keyboard", () => {
    const state = new KeymapState();
    state.follow("a");
    state.layer = 2;
    state.selection = { kind: "key", index: 5 };
    state.findText = "esc";
    state.follow("a");
    expect([state.layer, state.selection, state.findText]).toEqual([2, { kind: "key", index: 5 }, "esc"]);
  });

  it("starts them over for another keyboard, but keeps the view", () => {
    const state = new KeymapState("overview");
    state.follow("a");
    state.layer = 2;
    state.selection = { kind: "encoder", index: 1 };
    state.findText = "esc";
    state.follow("b");
    expect([state.layer, state.selection, state.findText, state.view]).toEqual([0, null, "", "overview"]);
  });
});
