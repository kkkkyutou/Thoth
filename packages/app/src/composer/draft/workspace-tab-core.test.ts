import { describe, expect, it } from "vitest";
import {
  shouldAllowEmptyDraftText,
  validateDraftSubmission,
} from "@/composer/draft/workspace-tab-core";

describe("shouldAllowEmptyDraftText", () => {
  it("allows an explicit empty auto-submit or an attachment", () => {
    expect(shouldAllowEmptyDraftText({ allowsEmptyAutoSubmit: true, attachments: [] })).toBe(true);
    expect(shouldAllowEmptyDraftText({ allowsEmptyAutoSubmit: false, attachments: [{}] })).toBe(
      true,
    );
    expect(shouldAllowEmptyDraftText({ allowsEmptyAutoSubmit: false, attachments: [] })).toBe(
      false,
    );
  });
});

describe("validateDraftSubmission", () => {
  const readyComposer = {
    providerDefinitions: [{ id: "codex" }],
    selectedProvider: "codex",
    isModelLoading: false,
    effectiveModelId: "gpt-5",
    availableModels: [{ id: "gpt-5" }],
  };

  it("accepts a ready real-Agent create request", () => {
    expect(
      validateDraftSubmission({
        text: "hello",
        allowsEmptyAutoSubmit: false,
        composerState: readyComposer,
        autoSubmitConfig: null,
        workspaceDirectory: "/workspace/project",
        hasClient: true,
      }),
    ).toBeNull();
  });

  it("rejects a create request without a connected client", () => {
    expect(
      validateDraftSubmission({
        text: "hello",
        allowsEmptyAutoSubmit: false,
        composerState: readyComposer,
        autoSubmitConfig: null,
        workspaceDirectory: "/workspace/project",
        hasClient: false,
      }),
    ).toBeTruthy();
  });
});
