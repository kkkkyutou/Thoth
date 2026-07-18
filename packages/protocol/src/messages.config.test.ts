import { describe, expect, it } from "vitest";
import { MutableDaemonConfigPatchSchema } from "./messages.js";

describe("mutable daemon Thoth preferences", () => {
  it("accepts the explicit Thoth switch", () => {
    expect(
      MutableDaemonConfigPatchSchema.parse({
        thoth: { enabled: false },
      }),
    ).toEqual({
      thoth: { enabled: false },
    });
  });

  it("accepts Loop and Clarify preferences without execution authority", () => {
    expect(
      MutableDaemonConfigPatchSchema.parse({
        thoth: {
          enabled: true,
          mode: "loop",
          clarifyStrength: "balanced",
          loopStrength: "one_plan_one_do",
          selectedBackgroundTaskId: "task-1",
        },
      }),
    ).toEqual({
      thoth: {
        enabled: true,
        mode: "loop",
        clarifyStrength: "balanced",
        loopStrength: "one_plan_one_do",
        selectedBackgroundTaskId: "task-1",
      },
    });
  });

  it("rejects provider sessions and topic execution state inside preferences", () => {
    expect(() =>
      MutableDaemonConfigPatchSchema.parse({
        thoth: { providerBinding: { provider: "codex" } },
      }),
    ).toThrow();
    expect(() =>
      MutableDaemonConfigPatchSchema.parse({
        thoth: { topicAgents: [{ agentId: "hidden-agent" }] },
      }),
    ).toThrow();
  });

  it("rejects the removed Workspace Secretary config surface", () => {
    expect(() =>
      MutableDaemonConfigPatchSchema.parse({
        workspaceSecretary: { enabled: true },
      }),
    ).toThrow();
  });
});
