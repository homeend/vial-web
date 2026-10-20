import { describe, expect, it } from "vitest";
import { DIALOG_TAKING_KEYS, MatrixRun } from "./run.svelte";

/** A key event as the browser sends it */
function key(type: string, code: string): Event {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, key: code });
  return event;
}

function setup() {
  const win = new EventTarget();
  const doc = new EventTarget();
  const watching = { started: 0, stopped: 0 };
  const run = new MatrixRun(() => {
    watching.started++;
    return () => watching.stopped++;
  }, win, doc);
  /** whether the page (and so the browser) is kept from doing what the event would */
  const send = (event: Event, target: EventTarget = win) => {
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const leave = () => send(new Event("beforeunload", { cancelable: true }));
  return { win, doc, run, watching, send, leave };
}

const plugged = { connected: true, inBootloader: false };

describe("a run of the matrix tester", () => {
  it("watches the keys held and keeps keys typed from the page while it tests", () => {
    const { run, watching, send } = setup();
    expect(run.testing).toBe(false);
    run.start("kb1");
    run.start("kb1");
    expect(run.testing).toBe(true);
    expect(watching).toEqual({ started: 1, stopped: 0 });
    expect(send(key("keydown", "Tab"))).toBe(true);
    run.stop();
    run.stop();
    expect(run.testing).toBe(false);
    expect(watching).toEqual({ started: 1, stopped: 1 });
    expect(send(key("keydown", "KeyA"))).toBe(false);
  });

  it("stops when the window loses the focus (another window, the Windows key): keys work again", () => {
    const { win, run, watching, send } = setup();
    run.start("kb1");
    send(key("keydown", "AltLeft"));
    win.dispatchEvent(new Event("blur"));
    expect(run.testing).toBe(false);
    expect(watching.stopped).toBe(1);
    // keys held when it left aren't waited for: the page lost the keyboard
    expect(send(key("keyup", "AltLeft"))).toBe(false);
    expect(send(key("keydown", "Enter"))).toBe(false);
  });

  it("stops when the page is hidden", () => {
    const { doc, run, watching } = setup();
    run.start("kb1");
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(run.testing).toBe(false);
    expect(watching.stopped).toBe(1);
  });

  it("stops when a dialog takes the focus (another keyboard picked asks first): the dialog's keys work", () => {
    const { doc, run, watching, send } = setup();
    /** the focus moves to an element: in a dialog whose keys must work, in the unlock dialog (which keeps every key
     * from the page itself), or in neither */
    const focusIn = (inDialog: boolean | "unlock") => {
      const event = new Event("focusin");
      const dialog = inDialog === true ? "dialog" : inDialog === "unlock" ? "dialog[data-keys-guarded]" : null;
      Object.defineProperty(event, "target", {
        value: {
          closest: (selector: string) =>
            dialog === null || !selector.startsWith("dialog") ? null
            : selector === DIALOG_TAKING_KEYS ? (dialog === "dialog" ? {} : null) : {},
        },
      });
      doc.dispatchEvent(event);
    };
    run.start("kb1");
    focusIn(false);
    expect(run.testing).toBe(true);
    // a locked keyboard is unlocked first: the test goes on behind the unlock dialog
    focusIn("unlock");
    expect(run.testing).toBe(true);
    focusIn(true);
    expect(run.testing).toBe(false);
    expect(watching.stopped).toBe(1);
    expect(send(key("keydown", "Escape"))).toBe(false);
    expect(send(key("keydown", "Tab"))).toBe(false);
    // once stopped, a dialog is no business of it
    run.start("kb1");
    run.stop();
    focusIn(true);
    expect(watching).toEqual({ started: 2, stopped: 2 });
  });

  it("listens to the window only while it tests", () => {
    const { win, doc, run, watching } = setup();
    win.dispatchEvent(new Event("blur"));
    run.start("kb1");
    run.stop();
    run.start("kb1");
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("blur"));
    expect(watching).toEqual({ started: 2, stopped: 2 });
  });

  it("asks before the page is left or reloaded, only while it tests", () => {
    const { run, leave } = setup();
    expect(leave()).toBe(false);
    run.start("kb1");
    expect(leave()).toBe(true);
    run.stop();
    expect(leave()).toBe(false);
  });

  it("stopped, swallows the keys still held until they are let go (the next page doesn't get them)", () => {
    const { run, send } = setup();
    run.start("kb1");
    send(key("keydown", "Enter"));
    run.stop();
    expect(send(key("keydown", "Enter"))).toBe(true); // repeats
    expect(send(key("keyup", "Enter"))).toBe(true);
    expect(send(key("keydown", "Enter"))).toBe(false);
  });

  it("ends when the keyboard is unplugged, goes to its bootloader or another one is plugged in, not when read again",
    () => {
      const { run } = setup();
      expect(run.ends({ connected: false, inBootloader: false }, "kb1")).toBe(false); // not testing
      run.start("kb1");
      expect(run.ends(plugged, "kb1")).toBe(false);
      expect(run.ends({ connected: false, inBootloader: false }, "kb1")).toBe(true);
      expect(run.ends({ connected: true, inBootloader: true }, "kb1")).toBe(true);
      expect(run.ends(plugged, "kb2")).toBe(true);
    });

  it("takes the readings only of the keyboard it tests, once it is read", () => {
    const { run } = setup();
    expect(run.reads(false, "kb1")).toBe(false); // not testing
    run.start("kb1");
    expect(run.reads(false, "kb1")).toBe(true);
    // being read again: it may be another keyboard already
    expect(run.reads(true, "kb1")).toBe(false);
    expect(run.reads(false, "kb2")).toBe(false);
    run.stop();
    run.start("kb2");
    expect(run.reads(false, "kb2")).toBe(true);
  });
});
