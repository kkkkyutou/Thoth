import { describe, expect, it } from "vitest";
import { resolveProviderControlDisplayLabel } from "./provider-display";

describe("resolveProviderControlDisplayLabel", () => {
  it("prefers the selected model label", () => {
    expect(
      resolveProviderControlDisplayLabel({
        provider: "codex",
        providerLabel: "Codex",
        selectedModelId: "gpt-5.5",
        modelOptions: [
          { id: "gpt-5.4", label: "GPT-5.4" },
          { id: "gpt-5.5", label: "GPT-5.5" },
        ],
      }),
    ).toBe("GPT-5.5");
  });

  it("uses the selected model id when metadata is not loaded yet", () => {
    expect(
      resolveProviderControlDisplayLabel({
        provider: "codex",
        providerLabel: "Codex",
        selectedModelId: "gpt-5.5",
        modelOptions: [],
      }),
    ).toBe("gpt-5.5");
  });

  it("uses the first available model before falling back to provider", () => {
    expect(
      resolveProviderControlDisplayLabel({
        provider: "codex",
        providerLabel: "Codex",
        modelOptions: [{ id: "gpt-5.5", label: "GPT-5.5" }],
      }),
    ).toBe("GPT-5.5");
  });

  it("prefers a real provider id over the generic Provider fallback", () => {
    expect(
      resolveProviderControlDisplayLabel({
        provider: "codex",
        providerLabel: "Provider",
      }),
    ).toBe("codex");
  });
});
