import { describe, expect, it } from "vitest";
import { described } from "../analysis/testing";
import { distinctMembers, isSet, MAX_COMBO_KEYS, memberProblem, membersOf, toggleMember } from "./members";

const codes = (list: { code: string }[]) => list.map((d) => d.code);

describe("toggleMember", () => {
  it("adds a keycode, and takes it out when chosen again", () => {
    const added = toggleMember([described("KC_K")], described("KC_Y"));
    expect(codes(added.members)).toEqual(["KC_K", "KC_Y"]);
    expect(added.problem).toBeNull();
    expect(codes(toggleMember(added.members, described("KC_K")).members)).toEqual(["KC_Y"]);
  });

  it(`takes at most ${MAX_COMBO_KEYS} keys`, () => {
    const four = ["KC_A", "KC_B", "KC_C", "KC_D"].map(described);
    const refused = toggleMember(four, described("KC_E"));
    expect(codes(refused.members)).toEqual(codes(four));
    expect(refused.problem).toBe("A combo has at most 4 keys: take one out first.");
    // taking one out still works
    expect(toggleMember(four, described("KC_B")).members).toHaveLength(3);
  });

  it("refuses an empty or transparent key", () => {
    expect(toggleMember([], described("KC_NO")).problem).toBe("An empty key can't be part of a combo.");
    expect(toggleMember([], described("KC_TRNS")).problem).toBe("A transparent key can't be part of a combo.");
    expect(memberProblem(undefined)).toBe("An empty key can't be part of a combo.");
    expect(memberProblem(described("MO(1)"))).toBeNull();
  });
});

describe("a combo's members", () => {
  const combo = { index: 0, keys: ["KC_K", "KC_Y", "KC_NO", "KC_NO"].map(described), output: described("KC_ESC") };

  it("leave out its empty slots", () => {
    expect(codes(membersOf(combo))).toEqual(["KC_K", "KC_Y"]);
    expect(codes(membersOf({ ...combo, keys: ["KC_K", "KC_Y", "KC_J", "KC_L"].map(described) }))).toEqual(
      ["KC_K", "KC_Y", "KC_J", "KC_L"]);
  });

  it("end at the first empty slot, as the firmware reads them", () => {
    expect(codes(membersOf({ ...combo, keys: ["KC_K", "KC_NO", "KC_Y", "KC_NO"].map(described) }))).toEqual(["KC_K"]);
    expect(membersOf({ ...combo, keys: ["KC_NO", "KC_K", "KC_Y", "KC_NO"].map(described) })).toEqual([]);
  });

  it("list each keycode once: a combo saved elsewhere may list one twice", () => {
    const twice = ["KC_K", "KC_Y", "KC_K", "KC_Y"].map(described);
    expect(codes(distinctMembers(twice))).toEqual(["KC_K", "KC_Y"]);
    expect(codes(distinctMembers(membersOf(combo)))).toEqual(["KC_K", "KC_Y"]);
  });

  it("make it set up, as an output does", () => {
    expect(isSet(combo)).toBe(true);
    expect(isSet({ ...combo, keys: combo.keys.map(() => described("KC_NO")) })).toBe(true);
    expect(isSet({ ...combo, keys: combo.keys.map(() => described("KC_NO")), output: described("KC_NO") })).toBe(false);
  });
});
