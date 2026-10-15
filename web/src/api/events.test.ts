import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectEvents, type LinkState, type ServerEvent } from "./events";

/** Stands in for the browser's WebSocket: the test opens, closes and sends on it by hand */
class FakeSocket {
  static all: FakeSocket[] = [];

  readonly url: string;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }

  static get latest(): FakeSocket {
    const socket = FakeSocket.all.at(-1);
    if (!socket) throw new Error("no socket was opened");
    return socket;
  }

  /** The server accepted the connection */
  accept(): void {
    this.onopen?.();
  }

  /** The server sent a frame */
  send(data: string): void {
    if (!this.closed) this.onmessage?.({ data });
  }

  /** The connection dropped (or never came up) */
  drop(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  /** Called by the page; like the browser, it ends with a close event */
  close(): void {
    this.drop();
  }
}

let events: ServerEvent[];
let links: LinkState[];
let stop: (() => void) | undefined;

function connect(): void {
  stop = connectEvents((event) => events.push(event), (state) => links.push(state));
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  events = [];
  links = [];
  stop = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("location", { protocol: "http:", host: "127.0.0.1:8000" });
});

afterEach(() => {
  stop?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("connectEvents", () => {
  it("opens a socket to /api/events on the page's host", () => {
    connect();
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.latest.url).toBe("ws://127.0.0.1:8000/api/events");
    expect(links).toEqual(["connecting"]);
    FakeSocket.latest.accept();
    expect(links).toEqual(["connecting", "open"]);
  });

  it("uses wss: on an https: page", () => {
    vi.stubGlobal("location", { protocol: "https:", host: "vial.example" });
    connect();
    expect(FakeSocket.latest.url).toBe("wss://vial.example/api/events");
  });

  it("passes on the events it knows", () => {
    connect();
    FakeSocket.latest.accept();
    for (const type of ["connected", "disconnected", "reloaded"]) {
      FakeSocket.latest.send(JSON.stringify({ type }));
    }
    expect(events).toEqual(["connected", "disconnected", "reloaded"]);
  });

  it("ignores events of unknown type", () => {
    connect();
    FakeSocket.latest.accept();
    for (const frame of [{ type: "toString" }, { type: "constructor" }, { type: "other" }, { type: 1 }, {}]) {
      FakeSocket.latest.send(JSON.stringify(frame));
    }
    FakeSocket.latest.send("null");
    FakeSocket.latest.send("42");
    expect(events).toEqual([]);
  });

  it("ignores frames that aren't JSON and keeps listening", () => {
    connect();
    FakeSocket.latest.accept();
    expect(() => FakeSocket.latest.send("not json {")).not.toThrow();
    FakeSocket.latest.send(JSON.stringify({ type: "reloaded" }));
    expect(events).toEqual(["reloaded"]);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("retries after 0.5 s, doubling the wait up to 5 s", () => {
    connect();
    for (const wait of [500, 1000, 2000, 4000, 5000, 5000]) {
      const count = FakeSocket.all.length;
      FakeSocket.latest.drop();
      expect(links.at(-1)).toBe("closed");
      vi.advanceTimersByTime(wait - 1);
      expect(FakeSocket.all).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.all).toHaveLength(count + 1);
      expect(links.at(-1)).toBe("connecting");
    }
  });

  it("starts the wait over at 0.5 s once a connection opens", () => {
    connect();
    FakeSocket.latest.drop();
    vi.advanceTimersByTime(500);
    FakeSocket.latest.drop();
    vi.advanceTimersByTime(1000);
    FakeSocket.latest.drop();
    vi.advanceTimersByTime(2000);
    FakeSocket.latest.accept();
    FakeSocket.latest.drop();
    const count = FakeSocket.all.length;
    vi.advanceTimersByTime(499);
    expect(FakeSocket.all).toHaveLength(count);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(count + 1);
  });

  function expectSilenceAfterStop(): void {
    const linksBefore = links.length;
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    for (const socket of FakeSocket.all) {
      socket.send(JSON.stringify({ type: "reloaded" }));
      socket.drop();
    }
    vi.advanceTimersByTime(60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(events).toEqual([]);
    expect(links).toHaveLength(linksBefore);
    expect(FakeSocket.all.every((socket) => socket.closed)).toBe(true);
  }

  it("stops for good while connecting", () => {
    connect();
    stop?.();
    expect(FakeSocket.all).toHaveLength(1);
    expectSilenceAfterStop();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("stops for good while open", () => {
    connect();
    FakeSocket.latest.accept();
    stop?.();
    expectSilenceAfterStop();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("stops for good while waiting to retry", () => {
    connect();
    FakeSocket.latest.drop();
    expect(vi.getTimerCount()).toBe(1);
    stop?.();
    expectSilenceAfterStop();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("stays stopped if the close event arrives after stopping", () => {
    connect();
    FakeSocket.latest.accept();
    const socket = FakeSocket.latest;
    // A browser fires the close event later; simulate a socket whose close() does nothing yet
    socket.close = () => {};
    stop?.();
    socket.close = FakeSocket.prototype.close;
    socket.drop();
    expectSilenceAfterStop();
  });
});
