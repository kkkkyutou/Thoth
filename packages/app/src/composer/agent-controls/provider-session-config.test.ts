import { describe, expect, it } from "vitest";
import {
  buildWorkspaceSecretaryProviderSessionPatch,
  readAgentFeatureValues,
} from "./provider-session-config";

describe("workspace secretary provider session config", () => {
  it("builds a typed workspaceSecretary providerSession patch", () => {
    expect(
      buildWorkspaceSecretaryProviderSessionPatch({
        provider: "codex",
        model: "gpt-5.4",
        modeId: "plan",
        thinkingOptionId: "high",
        featureValues: {
          fast_mode: true,
        },
      }),
    ).toEqual({
      workspaceSecretary: {
        providerSession: {
          provider: "codex",
          model: "gpt-5.4",
          modeId: "plan",
          thinkingOptionId: "high",
          featureValues: {
            fast_mode: true,
          },
        },
      },
    });
  });

  it("reads provider feature values without adding UI authority", () => {
    expect(
      readAgentFeatureValues([
        {
          type: "toggle",
          id: "fast_mode",
          label: "Fast mode",
          value: true,
        },
        {
          type: "select",
          id: "sandbox",
          label: "Sandbox",
          value: "workspace-write",
          options: [],
        },
      ]),
    ).toEqual({
      fast_mode: true,
      sandbox: "workspace-write",
    });
  });

  it("blocks a providerSession patch without a real provider", () => {
    expect(
      buildWorkspaceSecretaryProviderSessionPatch({
        provider: " ",
        model: "gpt-5.4",
      }),
    ).toBeNull();
  });
});
