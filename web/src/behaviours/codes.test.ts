import { describe, expect, it, vi } from "vitest";
import { described } from "../analysis/testing";
import type { KeycodeCategory } from "../api/types";
import { catalogued, describeCode } from "./codes";

const catalogue: KeycodeCategory[] = [
  { name: "Basic", templates: [], keycodes: [{ ...described("KC_ENTER"), aliases: ["KC_ENT"] }] },
];

describe("keycodes made in the browser", () => {
  it("are found in the catalogue by name or alias", () => {
    expect(catalogued(catalogue, "KC_ENT")?.code).toBe("KC_ENTER");
    expect(catalogued(catalogue, "KC_ENTER")?.code).toBe("KC_ENTER");
    expect(catalogued(catalogue, "LCTL(KC_L)")).toBeUndefined();
  });

  it("are described by the server when the catalogue doesn't have them", async () => {
    const parse = vi.fn(async (code: string) => described(code));
    expect((await describeCode(catalogue, "KC_ENTER", parse)).code).toBe("KC_ENTER");
    expect(parse).not.toHaveBeenCalled();
    expect((await describeCode(catalogue, "LCTL(KC_L)", parse)).code).toBe("LCTL(KC_L)");
    expect(parse).toHaveBeenCalledWith("LCTL(KC_L)");
  });
});
