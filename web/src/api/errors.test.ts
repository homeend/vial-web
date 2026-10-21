import { describe, expect, it, vi } from "vitest";
import { ApiError, causeMessage, errorMessage, failureMessage } from "./errors";

describe("errorMessage", () => {
  it.each([
    [503, "no keyboard connected", "The keyboard isn't connected."],
    [423, "the keyboard is waiting for its unlock keys", "the keyboard is waiting for its unlock keys"],
    [423, undefined, "The keyboard is locked."],
    [422, "not a valid keycode: FOO", "not a valid keycode: FOO"],
    [502, "the keyboard didn't respond: timeout", "The keyboard didn't respond."],
    [500, "unexpected error, see vial.log", "Unexpected error, see vial.log."],
    [401, "missing or wrong session token",
      "This page's session has ended. Open Vial again from the link in its terminal."],
    [0, undefined, "Can't reach Vial. Is it still running?"],
    [507, "The layers were arranged, but the layer names couldn't be saved: [Errno 13] Permission denied",
      "The layer names couldn't be saved (see vial.log)."],
  ])("%i: %s", (status, detail, message) => {
    expect(errorMessage(status, detail)).toBe(message);
  });

  it("shows the server's detail for other refusals", () => {
    expect(errorMessage(413, "the file is too large (at most 1024 KiB)"))
      .toBe("the file is too large (at most 1024 KiB)");
    expect(errorMessage(404)).toBe("The request failed (HTTP 404).");
  });

  it("does not show an empty 422 detail", () => {
    expect(errorMessage(422, "")).toBe("The keyboard can't take this change.");
  });
});

describe("causeMessage", () => {
  it("is what went wrong, to put after a failure of one's own", () => {
    expect(causeMessage(new ApiError(502))).toBe("The keyboard didn't respond.");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(causeMessage(new Error("bug"))).toBe("Unexpected error in the page.");
    } finally {
      log.mockRestore();
    }
  });
});

describe("failureMessage", () => {
  it("names the action and the cause", () => {
    expect(failureMessage("Changing the key", new ApiError(502, "x")))
      .toBe("Changing the key failed: The keyboard didn't respond.");
  });

  it("reports a status 0 ApiError as the server being unreachable", () => {
    expect(failureMessage("Loading", new ApiError(0)))
      .toBe("Loading failed: Can't reach Vial. Is it still running?");
  });

  it("logs errors that aren't from the API and calls them a bug in the page", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const bug = new TypeError("Cannot read properties of undefined");
    try {
      expect(failureMessage("Loading", bug)).toBe("Loading failed: Unexpected error in the page.");
      expect(log).toHaveBeenCalledWith(bug);
    } finally {
      log.mockRestore();
    }
  });
});
