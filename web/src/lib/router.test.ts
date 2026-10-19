import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "./router.svelte";

/** A page address in a node test: setting the hash, or replacing it, tells the listeners as the browser does (later) */
function fakeAddress(hash = "") {
  const listeners = new Set<() => void>();
  const changed = () => queueMicrotask(() => listeners.forEach((l) => l()));
  const location = {
    get hash() {
      return hash;
    },
    set hash(value: string) {
      hash = value;
      pushes++;
      changed();
    },
    replace(value: string) {
      hash = value;
      replaces++;
      changed();
    },
  };
  let pushes = 0;
  let replaces = 0;
  vi.stubGlobal("location", location);
  vi.stubGlobal("window", {
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  });
  return {
    listeners,
    counts: () => ({ pushes, replaces }),
    /** the user goes back, or types an address */
    visit(value: string) {
      hash = value;
      changed();
    },
  };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Router", () => {
  it("starts on what the address says, and follows it until stopped", async () => {
    const address = fakeAddress("#combos/2");
    const router = new Router();
    expect(router.route).toEqual({ section: "combos", item: 2 });
    const stop = router.start();
    address.visit("#macros");
    await settle();
    expect(router.route).toEqual({ section: "macros", item: null });
    stop();
    expect(address.listeners.size).toBe(0);
    address.visit("#tap-dance");
    await settle();
    expect(router.route.section).toBe("macros");
  });

  it("goes to a section with a step back, or without one when asked", async () => {
    const address = fakeAddress();
    const router = new Router();
    router.start();
    router.go("tap-dance");
    router.go("tap-dance", 5, { replace: true });
    await settle();
    expect(location.hash).toBe("#tap-dance/5");
    expect(address.counts()).toEqual({ pushes: 1, replaces: 1 });
    expect(router.route).toEqual({ section: "tap-dance", item: 5 });
  });

  it("doesn't set the route again when its own address change comes back", async () => {
    fakeAddress();
    const router = new Router();
    router.start();
    router.go("combos", 1);
    const shown = router.route;
    await settle();
    expect(router.route).toBe(shown);
  });

  it("hands a key to the keymap once", () => {
    fakeAddress("#combos");
    const router = new Router();
    const place = { layer: 1, ref: { kind: "key", index: 3 } } as const;
    router.openKey(place);
    expect(router.route.section).toBe("keymap");
    expect(router.takeKeyTarget()).toEqual(place);
    expect(router.takeKeyTarget()).toBeNull();
  });

  it("keeps the route without an address", () => {
    const router = new Router();
    router.go("macros", 0);
    expect(router.route).toEqual({ section: "macros", item: 0 });
  });
});
