import { resolveSubmissionReadiness } from "@/provider-selection/provider-selection";
import type { StreamItem } from "@/types/stream";
import type { ThothCleanUiModel } from "@thoth/protocol/workspace-secretary/rpc-schemas";

export interface WorkspaceDraftAutoSubmitConfig {
  provider: string;
  model: string | null;
}

const WORKSPACE_SECRETARY_DRAFT_TITLE_MAX_CHARS = 60;
const GENERIC_WORKSPACE_SECRETARY_TOPIC_TITLES =
  /^(当前话题|话题\s+\d+|current topic|topic\s+\d+)$/i;

export function shouldAllowEmptyDraftText(input: {
  allowsEmptyAutoSubmit: boolean;
  attachments: readonly unknown[];
}): boolean {
  return input.allowsEmptyAutoSubmit || input.attachments.length > 0;
}

export function shouldHydrateWorkspaceSecretarySnapshotForDraft(input: {
  secretaryTopicId?: string | null;
}): boolean {
  // Workspace Secretary snapshots are workspace-scoped. A draft must first own a durable topic
  // binding; otherwise a late snapshot can project another tab's active topic into this tab.
  return Boolean(input.secretaryTopicId?.trim());
}

export function shouldApplyWorkspaceSecretaryModelUpdateForDraft(input: {
  secretaryTopicId?: string | null;
  modelActiveTopicId?: string | null;
}): boolean {
  const secretaryTopicId = input.secretaryTopicId?.trim();
  // A submitted flag is only local UI intent. It is not proof that this tab owns the workspace-wide
  // model update: topic creation and a stale broadcast may race. Only a persisted topic binding is
  // allowed to authorize model projection into a draft tab.
  return Boolean(secretaryTopicId) && input.modelActiveTopicId === secretaryTopicId;
}

export function shouldApplyWorkspaceSecretarySnapshotForDraft(input: {
  secretaryTopicId?: string | null;
  modelActiveTopicId?: string | null;
}): boolean {
  const secretaryTopicId = input.secretaryTopicId?.trim();
  return Boolean(secretaryTopicId) && input.modelActiveTopicId === secretaryTopicId;
}

export function shouldApplyLoopTaskDecisionUpdateForDraft(input: {
  secretaryTopicId?: string | null;
  draftWorkspacePath?: string | null;
  taskSourceTopicId?: string | null;
  taskWorkspacePath?: string | null;
}): boolean {
  const secretaryTopicId = input.secretaryTopicId?.trim();
  const draftWorkspacePath = input.draftWorkspacePath?.trim();
  const taskSourceTopicId = input.taskSourceTopicId?.trim();
  const taskWorkspacePath = input.taskWorkspacePath?.trim();
  return Boolean(
    secretaryTopicId &&
    draftWorkspacePath &&
    taskSourceTopicId === secretaryTopicId &&
    taskWorkspacePath === draftWorkspacePath,
  );
}

export function deriveWorkspaceSecretaryDraftTitleFromText(text: string): string | null {
  const firstContentLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstContentLine) {
    return null;
  }
  const normalized = firstContentLine.replace(/\s+/g, " ").trim();
  const clamped = normalized.slice(0, WORKSPACE_SECRETARY_DRAFT_TITLE_MAX_CHARS).trim();
  return clamped.length > 0 ? clamped : null;
}

export function resolveWorkspaceSecretaryDraftTitleFromModel(
  model: ThothCleanUiModel,
): string | null {
  const activeTopic =
    model.secretary.topics.find((topic) => topic.id === model.secretary.activeTopicId) ?? null;
  const title = activeTopic?.title.trim();
  if (!title || GENERIC_WORKSPACE_SECRETARY_TOPIC_TITLES.test(title)) {
    return null;
  }
  return title;
}

export function isWorkspaceSecretaryModelRunning(model: ThothCleanUiModel): boolean {
  return model.secretary.status.kind === "loading";
}

export function isWorkspaceSecretaryBackgroundHandoff(model: ThothCleanUiModel | null): boolean {
  return model?.secretary.foregroundTurnState === "background_handoff";
}

export function resolveWorkspaceSecretaryTurnInFlight(input: {
  current: boolean;
  model: ThothCleanUiModel;
  reason?:
    | "provider_turn_started"
    | "provider_progress"
    | "provider_reply_delta"
    | "provider_turn_completed"
    | "provider_blocked"
    | "provider_error";
}): boolean {
  if (isWorkspaceSecretaryBackgroundHandoff(input.model)) {
    return false;
  }
  if (isWorkspaceSecretaryModelRunning(input.model)) {
    return true;
  }
  if (
    input.reason === "provider_turn_completed" ||
    input.reason === "provider_blocked" ||
    input.reason === "provider_error" ||
    input.model.secretary.status.kind === "recoverable_error" ||
    input.model.secretary.status.kind === "provider_required" ||
    input.model.secretary.status.kind === "provider_unsupported" ||
    input.model.secretary.status.kind === "host_unavailable"
  ) {
    return false;
  }

  // An authority tool answer resumes the provider asynchronously. A stale ready snapshot must not
  // render the prior assistant turn as complete before the provider emits its actual terminal event.
  return input.current;
}

function latestWorkspaceSecretaryAuthorityItem(items: readonly StreamItem[]): StreamItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "user_message") {
      return null;
    }
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
  secretaryTurnInFlight: boolean;
  streamItems: readonly StreamItem[];
  backgroundHandoff?: boolean;
}): boolean {
  if (input.backgroundHandoff) {
    return false;
  }
  if (input.secretaryTurnInFlight) {
    return true;
  }

  for (let index = input.streamItems.length - 1; index >= 0; index -= 1) {
    const item = input.streamItems[index];
    if (item?.kind === "user_message") {
      break;
    }
    if (item?.kind === "thought" && item.status === "loading") {
      return true;
    }
    if (item?.kind === "tool_call" && item.payload.data.status === "running") {
      return true;
    }
  }

  const latestAuthorityItem = latestWorkspaceSecretaryAuthorityItem(input.streamItems);
  if (!latestAuthorityItem) {
    return false;
  }

  if (latestAuthorityItem.kind === "clarify_card") {
    return !latestAuthorityItem.card.submitted;
  }

  if (latestAuthorityItem.kind === "task_card") {
    return !latestAuthorityItem.card.submitted;
  }

  if (latestAuthorityItem.kind === "goal_card") {
    return !latestAuthorityItem.card.submitted;
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
