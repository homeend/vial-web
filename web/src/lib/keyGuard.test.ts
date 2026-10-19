import { describe, expect, it, vi } from "vitest";
import { KeyGuard } from "./keyGuard";

/** A key event as the browser sends it */
function key(type: string, code: string): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, key: code });
  return event;
}

function setup() {
  const win = new EventTarget();
  const doc = new EventTarget();
  const guard = new KeyGuard(win, doc);
  // what the page itself listens to: it only sees what the guard lets through (a test window has no capture phase, so
  // the page listens after the guard, as listeners added after it on the window would)
  const seen: string[] = [];
  const listen = () => {
    for (const type of ["keydown", "keyup"]) win.addEventListener(type, (e) => seen.push(`${e.type} ${(e as KeyboardEvent).code}`));
  };
  const send = (type: string, code: string) => {
    const event = key(type, code);
    win.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { win, doc, guard, seen, send, listen };
}

describe("KeyGuard", () => {
  it("lets keys through until it starts", () => {
    const { send, seen, listen } = setup();
    listen();
    expect(send("keydown", "Enter")).toBe(false);
    expect(seen).toEqual(["keydown Enter"]);
  });

  it("swallows every key while it is on", () => {
    const { guard, send, seen, listen } = setup();
    guard.start();
    listen();
    expect(guard.on).toBe(true);
    expect(send("keydown", "Tab")).toBe(true);
    expect(send("keyup", "Tab")).toBe(true);
    expect(seen).toEqual([]);
  });

  it("once stopped, swallows only the keys still held until they are let go", () => {
    const { guard, send, seen, listen } = setup();
    guard.start();
    listen();
    send("keydown", "Enter");
    guard.stop();
    expect(send("keydown", "KeyA")).toBe(false);
    expect(send("keydown", "Enter")).toBe(true); // repeats
    expect(send("keyup", "Enter")).toBe(true);
    expect(send("keydown", "Enter")).toBe(false);
    expect(seen).toEqual(["keydown KeyA", "keydown Enter"]);
  });

  it("forgets the keys held when the page loses the keyboard", () => {
    const { guard, send, win } = setup();
    guard.start();
    send("keydown", "Enter");
    guard.stop();
    win.dispatchEvent(new Event("blur"));
    expect(send("keydown", "Enter")).toBe(false);
  });

  it("goes on swallowing after a blur while it is on, and stops listening when disposed", () => {
    const { guard, send, doc, win } = setup();
    const remove = vi.spyOn(win, "removeEventListener");
    guard.start();
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(send("keydown", "Space")).toBe(true);
    guard.dispose();
    expect(remove).toHaveBeenCalled();
    expect(send("keydown", "Space")).toBe(false);
    guard.dispose();
  });
});
