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

  it("tells whether the route shown came from the address or from go()", async () => {
    const address = fakeAddress("#combos");
    const router = new Router();
    router.start();
    expect(router.fromAddress).toBe(false);
    router.go("macros");
    await settle();
    expect(router.fromAddress).toBe(false);
    address.visit("#combos");
    await settle();
    expect(router.fromAddress).toBe(true);
    router.go("tap-dance", 1);
    expect(router.fromAddress).toBe(false);
  });

  it("counts every route shown, the same one shown again too, but not its own address change", async () => {
    const address = fakeAddress();
    const router = new Router();
    router.start();
    const first = router.visits;
    router.go("combos", 1);
    await settle();
    expect(router.visits).toBe(first + 1);
    // a card opened again while it is the one shown: shown again
    router.go("combos", 1, { replace: true });
    await settle();
    expect(router.visits).toBe(first + 2);
    address.visit("#macros");
    await settle();
    expect(router.visits).toBe(first + 3);
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

  it("drops an entry from the address of a section that shows one page, which names none", async () => {
    const address = fakeAddress("#lighting/3");
    const router = new Router();
    router.start();
    expect(router.route).toEqual({ section: "lighting", item: null });
    expect(location.hash).toBe("#lighting");
    expect(address.counts()).toEqual({ pushes: 0, replaces: 1 });
    address.visit("#keyboard/0");
    await settle();
    expect(location.hash).toBe("#keyboard");
    // what the address leaves alone: an entry of a section that has entries, and an address that isn't one
    address.visit("#combos/2");
    await settle();
    expect(location.hash).toBe("#combos/2");
    address.visit("#nothing/2");
    await settle();
    expect(location.hash).toBe("#nothing/2");
  });

  it("keeps no entry for a section that shows one page", () => {
    const router = new Router();
    router.go("lighting", 3);
    expect(router.route).toEqual({ section: "lighting", item: null });
  });

  it("keeps the route without an address", () => {
    const router = new Router();
    router.go("macros", 0);
    expect(router.route).toEqual({ section: "macros", item: 0 });
  });
});
