import { describe, expect, it } from "vitest";
import {
  buildThothTurnSnapshot,
  isThothModeEnabled,
  resolveThothClarifyStrength,
} from "./thoth-mode";

describe("Thoth composer mode", () => {
  it("starts enabled Thoth sessions at Light or stronger, never Direct", () => {
    expect(resolveThothClarifyStrength("none")).toBe("light");
    expect(resolveThothClarifyStrength("auto")).toBe("light");
    expect(buildThothTurnSnapshot({ enabled: true, clarifyStrength: "none" })).toEqual({
      enabled: true,
      executionMode: "quick",
      clarifyStrength: "light",
    });
  });

  it("keeps deliberate legacy structured settings enabled while empty legacy config is direct", () => {
    expect(isThothModeEnabled({ mode: "loop", clarifyStrength: "balanced" })).toBe(true);
    expect(isThothModeEnabled({ clarifyStrength: "light" })).toBe(true);
    expect(isThothModeEnabled({})).toBe(false);
  });

  it("freezes explicit off and complete enabled turn snapshots", () => {
    expect(buildThothTurnSnapshot({ enabled: false, mode: "loop" })).toEqual({
      enabled: false,
    });
    expect(
      buildThothTurnSnapshot({
        enabled: true,
        mode: "loop",
        clarifyStrength: "dive",
        loopStrength: "balanced",
      }),
    ).toEqual({
      enabled: true,
      executionMode: "loop",
      clarifyStrength: "dive",
      loopStrength: "balanced",
    });
    expect(
      buildThothTurnSnapshot({
        enabled: true,
        mode: "quick",
        clarifyStrength: "balanced",
        loopStrength: "run_until_stopped",
      }),
    ).toEqual({
      enabled: true,
      executionMode: "quick",
      clarifyStrength: "balanced",
    });
  });
});
