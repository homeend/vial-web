// What a failed request means for the user.

/** A request the server answered with an error, or (status 0) that didn't reach it */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: string | undefined;

  constructor(status: number, detail?: string) {
    super(errorMessage(status, detail));
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export function errorMessage(status: number, detail?: string): string {
  switch (status) {
    case 0:
      return "Can't reach Vial. Is it still running?";
    case 401:
      return "This page's session has ended. Open Vial again from the link in its terminal.";
    case 423:
      // "the keyboard is locked: unlock it to make this change", or it waits for its unlock keys
      return detail || "The keyboard is locked.";
    case 422:
      return detail || "The keyboard can't take this change.";
    case 500:
      return "Unexpected error, see vial.log.";
    case 502:
      return "The keyboard didn't respond.";
    case 503:
      return "The keyboard isn't connected.";
    default:
      return detail || `The request failed (HTTP ${status}).`;
  }
}

/**
 * "Changing the key failed: The keyboard didn't respond."
 * request() reports every failure to reach the server as ApiError(0), so anything else is a bug in the page.
 */
export function failureMessage(action: string, error: unknown): string {
  return `${action} failed: ${causeMessage(error)}`;
}

/** What went wrong, to follow a failure of one's own: "The keyboard didn't respond." */
export function causeMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  console.error(error);
  return "Unexpected error in the page.";
}
