// Live events from the server: the keyboard was plugged in, unplugged, read again, or its unlock state changed; while
// the page asks for them, the keys held (the matrix tester); and Vial stopping (Quit Vial), after which the link isn't
// opened again.
import type { ServerEvent } from "./types";

export type { ServerEvent };
export type LinkState = "connecting" | "open" | "closed";

/** What the page can ask the server for on the events link */
export type ClientMessage = { type: "matrix"; watch: boolean };

/** The events link: close() ends it for good; send() asks the server for something, if the link is open (a link
 * opened again starts with nothing asked: whoever asked asks again when it opens) */
export interface EventsLink {
  close(): void;
  send(message: ClientMessage): void;
}

const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 5000;

const EVENTS: Record<ServerEvent["type"], true> = {
  connected: true, disconnected: true, reloaded: true, unlock: true, matrix: true, keyboards: true, stopped: true,
  changed: true,
};

/** An event of a known type; an "unlock" one must carry the unlock state, a "matrix" one the keys held */
function isServerEvent(frame: unknown): frame is ServerEvent {
  const { type, unlock, matrix } = (frame ?? {}) as { type?: unknown; unlock?: unknown; matrix?: unknown };
  if (typeof type !== "string" || !Object.hasOwn(EVENTS, type)) return false;
  if (type === "unlock") return typeof unlock === "object" && unlock !== null;
  if (type === "matrix") {
    const pressed = (matrix as { pressed?: unknown } | null)?.pressed;
    return typeof matrix === "object" && matrix !== null && Array.isArray(pressed);
  }
  return true;
}

/** Keeps a WebSocket to /api/events open, reconnecting when it drops; after a "stopped" event it closes for good, as
 * there is nothing to reconnect to */
export function connectEvents(
  onEvent: (event: ServerEvent) => void,
  onLink: (state: LinkState) => void,
): EventsLink {
  let socket: WebSocket | null = null;
  let retry = RETRY_FIRST_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let open = false;

  function connect() {
    onLink("connecting");
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const current = new WebSocket(`${scheme}//${location.host}/api/events`);
    socket = current;
    current.onopen = () => {
      retry = RETRY_FIRST_MS;
      open = true;
      onLink("open");
    };
    current.onmessage = (message) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        return; // not JSON: not an event
      }
      if (!isServerEvent(frame)) return;
      if (frame.type === "stopped") {
        // Vial is stopping: the link ends, without the "closed" a drop would bring
        stopped = true;
        clearTimeout(timer);
        current.close();
      }
      onEvent(frame);
    };
    current.onclose = () => {
      socket = null;
      open = false;
      if (stopped) return;
      onLink("closed");
      timer = setTimeout(connect, retry);
      retry = Math.min(retry * 2, RETRY_MAX_MS);
    };
  }

  connect();
  return {
    close() {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    },
    send(message) {
      if (open && socket) socket.send(JSON.stringify(message));
    },
  };
}
