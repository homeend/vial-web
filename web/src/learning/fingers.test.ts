import { describe, expect, it } from "vitest";
import { FINGER_COLOURS, FINGERS, fingerLabel } from "./fingers";

describe("FINGER_COLOURS", () => {
  it("is a colour token for each finger", () => {
    expect(FINGERS).toEqual(["pinky", "ring", "middle", "index", "thumb"]);
    for (const finger of FINGERS) expect(FINGER_COLOURS[finger]).toBe(`var(--finger-${finger})`);
  });
});

describe("fingerLabel", () => {
  it("names the finger with its hand", () => {
    expect(fingerLabel("index", "left")).toBe("left index");
    expect(fingerLabel("pinky", "right")).toBe("right pinky");
    expect(fingerLabel("thumb", "left")).toBe("left thumb");
  });
});
