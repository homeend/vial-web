// Live events from the server: the keyboard was plugged in, unplugged, or read again.
import type { ServerEvent } from "./types";

export type { ServerEvent };
export type LinkState = "connecting" | "open" | "closed";

const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 5000;

const EVENTS: Record<ServerEvent, true> = { connected: true, disconnected: true, reloaded: true };

function isServerEvent(type: unknown): type is ServerEvent {
  return typeof type === "string" && type in EVENTS;
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
      const type = (JSON.parse(String(message.data)) as { type?: string }).type;
      if (isServerEvent(type)) onEvent(type);
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
