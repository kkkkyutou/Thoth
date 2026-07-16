import { describe, expect, it } from "vitest";
import {
  buildWorkspaceSecretaryComposerModel,
  isThothModeEnabled,
  resolveThothClarifyStrength,
} from "./thoth-mode";

describe("Thoth composer mode", () => {
  it("uses raw provider Quick + Direct when the explicit switch is off", () => {
    expect(
      buildWorkspaceSecretaryComposerModel({
        enabled: false,
        mode: "loop",
        clarifyStrength: "dive",
        loopStrength: "run_until_stopped",
      }),
    ).toMatchObject({
      mode: "quick",
      clarifyStrength: "none",
      loop: null,
    });
  });

  it("starts enabled Thoth sessions at Light or stronger, never Direct", () => {
    expect(resolveThothClarifyStrength("none")).toBe("light");
    expect(resolveThothClarifyStrength("auto")).toBe("light");
    expect(
      buildWorkspaceSecretaryComposerModel({ enabled: true, clarifyStrength: "none" }),
    ).toMatchObject({
      mode: "quick",
      clarifyStrength: "light",
      loop: null,
    });
  });

  it("keeps deliberate legacy structured settings enabled while empty legacy config is direct", () => {
    expect(isThothModeEnabled({ mode: "loop", clarifyStrength: "balanced" })).toBe(true);
    expect(isThothModeEnabled({ clarifyStrength: "light" })).toBe(true);
    expect(isThothModeEnabled({})).toBe(false);
  });
});
