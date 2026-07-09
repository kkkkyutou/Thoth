import { resolveSubmissionReadiness } from "@/provider-selection/provider-selection";
import type { StreamItem } from "@/types/stream";

export interface WorkspaceDraftAutoSubmitConfig {
  provider: string;
  model: string | null;
}

export function shouldAllowEmptyDraftText(input: {
  allowsEmptyAutoSubmit: boolean;
  attachments: readonly unknown[];
}): boolean {
  return input.allowsEmptyAutoSubmit || input.attachments.length > 0;
}

export function shouldHydrateWorkspaceSecretarySnapshotForDraft(input: {
  localStreamItemCount: number;
}): boolean {
  // Workspace Secretary snapshots are workspace-scoped active topics. A fresh draft tab has no
  // tab-scoped topic binding yet, so hydrating it would show the previous topic as a new agent.
  return input.localStreamItemCount > 0;
}

function isPausedSubmittedSummary(summary: string | undefined): boolean {
  return Boolean(summary && /暂停|取消/.test(summary));
}

function latestWorkspaceSecretaryAuthorityItem(items: readonly StreamItem[]): StreamItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (
      item?.kind === "clarify_card" ||
      item?.kind === "task_card" ||
      item?.kind === "goal_card" ||
      item?.kind === "registered_task"
    ) {
      return item;
    }
  }
  return null;
}

export function shouldKeepWorkspaceSecretaryAuthorityTurnRunning(input: {
  secretarySubmitted: boolean;
  secretarySubmitting: boolean;
  clarifyStrength: string | null | undefined;
  streamItems: readonly StreamItem[];
}): boolean {
  if (input.secretarySubmitting) {
    return true;
  }
  if (!input.secretarySubmitted || input.clarifyStrength === "none") {
    return false;
  }

  const latestAuthorityItem = latestWorkspaceSecretaryAuthorityItem(input.streamItems);
  if (!latestAuthorityItem) {
    return true;
  }

  if (latestAuthorityItem.kind === "clarify_card") {
    if (!latestAuthorityItem.card.submitted) {
      return true;
    }
    return !isPausedSubmittedSummary(latestAuthorityItem.card.submittedSummary);
  }

  if (latestAuthorityItem.kind === "task_card") {
    if (!latestAuthorityItem.card.submitted) {
      return true;
    }
    return !isPausedSubmittedSummary(latestAuthorityItem.card.submittedSummary);
  }

  if (latestAuthorityItem.kind === "goal_card") {
    return latestAuthorityItem.card.submitted === false;
  }

  return false;
}

export function validateDraftSubmission(input: {
  text: string;
  allowsEmptyAutoSubmit: boolean;
  composerState: {
    providerDefinitions: unknown[];
    selectedProvider: string | null;
    isModelLoading: boolean;
    effectiveModelId: string | null;
    availableModels: unknown[];
  };
  autoSubmitConfig: WorkspaceDraftAutoSubmitConfig | null;
  workspaceDirectory: string | null;
  hasClient: boolean;
}): string | null {
  const {
    text,
    allowsEmptyAutoSubmit,
    composerState,
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  } = input;
  const readiness = resolveSubmissionReadiness({
    text,
    allowsEmptyAutoSubmit,
    providerCount: composerState.providerDefinitions.length,
    selection: {
      provider: composerState.selectedProvider,
      modelId: composerState.effectiveModelId ?? "",
      availableModels: composerState.availableModels,
      isModelLoading: composerState.isModelLoading,
    },
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  });
  return readiness.ok ? null : (readiness.reason ?? null);
}
