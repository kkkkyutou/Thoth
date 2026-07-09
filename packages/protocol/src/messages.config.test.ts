import { describe, expect, it } from "vitest";
import { MutableDaemonConfigPatchSchema } from "./messages.js";

describe("mutable daemon config patch", () => {
  it("accepts Workspace Secretary loop strength", () => {
    expect(
      MutableDaemonConfigPatchSchema.parse({
        workspaceSecretary: {
          mode: "loop",
          loopStrength: "one_plan_one_do",
        },
      }),
    ).toEqual({
      workspaceSecretary: {
        mode: "loop",
        loopStrength: "one_plan_one_do",
      },
    });
  });
});
