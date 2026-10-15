// Typed requests to the Vial server. Paths, bodies and replies are checked against the generated schema.
import { ApiError } from "./errors";
import type { paths } from "./schema";

type Method = "get" | "put" | "post";
type Operation<P extends keyof paths, M extends Method> = paths[P][M];
type Json<T> = T extends { content: { "application/json": infer R } } ? R : never;
type Reply<Op> = Op extends { responses: { 200: infer R } } ? Json<R> : never;
type Body<Op> = Op extends { requestBody: { content: { "application/json": infer B } } } ? B : undefined;
type PathParams<Op> = Op extends { parameters: { path: infer P } } ? P : undefined;

export const DEFAULT_LANGUAGE = "en-us";
let language = DEFAULT_LANGUAGE;

/** Keyboard language that every request asks the server to label keys in (routes that don't label keys ignore it) */
export function setRequestLanguage(lang: string): void {
  language = lang;
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

export async function request<P extends keyof paths, M extends Method>(
  method: M,
  path: P,
  options: { params?: PathParams<Operation<P, M>>; body?: Body<Operation<P, M>> } = {},
): Promise<Reply<Operation<P, M>>> {
  let response: Response;
  try {
    response = await fetch(url(path, options.params as Record<string, string | number> | undefined), {
      method: method.toUpperCase(),
      headers: options.body === undefined ? {} : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, detailOf(body));
  return body as Reply<Operation<P, M>>;
}
