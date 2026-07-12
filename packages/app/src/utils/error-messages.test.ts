import { describe, expect, it } from "vitest";
import { isDaemonClientClosedError } from "./error-messages";

describe("isDaemonClientClosedError", () => {
  it("recognizes the expected cleanup rejection from a superseded daemon client", () => {
    expect(isDaemonClientClosedError(new Error("Daemon client closed"))).toBe(true);
  });

  it("does not hide a real daemon request failure", () => {
    expect(isDaemonClientClosedError(new Error("Daemon request timed out"))).toBe(false);
  });
});
