import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentName, DEFAULT_LANGUAGE, download, request, setRequestKeyboard, setRequestLanguage } from "./client";
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
  setRequestKeyboard(null);
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

  it("says which keyboard a change is for, once one is known, percent-encoded; never for a read", async () => {
    fetchMock.mockResolvedValue(reply(200, {}));
    setRequestKeyboard("55d4:0461:name:W-CORNE ñ#2");
    const meant = { "X-Vial-Keyboard": "55d4%3A0461%3Aname%3AW-CORNE%20%C3%B1%232" };
    await request("put", "/api/keymap/{layer}/{row}/{col}", {
      params: { layer: 0, row: 0, col: 0 },
      body: { code: "KC_A" },
    });
    expect(sent().init.headers).toEqual({ "Content-Type": "application/json", ...meant });
    fetchMock.mockClear();
    await request("post", "/api/unlock/start");
    expect(sent().init.headers).toEqual(meant);
    fetchMock.mockClear();
    await request("get", "/api/keyboard");
    expect(sent().init.headers).toEqual({});
    fetchMock.mockClear();
    setRequestKeyboard(null);
    await request("post", "/api/unlock/start");
    expect(sent().init.headers).toEqual({});
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

  it("keeps the code a refusal names, to tell it from others of its status", async () => {
    fetchMock.mockResolvedValue(reply(409, { detail: "The layers changed since this was shown.", code: "layoutChanged" }));
    const error = await failure(request("post", "/api/layers/arrange", { body: { order: [0, 2, 1], expect: 3 } }));
    expect([error.status, error.code, error.detail]).toEqual([409, "layoutChanged", "The layers changed since this was shown."]);
    fetchMock.mockResolvedValue(reply(409, { detail: "another keyboard is open" }));
    expect((await failure(request("post", "/api/layers/arrange", { body: { order: [0, 2, 1] } }))).code).toBeUndefined();
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

  it("keeps the strings of the errors list a refusal gives, and nothing when there is no list", async () => {
    fetchMock.mockResolvedValue(reply(422, { detail: "the set has errors", errors: ["a", 1, "b"] }));
    expect((await failure(request("post", "/api/learning/sets", { raw: "{}" }))).errors).toEqual(["a", "b"]);
    fetchMock.mockResolvedValue(reply(422, { detail: "the set has errors" }));
    expect((await failure(request("post", "/api/learning/sets", { raw: "{}" }))).errors).toBeUndefined();
    fetchMock.mockResolvedValue(reply(422, { detail: "the set has errors", errors: "a" }));
    expect((await failure(request("post", "/api/learning/sets", { raw: "{}" }))).errors).toBeUndefined();
  });

  it("says which keyboard a delete is for", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    setRequestKeyboard("55d4:0461");
    expect(await request("delete", "/api/learning/sets/{set}", { params: { set: "mini" } })).toBeNull();
    const { url, init } = sent();
    expect(url).toBe("/api/learning/sets/mini");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ "X-Vial-Keyboard": "55d4%3A0461" });
  });

  it("returns the JSON of a 201 reply", async () => {
    fetchMock.mockResolvedValue(reply(201, { id: "mini", warnings: [] }));
    expect(await request("post", "/api/learning/sets", { raw: "{}" })).toEqual({ id: "mini", warnings: [] });
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
