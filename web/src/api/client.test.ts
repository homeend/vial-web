import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentName, DEFAULT_LANGUAGE, download, request, setRequestLanguage } from "./client";
import { ApiError } from "./errors";

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setRequestLanguage(DEFAULT_LANGUAGE);
  vi.unstubAllGlobals();
});

function sent(): { url: string; init: RequestInit } {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0];
  return { url: String(url), init: init ?? {} };
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("request", () => {
  it("fills path parameters, sends a JSON body with the method, and returns the reply", async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }));
    const result = await request("put", "/api/keymap/{layer}/{row}/{col}", {
      params: { layer: 1, row: 2, col: 3 },
      body: { code: "KC_A" },
    });
    const { url, init } = sent();
    expect(url).toBe("/api/keymap/1/2/3");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ code: "KC_A" }));
    expect(result).toEqual({ ok: true });
  });

  it("sends no body or content type without a body", async () => {
    fetchMock.mockResolvedValue(reply(200, {}));
    await request("get", "/api/keyboard");
    const { url, init } = sent();
    expect(url).toBe("/api/keyboard");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({});
    expect(init.body).toBeUndefined();
  });

  it("asks for the keyboard language when it isn't the default", async () => {
    fetchMock.mockResolvedValue(reply(200, {}));
    setRequestLanguage("de-de");
    await request("get", "/api/keyboard");
    expect(sent().url).toBe("/api/keyboard?lang=de-de");
  });

  it("turns an error status with a string detail into an ApiError", async () => {
    fetchMock.mockResolvedValue(reply(422, { detail: "not a valid keycode: FOO" }));
    const error = await failure(request("post", "/api/keycodes/parse", { body: { expression: "FOO" } }));
    expect(error.status).toBe(422);
    expect(error.detail).toBe("not a valid keycode: FOO");
    expect(error.message).toBe("not a valid keycode: FOO");
  });

  it("joins FastAPI's list of validation errors into the detail", async () => {
    fetchMock.mockResolvedValue(reply(422, {
      detail: [
        { loc: ["body", "code"], msg: "Field required", type: "missing" },
        { loc: ["path", "row"], msg: "Input should be a valid integer", type: "int_parsing" },
      ],
    }));
    const error = await failure(request("get", "/api/keyboard"));
    expect(error.status).toBe(422);
    expect(error.detail).toBe("Field required; Input should be a valid integer");
  });

  it("has no detail when the error reply isn't JSON", async () => {
    fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));
    const error = await failure(request("get", "/api/keyboard"));
    expect(error.status).toBe(502);
    expect(error.detail).toBeUndefined();
  });

  it("turns a network failure into ApiError(0)", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await failure(request("get", "/api/keyboard"));
    expect(error.status).toBe(0);
    expect(error.message).toBe("Can't reach Vial. Is it still running?");
  });
});

describe("raw bodies and downloads", () => {
  it("sends a JSON document as it is", async () => {
    fetchMock.mockResolvedValue(reply(200, { keys: [] }));
    await request("post", "/api/layout-file/preview", { raw: '{"layout": []}' });
    const { url, init } = sent();
    expect(url).toBe("/api/layout-file/preview");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.body).toBe('{"layout": []}');
  });

  it("downloads a file with the name the server gives it", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: {
      "Content-Disposition": "attachment; filename=\"Simulated Corne.vil\"; filename*=UTF-8''Simulated%20Corne.vil",
    } }));
    const file = await download("/api/layout-file", "keyboard.vil");
    expect(file.name).toBe("Simulated Corne.vil");
    expect(await file.blob.text()).toBe("{}");
  });

  it("fails a download the server refuses, with its reason", async () => {
    fetchMock.mockResolvedValue(reply(503, { detail: "no keyboard" }));
    const error = await failure(download("/api/layout-file", "keyboard.vil"));
    expect(error.status).toBe(503);
  });

  it("reads the file name from a Content-Disposition header", () => {
    expect(attachmentName("attachment; filename*=UTF-8''Za%C5%BC%C3%B3%C5%82%C4%87.vil")).toBe("Zażółć.vil");
    expect(attachmentName('attachment; filename="a b.vil"')).toBe("a b.vil");
    expect(attachmentName("attachment; filename=plain.vil")).toBe("plain.vil");
    expect(attachmentName("attachment; filename*=UTF-8''%E0%A4%A; filename=\"fallback.vil\"")).toBe("fallback.vil");
    expect(attachmentName(null)).toBeNull();
    expect(attachmentName("attachment")).toBeNull();
  });
});
