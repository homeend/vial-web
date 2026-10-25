// Typed requests to the Vial server. Paths, bodies and replies are checked against the generated schema.
import { ApiError } from "./errors";
import type { paths } from "./schema";

type Method = "get" | "put" | "post" | "delete";
type Operation<P extends keyof paths, M extends Method> = paths[P][M];
type Json<T> = T extends { content: { "application/json": infer R } } ? R : never;
/** the reply's JSON (200, or 201 for a route that makes something); null for a route that answers nothing (204) */
type Reply<Op> = Op extends { responses: { 200: infer R } } ? Json<R>
  : Op extends { responses: { 201: infer R } } ? Json<R>
  : Op extends { responses: { 204: unknown } } ? null : never;
type Body<Op> = Op extends { requestBody: { content: { "application/json": infer B } } } ? B : undefined;
type PathParams<Op> = Op extends { parameters: { path: infer P } } ? P : undefined;

export const DEFAULT_LANGUAGE = "en-us";
let language = DEFAULT_LANGUAGE;

/** Keyboard language that every request asks the server to label keys in (routes that don't label keys ignore it) */
export function setRequestLanguage(lang: string): void {
  language = lang;
}

let keyboardMeant: string | null = null;

/** The keyboard (KeyboardEntry.id) the page shows: every change is sent for it (the X-Vial-Keyboard header), and the
 * server refuses one (409) while another keyboard is open, opened from another tab meanwhile. null: any keyboard. */
export function setRequestKeyboard(id: string | null): void {
  keyboardMeant = id;
}

/** A route's address with the keyboard language the page shows, for a link the browser follows itself (a download);
 * params fill its {placeholders} */
export function apiUrl(path: string, params?: Record<string, string | number>): string {
  return url(path, params);
}

function url(path: string, params: Record<string, string | number> | undefined): string {
  const filled = path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(String(params?.[name])));
  return language === DEFAULT_LANGUAGE ? filled : `${filled}?lang=${encodeURIComponent(language)}`;
}

/** The server's reason: a string, or FastAPI's list of validation errors */
function detailOf(body: unknown): string | undefined {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((e) => (e as { msg?: string }).msg).filter(Boolean).join("; ") || undefined;
  }
  return undefined;
}

/** What the server calls a refusal (its "code"), if it does */
function codeOf(body: unknown): string | undefined {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** The refusal's findings, one by one, when the server lists them (a lesson set the checker refuses) */
function errorsOf(body: unknown): string[] | undefined {
  const errors = (body as { errors?: unknown } | null)?.errors;
  return Array.isArray(errors) ? errors.filter((e): e is string => typeof e === "string") : undefined;
}

export async function request<P extends keyof paths, M extends Method>(
  method: M,
  path: P,
  options: {
    params?: PathParams<Operation<P, M>>;
    body?: Body<Operation<P, M>>;
    /** a JSON document sent as it is, for routes that read the request themselves (a .vil file) */
    raw?: string;
  } = {},
): Promise<Reply<Operation<P, M>>> {
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  const headers: Record<string, string> = body === undefined ? {} : { "Content-Type": "application/json" };
  // a header value can't hold every character a keyboard's name can: percent-encoded
  if (method !== "get" && keyboardMeant !== null) headers["X-Vial-Keyboard"] = encodeURIComponent(keyboardMeant);
  const response = await send(url(path, options.params as Record<string, string | number> | undefined), {
    method: method.toUpperCase(),
    headers,
    body,
  });
  const reply: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, detailOf(reply), codeOf(reply), errorsOf(reply));
  return reply as Reply<Operation<P, M>>;
}

async function send(target: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(target, init);
  } catch {
    throw new ApiError(0);
  }
}

/** The file name a Content-Disposition header gives: the UTF-8 one (filename*) if there is one; null if none */
export function attachmentName(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // not percent-encoded right: the plain name, if any
    }
  }
  return /filename\s*=\s*"([^"]*)"/i.exec(disposition)?.[1] ?? /filename\s*=\s*([^;\s]+)/i.exec(disposition)?.[1] ?? null;
}

/** A file the server sends to save (GET), with the name it gives it, or `fallback` */
export async function download(path: keyof paths, fallback: string): Promise<{ blob: Blob; name: string }> {
  const response = await send(url(path, undefined), { method: "GET" });
  if (!response.ok) {
    const reply: unknown = await response.json().catch(() => null);
    throw new ApiError(response.status, detailOf(reply));
  }
  return { blob: await response.blob(), name: attachmentName(response.headers.get("Content-Disposition")) ?? fallback };
}
