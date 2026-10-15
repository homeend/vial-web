import { describe, expect, it } from "vitest";
import { ApiError, errorMessage, failureMessage } from "./errors";

describe("errorMessage", () => {
  it.each([
    [503, "no keyboard connected", "The keyboard isn't connected."],
    [423, "locked", "This change needs the keyboard unlocked; unlocking isn't supported yet."],
    [422, "not a valid keycode: FOO", "not a valid keycode: FOO"],
    [502, "the keyboard didn't respond: timeout", "The keyboard didn't respond."],
    [500, "unexpected error, see vial.log", "Unexpected error, see vial.log."],
    [401, "missing or wrong session token",
      "This page's session has ended. Open Vial again from the link in its terminal."],
    [0, undefined, "Can't reach Vial. Is it still running?"],
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

describe("failureMessage", () => {
  it("names the action and the cause", () => {
    expect(failureMessage("Changing the key", new ApiError(502, "x")))
      .toBe("Changing the key failed: The keyboard didn't respond.");
  });

  it("handles errors that aren't from the API", () => {
    expect(failureMessage("Loading", new TypeError("Failed to fetch")))
      .toBe("Loading failed: Can't reach Vial. Is it still running?");
  });
});
