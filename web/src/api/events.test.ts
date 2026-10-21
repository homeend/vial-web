import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectEvents, type EventsLink, type LinkState, type ServerEvent } from "./events";

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

  /** What the page sent */
  sent: string[] = [];

  /** The server sent a frame */
  deliver(data: string): void {
    if (!this.closed) this.onmessage?.({ data });
  }

  /** The connection dropped (or never came up) */
  drop(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  /** Called by the page */
  send(data: string): void {
    this.sent.push(data);
  }

  /** Called by the page; like the browser, it ends with a close event */
  close(): void {
    this.drop();
  }
}

let events: ServerEvent[];
let links: LinkState[];
let link: EventsLink | undefined;
const stop = () => link?.close();

function connect(): void {
  link = connectEvents((event) => events.push(event), (state) => links.push(state));
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  events = [];
  links = [];
  link = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("location", { protocol: "http:", host: "127.0.0.1:8000" });
});

afterEach(() => {
  stop();
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
    for (const type of ["connected", "disconnected", "reloaded", "keyboards"]) {
      FakeSocket.latest.deliver(JSON.stringify({ type }));
    }
    const unlock = { state: "unlocking", keys: [{ row: 0, col: 0 }], remaining: 3, total: 50 };
    FakeSocket.latest.deliver(JSON.stringify({ type: "unlock", unlock }));
    expect(events).toEqual([{ type: "connected" }, { type: "disconnected" }, { type: "reloaded" },
      { type: "keyboards" }, { type: "unlock", unlock }]);
  });

  it("ignores events of unknown type", () => {
    connect();
    FakeSocket.latest.accept();
    const frames = [{ type: "toString" }, { type: "constructor" }, { type: "other" }, { type: 1 }, {}, { type: "unlock" },
      { type: "unlock", unlock: null }];
    for (const frame of frames) {
      FakeSocket.latest.deliver(JSON.stringify(frame));
    }
    FakeSocket.latest.deliver("null");
    FakeSocket.latest.deliver("42");
    expect(events).toEqual([]);
  });

  it("ignores frames that aren't JSON and keeps listening", () => {
    connect();
    FakeSocket.latest.accept();
    expect(() => FakeSocket.latest.deliver("not json {")).not.toThrow();
    FakeSocket.latest.deliver(JSON.stringify({ type: "reloaded" }));
    expect(events).toEqual([{ type: "reloaded" }]);
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
      socket.deliver(JSON.stringify({ type: "reloaded" }));
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
    stop();
    expect(FakeSocket.all).toHaveLength(1);
    expectSilenceAfterStop();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("stops for good while open", () => {
    connect();
    FakeSocket.latest.accept();
    stop();
    expectSilenceAfterStop();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("stops for good while waiting to retry", () => {
    connect();
    FakeSocket.latest.drop();
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expectSilenceAfterStop();
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("stays stopped if the close event arrives after stopping", () => {
    connect();
    FakeSocket.latest.accept();
    const socket = FakeSocket.latest;
    // A browser fires the close event later; simulate a socket whose close() does nothing yet
    socket.close = () => {};
    stop();
    socket.close = FakeSocket.prototype.close;
    socket.drop();
    expectSilenceAfterStop();
  });
});

describe("the matrix tester on the events link", () => {
  it("passes on the keys held, and ignores a matrix event without them", () => {
    connect();
    FakeSocket.latest.accept();
    const matrix = { state: "testing", pressed: [{ row: 1, col: 2 }] };
    FakeSocket.latest.deliver(JSON.stringify({ type: "matrix", matrix }));
    for (const frame of [{ type: "matrix" }, { type: "matrix", matrix: null }, { type: "matrix", matrix: {} }]) {
      FakeSocket.latest.deliver(JSON.stringify(frame));
    }
    expect(events).toEqual([{ type: "matrix", matrix }]);
  });

  it("sends what the page asks for only while the link is open", () => {
    connect();
    link!.send({ type: "matrix", watch: true });
    expect(FakeSocket.latest.sent).toEqual([]);
    FakeSocket.latest.accept();
    link!.send({ type: "matrix", watch: true });
    expect(FakeSocket.latest.sent).toEqual(['{"type":"matrix","watch":true}']);
    FakeSocket.latest.drop();
    link!.send({ type: "matrix", watch: false });
    vi.advanceTimersByTime(500);
    // a new link: nothing is sent again by itself
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.latest.accept();
    expect(FakeSocket.latest.sent).toEqual([]);
  });
});

describe("Vial stopping", () => {
  it("passes on the stopped event, then closes the link for good: it isn't opened again", () => {
    connect();
    FakeSocket.latest.accept();
    FakeSocket.latest.deliver(JSON.stringify({ type: "stopped" }));
    expect(events).toEqual([{ type: "stopped" }]);
    expect(FakeSocket.latest.closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    // the link didn't drop: it ended
    expect(links).toEqual(["connecting", "open"]);
  });
});
