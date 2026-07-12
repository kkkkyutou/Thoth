import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import ReanimatedAnimated from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { useContainerWidthBelow } from "@/hooks/use-container-width";
import invariant from "tiny-invariant";
import { Composer } from "@/composer";
import {
  applyWorkspaceSecretaryModelToStream,
  dispatchWorkspaceSecretaryAnswer,
  dispatchWorkspaceSecretaryCancel,
  dispatchWorkspaceSecretaryMessage,
  removeWorkspaceSecretaryModelItemsFromStream,
  type AgentStreamWriter,
} from "@/composer/actions";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { ComposerImportPill } from "@/composer/draft/import-pill";
import { AgentStreamView } from "@/agent-stream/view";
import { composerWorkspaceAttachment } from "@/composer/attachments/workspace";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import type { CreateAgentInitialValues } from "@/hooks/use-agent-form-state";
import { useDraftAgentCreateFlow, type DraftCreateAttempt } from "@/composer/draft/create-flow";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { usePanelStore } from "@/stores/panel-store";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { encodeImages } from "@/utils/encode-images";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { shouldAutoFocusWorkspaceDraftComposer } from "@/screens/workspace/workspace-draft-pane-focus";
import {
  deriveWorkspaceSecretaryDraftTitleFromText,
  isWorkspaceSecretaryModelRunning,
  resolveWorkspaceSecretaryTurnInFlight,
  resolveWorkspaceSecretaryDraftTitleFromModel,
  shouldAllowEmptyDraftText,
  shouldApplyWorkspaceSecretaryModelUpdateForDraft,
  shouldApplyWorkspaceSecretarySnapshotForDraft,
  shouldHydrateWorkspaceSecretarySnapshotForDraft,
  shouldKeepWorkspaceSecretaryAuthorityTurnRunning,
  validateDraftSubmission,
} from "@/composer/draft/workspace-tab-core";
import type { AgentCapabilityFlags, AgentProvider } from "@thoth/protocol/agent-types";
import type { AgentSnapshotPayload } from "@thoth/protocol/messages";
import type { DaemonClient } from "@thoth/client/internal/daemon-client";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  useDraftWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import type { StreamItem, UserMessageImageAttachment } from "@/types/stream";
import type {
  ThothComposerModel,
  WorkspaceSecretaryTurnActionPayload,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
import type {
  ThothRuntimeClarifyStrength,
  ThothRuntimeLoopStrength,
  ThothRuntimeMode,
} from "@thoth/protocol/thoth-runtime-contract";
import {
  COMPACT_FORM_FACTOR_WIDTH,
  MAX_CONTENT_WIDTH,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import type { WorkspaceDraftTabSetup } from "@/stores/workspace-tabs-store";

const EMPTY_PENDING_PERMISSIONS = new Map();
const EMPTY_ONLINE_SERVER_IDS: string[] = [];
const EMPTY_STREAM_ITEMS: StreamItem[] = [];
const DRAFT_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

function createWorkspaceSecretaryTopicId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `topic-${randomId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function buildWorkspaceSecretaryComposerModel(config: {
  workspaceSecretary?: {
    mode?: string;
    clarifyStrength?: string;
    loopStrength?: string;
  };
}): ThothComposerModel {
  const rawMode = config.workspaceSecretary?.mode;
  const mode: ThothRuntimeMode = rawMode === "loop" ? "loop" : "quick";
  const rawClarify = config.workspaceSecretary?.clarifyStrength;
  const clarifyStrength: Exclude<ThothRuntimeClarifyStrength, "deep"> =
    rawClarify === "none" ||
    rawClarify === "auto" ||
    rawClarify === "light" ||
    rawClarify === "dive"
      ? rawClarify
      : "balanced";
  const loopStrength = resolveWorkspaceSecretaryLoopStrength(
    config.workspaceSecretary?.loopStrength,
  );
  return {
    mode,
    clarifyStrength,
    loop: mode === "loop" ? loopStrength : null,
    authorityLabel: "真实 provider",
    authorityReady: true,
  };
}

function resolveWorkspaceSecretaryLoopStrength(value: unknown): ThothRuntimeLoopStrength {
  return value === "one_plan_one_do" ||
    value === "light" ||
    value === "balanced" ||
    value === "run_until_stopped"
    ? value
    : "one_plan_one_do";
}

function buildWorkspaceSecretaryDraftAgent(input: {
  serverId: string;
  tabId: string;
  workspaceDirectory: string;
  workspaceId: string | null;
  provider: string;
  model: string | null;
  status: Agent["status"];
}): Agent {
  const now = new Date();
  return {
    serverId: input.serverId,
    id: input.tabId,
    provider: input.provider,
    status: input.status,
    createdAt: now,
    updatedAt: now,
    lastUserMessageAt: now,
    lastActivityAt: now,
    capabilities: DRAFT_CAPABILITIES,
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: {
      provider: input.provider,
      sessionId: null,
      model: input.model,
      modeId: null,
    },
    title: "Workspace Secretary",
    cwd: input.workspaceDirectory,
    workspaceId: input.workspaceId ?? undefined,
    model: input.model,
    features: [],
    thinkingOptionId: null,
    parentAgentId: null,
    labels: {},
  };
}

interface AutoSubmitConfig {
  provider: string;
  modeId: string | null;
  model: string | null;
  thinkingOptionId: string | null;
  featureValues: Record<string, unknown>;
}

function resolveAutoSubmitConfig(
  pending: {
    provider: string;
    modeId?: string | null;
    model?: string | null;
    thinkingOptionId?: string | null;
    featureValues?: Record<string, unknown>;
  } | null,
): AutoSubmitConfig | null {
  if (!pending) return null;
  return {
    provider: pending.provider,
    modeId: pending.modeId ?? null,
    model: pending.model ?? null,
    thinkingOptionId: pending.thinkingOptionId ?? null,
    featureValues: pending.featureValues ?? {},
  };
}

function resolveDraftModeIdOverride(input: {
  autoSubmitConfig: AutoSubmitConfig | null;
  modeOptionsCount: number;
  selectedMode: string;
}): { modeId: string } | Record<string, never> {
  const { autoSubmitConfig, modeOptionsCount, selectedMode } = input;
  if (autoSubmitConfig?.modeId) {
    return { modeId: autoSubmitConfig.modeId };
  }
  if (modeOptionsCount > 0 && selectedMode !== "") {
    return { modeId: selectedMode };
  }
  return {};
}

function resolveDraftModeId(input: {
  autoSubmitConfig: AutoSubmitConfig | null;
  modeOptionsCount: number;
  selectedMode: string;
}): string | null {
  const { autoSubmitConfig, modeOptionsCount, selectedMode } = input;
  if (autoSubmitConfig?.modeId !== undefined) {
    return autoSubmitConfig.modeId;
  }
  if (modeOptionsCount > 0 && selectedMode !== "") {
    return selectedMode;
  }
  return null;
}

async function submitDraftCreateRequest(input: {
  attempt: { clientMessageId: string };
  text: string;
  images?: UserMessageImageAttachment[];
  attachments?: unknown;
  cwd: string;
  client: DaemonClient | null;
  workspaceDirectory: string | null;
  workspaceId: string | null;
  autoSubmitConfig: AutoSubmitConfig | null;
  composerState: {
    selectedProvider: string | null;
    selectedMode: string;
    modeOptions: unknown[];
    effectiveModelId: string | null;
    effectiveThinkingOptionId: string | null;
    featureValues: Record<string, unknown> | undefined;
  };
  hostDisconnectedMessage: string;
  selectModelMessage: string;
}): Promise<{ agentId: string | null; result: AgentSnapshotPayload }> {
  const {
    attempt,
    text,
    images,
    attachments,
    cwd,
    client,
    workspaceDirectory,
    workspaceId,
    autoSubmitConfig,
    composerState,
  } = input;

  invariant(workspaceDirectory, "Workspace directory is required");
  invariant(workspaceId, "Workspace id is required");
  if (!client) {
    throw new Error(input.hostDisconnectedMessage);
  }

  const provider = autoSubmitConfig?.provider ?? composerState.selectedProvider;
  if (!provider) {
    throw new Error(input.selectModelMessage);
  }
  const modeIdOverride = resolveDraftModeIdOverride({
    autoSubmitConfig,
    modeOptionsCount: composerState.modeOptions.length,
    selectedMode: composerState.selectedMode,
  });
  const config = buildWorkspaceDraftAgentConfig({
    provider,
    cwd,
    ...modeIdOverride,
    model: autoSubmitConfig?.model ?? (composerState.effectiveModelId || undefined),
    thinkingOptionId:
      autoSubmitConfig?.thinkingOptionId ?? (composerState.effectiveThinkingOptionId || undefined),
    featureValues: autoSubmitConfig?.featureValues ?? composerState.featureValues,
  });

  const imagesData = await encodeImages(images);
  const attachmentsArray = Array.isArray(attachments) ? attachments : undefined;
  const result = await client.createAgent({
    config,
    workspaceId,
    ...(text ? { initialPrompt: text } : {}),
    clientMessageId: attempt.clientMessageId,
    ...(imagesData && imagesData.length > 0 ? { images: imagesData } : {}),
    ...(attachmentsArray && attachmentsArray.length > 0 ? { attachments: attachmentsArray } : {}),
  });

  return {
    agentId: result.id,
    result,
  };
}

function buildDraftAgentSnapshot(input: {
  attempt: { timestamp: Date };
  serverId: string;
  tabId: string;
  workspaceDirectory: string | null;
  autoSubmitConfig: AutoSubmitConfig | null;
  composerState: {
    effectiveModelId: string | null;
    effectiveThinkingOptionId: string | null;
    modeOptions: unknown[];
    selectedMode: string;
    selectedProvider: string | null;
    agentControls: { features?: Agent["features"] };
  };
  selectModelMessage: string;
}): Agent {
  const { attempt, serverId, tabId, workspaceDirectory, autoSubmitConfig, composerState } = input;
  invariant(workspaceDirectory, "Workspace directory is required");
  const now = attempt.timestamp;
  const model = autoSubmitConfig?.model ?? (composerState.effectiveModelId || null);
  const thinkingOptionId =
    autoSubmitConfig?.thinkingOptionId ?? (composerState.effectiveThinkingOptionId || null);
  const modeId = resolveDraftModeId({
    autoSubmitConfig,
    modeOptionsCount: composerState.modeOptions.length,
    selectedMode: composerState.selectedMode,
  });
  const provider = autoSubmitConfig?.provider ?? composerState.selectedProvider;
  if (!provider) {
    throw new Error(input.selectModelMessage);
  }
  return {
    serverId,
    id: tabId,
    provider,
    status: "running",
    createdAt: now,
    updatedAt: now,
    lastUserMessageAt: now,
    lastActivityAt: now,
    capabilities: DRAFT_CAPABILITIES,
    currentModeId: modeId,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: { provider, sessionId: null, model, modeId },
    title: "Agent",
    cwd: workspaceDirectory,
    model,
    features: composerState.agentControls.features,
    thinkingOptionId,
    parentAgentId: null,
    labels: {},
  };
}

function buildDraftInitialValues(input: {
  workingDir: string | null;
  initialSetup: WorkspaceDraftTabSetup | null;
}): CreateAgentInitialValues | undefined {
  if (!input.workingDir) {
    return undefined;
  }
  if (!input.initialSetup) {
    return { workingDir: input.workingDir };
  }
  return {
    workingDir: input.workingDir,
    provider: input.initialSetup.provider,
    modeId: input.initialSetup.modeId,
    model: input.initialSetup.model,
    thinkingOptionId: input.initialSetup.thinkingOptionId,
  };
}

function resolveDraftWorkingDirectory(input: {
  workspaceDirectory: string | null;
  initialSetup: WorkspaceDraftTabSetup | null;
}): string | null {
  if (input.initialSetup) {
    return input.initialSetup.cwd;
  }
  return input.workspaceDirectory;
}

function resolveOnlineServerIds(input: { isConnected: boolean; serverId: string }): string[] {
  if (!input.isConnected) {
    return EMPTY_ONLINE_SERVER_IDS;
  }
  return [input.serverId];
}

interface WorkspaceDraftAgentTabProps {
  serverId: string;
  workspaceId: string;
  tabId: string;
  draftId: string;
  initialSetup?: WorkspaceDraftTabSetup;
  isPaneFocused: boolean;
  onCreated: (snapshot: AgentSnapshotPayload) => void;
  onOpenWorkspaceFile: (request: WorkspaceFileOpenRequest) => void;
  onDraftTitleChange?: (title: string | null) => void;
  secretaryTopicId?: string | null;
  onDraftSecretaryTopicChange?: (topicId: string) => void;
  onOpenImportSheet?: () => void;
}

function resolveImportPillPress(
  onOpenImportSheet: (() => void) | undefined,
  isSubmitting: boolean,
): (() => void) | null {
  if (isSubmitting) {
    return null;
  }
  return onOpenImportSheet ?? null;
}

export function WorkspaceDraftAgentTab({
  serverId,
  workspaceId,
  tabId,
  draftId,
  initialSetup = undefined,
  isPaneFocused,
  onCreated,
  onOpenWorkspaceFile,
  onDraftTitleChange,
  secretaryTopicId = null,
  onDraftSecretaryTopicChange,
  onOpenImportSheet,
}: WorkspaceDraftAgentTabProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const client = useHostRuntimeClient(serverId);
  const { config: daemonConfig } = useDaemonConfig(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const workspaceFields = useWorkspaceFields(serverId, workspaceId, (w) => ({
    workspaceDirectory: w.workspaceDirectory,
    id: w.id,
  }));
  const workspaceDirectory = workspaceFields?.workspaceDirectory || null;
  const draftSetup = initialSetup ?? null;
  const draftWorkingDirectory = resolveDraftWorkingDirectory({
    workspaceDirectory,
    initialSetup: draftSetup,
  });
  const draftInitialValues = buildDraftInitialValues({
    workingDir: draftWorkingDirectory,
    initialSetup: draftSetup,
  });
  const onlineServerIds = resolveOnlineServerIds({ isConnected, serverId });
  const draftStoreKey = useMemo(
    () =>
      buildDraftStoreKey({
        serverId,
        agentId: tabId,
        draftId,
      }),
    [draftId, serverId, tabId],
  );
  const draftInput = useAgentInputDraft({
    draftKey: draftStoreKey,
    composer: {
      initialServerId: serverId,
      initialValues: draftInitialValues,
      initialFeatureValues: draftSetup?.featureValues,
      isVisible: true,
      onlineServerIds,
      lockedWorkingDir: draftWorkingDirectory ?? undefined,
    },
  });
  const composerState = draftInput.composerState;
  if (!composerState) {
    throw new Error("Workspace draft composer state is required");
  }
  const workspaceSecretaryComposer = useMemo(
    () => buildWorkspaceSecretaryComposerModel(daemonConfig ?? {}),
    [daemonConfig],
  );
  const workspaceSecretaryProvider = daemonConfig?.workspaceSecretary?.providerSession;
  const secretaryProvider =
    workspaceSecretaryProvider?.provider ?? composerState.selectedProvider ?? "codex";
  const secretaryModel =
    workspaceSecretaryProvider?.model ?? composerState.effectiveModelId ?? null;
  const clearDraftInput = draftInput.clear;
  const setDraftText = draftInput.setText;
  const setDraftAttachments = draftInput.setAttachments;
  const [secretarySubmitted, setSecretarySubmitted] = useState(false);
  const [secretarySubmitting, setSecretarySubmitting] = useState(false);
  const [secretaryTurnInFlight, setSecretaryTurnInFlight] = useState(false);
  const [secretaryErrorMessage, setSecretaryErrorMessage] = useState("");
  const boundSecretaryTopicId = secretaryTopicId?.trim() || null;
  const secretaryTopicIdRef = useRef<string | null>(boundSecretaryTopicId);
  const secretaryStreamItems =
    useSessionStore((state) => state.sessions[serverId]?.agentStreamTail?.get(tabId)) ??
    EMPTY_STREAM_ITEMS;
  useEffect(() => {
    secretaryTopicIdRef.current = boundSecretaryTopicId;
  }, [boundSecretaryTopicId]);
  const rememberSecretaryTopicId = useCallback(
    (topicId: string | null | undefined) => {
      const normalizedTopicId = topicId?.trim() || null;
      if (
        !normalizedTopicId ||
        secretaryTopicIdRef.current === normalizedTopicId ||
        (secretaryTopicIdRef.current && secretaryTopicIdRef.current !== normalizedTopicId)
      ) {
        return;
      }
      secretaryTopicIdRef.current = normalizedTopicId;
      onDraftSecretaryTopicChange?.(normalizedTopicId);
    },
    [onDraftSecretaryTopicChange],
  );
  const secretaryAuthorityTurnRunning = shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
    secretaryTurnInFlight,
    streamItems: secretaryStreamItems,
  });
  const shouldHydrateSecretarySnapshot = shouldHydrateWorkspaceSecretarySnapshotForDraft({
    secretaryTopicId: boundSecretaryTopicId,
  });
  const setAgentStreamTail = useSessionStore((state) => state.setAgentStreamTail);
  const setAgentStreamHead = useSessionStore((state) => state.setAgentStreamHead);
  const secretaryDraftAgent = useMemo(
    () =>
      draftWorkingDirectory
        ? buildWorkspaceSecretaryDraftAgent({
            serverId,
            tabId,
            workspaceDirectory: draftWorkingDirectory,
            workspaceId: workspaceFields?.id ?? null,
            provider: secretaryProvider,
            model: secretaryModel,
            status: secretaryAuthorityTurnRunning ? "running" : "idle",
          })
        : null,
    [
      draftWorkingDirectory,
      secretaryModel,
      secretaryProvider,
      secretaryAuthorityTurnRunning,
      serverId,
      tabId,
      workspaceFields?.id,
    ],
  );
  const getSecretaryStreamWriter = useCallback(
    (): AgentStreamWriter => ({
      getTail: (id) => useSessionStore.getState().sessions[serverId]?.agentStreamTail?.get(id),
      getHead: (id) => useSessionStore.getState().sessions[serverId]?.agentStreamHead?.get(id),
      setHead: (updater) => setAgentStreamHead(serverId, updater),
      setTail: (updater) => setAgentStreamTail(serverId, updater),
    }),
    [serverId, setAgentStreamHead, setAgentStreamTail],
  );
  const secretarySnapshotHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!shouldHydrateSecretarySnapshot) {
      return;
    }
    if (!client || !draftWorkingDirectory || !workspaceFields?.id) {
      return;
    }
    const hydrateKey = [
      serverId,
      workspaceFields.id,
      draftWorkingDirectory,
      tabId,
      boundSecretaryTopicId ?? "active",
    ].join(":");
    if (secretarySnapshotHydratedRef.current === hydrateKey) {
      return;
    }
    secretarySnapshotHydratedRef.current = hydrateKey;
    let cancelled = false;
    void client
      .fetchWorkspaceSecretarySnapshot({
        workspaceId: workspaceFields.id,
        workspacePath: draftWorkingDirectory,
        ...(boundSecretaryTopicId ? { topicId: boundSecretaryTopicId } : {}),
      })
      .then((payload) => {
        if (cancelled) {
          return;
        }
        if (!payload.model) {
          return;
        }
        if (
          !shouldApplyWorkspaceSecretarySnapshotForDraft({
            secretaryTopicId: boundSecretaryTopicId,
            modelActiveTopicId: payload.model.secretary.activeTopicId,
          })
        ) {
          removeWorkspaceSecretaryModelItemsFromStream(
            tabId,
            payload.model,
            getSecretaryStreamWriter(),
          );
          return;
        }
        rememberSecretaryTopicId(payload.model.secretary.activeTopicId);
        applyWorkspaceSecretaryModelToStream(tabId, payload.model, getSecretaryStreamWriter());
        setSecretaryTurnInFlight(isWorkspaceSecretaryModelRunning(payload.model));
        const restoredTitle = resolveWorkspaceSecretaryDraftTitleFromModel(payload.model);
        if (restoredTitle) {
          onDraftTitleChange?.(restoredTitle);
        }
        if (payload.model.secretary.turns.length > 0) {
          setSecretarySubmitted(true);
        }
      })
      .catch((error) => {
        secretarySnapshotHydratedRef.current = null;
        console.warn("[WorkspaceSecretary] failed to hydrate snapshot", error);
      });
    return () => {
      cancelled = true;
    };
  }, [
    client,
    draftWorkingDirectory,
    getSecretaryStreamWriter,
    onDraftTitleChange,
    rememberSecretaryTopicId,
    serverId,
    shouldHydrateSecretarySnapshot,
    tabId,
    boundSecretaryTopicId,
    workspaceFields?.id,
  ]);
  useEffect(() => {
    if (!client || !draftWorkingDirectory) {
      return;
    }
    return client.subscribeWorkspaceSecretaryModelUpdates((payload) => {
      if (payload.model.secretary.workspacePath !== draftWorkingDirectory) {
        return;
      }
      if (
        !shouldApplyWorkspaceSecretaryModelUpdateForDraft({
          secretaryTopicId: secretaryTopicIdRef.current,
          modelActiveTopicId: payload.model.secretary.activeTopicId,
        })
      ) {
        return;
      }
      rememberSecretaryTopicId(payload.model.secretary.activeTopicId);
      applyWorkspaceSecretaryModelToStream(tabId, payload.model, getSecretaryStreamWriter());
      setSecretaryTurnInFlight((current) =>
        resolveWorkspaceSecretaryTurnInFlight({
          current,
          model: payload.model,
          reason: payload.reason,
        }),
      );
      const restoredTitle = resolveWorkspaceSecretaryDraftTitleFromModel(payload.model);
      if (restoredTitle) {
        onDraftTitleChange?.(restoredTitle);
      }
      if (payload.model.secretary.turns.length > 0) {
        setSecretarySubmitted(true);
      }
    });
  }, [
    client,
    draftWorkingDirectory,
    getSecretaryStreamWriter,
    onDraftTitleChange,
    rememberSecretaryTopicId,
    tabId,
  ]);
  const pendingAutoSubmit = useWorkspaceDraftSubmissionStore((state) => {
    const pending = state.pendingByDraftId[draftId] ?? null;
    return pending?.serverId === serverId && pending.workspaceId === workspaceId ? pending : null;
  });
  const pendingCreateAttempt = useCreateFlowStore((state) => {
    const pending = state.pendingByDraftId[draftId] ?? null;
    return pending?.serverId === serverId && pending.lifecycle === "active" ? pending : null;
  });
  const consumePendingAutoSubmit = useWorkspaceDraftSubmissionStore(
    (state) => state.consumePending,
  );
  const autoSubmitConfig = resolveAutoSubmitConfig(pendingAutoSubmit);
  const initialCreateAttempt = useMemo<DraftCreateAttempt | null>(() => {
    if (!pendingAutoSubmit || !pendingCreateAttempt) {
      return null;
    }
    if (pendingAutoSubmit.clientMessageId !== pendingCreateAttempt.clientMessageId) {
      return null;
    }
    return {
      clientMessageId: pendingCreateAttempt.clientMessageId,
      text: pendingCreateAttempt.text,
      timestamp: new Date(pendingCreateAttempt.timestamp),
      ...(pendingCreateAttempt.images && pendingCreateAttempt.images.length > 0
        ? { images: pendingCreateAttempt.images }
        : {}),
      ...(pendingCreateAttempt.attachments && pendingCreateAttempt.attachments.length > 0
        ? { attachments: pendingCreateAttempt.attachments }
        : {}),
    };
  }, [pendingAutoSubmit, pendingCreateAttempt]);
  const allowsEmptyAutoSubmit = pendingAutoSubmit?.allowEmptyText === true;
  const isCompactFormFactor = useIsCompactFormFactor();
  const { onLayout: onInputAreaLayout, isBelow: isCompactComposerLayout } = useContainerWidthBelow(
    COMPACT_FORM_FACTOR_WIDTH,
    { initialIsBelow: isCompactFormFactor },
  );
  const workspaceAttachmentScopeKey = useWorkspaceAttachmentScopeKey({
    serverId,
    cwd: composerState.workingDir,
    workspaceId,
  });
  const draftAttachmentScopeKey = useDraftWorkspaceAttachmentScopeKey(draftId);
  const attachmentScopeKeys = useMemo(
    () => [draftAttachmentScopeKey, workspaceAttachmentScopeKey].filter(Boolean),
    [draftAttachmentScopeKey, workspaceAttachmentScopeKey],
  );
  const clearWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.clearWorkspaceAttachments,
  );
  const openFileExplorerForCheckout = usePanelStore((state) => state.openFileExplorerForCheckout);
  const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);
  const handleOpenWorkspaceAttachment = useCallback(
    (attachment: WorkspaceComposerAttachment) => {
      if (attachment.kind !== "review") {
        return;
      }
      const checkout = {
        serverId,
        cwd: attachment.attachment.cwd,
        isGit: true,
      };
      openFileExplorerForCheckout({
        checkout,
        isCompact: isCompactFormFactor,
      });
      setExplorerTabForCheckout({
        ...checkout,
        tab: "changes",
      });
    },
    [isCompactFormFactor, openFileExplorerForCheckout, serverId, setExplorerTabForCheckout],
  );

  const {
    formErrorMessage,
    isSubmitting,
    optimisticStreamItems,
    draftAgent,
    handleCreateFromInput,
    continueCreateFromAttempt,
  } = useDraftAgentCreateFlow<Agent, AgentSnapshotPayload>({
    draftId,
    getPendingServerId: () => serverId,
    initialAttempt: initialCreateAttempt,
    allowEmptyText: allowsEmptyAutoSubmit,
    validateBeforeSubmit: ({ text, attachments }) => {
      const allowsEmptyDraftText = shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit,
        attachments,
      });
      return validateDraftSubmission({
        text,
        allowsEmptyAutoSubmit: allowsEmptyDraftText,
        composerState,
        autoSubmitConfig,
        workspaceDirectory: draftWorkingDirectory,
        hasClient: Boolean(client),
      });
    },
    onBeforeSubmit: async () => {
      await composerState.persistFormPreferences();
      if (isWeb) {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      Keyboard.dismiss();
    },
    buildDraftAgent: (attempt) =>
      buildDraftAgentSnapshot({
        attempt,
        serverId,
        tabId,
        workspaceDirectory: draftWorkingDirectory,
        autoSubmitConfig,
        composerState,
        selectModelMessage: t("workspaceSetup.errors.selectModel"),
      }),
    createRequest: async ({ attempt, text, images, attachments, cwd }) =>
      submitDraftCreateRequest({
        attempt,
        text,
        images,
        attachments,
        cwd,
        client,
        workspaceDirectory: draftWorkingDirectory,
        workspaceId: workspaceFields?.id ?? null,
        autoSubmitConfig,
        composerState,
        hostDisconnectedMessage: t("workspace.terminal.hostDisconnected"),
        selectModelMessage: t("workspaceSetup.errors.selectModel"),
      }),
    onCreateSuccess: ({ result }) => {
      clearDraftInput("sent");
      clearWorkspaceAttachments({ scopeKey: draftAttachmentScopeKey });
      useWorkspaceDraftSubmissionStore.getState().clearDraftSetup({ draftId });
      onCreated(result);
    },
  });
  const handleWorkspaceSecretarySubmit = useCallback(
    async ({
      text,
      attachments,
    }: {
      text: string;
      attachments: Parameters<typeof handleCreateFromInput>[0]["attachments"];
      cwd: string;
    }) => {
      if (secretarySubmitting) {
        throw new Error(t("composer.errors.alreadyLoading"));
      }
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      if (!draftWorkingDirectory) {
        throw new Error("Workspace directory is required");
      }
      const trimmedPrompt = text.trim();
      if (!trimmedPrompt && attachments.length === 0) {
        throw new Error(t("composer.errors.initialPromptRequired"));
      }
      const provisionalTitle = deriveWorkspaceSecretaryDraftTitleFromText(trimmedPrompt);

      setSecretaryErrorMessage("");
      setSecretarySubmitting(true);
      setSecretarySubmitted(true);
      setSecretaryTurnInFlight(true);
      if (provisionalTitle) {
        onDraftTitleChange?.(provisionalTitle);
      }
      void (async () => {
        try {
          await composerState.persistFormPreferences();
          if (isWeb) {
            (document.activeElement as HTMLElement | null)?.blur?.();
          }
          Keyboard.dismiss();
          const topicId = secretaryTopicIdRef.current ?? createWorkspaceSecretaryTopicId();
          if (!secretaryTopicIdRef.current) {
            // Persist the binding before the RPC begins. The daemon creates this topic atomically
            // with the first user turn, so a reload cannot leave a durable empty topic behind.
            rememberSecretaryTopicId(topicId);
          }
          const response = await dispatchWorkspaceSecretaryMessage({
            client,
            agentId: tabId,
            workspaceId: workspaceFields?.id,
            workspacePath: draftWorkingDirectory,
            topicId,
            text: trimmedPrompt,
            attachments,
            composer: workspaceSecretaryComposer,
            encodeImages,
            stream: getSecretaryStreamWriter(),
          });
          if (response.model) {
            setSecretaryTurnInFlight((current) =>
              resolveWorkspaceSecretaryTurnInFlight({ current, model: response.model }),
            );
            const responseTitle = resolveWorkspaceSecretaryDraftTitleFromModel(response.model);
            if (responseTitle) {
              onDraftTitleChange?.(responseTitle);
            }
          }
          const responseError =
            response.error ??
            (response.model?.secretary.status.kind === "recoverable_error"
              ? response.model.secretary.status.detail
              : null);
          if (responseError) {
            setSecretaryErrorMessage(responseError);
            setSecretaryTurnInFlight(false);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setSecretaryErrorMessage(message);
          setSecretaryTurnInFlight(false);
        } finally {
          setSecretarySubmitting(false);
        }
      })();
      clearWorkspaceAttachments({ scopeKey: draftAttachmentScopeKey });
      useWorkspaceDraftSubmissionStore.getState().clearDraftSetup({ draftId });
    },
    [
      clearWorkspaceAttachments,
      client,
      composerState,
      draftAttachmentScopeKey,
      draftId,
      draftWorkingDirectory,
      getSecretaryStreamWriter,
      onDraftTitleChange,
      rememberSecretaryTopicId,
      secretarySubmitting,
      t,
      tabId,
      workspaceFields?.id,
      workspaceSecretaryComposer,
    ],
  );
  const handleWorkspaceSecretaryAnswer = useCallback(
    async (cardId: string, answer: WorkspaceSecretaryTurnActionPayload) => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      setSecretaryErrorMessage("");
      setSecretaryTurnInFlight(true);
      try {
        const response = await dispatchWorkspaceSecretaryAnswer({
          client,
          agentId: tabId,
          workspaceId: workspaceFields?.id,
          workspacePath: draftWorkingDirectory,
          topicId: secretaryTopicIdRef.current ?? undefined,
          cardId,
          answer,
          stream: getSecretaryStreamWriter(),
        });
        if (response.model) {
          setSecretaryTurnInFlight((current) =>
            resolveWorkspaceSecretaryTurnInFlight({ current, model: response.model }),
          );
        }
        const responseError =
          response.error ??
          (response.model?.secretary.status.kind === "recoverable_error"
            ? response.model.secretary.status.detail
            : null);
        setSecretaryErrorMessage(responseError ?? "");
        if (responseError) {
          setSecretaryTurnInFlight(false);
        }
      } catch (error) {
        setSecretaryErrorMessage(error instanceof Error ? error.message : String(error));
        setSecretaryTurnInFlight(false);
        throw error;
      }
    },
    [client, draftWorkingDirectory, getSecretaryStreamWriter, t, tabId, workspaceFields?.id],
  );
  const handleWorkspaceSecretaryCancel = useCallback(async () => {
    if (!client) {
      throw new Error(t("workspace.terminal.hostDisconnected"));
    }
    const response = await dispatchWorkspaceSecretaryCancel({
      client,
      agentId: tabId,
      workspaceId: workspaceFields?.id,
      workspacePath: draftWorkingDirectory,
      topicId: secretaryTopicIdRef.current ?? undefined,
      stream: getSecretaryStreamWriter(),
    });
    if (response.model) {
      setSecretaryTurnInFlight(isWorkspaceSecretaryModelRunning(response.model));
    } else {
      setSecretaryTurnInFlight(false);
    }
    setSecretaryErrorMessage(response.error ?? "");
  }, [client, draftWorkingDirectory, getSecretaryStreamWriter, t, tabId, workspaceFields?.id]);

  const isReadyForPendingAutoSubmit = Boolean(
    pendingAutoSubmit &&
    draftInput.isHydrated &&
    draftWorkingDirectory &&
    client &&
    !composerState.isModelLoading,
  );
  const autoSubmitKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isReadyForPendingAutoSubmit) {
      return;
    }
    const submitKey = `${serverId}:${workspaceId}:${draftId}`;
    if (autoSubmitKeyRef.current === submitKey) {
      return;
    }
    const submission = consumePendingAutoSubmit({ serverId, workspaceId, draftId });
    if (!submission) {
      return;
    }
    autoSubmitKeyRef.current = submitKey;
    setDraftText("");
    setDraftAttachments([]);
    const preparedAttempt =
      initialCreateAttempt?.clientMessageId === submission.clientMessageId
        ? initialCreateAttempt
        : null;
    const createPromise = preparedAttempt
      ? continueCreateFromAttempt({
          attempt: preparedAttempt,
          cwd: submission.cwd,
        })
      : handleCreateFromInput({
          text: submission.text,
          attachments: submission.attachments,
          cwd: submission.cwd,
        });
    void createPromise.catch(() => {
      setDraftText(submission.text);
      setDraftAttachments(composerWorkspaceAttachment.userAttachmentsOnly(submission.attachments));
      autoSubmitKeyRef.current = null;
    });
  }, [
    continueCreateFromAttempt,
    consumePendingAutoSubmit,
    draftId,
    handleCreateFromInput,
    initialCreateAttempt,
    isReadyForPendingAutoSubmit,
    serverId,
    setDraftAttachments,
    setDraftText,
    workspaceId,
  ]);

  const focusInputRef = useRef<(() => void) | null>(null);

  const handleFocusInputCallback = useCallback((focus: () => void) => {
    focusInputRef.current = focus;
  }, []);

  const handleProviderSelectWithFocus = useCallback(
    (provider: Parameters<typeof composerState.setProviderFromUser>[0]) => {
      composerState.setProviderFromUser(provider);
      focusInputRef.current?.();
    },
    [composerState],
  );

  const handleModeSelectWithFocus = useCallback(
    (modeId: string) => {
      composerState.setModeFromUser(modeId);
      focusInputRef.current?.();
    },
    [composerState],
  );

  const handleModelSelectWithFocus = useCallback(
    (modelId: string) => {
      composerState.setModelFromUser(modelId);
      focusInputRef.current?.();
    },
    [composerState],
  );

  const handleProviderAndModelSelectWithFocus = useCallback(
    (
      provider: Parameters<typeof composerState.setProviderAndModelFromUser>[0],
      modelId: string,
    ) => {
      composerState.setProviderAndModelFromUser(provider, modelId);
      focusInputRef.current?.();
    },
    [composerState],
  );

  const handleThinkingOptionSelectWithFocus = useCallback(
    (optionId: string) => {
      composerState.setThinkingOptionFromUser(optionId);
      focusInputRef.current?.();
    },
    [composerState],
  );

  const handleSetFeatureWithFocus = useCallback(
    (featureId: string, value: unknown) => {
      composerState.agentControls.onSetFeature?.(featureId, value);
      focusInputRef.current?.();
    },
    [composerState],
  );

  const { style: composerKeyboardStyle } = useKeyboardShiftStyle({
    mode: "translate",
  });

  const inputAreaWrapperStyle = useMemo(
    () => [styles.inputAreaWrapper, { paddingBottom: insets.bottom }, composerKeyboardStyle],
    [insets.bottom, composerKeyboardStyle],
  );

  const handleDropdownCloseFocus = useCallback(() => {
    focusInputRef.current?.();
  }, []);
  const importPillPress = resolveImportPillPress(onOpenImportSheet, isSubmitting);
  const composerAgentControls = useMemo(
    () => ({
      ...composerState.agentControls,
      selectedProvider: secretaryProvider as AgentProvider,
      selectedModel: secretaryModel ?? composerState.agentControls.selectedModel,
      onSelectProvider: handleProviderSelectWithFocus,
      onSelectMode: handleModeSelectWithFocus,
      onSelectModel: handleModelSelectWithFocus,
      onSelectProviderAndModel: handleProviderAndModelSelectWithFocus,
      onSelectThinkingOption: handleThinkingOptionSelectWithFocus,
      onSetFeature: handleSetFeatureWithFocus,
      onDropdownClose: handleDropdownCloseFocus,
      disabled: isSubmitting,
    }),
    [
      composerState.agentControls,
      handleProviderSelectWithFocus,
      handleModeSelectWithFocus,
      handleModelSelectWithFocus,
      handleProviderAndModelSelectWithFocus,
      handleThinkingOptionSelectWithFocus,
      handleSetFeatureWithFocus,
      handleDropdownCloseFocus,
      isSubmitting,
      secretaryModel,
      secretaryProvider,
    ],
  );
  const showWorkspaceSecretaryStream =
    Boolean(secretaryDraftAgent) && (secretarySubmitted || secretaryStreamItems.length > 0);
  const visibleFormErrorMessage = secretaryErrorMessage || formErrorMessage;
  const visibleSubmitLoading = isSubmitting;
  const composerStatusOverride: Agent["status"] = secretaryAuthorityTurnRunning
    ? "running"
    : "idle";
  return (
    <FileDropZone style={styles.container}>
      <View style={styles.contentContainer}>
        {showWorkspaceSecretaryStream && secretaryDraftAgent ? (
          <View style={styles.streamContainer}>
            {visibleFormErrorMessage ? (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{visibleFormErrorMessage}</Text>
              </View>
            ) : null}
            <AgentStreamView
              agentId={tabId}
              serverId={serverId}
              agent={secretaryDraftAgent}
              streamItems={secretaryStreamItems}
              pendingPermissions={EMPTY_PENDING_PERMISSIONS}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
              onSubmitClarifyAnswer={handleWorkspaceSecretaryAnswer}
            />
          </View>
        ) : isSubmitting && draftAgent ? (
          <View style={styles.streamContainer}>
            <AgentStreamView
              agentId={tabId}
              serverId={serverId}
              agent={draftAgent}
              streamItems={optimisticStreamItems}
              pendingPermissions={EMPTY_PENDING_PERMISSIONS}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
            />
          </View>
        ) : (
          <ScrollView style={styles.scrollView} contentContainerStyle={styles.configScrollContent}>
            <View style={styles.configSection}>
              {visibleFormErrorMessage ? (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{visibleFormErrorMessage}</Text>
                </View>
              ) : null}
            </View>
          </ScrollView>
        )}
      </View>

      <ReanimatedAnimated.View style={inputAreaWrapperStyle} onLayout={onInputAreaLayout}>
        {importPillPress ? (
          <View style={styles.importPillRow}>
            <View style={styles.importPillContent}>
              <ComposerImportPill onPress={importPillPress} />
            </View>
          </View>
        ) : null}
        <Composer
          agentId={tabId}
          serverId={serverId}
          externalKeyboardShift
          isPaneFocused={isPaneFocused}
          onSubmitMessage={handleWorkspaceSecretarySubmit}
          isSubmitLoading={visibleSubmitLoading}
          agentStatusOverride={composerStatusOverride}
          onCancelRunningAgent={handleWorkspaceSecretaryCancel}
          blurOnSubmit={true}
          value={draftInput.text}
          onChangeText={draftInput.setText}
          attachments={draftInput.attachments}
          attachmentScopeKeys={attachmentScopeKeys}
          onOpenWorkspaceAttachment={handleOpenWorkspaceAttachment}
          onChangeAttachments={draftInput.setAttachments}
          cwd={composerState.workingDir}
          clearDraft={draftInput.clear}
          autoFocus={shouldAutoFocusWorkspaceDraftComposer({ isPaneFocused, isSubmitting })}
          onFocusInput={handleFocusInputCallback}
          commandDraftConfig={composerState.commandDraftConfig}
          agentControls={composerAgentControls}
          isCompactLayout={isCompactComposerLayout}
        />
      </ReanimatedAnimated.View>
    </FileDropZone>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    width: "100%",
    backgroundColor: theme.colors.surface0,
  },
  contentContainer: {
    flex: 1,
  },
  streamContainer: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  configScrollContent: {
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  configSection: {
    gap: theme.spacing[3],
  },
  inputAreaWrapper: {
    width: "100%",
    backgroundColor: theme.colors.surface0,
  },
  importPillRow: {
    width: "100%",
    paddingHorizontal: theme.spacing[4],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[3],
    alignItems: "center",
  },
  importPillContent: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    flexDirection: "row",
  },
  errorContainer: {
    marginTop: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
  },
  errorText: {
    color: theme.colors.destructive,
  },
}));
