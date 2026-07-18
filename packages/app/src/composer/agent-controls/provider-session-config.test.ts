import { describe, expect, it } from "vitest";
import { selectProviderModel } from "./provider-session-config";

describe("provider model selection", () => {
  it.each([
    { currentProvider: "", nextProviderId: "codex", modelId: "gpt-5.4" },
    { currentProvider: "codex", nextProviderId: "claude", modelId: "sonnet" },
  ])("selects $nextProviderId from '$currentProvider' with one atomic handler", (selection) => {
    const calls: Array<[string, string]> = [];
    selectProviderModel({
      ...selection,
      onSelectProviderAndModel: (provider, modelId) => calls.push([provider, modelId]),
    });
    expect(calls).toEqual([[selection.nextProviderId, selection.modelId]]);
  });

  it("changes only the model when the provider is unchanged and no atomic handler exists", () => {
    const providerCalls: string[] = [];
    const modelCalls: string[] = [];
    selectProviderModel({
      currentProvider: "codex",
      nextProviderId: "codex",
      modelId: "gpt-5.4-mini",
      onSelectProvider: (provider) => providerCalls.push(provider),
      onSelectModel: (model) => modelCalls.push(model),
    });
    expect(providerCalls).toEqual([]);
    expect(modelCalls).toEqual(["gpt-5.4-mini"]);
  });
});
