// Live events from the server: the keyboard was plugged in, unplugged, read again, or its unlock state changed.
import type { ServerEvent } from "./types";

export type { ServerEvent };
export type LinkState = "connecting" | "open" | "closed";

const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 5000;

const EVENTS: Record<ServerEvent["type"], true> = { connected: true, disconnected: true, reloaded: true, unlock: true };

/** An event of a known type; an "unlock" one must carry the unlock state */
function isServerEvent(frame: unknown): frame is ServerEvent {
  const { type, unlock } = (frame ?? {}) as { type?: unknown; unlock?: unknown };
  if (typeof type !== "string" || !Object.hasOwn(EVENTS, type)) return false;
  return type !== "unlock" || (typeof unlock === "object" && unlock !== null);
}

/** Keeps a WebSocket to /api/events open, reconnecting when it drops. Returns a function that closes it for good. */
export function connectEvents(
  onEvent: (event: ServerEvent) => void,
  onLink: (state: LinkState) => void,
): () => void {
  let socket: WebSocket | null = null;
  let retry = RETRY_FIRST_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function open() {
    onLink("connecting");
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${scheme}//${location.host}/api/events`);
    socket.onopen = () => {
      retry = RETRY_FIRST_MS;
      onLink("open");
    };
    socket.onmessage = (message) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        return; // not JSON: not an event
      }
      if (isServerEvent(frame)) onEvent(frame);
    };
    socket.onclose = () => {
      socket = null;
      if (stopped) return;
      onLink("closed");
      timer = setTimeout(open, retry);
      retry = Math.min(retry * 2, RETRY_MAX_MS);
    };
  }

  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
}
