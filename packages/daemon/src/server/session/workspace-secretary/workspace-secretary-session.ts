import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SessionOutboundMessage } from "../../messages.js";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";
import type { AgentManager } from "../../agent/agent-manager.js";
import type {
  AgentPromptInput,
  AgentStreamEvent,
  AgentSessionConfig,
} from "../../agent/agent-sdk-types.js";
import type { DaemonConfigStore } from "../../daemon-config-store.js";
import {
  answerRuntimeAuthorityDecision,
  getPendingRuntimeAuthorityDecisionByCardId,
  listPendingRuntimeAuthorityDecisions,
  rejectRuntimeAuthorityDecision,
  type RuntimeAuthorityDecisionRecord,
} from "../../agent/runtime-tool-decisions.js";
import { resolveCreateAgentTitles } from "../../agent/create-agent-title.js";
import {
  BackgroundTaskModelSchema,
  RegisteredTaskModelSchema,
  WORKSPACE_SECRETARY_RELAY_ENDPOINT,
  WORKSPACE_SECRETARY_RELAY_HEALTH_URL,
  ThothCleanUiModelSchema,
  type BackgroundTaskModel,
  type LoopTaskModel,
  type RegisteredTaskModel,
  type RelayServiceStatus,
  type SecretaryClarifyAnswerPayload,
  type SecretaryRuntimeStatusKind,
  type SecretaryTopicModel,
  type SecretaryTurn,
  type ThothApprovalGoalCardModel,
  type ThothClarifyCardModel,
  type ThothCleanUiModel,
  type ThothGoalsCardModel,
  type ThothTaskCardModel,
  type WorkspaceSecretaryAnswerRequest,
  type WorkspaceSecretaryCancelRequest,
  type WorkspaceSecretaryProviderBridge,
  type WorkspaceSecretaryProviderRuntimeModel,
  type WorkspaceSecretarySendRequest,
  type WorkspaceSecretarySnapshotRequest,
  type WorkspaceSecretaryTurnActionPayload,
  type WorkspaceSecretaryTopicCreateRequest,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
import {
  type ClarifyRuntimeCode,
  type ClarifyTurnPhase,
  type ThothRuntimeClarifyStrength,
  type ThothRuntimeLoopStrength,
  type ThothRuntimeMode,
} from "@thoth/protocol/thoth-runtime-contract";
import type { AgentAttachment } from "@thoth/protocol/messages";
import {
  loadRuntimeSkillArtifact,
  mountRuntimeSkillForSession,
  type RuntimeSkillMount,
} from "@thoth/drivers/clarify";
import type { ThothLoopTaskService } from "../../thoth-loop/task-service.js";

interface WorkspaceSecretaryHost {
  emit(message: SessionOutboundMessage): void;
  listWorkspaces(): Promise<PersistedWorkspaceRecord[]>;
}

interface WorkspaceSecretarySessionOptions {
  host: WorkspaceSecretaryHost;
  agentManager: AgentManager;
  daemonConfigStore: DaemonConfigStore;
  loopTaskService?: ThothLoopTaskService | null;
  probeRelayHealth?: () => Promise<RelayServiceStatus>;
}

interface WorkspaceSecretaryState {
  model: ThothCleanUiModel;
  nextTopicIndex: number;
  currentClarifyState: ClarifyRuntimeCode;
  topicAgents: Map<string, string>;
  topicRuntimeInjectionKeys: Map<string, string>;
  topicSkillMounts: Map<string, RuntimeSkillMount>;
  userCanceledAgentIds: Set<string>;
  activeTopicProviderBacked: boolean;
  activeTurnPhase: ClarifyTurnPhase;
}

interface ProviderSessionConfig {
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

interface WorkspaceSecretaryComposerConfig {
  mode: ThothRuntimeMode;
  clarifyStrength: Exclude<ThothRuntimeClarifyStrength, "deep">;
  loop?: ThothRuntimeLoopStrength | null;
  loopStrength?: ThothRuntimeLoopStrength | null;
}

interface WorkspaceSecretaryTopicSnapshot {
  workspacePath: string;
  workspaceName: string;
  activeTopicId: string;
  topics: SecretaryTopicModel[];
  turns: SecretaryTurn[];
  nextTopicIndex: number;
  currentClarifyState: ClarifyRuntimeCode;
  activeTurnPhase: ClarifyTurnPhase;
  activeTopicProviderBacked?: boolean;
}

type WorkspaceSecretaryImageAttachment = { data: string; mimeType: string };

type ProviderRuntime =
  | { ok: true; config: ProviderSessionConfig; runtime: WorkspaceSecretaryProviderRuntimeModel }
  | { ok: false; runtime: WorkspaceSecretaryProviderRuntimeModel };

const DEV_PROVIDER_IDS = new Set(["mock", "mock-slow"]);
const CODEX_AUTH_MIRROR_FILES = ["auth.json", "config.toml"] as const;

function nowLabel(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function createStatusModel(
  kind: SecretaryRuntimeStatusKind,
  detailOverride?: string,
): ThothCleanUiModel["secretary"]["status"] {
  if (kind === "loading") {
    return {
      kind,
      title: "秘书正在等待真实 provider",
      detail: detailOverride ?? "这轮回复会在真实 provider 结果通过校验后写入历史。",
    };
  }
  if (kind === "recoverable_error") {
    return {
      kind,
      title: "真实 provider 结果没有通过",
      detail: detailOverride ?? "没有写入假回复；可以修复 provider 配置后重试。",
      actionLabel: "重新检查",
    };
  }
  if (kind === "host_unavailable") {
    return {
      kind,
      title: "本机 Thoth host 未连接",
      detail: detailOverride ?? "当前只能查看已加载内容；新的 Loop 需要 host 恢复后继续。",
      actionLabel: "重新检查",
    };
  }
  if (kind === "provider_required") {
    return {
      kind,
      title: "需要配置真实 provider",
      detail: detailOverride ?? "Workspace Secretary 不会生成本地假回复或保存待发送草稿。",
      actionLabel: "打开 Settings",
    };
  }
  if (kind === "provider_unsupported") {
    return {
      kind,
      title: "当前 provider 缺少 Thoth 结构化通道",
      detail: detailOverride ?? "需要 Thoth runtime tool bridge。",
      actionLabel: "打开 Settings",
    };
  }
  return {
    kind,
    title: "真实 provider 已连接",
    detail: detailOverride ?? "Quick 和 Loop 都会通过真实 provider 结果写入历史。",
  };
}

const WORKSPACE_SECRETARY_USER_CANCEL_SUMMARY = "已中断当前请求，可继续输入。";

function providerAgentIdsForTopic(state: WorkspaceSecretaryState, topicId: string): string[] {
  const prefix = `${topicId}:`;
  return Array.from(
    new Set(
      Array.from(state.topicAgents.entries())
        .filter(([key]) => key.startsWith(prefix))
        .map(([, agentId]) => agentId),
    ),
  );
}

function resolveCancelTopicId(
  state: WorkspaceSecretaryState,
  requestedTopicId: string | undefined,
): string {
  if (
    requestedTopicId &&
    state.model.secretary.topics.some((topic) => topic.id === requestedTopicId)
  ) {
    return requestedTopicId;
  }
  return state.model.secretary.activeTopicId;
}

function foldSubmittedAuthorityCard(
  state: WorkspaceSecretaryState,
  cardId: string,
  submittedSummary: string,
): void {
  for (const turn of state.model.secretary.turns) {
    if (
      (turn.kind === "clarify_card" || turn.kind === "task_card" || turn.kind === "goal_card") &&
      turn.card.id === cardId
    ) {
      turn.card = {
        ...turn.card,
        submitted: true,
        submittedSummary,
      };
    }
  }
}

function buildUserCancelAuthorityAnswer(
  decision: RuntimeAuthorityDecisionRecord,
  submittedSummary: string,
): WorkspaceSecretaryTurnActionPayload | null {
  const authorityCard = decision.authorityCard;
  if (authorityCard.kind === "clarify_card") {
    return {
      intent: "stop",
      question_card_id: authorityCard.card.id,
      title: authorityCard.card.title,
      answers: [],
      note: submittedSummary,
      raw_answer: submittedSummary,
    };
  }
  if (
    authorityCard.kind === "task_card" ||
    authorityCard.kind === "goals_card" ||
    authorityCard.kind === "pyramid_plan_card"
  ) {
    return {
      intent: "cancel",
      card_id: authorityCard.card.id,
      title: authorityCard.card.title,
      note: submittedSummary,
      raw_answer: submittedSummary,
    };
  }
  return null;
}

function resolvePendingAuthorityDecisionsForUserCancel(input: {
  state: WorkspaceSecretaryState;
  topicId: string;
  providerAgentIds: Set<string>;
  submittedSummary: string;
}): number {
  let resolvedCount = 0;
  for (const decision of listPendingRuntimeAuthorityDecisions()) {
    if (decision.topicId !== input.topicId && !input.providerAgentIds.has(decision.agentId)) {
      continue;
    }
    foldSubmittedAuthorityCard(input.state, decision.cardId, input.submittedSummary);
    const answer = buildUserCancelAuthorityAnswer(decision, input.submittedSummary);
    if (answer) {
      const answered = answerRuntimeAuthorityDecision({
        cardId: decision.cardId,
        answer,
        submittedSummary: input.submittedSummary,
      });
      if (answered) {
        resolvedCount += 1;
      }
      continue;
    }
    const rejected = rejectRuntimeAuthorityDecision({
      cardId: decision.cardId,
      message: input.submittedSummary,
      status: "blocked",
    });
    if (rejected) {
      resolvedCount += 1;
    }
  }
  return resolvedCount;
}

function isRelayHealthPayload(value: unknown): value is {
  status: "ok";
  protocol: "3";
  service: "thoth-relay";
} {
  if (!value || typeof value !== "object") {
    return false;
  }
  const payload = value as Record<string, unknown>;
  return payload.status === "ok" && payload.protocol === "3" && payload.service === "thoth-relay";
}

async function probeRelayHealth(): Promise<RelayServiceStatus> {
  if (typeof fetch !== "function") {
    return "unavailable";
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(WORKSPACE_SECRETARY_RELAY_HEALTH_URL, {
      method: "GET",
      signal: controller.signal,
    });
    const payload = response.ok ? await response.json() : null;
    return isRelayHealthPayload(payload) ? "healthy" : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}

function createRelayModel(status: RelayServiceStatus) {
  return {
    endpoint: WORKSPACE_SECRETARY_RELAY_ENDPOINT,
    healthUrl: WORKSPACE_SECRETARY_RELAY_HEALTH_URL,
    status,
    safeSummary:
      status === "healthy"
        ? "真实测试服务健康，未显示 token 或配对凭证"
        : status === "checking"
          ? "正在检查真实测试服务"
          : "真实测试服务暂不可用",
    checkedAtLabel: nowLabel(),
  };
}

function readProviderSessionConfig(store: DaemonConfigStore): ProviderSessionConfig | null {
  const raw = store.get().workspaceSecretary?.providerSession;
  if (!raw?.provider?.trim()) {
    return null;
  }
  return {
    provider: raw.provider.trim(),
    ...(raw.model?.trim() ? { model: raw.model.trim() } : {}),
    ...(raw.modeId?.trim() ? { modeId: raw.modeId.trim() } : {}),
    ...(raw.thinkingOptionId?.trim() ? { thinkingOptionId: raw.thinkingOptionId.trim() } : {}),
    ...(raw.featureValues ? { featureValues: raw.featureValues } : {}),
  };
}

function readComposerConfig(store: DaemonConfigStore): WorkspaceSecretaryComposerConfig {
  const raw = store.get().workspaceSecretary;
  return {
    mode: raw?.mode === "loop" ? "loop" : "quick",
    clarifyStrength:
      raw?.clarifyStrength === "none" ||
      raw?.clarifyStrength === "auto" ||
      raw?.clarifyStrength === "light" ||
      raw?.clarifyStrength === "dive"
        ? raw.clarifyStrength
        : "balanced",
    loopStrength: normalizeLoopStrength(raw?.loopStrength),
  };
}

function readRegisteredTasks(store: DaemonConfigStore): RegisteredTaskModel[] {
  const raw = store.get().workspaceSecretary?.registeredTasks;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    const parsed = RegisteredTaskModelSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function readSelectedRegisteredTaskId(store: DaemonConfigStore): string | null {
  const raw = store.get().workspaceSecretary?.selectedBackgroundTaskId;
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

function isClarifyRuntimeCode(value: unknown): value is ClarifyRuntimeCode {
  return (
    value === "C_DIRECT" ||
    value === "C_ASK" ||
    value === "C_TASK_CARD" ||
    value === "C_GOAL_CARD" ||
    value === "C_REGISTER" ||
    value === "C_REPAIR" ||
    value === "C_BLOCKED"
  );
}

function isClarifyTurnPhase(value: unknown): value is ClarifyTurnPhase {
  return (
    value === "clarify" ||
    value === "approval_task" ||
    value === "approval_breakdown" ||
    value === "quick_exec" ||
    value === "repair"
  );
}

function readTopicSnapshots(store: DaemonConfigStore): WorkspaceSecretaryTopicSnapshot[] {
  const raw = store.get().workspaceSecretary?.topicSnapshots;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    if (
      typeof record.workspacePath !== "string" ||
      typeof record.workspaceName !== "string" ||
      typeof record.activeTopicId !== "string" ||
      !Array.isArray(record.topics) ||
      !Array.isArray(record.turns) ||
      typeof record.nextTopicIndex !== "number" ||
      !Number.isInteger(record.nextTopicIndex) ||
      !isClarifyRuntimeCode(record.currentClarifyState) ||
      !isClarifyTurnPhase(record.activeTurnPhase)
    ) {
      return [];
    }
    return [
      {
        workspacePath: record.workspacePath,
        workspaceName: record.workspaceName,
        activeTopicId: record.activeTopicId,
        topics: record.topics as SecretaryTopicModel[],
        turns: record.turns as SecretaryTurn[],
        nextTopicIndex: Math.max(1, record.nextTopicIndex),
        currentClarifyState: record.currentClarifyState,
        activeTurnPhase: record.activeTurnPhase,
        activeTopicProviderBacked: record.activeTopicProviderBacked === true,
      },
    ];
  });
}

function readTopicSnapshotForWorkspace(
  store: DaemonConfigStore,
  workspacePath: string,
): WorkspaceSecretaryTopicSnapshot | null {
  const resolvedWorkspacePath = resolve(workspacePath);
  return (
    readTopicSnapshots(store).find(
      (snapshot) => resolve(snapshot.workspacePath) === resolvedWorkspacePath,
    ) ?? null
  );
}

function persistTopicSnapshot(store: DaemonConfigStore, state: WorkspaceSecretaryState): void {
  if (typeof (store as { patch?: unknown }).patch !== "function") {
    return;
  }
  const snapshot: WorkspaceSecretaryTopicSnapshot = {
    workspacePath: state.model.secretary.workspacePath,
    workspaceName: state.model.secretary.workspaceName,
    activeTopicId: state.model.secretary.activeTopicId,
    topics: state.model.secretary.topics,
    turns: state.model.secretary.turns,
    nextTopicIndex: state.nextTopicIndex,
    currentClarifyState: state.currentClarifyState,
    activeTurnPhase: state.activeTurnPhase,
    activeTopicProviderBacked: state.activeTopicProviderBacked,
  };
  const snapshots = [
    ...readTopicSnapshots(store).filter(
      (entry) => resolve(entry.workspacePath) !== resolve(snapshot.workspacePath),
    ),
    snapshot,
  ];
  store.patch({
    workspaceSecretary: {
      topicSnapshots: snapshots,
    },
  });
}

function normalizeLoopStrength(value: unknown): ThothRuntimeLoopStrength | null {
  return value === "one_plan_one_do" ||
    value === "light" ||
    value === "balanced" ||
    value === "run_until_stopped"
    ? value
    : null;
}

function loopStrengthForComposer(config: WorkspaceSecretaryComposerConfig) {
  if (config.mode !== "loop") {
    return null;
  }
  return normalizeLoopStrength(config.loopStrength ?? config.loop) ?? "one_plan_one_do";
}

function applyComposerConfig(
  state: WorkspaceSecretaryState,
  config: WorkspaceSecretaryComposerConfig,
) {
  state.model.secretary.composer = {
    ...state.model.secretary.composer,
    mode: config.mode,
    clarifyStrength: config.clarifyStrength,
    loop: loopStrengthForComposer(config),
  };
}

function isQuickNoneForeground(config: WorkspaceSecretaryComposerConfig): boolean {
  return config.mode === "quick" && config.clarifyStrength === "none";
}

function providerSafeLabel(config: ProviderSessionConfig): string {
  return [config.provider, config.model].filter(Boolean).join(" / ");
}

function createProviderRuntime(input: {
  configured: boolean;
  ready: boolean;
  state: WorkspaceSecretaryProviderRuntimeModel["state"];
  safeLabel: string;
  detail: string;
  bridge?: WorkspaceSecretaryProviderBridge;
  config?: ProviderSessionConfig;
}): WorkspaceSecretaryProviderRuntimeModel {
  return {
    configured: input.configured,
    ready: input.ready,
    state: input.state,
    safeLabel: input.safeLabel,
    detail: input.detail,
    ...(input.bridge ? { bridge: input.bridge } : {}),
    ...(input.config?.provider ? { provider: input.config.provider } : {}),
    ...(input.config?.model ? { model: input.config.model } : {}),
    ...(input.config?.modeId ? { mode: input.config.modeId } : {}),
  };
}

function resolveProviderBridge(config: ProviderSessionConfig) {
  if (config.provider === "codex") {
    return "runtime_tool" as const;
  }
  return "unsupported" as const;
}

function runtimeStatusKind(runtime: WorkspaceSecretaryProviderRuntimeModel) {
  if (runtime.state === "not_configured") {
    return "provider_required" as const;
  }
  if (runtime.state === "unsupported") {
    return "provider_unsupported" as const;
  }
  if (runtime.state === "error") {
    return "recoverable_error" as const;
  }
  return "ready" as const;
}

const CLARIFY_MATERIAL_FRONTIER_CATEGORIES = [
  "target_environment_and_runtime",
  "delivery_shape_and_integration_boundary",
  "api_data_contract_and_error_behavior",
  "correctness_acceptance_and_edge_cases",
  "performance_quality_scale_or_benchmark_baseline",
  "resource_memory_concurrency_portability_and_safety",
  "testing_evidence_docs_and_comparison_baseline",
  "user_owned_tradeoffs",
] as const;

const GENERIC_WORKSPACE_SECRETARY_TOPIC_TITLES =
  /^(当前话题|话题\s+\d+|current topic|topic\s+\d+)$/i;

function deriveWorkspaceSecretaryTopicTitle(text: string): string | null {
  return resolveCreateAgentTitles({ initialPrompt: text }).provisionalTitle;
}

function updateActiveTopicTitleFromUserInput(
  state: WorkspaceSecretaryState,
  text: string,
): boolean {
  const title = deriveWorkspaceSecretaryTopicTitle(text);
  if (!title) {
    return false;
  }
  let changed = false;
  state.model.secretary.topics = state.model.secretary.topics.map((topic) => {
    if (topic.id !== state.model.secretary.activeTopicId) {
      return topic;
    }
    if (!GENERIC_WORKSPACE_SECRETARY_TOPIC_TITLES.test(topic.title.trim())) {
      return topic;
    }
    changed = true;
    return { ...topic, title };
  });
  return changed;
}

function clarifyBelowSoftTargetPolicy(input: {
  strength: Exclude<ThothRuntimeClarifyStrength, "deep">;
  cardCount: number;
  softRange: { min: number | null; max: number | null };
}): string {
  if (!input.softRange.min || input.cardCount >= input.softRange.min) {
    return "at_or_above_soft_minimum: submit Task only when the frontier ledger has no remaining material user-owned assumptions.";
  }
  if (input.strength === "balanced" || input.strength === "dive") {
    return [
      `below_soft_minimum: ${input.strength} has ${input.cardCount}/${input.softRange.min} Clarify cards.`,
      "Normally call thoth_submit_clarify_card and expand the next material frontier.",
      "thoth_submit_task_card is exceptional before the soft minimum: use it only after explicit user stop, a genuinely trivial request, or category-by-category proof that every remaining material frontier is grounded, agent-owned, discoverable, or standard practice.",
      "Do not use a generic below_soft_target_rationale as a shortcut.",
    ].join(" ");
  }
  return "no_soft_minimum_for_current_strength.";
}

function runtimeContextPrompt(input: {
  bridge: WorkspaceSecretaryProviderBridge;
  state: WorkspaceSecretaryState;
  skillMount: RuntimeSkillMount;
}): string {
  const clarifyCards = clarifyCardTurns(input.state);
  const strength = input.state.model.secretary.composer.clarifyStrength;
  const softRange = clarifySoftRange(strength);
  const latestLedger = latestClarifyCard(input.state)?.frontierLedger;
  const belowSoftTargetPolicy = clarifyBelowSoftTargetPolicy({
    strength,
    cardCount: clarifyCards.length,
    softRange,
  });
  return [
    "Thoth structured Workspace Secretary turn.",
    `mode: ${input.state.model.secretary.composer.mode}`,
    `clarify_strength: ${strength}`,
    `turn_phase: ${input.state.activeTurnPhase}`,
    `current_state: ${input.state.currentClarifyState}`,
    `clarify_card_count: ${clarifyCards.length}`,
    `clarify_soft_range: ${softRange.min ?? "none"}-${softRange.max ?? "none"}`,
    `clarify_below_soft_target_policy: ${belowSoftTargetPolicy}`,
    `material_frontier_categories: ${CLARIFY_MATERIAL_FRONTIER_CATEGORIES.join(", ")}`,
    `latest_frontier_ledger: ${latestLedger ? JSON.stringify(latestLedger) : "none"}`,
    `skill_ref: ${input.skillMount.skillRef.id} ${input.skillMount.skillRef.digest}`,
    `skill_mount: session_scoped ${input.skillMount.mountedPath}`,
    `required_next_runtime_tool: ${resolveRequiredRuntimeTool(input.state)}`,
    "skill_sections: Runtime Tools, Runtime Context, Clarify Strength, Assumption Ownership, Clarify Cards, Task Card, Goals Card, Transition Rules, Loop And Quick Handoff, Repair",
    "runtime_tools: thoth_submit_clarify_card, thoth_submit_task_card, thoth_submit_goals_card, thoth_report_blocked",
    "Use the loaded session-scoped Skill as the behavior authority. Treat required_next_runtime_tool as daemon phase context, then call the matching semantic Thoth runtime tool for this structured decision point.",
  ].join("\n\n");
}

function resolveRequiredRuntimeTool(state: WorkspaceSecretaryState): string {
  if (state.activeTurnPhase === "approval_task" || state.currentClarifyState === "C_TASK_CARD") {
    return "thoth_submit_goals_card";
  }
  if (state.activeTurnPhase === "clarify") {
    return "thoth_submit_clarify_card_or_thoth_submit_task_card";
  }
  if (state.activeTurnPhase === "approval_breakdown") {
    return "await_user_approval_result";
  }
  if (state.activeTurnPhase === "repair") {
    return "repair_with_one_semantic_thoth_tool";
  }
  return "none";
}

function resolveStructuredCompletionError(state: WorkspaceSecretaryState): string | null {
  if (state.activeTurnPhase === "quick_exec") {
    return null;
  }
  if (state.activeTurnPhase === "approval_task" || state.currentClarifyState === "C_TASK_CARD") {
    return "Task Card 已确认，但真实 provider 回合结束前没有提交 Goals Card。";
  }
  if (
    state.activeTurnPhase === "approval_breakdown" ||
    state.currentClarifyState === "C_GOAL_CARD"
  ) {
    return "Goals Card 审批回合结束前没有产生可验证的下一步结果。";
  }
  if (state.activeTurnPhase === "clarify" || state.currentClarifyState === "C_ASK") {
    return "Clarify 结构化回合结束前没有提交新的 Clarify card、Task Card 或阻塞状态。";
  }
  if (state.activeTurnPhase === "repair" || state.currentClarifyState === "C_REPAIR") {
    return "Clarify repair 回合结束前没有提交修复后的 authority card。";
  }
  return "结构化 provider 回合结束前没有提交 Thoth runtime authority card。";
}

function buildProviderPrompt(
  text: string,
  images?: WorkspaceSecretaryImageAttachment[],
  attachments?: AgentAttachment[],
): AgentPromptInput {
  const normalized = text.trim();
  const hasImages = (images?.length ?? 0) > 0;
  const hasAttachments = (attachments?.length ?? 0) > 0;
  if (!hasImages && !hasAttachments) {
    return normalized;
  }
  const blocks: Exclude<AgentPromptInput, string> = [];
  if (normalized.length > 0) {
    blocks.push({ type: "text", text: normalized });
  }
  for (const image of images ?? []) {
    blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  for (const attachment of attachments ?? []) {
    blocks.push(attachment);
  }
  return blocks;
}

function buildStructuredProviderPrompt(input: {
  state: WorkspaceSecretaryState;
  runtime: WorkspaceSecretaryProviderRuntimeModel;
  envelopeText: string;
  skillMount: RuntimeSkillMount;
  images?: WorkspaceSecretaryImageAttachment[];
  attachments?: AgentAttachment[];
}): AgentPromptInput {
  const topicId = input.state.model.secretary.activeTopicId;
  const bridge = input.runtime.bridge ?? "runtime_tool";
  const runtimeKey = [
    input.state.model.secretary.composer.mode,
    input.state.model.secretary.composer.clarifyStrength,
    input.state.activeTurnPhase,
    bridge,
  ].join(":");
  const previousKey = input.state.topicRuntimeInjectionKeys.get(topicId);
  input.state.topicRuntimeInjectionKeys.set(topicId, runtimeKey);
  const text =
    previousKey === runtimeKey
      ? input.envelopeText
      : [
          runtimeContextPrompt({
            bridge,
            state: input.state,
            skillMount: input.skillMount,
          }),
          "Runtime context follows.",
          input.envelopeText,
        ].join("\n\n");
  return buildProviderPrompt(text, input.images, input.attachments);
}

function defaultCodexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

function mirrorCodexAuthFile(input: {
  sourceHome: string;
  targetHome: string;
  fileName: string;
}): void {
  const source = join(input.sourceHome, input.fileName);
  const target = join(input.targetHome, input.fileName);
  if (!existsSync(source) || existsSync(target)) {
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  try {
    symlinkSync(source, target);
  } catch {
    copyFileSync(source, target);
  }
}

function prepareCodexSessionHome(input: { thothHome: string; topicId: string }): string {
  const providerSessionHome = resolve(input.thothHome, "provider-sessions", input.topicId);
  mkdirSync(providerSessionHome, { recursive: true });
  const sourceHome = defaultCodexHome();
  for (const fileName of CODEX_AUTH_MIRROR_FILES) {
    mirrorCodexAuthFile({ sourceHome, targetHome: providerSessionHome, fileName });
  }
  return providerSessionHome;
}

function mountClarifySkillForTopic(input: {
  state: WorkspaceSecretaryState;
  thothHome: string;
  topicId: string;
}): RuntimeSkillMount {
  const existing = input.state.topicSkillMounts.get(input.topicId);
  if (existing) {
    return existing;
  }
  const artifact = loadRuntimeSkillArtifact("thoth.clarify");
  const mount = mountRuntimeSkillForSession({
    artifact,
    thothSessionHome: input.thothHome,
    sessionId: input.topicId,
  });
  input.state.topicSkillMounts.set(input.topicId, mount);
  return mount;
}

function renderTranscript(turns: SecretaryTurn[]): string {
  return turns
    .map((turn) => {
      if (turn.kind === "message") {
        return `${turn.speaker}: ${turn.text}`;
      }
      if (turn.kind === "clarify_card") {
        return `clarify_card:${turn.card.title}:${turn.card.submitted ? "submitted" : "open"}`;
      }
      if (turn.kind === "task_card") {
        return `task_card:${turn.card.title}:${turn.card.submitted ? "submitted" : "open"}`;
      }
      if (turn.kind === "goal_card") {
        return `goal_card:${turn.card.title}:${turn.card.submitted ? "submitted" : "open"}`;
      }
      return `registered_task:${turn.task.title}:${turn.task.status}`;
    })
    .join("\n");
}

function renderTaskCardForProvider(card: ThothTaskCardModel): string {
  return [
    `title: ${card.title}`,
    `goal: ${card.goal}`,
    `constraints:\n${card.constraints.map((item) => `- ${item}`).join("\n")}`,
    `acceptance:\n${card.acceptance.map((item) => `- ${item}`).join("\n")}`,
  ].join("\n");
}

function renderGoalCardForProvider(card: ThothApprovalGoalCardModel): string {
  if ("goals" in card) {
    return [
      `title: ${card.title}`,
      `summary: ${card.summary}`,
      "linear goals:",
      ...card.goals.map((goal) =>
        [
          `${goal.order}. ${goal.title}`,
          `goal: ${goal.goal}`,
          `constraints: ${goal.constraints.join("；")}`,
          `acceptance: ${goal.acceptance.join("；")}`,
        ].join("\n"),
      ),
    ].join("\n");
  }
  return [
    `title: ${card.title}`,
    `summary: ${card.summary}`,
    "pyramid plan:",
    ...card.pyramid.flatMap((stage, index) => [
      `${index + 1}. ${stage.title}`,
      `goal: ${stage.goal}`,
      `acceptance: ${stage.acceptance.join("；")}`,
      ...stage.subgoals.flatMap((subgoal, subgoalIndex) => [
        `${index + 1}.${subgoalIndex + 1}. ${subgoal.title}`,
        `goal: ${subgoal.goal}`,
        `acceptance: ${subgoal.acceptance.join("；")}`,
      ]),
    ]),
  ].join("\n");
}

function latestTaskCardTurn(
  state: WorkspaceSecretaryState,
): Extract<SecretaryTurn, { kind: "task_card" }> | null {
  return (
    [...state.model.secretary.turns]
      .reverse()
      .find(
        (turn): turn is Extract<SecretaryTurn, { kind: "task_card" }> => turn.kind === "task_card",
      ) ?? null
  );
}

function latestGoalCardTurn(
  state: WorkspaceSecretaryState,
): Extract<SecretaryTurn, { kind: "goal_card" }> | null {
  return (
    [...state.model.secretary.turns]
      .reverse()
      .find(
        (turn): turn is Extract<SecretaryTurn, { kind: "goal_card" }> => turn.kind === "goal_card",
      ) ?? null
  );
}

function clarifyCardTurns(
  state: WorkspaceSecretaryState,
): Array<Extract<SecretaryTurn, { kind: "clarify_card" }>> {
  return state.model.secretary.turns.filter(
    (turn): turn is Extract<SecretaryTurn, { kind: "clarify_card" }> =>
      turn.kind === "clarify_card",
  );
}

function latestClarifyCard(state: WorkspaceSecretaryState): ThothClarifyCardModel | null {
  return clarifyCardTurns(state).at(-1)?.card ?? null;
}

function clarifySoftRange(strength: Exclude<ThothRuntimeClarifyStrength, "deep">): {
  min: number | null;
  max: number | null;
} {
  if (strength === "balanced") {
    return { min: 5, max: 10 };
  }
  if (strength === "dive") {
    return { min: 10, max: 20 };
  }
  if (strength === "light") {
    return { min: 1, max: 1 };
  }
  return { min: null, max: null };
}

function limitText(value: string | null | undefined, max = 200): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^[\[{]/.test(trimmed)) {
    return undefined;
  }
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

function toSafeRuntimeErrorMessage(message: string): string {
  if (
    /schema|json|packet|submit_runtime_packet|submit_clarify_packet|structured output|question request/i.test(
      message,
    )
  ) {
    return "真实 provider 结果没有通过 Thoth 的安全检查。";
  }
  if (/permission or approval request/i.test(message)) {
    return "当前 provider 回合转成了不受支持的权限请求。";
  }
  return limitText(message, 160) ?? "真实 provider 回合没有成功完成。";
}

function registeredTaskToBackgroundTask(task: RegisteredTaskModel): BackgroundTaskModel {
  return BackgroundTaskModelSchema.parse({
    id: task.id,
    title: task.title,
    status: "registered_pending",
    summary: task.summary,
    workspaceName: task.workspaceName,
    sourceTopicId: task.sourceTopicId,
    detailLabel: "查看合同",
  });
}

function applyRegisteredTasksToModel(
  state: WorkspaceSecretaryState,
  tasks: RegisteredTaskModel[],
  selectedTaskId: string | null,
): void {
  state.model.backgroundTasks = {
    tasks:
      tasks.length > 0
        ? tasks.map((task) => registeredTaskToBackgroundTask(task))
        : [
            {
              id: "empty",
              title: "还没有后台任务",
              status: "empty",
              summary: "Loop 会在任务合同确认后出现在这里。",
            },
          ],
    selectedTaskId,
    detail: tasks.find((task) => task.id === selectedTaskId) ?? null,
  };
}

function applyLoopTasksToModel(
  state: WorkspaceSecretaryState,
  loopTaskService: ThothLoopTaskService | null | undefined,
  selectedTaskId?: string | null,
): void {
  if (!loopTaskService) {
    return;
  }
  const tasks = loopTaskService.list({ workspacePath: state.model.secretary.workspacePath });
  const selected =
    selectedTaskId ??
    state.model.backgroundTasks.selectedTaskId ??
    tasks.find((task) => task.id !== "empty")?.id ??
    null;
  const detail = selected && selected !== "empty" ? loopTaskService.inspect(selected) : null;
  state.model.backgroundTasks = {
    tasks,
    selectedTaskId: selected,
    detail,
  };
}

function summarizeSubmittedAnswer(payload: WorkspaceSecretaryTurnActionPayload): string {
  if (
    payload.intent === "accept_quick" ||
    payload.intent === "accept_loop" ||
    payload.intent === "annotate" ||
    payload.intent === "cancel"
  ) {
    if (payload.intent === "accept_quick") {
      return "已确认并按 Quick 前台执行";
    }
    if (payload.intent === "accept_loop") {
      return "已确认并注册后台任务";
    }
    if (payload.intent === "annotate") {
      return "已提交批注并请求秘书修订";
    }
    return "已取消这轮审批";
  }
  const clarifyPayload = payload as SecretaryClarifyAnswerPayload;
  if (clarifyPayload.intent === "recommend") {
    return "已请秘书推荐分支";
  }
  if (clarifyPayload.intent === "decide") {
    return "已授权秘书决定分支";
  }
  if (clarifyPayload.intent === "stop") {
    return "已暂停继续询问";
  }
  if (clarifyPayload.intent === "note_only") {
    return clarifyPayload.note ? `已补充 note：${clarifyPayload.note}` : "已补充 note";
  }
  const selectedCount = clarifyPayload.answers.reduce(
    (count, answer) => count + answer.choice_ids.length,
    0,
  );
  return `已确认 ${selectedCount} 个分支维度`;
}

function clarifyQuestionItems(card: ThothClarifyCardModel["card"]) {
  if ("questions" in card) {
    return card.questions;
  }
  return [
    {
      id: card.question_id,
      selection_mode: "single" as const,
    },
  ];
}

function validateClarifyAnswerForCard(input: {
  card: ThothClarifyCardModel;
  answer: WorkspaceSecretaryTurnActionPayload;
}): string | null {
  if (!("answers" in input.answer)) {
    return null;
  }
  const questionModeById = new Map(
    clarifyQuestionItems(input.card.card).map((question) => [
      question.id,
      question.selection_mode ?? "single",
    ]),
  );
  for (const answer of input.answer.answers) {
    if (questionModeById.get(answer.question_id) === "single" && answer.choice_ids.length > 1) {
      return "单选问题只能提交一个选项；请调整后再提交。";
    }
  }
  return null;
}

function createInitialModel(input: {
  workspaceName: string;
  workspacePath: string;
  composer: WorkspaceSecretaryComposerConfig;
  registeredTasks?: RegisteredTaskModel[];
  selectedTaskId?: string | null;
}): ThothCleanUiModel {
  const providerRuntime = createProviderRuntime({
    configured: false,
    ready: false,
    state: "not_configured",
    safeLabel: "未配置",
    detail: "需要在 Settings 选择真实 provider。",
  });
  return {
    authority: {
      source: "daemon_clean_ui_model",
      schemaVerified: true,
      label: "Daemon Workspace Secretary clean UI model",
    },
    activeView: "workspace-secretary",
    secretary: {
      workspaceName: input.workspaceName,
      workspacePath: input.workspacePath,
      activeTopicId: "topic-main",
      status: createStatusModel("provider_required"),
      provider: providerRuntime,
      topics: [
        {
          id: "topic-main",
          title: "当前话题",
          status: "current",
          updatedLabel: "刚刚",
        },
      ],
      turns: [],
      composer: {
        mode: input.composer.mode,
        clarifyStrength: input.composer.clarifyStrength,
        loop: loopStrengthForComposer(input.composer),
        authorityLabel: "需要真实 provider",
        authorityReady: false,
        disabledReason: "需要先在 Settings 配置真实 provider",
      },
    },
    settings: {
      runtime: [],
      relay: createRelayModel("checking"),
      requiredRuntime: [
        {
          id: "clarify-secretary",
          title: "Clarify secretary",
          value: "必需，不能关闭",
          locked: true,
        },
        {
          id: "loop-runner",
          title: "Loop runner",
          value: "必需，不能关闭",
          locked: true,
        },
      ],
      workspaceSecretaryProvider: providerRuntime,
    },
    backgroundTasks: {
      tasks:
        input.registeredTasks && input.registeredTasks.length > 0
          ? input.registeredTasks.map((task) => registeredTaskToBackgroundTask(task))
          : [
              {
                id: "empty",
                title: "还没有后台任务",
                status: "empty",
                summary: "Loop 会在任务合同确认后出现在这里。",
              },
            ],
      selectedTaskId: input.selectedTaskId ?? null,
      detail:
        input.registeredTasks?.find((task) => task.id === (input.selectedTaskId ?? null)) ?? null,
    },
  };
}

function withSchemaVerifiedModel(model: ThothCleanUiModel): ThothCleanUiModel {
  return ThothCleanUiModelSchema.parse(model);
}

export class WorkspaceSecretarySession {
  private state: WorkspaceSecretaryState | null = null;

  constructor(private readonly options: WorkspaceSecretarySessionOptions) {}

  async handleSnapshotRequest(request: WorkspaceSecretarySnapshotRequest): Promise<void> {
    await this.emitResponse("workspace_secretary.snapshot.response", request.requestId, () =>
      this.ensureState(request),
    );
  }

  async handleSendRequest(request: WorkspaceSecretarySendRequest): Promise<void> {
    await this.emitResponse("workspace_secretary.send.response", request.requestId, async () => {
      const state = await this.ensureState();
      const provider = await this.resolveProviderRuntime();
      if (!provider.ok) {
        state.model.secretary.status = createStatusModel(
          runtimeStatusKind(provider.runtime),
          provider.runtime.detail,
        );
        return state;
      }

      const userTurn: SecretaryTurn = {
        id: `user-${randomUUID()}`,
        kind: "message",
        speaker: "user",
        text: request.text,
      };
      state.model.secretary.turns.push(userTurn);
      updateActiveTopicTitleFromUserInput(state, request.text);
      state.model.secretary.composer = request.composer;
      state.activeTurnPhase = isQuickNoneForeground(request.composer) ? "quick_exec" : "clarify";
      this.applyResolvedRuntime(state, provider.runtime);
      state.model.secretary.status = createStatusModel("loading");

      await this.startProviderTurnInBackground({
        state,
        provider: provider.config,
        runtime: isQuickNoneForeground(request.composer) ? null : provider.runtime,
        userInput: request.text,
        answer: null,
        messageId: request.messageId,
        images: request.images,
        attachments: request.attachments,
        uiAgentId: request.uiAgentId,
      });
      this.emitModelUpdate(state, "provider_turn_started");
      return state;
    });
  }

  async handleAnswerRequest(request: WorkspaceSecretaryAnswerRequest): Promise<void> {
    await this.emitResponse("workspace_secretary.answer.response", request.requestId, async () => {
      const state = await this.ensureState();
      const targetTurn = state.model.secretary.turns.find(
        (
          turn,
        ): turn is
          | Extract<SecretaryTurn, { kind: "clarify_card" }>
          | Extract<SecretaryTurn, { kind: "task_card" }>
          | Extract<SecretaryTurn, { kind: "goal_card" }> =>
          (turn.kind === "clarify_card" ||
            turn.kind === "task_card" ||
            turn.kind === "goal_card") &&
          turn.card.id === request.cardId,
      );
      if (!targetTurn) {
        state.model.secretary.status = createStatusModel(
          "recoverable_error",
          "没有找到要提交的 Clarify card；没有生成本地补救卡。",
        );
        return state;
      }

      const provider = await this.resolveProviderRuntime();
      if (!provider.ok) {
        state.model.secretary.status = createStatusModel(
          runtimeStatusKind(provider.runtime),
          provider.runtime.detail,
        );
        return state;
      }
      this.applyResolvedRuntime(state, provider.runtime);

      const pendingDecision = getPendingRuntimeAuthorityDecisionByCardId(request.cardId);
      if (!pendingDecision) {
        state.model.secretary.status = createStatusModel(
          "recoverable_error",
          "这张卡片没有可恢复的 provider runtime decision；没有执行本地兜底。",
        );
        return state;
      }

      if (targetTurn.kind === "clarify_card") {
        const validationError = validateClarifyAnswerForCard({
          card: targetTurn.card,
          answer: request.answer,
        });
        if (validationError) {
          state.model.secretary.status = createStatusModel("recoverable_error", validationError);
          return state;
        }
      }

      const submittedSummary = summarizeSubmittedAnswer(request.answer);
      targetTurn.card = {
        ...targetTurn.card,
        submitted: true,
        submittedSummary,
      };

      state.activeTurnPhase =
        targetTurn.kind === "clarify_card"
          ? "clarify"
          : targetTurn.kind === "task_card"
            ? "approval_task"
            : "approval_breakdown";

      let loopTask: LoopTaskModel | undefined;
      if (
        targetTurn.kind === "goal_card" &&
        "intent" in request.answer &&
        request.answer.intent === "accept_loop"
      ) {
        const taskTurn = latestTaskCardTurn(state);
        if (taskTurn && "goals" in targetTurn.card && this.options.loopTaskService) {
          const loopStrength =
            normalizeLoopStrength(state.model.secretary.composer.loop) ?? "one_plan_one_do";
          loopTask = await this.options.loopTaskService.register({
            workspaceName: state.model.secretary.workspaceName,
            workspacePath: state.model.secretary.workspacePath,
            sourceTopicId: state.model.secretary.activeTopicId,
            taskCard: taskTurn.card,
            goalsCard: targetTurn.card as ThothGoalsCardModel,
            clarifyTranscript: renderTranscript(state.model.secretary.turns),
            loopStrength,
            provider: provider.config,
          });
          state.model.backgroundTasks = {
            tasks: this.options.loopTaskService.list({
              workspacePath: state.model.secretary.workspacePath,
            }),
            selectedTaskId: loopTask.id,
            detail: null,
          };
          this.emitMirroredAgentStream(request.uiAgentId, {
            type: "timeline",
            provider: provider.config.provider,
            item: {
              type: "assistant_message",
              text: `后台任务已注册并开始排队：${loopTask.title}`,
            },
          });
        } else {
          const detail =
            "当前 host 缺少真实 Loop background runtime，无法把 Goals Card 降级成旧 registered_pending。";
          state.model.secretary.status = createStatusModel("provider_unsupported", detail);
          this.emitMirroredAgentStream(request.uiAgentId, {
            type: "timeline",
            provider: provider.config.provider,
            item: {
              type: "assistant_message",
              text: detail,
            },
          });
        }
        if (loopTask) {
          state.model.secretary.composer = {
            ...state.model.secretary.composer,
            mode: "quick",
            loop: null,
          };
          state.activeTurnPhase = "quick_exec";
          state.currentClarifyState = "C_DIRECT";
        } else {
          state.activeTurnPhase = "repair";
          state.currentClarifyState = "C_BLOCKED";
        }
      }

      if (
        targetTurn.kind === "goal_card" &&
        "intent" in request.answer &&
        request.answer.intent === "accept_quick"
      ) {
        state.model.secretary.composer = {
          ...state.model.secretary.composer,
          mode: "quick",
          loop: null,
        };
        state.activeTurnPhase = "quick_exec";
        state.currentClarifyState = "C_DIRECT";
      }

      const answered = answerRuntimeAuthorityDecision({
        cardId: request.cardId,
        answer: request.answer,
        submittedSummary,
      });
      if (!answered) {
        state.model.secretary.status = createStatusModel(
          "recoverable_error",
          "provider runtime decision 已经结束；没有重复提交。",
        );
        return state;
      }

      state.activeTopicProviderBacked = true;
      state.model.secretary.status = createStatusModel(
        "ready",
        "已提交给真实 provider，后续会在同一 timeline 继续。",
      );
      this.emitModelUpdate(state, "provider_progress");
      persistTopicSnapshot(this.options.daemonConfigStore, state);
      return state;
    });
  }

  async handleCancelRequest(request: WorkspaceSecretaryCancelRequest): Promise<void> {
    await this.emitResponse("workspace_secretary.cancel.response", request.requestId, async () => {
      const state = await this.ensureState();
      const topicId = resolveCancelTopicId(state, request.topicId);
      const providerAgentIds = new Set(providerAgentIdsForTopic(state, topicId));

      resolvePendingAuthorityDecisionsForUserCancel({
        state,
        topicId,
        providerAgentIds,
        submittedSummary: WORKSPACE_SECRETARY_USER_CANCEL_SUMMARY,
      });

      for (const agentId of providerAgentIds) {
        state.userCanceledAgentIds.add(agentId);
        await this.options.agentManager.cancelAgentRun(agentId).catch(() => false);
      }

      state.model.secretary.status = createStatusModel(
        "ready",
        WORKSPACE_SECRETARY_USER_CANCEL_SUMMARY,
      );
      this.emitModelUpdate(state, "provider_progress");
      persistTopicSnapshot(this.options.daemonConfigStore, state);
      return state;
    });
  }

  async handleTopicCreateRequest(request: WorkspaceSecretaryTopicCreateRequest): Promise<void> {
    await this.emitResponse(
      "workspace_secretary.topic.create.response",
      request.requestId,
      async () => {
        const state = await this.ensureState();
        const workspace = await this.resolveWorkspaceIdentity(request);
        state.model.secretary.workspaceName = workspace.workspaceName;
        state.model.secretary.workspacePath = workspace.workspacePath;
        const provider = await this.resolveProviderRuntime();
        if (!provider.ok) {
          state.model.secretary.status = createStatusModel(
            runtimeStatusKind(provider.runtime),
            provider.runtime.detail,
          );
          return state;
        }
        const topicId = `topic-${randomUUID()}`;
        state.nextTopicIndex += 1;
        state.currentClarifyState = "C_DIRECT";
        state.activeTopicProviderBacked = false;
        const composerConfig = readComposerConfig(this.options.daemonConfigStore);
        state.model.secretary.activeTopicId = topicId;
        state.model.secretary.status = createStatusModel("ready");
        state.model.secretary.topics = [
          {
            id: topicId,
            title: `话题 ${state.nextTopicIndex}`,
            status: "current",
            updatedLabel: "刚刚",
          },
          ...state.model.secretary.topics.map((topic) => ({
            ...topic,
            status: "quiet" as const,
          })),
        ];
        state.model.secretary.turns = [];
        applyComposerConfig(state, composerConfig);
        return state;
      },
    );
  }

  private async ensureState(request?: {
    workspaceId?: string;
    workspacePath?: string;
    workspaceName?: string;
  }): Promise<WorkspaceSecretaryState> {
    if (this.state && request?.workspacePath) {
      if (resolve(this.state.model.secretary.workspacePath) !== resolve(request.workspacePath)) {
        this.state = null;
      }
    }
    if (this.state && request?.workspaceId) {
      const requestedWorkspace = (await this.resolveWorkspaceIdentity(request)).workspacePath;
      if (resolve(this.state.model.secretary.workspacePath) !== resolve(requestedWorkspace)) {
        this.state = null;
      }
    }
    if (this.state) {
      return this.state;
    }
    const workspace = await this.resolveWorkspaceIdentity(request);
    const composer = readComposerConfig(this.options.daemonConfigStore);
    const model = createInitialModel({
      ...workspace,
      composer,
      registeredTasks: readRegisteredTasks(this.options.daemonConfigStore),
      selectedTaskId: readSelectedRegisteredTaskId(this.options.daemonConfigStore),
    });
    const persistedTopic = readTopicSnapshotForWorkspace(
      this.options.daemonConfigStore,
      workspace.workspacePath,
    );
    if (persistedTopic) {
      model.secretary.workspaceName = persistedTopic.workspaceName;
      model.secretary.workspacePath = persistedTopic.workspacePath;
      model.secretary.activeTopicId = persistedTopic.activeTopicId;
      model.secretary.topics = persistedTopic.topics.map((topic) => ({
        ...topic,
        status: topic.id === persistedTopic.activeTopicId ? "current" : "quiet",
      }));
      model.secretary.turns = persistedTopic.turns;
      model.secretary.status = createStatusModel("ready");
    }
    this.state = {
      model: withSchemaVerifiedModel(model),
      nextTopicIndex: 1,
      currentClarifyState: "C_DIRECT",
      topicAgents: new Map(),
      topicRuntimeInjectionKeys: new Map(),
      topicSkillMounts: new Map(),
      userCanceledAgentIds: new Set(),
      activeTopicProviderBacked: false,
      activeTurnPhase: "clarify",
    };
    if (persistedTopic) {
      this.state.nextTopicIndex = persistedTopic.nextTopicIndex;
      this.state.currentClarifyState = persistedTopic.currentClarifyState;
      this.state.activeTopicProviderBacked = persistedTopic.activeTopicProviderBacked === true;
      this.state.activeTurnPhase = persistedTopic.activeTurnPhase;
    }
    applyComposerConfig(this.state, readComposerConfig(this.options.daemonConfigStore));
    return this.state;
  }

  private emitModelUpdate(
    state: WorkspaceSecretaryState,
    reason:
      | "provider_turn_started"
      | "provider_progress"
      | "provider_reply_delta"
      | "provider_turn_completed"
      | "provider_blocked"
      | "provider_error",
  ): void {
    this.options.host.emit({
      type: "workspace_secretary.model.update",
      payload: {
        model: withSchemaVerifiedModel(state.model),
        reason,
      },
    });
  }

  private applyResolvedRuntime(
    state: WorkspaceSecretaryState,
    runtime: WorkspaceSecretaryProviderRuntimeModel,
  ): void {
    state.model.secretary.provider = runtime;
    state.model.settings.workspaceSecretaryProvider = runtime;
    const composerWithoutDisabledReason = { ...state.model.secretary.composer };
    delete composerWithoutDisabledReason.disabledReason;
    state.model.secretary.composer = {
      ...composerWithoutDisabledReason,
      authorityReady: runtime.ready,
      authorityLabel: runtime.ready ? runtime.safeLabel : "需要真实 provider",
      ...(runtime.ready ? {} : { disabledReason: runtime.detail }),
    };
    state.model.settings.runtime = [
      {
        id: "workspace-secretary-provider",
        title: "Workspace Secretary provider",
        value: runtime.safeLabel,
      },
      {
        id: "workspace-secretary-bridge",
        title: "Structured channel",
        value: runtime.bridge ?? "not configured",
      },
      {
        id: "diagnostics",
        title: "Diagnostics",
        value: runtime.detail,
      },
    ];
  }

  private async resolveProviderRuntime(): Promise<ProviderRuntime> {
    const config = readProviderSessionConfig(this.options.daemonConfigStore);
    if (!config) {
      return {
        ok: false,
        runtime: createProviderRuntime({
          configured: false,
          ready: false,
          state: "not_configured",
          safeLabel: "未配置",
          detail: "Settings 需要选择真实 provider；Workspace Secretary 不会生成本地假回复。",
        }),
      };
    }

    if (DEV_PROVIDER_IDS.has(config.provider)) {
      return {
        ok: false,
        runtime: createProviderRuntime({
          configured: true,
          ready: false,
          state: "unsupported",
          bridge: "unsupported",
          safeLabel: providerSafeLabel(config),
          detail: "mock/dev provider 不能用于 Workspace Secretary 验收。",
          config,
        }),
      };
    }

    const availability = await this.options.agentManager.getProviderAvailability(config.provider);
    if (!availability.available) {
      return {
        ok: false,
        runtime: createProviderRuntime({
          configured: true,
          ready: false,
          state: "error",
          safeLabel: providerSafeLabel(config),
          detail: availability.error ?? "provider 当前不可用。",
          config,
        }),
      };
    }

    const bridge = resolveProviderBridge(config);
    if (bridge === "unsupported") {
      return {
        ok: false,
        runtime: createProviderRuntime({
          configured: true,
          ready: false,
          state: "unsupported",
          bridge,
          safeLabel: providerSafeLabel(config),
          detail: "该 provider 需要支持 Thoth runtime tool bridge。",
          config,
        }),
      };
    }

    return {
      ok: true,
      config,
      runtime: createProviderRuntime({
        configured: true,
        ready: true,
        state: "ready",
        bridge,
        safeLabel: providerSafeLabel(config),
        detail: "使用 Thoth runtime tool bridge。",
        config,
      }),
    };
  }

  private emitMirroredAgentStream(uiAgentId: string | undefined, event: AgentStreamEvent): void {
    if (!uiAgentId) {
      return;
    }
    if (
      event.type === "usage_updated" ||
      event.type === "mode_changed" ||
      event.type === "model_changed" ||
      event.type === "thinking_option_changed" ||
      event.type === "attention_required"
    ) {
      return;
    }
    const streamMessage: Extract<SessionOutboundMessage, { type: "agent_stream" }> = {
      type: "agent_stream",
      payload: {
        agentId: uiAgentId,
        event,
        timestamp: new Date().toISOString(),
      },
    };
    this.options.host.emit(streamMessage);
    if (event.type === "permission_requested") {
      const permissionMessage: Extract<
        SessionOutboundMessage,
        { type: "agent_permission_request" }
      > = {
        type: "agent_permission_request",
        payload: {
          agentId: uiAgentId,
          request: event.request,
        },
      };
      this.options.host.emit(permissionMessage);
    } else if (event.type === "permission_resolved") {
      const resolvedMessage: Extract<
        SessionOutboundMessage,
        { type: "agent_permission_resolved" }
      > = {
        type: "agent_permission_resolved",
        payload: {
          agentId: uiAgentId,
          requestId: event.requestId,
          resolution: event.resolution,
        },
      };
      this.options.host.emit(resolvedMessage);
    }
  }

  private recordTimelineForSecretaryState(
    state: WorkspaceSecretaryState,
    event: AgentStreamEvent,
  ): void {
    if (event.type !== "timeline") {
      return;
    }
    const item = event.item;
    if (item.type === "assistant_message") {
      state.activeTopicProviderBacked = true;
      return;
    }
    if (item.type === "clarify_card") {
      state.activeTopicProviderBacked = true;
      state.currentClarifyState = "C_ASK";
      state.activeTurnPhase = "clarify";
      const existing = state.model.secretary.turns.find(
        (turn) => turn.kind === "clarify_card" && turn.card.id === item.card.id,
      );
      if (existing?.kind === "clarify_card") {
        existing.card = item.card;
      } else {
        state.model.secretary.turns.push({
          id: `turn-clarify-${item.card.id}`,
          kind: "clarify_card",
          card: item.card,
        });
      }
      state.model.secretary.status = createStatusModel("ready");
      persistTopicSnapshot(this.options.daemonConfigStore, state);
      return;
    }
    if (item.type === "task_card") {
      state.activeTopicProviderBacked = true;
      state.currentClarifyState = "C_TASK_CARD";
      state.activeTurnPhase = "approval_task";
      const existing = state.model.secretary.turns.find(
        (turn) => turn.kind === "task_card" && turn.card.id === item.card.id,
      );
      if (existing?.kind === "task_card") {
        existing.card = item.card;
      } else {
        state.model.secretary.turns.push({
          id: `turn-task-${item.card.id}`,
          kind: "task_card",
          card: item.card,
        });
      }
      state.model.secretary.status = createStatusModel("ready");
      persistTopicSnapshot(this.options.daemonConfigStore, state);
      return;
    }
    if (item.type === "goal_card") {
      state.activeTopicProviderBacked = true;
      const preservePostApprovalPhase =
        item.card.submitted === true && state.activeTurnPhase === "quick_exec";
      if (!preservePostApprovalPhase) {
        state.currentClarifyState = "C_GOAL_CARD";
        state.activeTurnPhase = "approval_breakdown";
      }
      const existing = state.model.secretary.turns.find(
        (turn) => turn.kind === "goal_card" && turn.card.id === item.card.id,
      );
      if (existing?.kind === "goal_card") {
        existing.card = item.card;
      } else {
        state.model.secretary.turns.push({
          id: `turn-goal-${item.card.id}`,
          kind: "goal_card",
          card: item.card,
        });
      }
      state.model.secretary.status = createStatusModel("ready");
      persistTopicSnapshot(this.options.daemonConfigStore, state);
      return;
    }
    if (item.type === "registered_task") {
      state.activeTopicProviderBacked = true;
      state.currentClarifyState = "C_DIRECT";
      state.activeTurnPhase = "quick_exec";
      const existing = state.model.secretary.turns.find(
        (turn) => turn.kind === "registered_task" && turn.task.id === item.task.id,
      );
      if (!existing) {
        state.model.secretary.turns.push({
          id: `turn-registered-${item.task.id}`,
          kind: "registered_task",
          task: item.task,
        });
      }
      state.model.secretary.status = createStatusModel("ready");
      persistTopicSnapshot(this.options.daemonConfigStore, state);
    }
  }

  private async startProviderTurnInBackground(input: {
    state: WorkspaceSecretaryState;
    provider: ProviderSessionConfig;
    runtime: WorkspaceSecretaryProviderRuntimeModel | null;
    userInput: string;
    answer: WorkspaceSecretaryTurnActionPayload | null;
    messageId?: string;
    images?: WorkspaceSecretaryImageAttachment[];
    attachments?: AgentAttachment[];
    uiAgentId?: string;
  }): Promise<void> {
    const agentId = await this.resolveTopicAgent(input.state, input.provider, input.runtime);
    const runtime = input.runtime;
    const prompt =
      runtime === null
        ? buildProviderPrompt(input.userInput, input.images, input.attachments)
        : this.buildRuntimeToolProviderPrompt({
            state: input.state,
            runtime,
            userInput: input.userInput,
            answer: input.answer,
            images: input.images,
            attachments: input.attachments,
          });
    const events = this.options.agentManager.streamAgent(
      agentId,
      prompt,
      input.messageId ? { messageId: input.messageId } : undefined,
    );
    void this.consumeProviderTurnInBackground({
      state: input.state,
      agentId,
      uiAgentId: input.uiAgentId,
      events,
      structured: input.runtime !== null,
    });
  }

  private buildRuntimeToolProviderPrompt(input: {
    state: WorkspaceSecretaryState;
    runtime: WorkspaceSecretaryProviderRuntimeModel;
    userInput: string;
    answer: WorkspaceSecretaryTurnActionPayload | null;
    images?: WorkspaceSecretaryImageAttachment[];
    attachments?: AgentAttachment[];
  }): AgentPromptInput {
    const topicId = input.state.model.secretary.activeTopicId;
    const clarifyCards = clarifyCardTurns(input.state);
    const clarifyStrength = input.state.model.secretary.composer.clarifyStrength;
    const softRange = clarifySoftRange(clarifyStrength);
    const latestLedger = latestClarifyCard(input.state)?.frontierLedger ?? null;
    const belowSoftTargetPolicy = clarifyBelowSoftTargetPolicy({
      strength: clarifyStrength,
      cardCount: clarifyCards.length,
      softRange,
    });
    const skillMount = mountClarifySkillForTopic({
      state: input.state,
      thothHome: this.options.daemonConfigStore.getThothHome(),
      topicId,
    });
    const context = {
      type: "workspace_secretary_runtime_context",
      session_id: topicId,
      current_state: input.state.currentClarifyState,
      turn_phase: input.state.activeTurnPhase,
      controls: {
        mode: input.state.model.secretary.composer.mode,
        clarify_strength: clarifyStrength,
        loop: input.state.model.secretary.composer.loop,
      },
      clarify_progress: {
        card_count: clarifyCards.length,
        next_card_index: clarifyCards.length + 1,
        soft_range: softRange,
        below_soft_target_policy: belowSoftTargetPolicy,
        material_frontier_categories: CLARIFY_MATERIAL_FRONTIER_CATEGORIES,
        latest_frontier_ledger: latestLedger,
      },
      user_input: input.userInput,
      answer: input.answer,
      transcript: renderTranscript(input.state.model.secretary.turns),
      required_next_runtime_tool: resolveRequiredRuntimeTool(input.state),
      approved_task_card: latestTaskCardTurn(input.state)
        ? renderTaskCardForProvider(latestTaskCardTurn(input.state)!.card)
        : null,
      approved_goals_card: latestGoalCardTurn(input.state)
        ? renderGoalCardForProvider(latestGoalCardTurn(input.state)!.card)
        : null,
      approved_pyramid_plan_card: latestGoalCardTurn(input.state)
        ? renderGoalCardForProvider(latestGoalCardTurn(input.state)!.card)
        : null,
    };
    return buildStructuredProviderPrompt({
      state: input.state,
      runtime: input.runtime,
      envelopeText: JSON.stringify(context),
      skillMount,
      images: input.images,
      attachments: input.attachments,
    });
  }

  private async consumeProviderTurnInBackground(input: {
    state: WorkspaceSecretaryState;
    agentId: string;
    uiAgentId?: string;
    events: AsyncGenerator<AgentStreamEvent>;
    structured: boolean;
  }): Promise<void> {
    try {
      for await (const event of input.events) {
        if (input.structured && event.type === "permission_requested") {
          await this.options.agentManager
            .respondToPermission(input.agentId, event.request.id, {
              behavior: "deny",
              interrupt: true,
              message:
                "Use the Thoth runtime authority tools for Workspace Secretary Clarify decisions.",
            })
            .catch(() => undefined);
          input.state.model.secretary.status = createStatusModel(
            "recoverable_error",
            "provider 在 Clarify 中调用了原生 question/permission；已要求它改用 Thoth runtime tool。",
          );
          this.emitModelUpdate(input.state, "provider_blocked");
          persistTopicSnapshot(this.options.daemonConfigStore, input.state);
          return;
        }
        this.emitMirroredAgentStream(input.uiAgentId, event);
        this.recordTimelineForSecretaryState(input.state, event);
        if (event.type === "turn_completed") {
          const hasPendingAuthorityDecision = listPendingRuntimeAuthorityDecisions().some(
            (decision) => decision.agentId === input.agentId,
          );
          if (hasPendingAuthorityDecision) {
            input.state.model.secretary.status = createStatusModel(
              "loading",
              "正在等待用户确认需求拆解卡片。",
            );
            this.emitModelUpdate(input.state, "provider_progress");
            persistTopicSnapshot(this.options.daemonConfigStore, input.state);
            continue;
          }
          const completionError = input.structured
            ? resolveStructuredCompletionError(input.state)
            : null;
          if (completionError) {
            input.state.model.secretary.status = createStatusModel(
              "recoverable_error",
              completionError,
            );
            this.emitModelUpdate(input.state, "provider_blocked");
            persistTopicSnapshot(this.options.daemonConfigStore, input.state);
            return;
          }
          input.state.activeTopicProviderBacked = true;
          input.state.model.secretary.status = createStatusModel("ready");
          this.emitModelUpdate(input.state, "provider_turn_completed");
          persistTopicSnapshot(this.options.daemonConfigStore, input.state);
        } else if (event.type === "turn_failed") {
          if (input.state.userCanceledAgentIds.delete(input.agentId)) {
            input.state.model.secretary.status = createStatusModel(
              "ready",
              WORKSPACE_SECRETARY_USER_CANCEL_SUMMARY,
            );
            this.emitModelUpdate(input.state, "provider_progress");
            persistTopicSnapshot(this.options.daemonConfigStore, input.state);
            continue;
          }
          input.state.model.secretary.status = createStatusModel(
            "recoverable_error",
            toSafeRuntimeErrorMessage(event.error),
          );
          this.emitModelUpdate(input.state, "provider_error");
          persistTopicSnapshot(this.options.daemonConfigStore, input.state);
        } else if (event.type === "turn_canceled") {
          if (input.state.userCanceledAgentIds.delete(input.agentId)) {
            input.state.model.secretary.status = createStatusModel(
              "ready",
              WORKSPACE_SECRETARY_USER_CANCEL_SUMMARY,
            );
            this.emitModelUpdate(input.state, "provider_progress");
            persistTopicSnapshot(this.options.daemonConfigStore, input.state);
            continue;
          }
          input.state.model.secretary.status = createStatusModel(
            "recoverable_error",
            toSafeRuntimeErrorMessage(event.reason || "provider turn canceled"),
          );
          this.emitModelUpdate(input.state, "provider_error");
          persistTopicSnapshot(this.options.daemonConfigStore, input.state);
        }
      }
    } catch (error) {
      input.state.model.secretary.status = createStatusModel(
        "recoverable_error",
        toSafeRuntimeErrorMessage(error instanceof Error ? error.message : String(error)),
      );
      this.emitModelUpdate(input.state, "provider_error");
      persistTopicSnapshot(this.options.daemonConfigStore, input.state);
    }
  }

  private async resolveTopicAgent(
    state: WorkspaceSecretaryState,
    provider: ProviderSessionConfig,
    runtime: WorkspaceSecretaryProviderRuntimeModel | null,
  ): Promise<string> {
    const topicId = state.model.secretary.activeTopicId;
    const runtimeKind = runtime ? "structured" : "bare";
    const providerKey = [
      runtimeKind,
      provider.provider,
      provider.model ?? "",
      provider.modeId ?? "",
      provider.thinkingOptionId ?? "",
      JSON.stringify(provider.featureValues ?? {}),
    ].join(":");
    const agentKey = `${topicId}:${providerKey}`;
    const existing = state.topicAgents.get(agentKey);
    if (existing) {
      return existing;
    }
    const config: AgentSessionConfig = {
      provider: provider.provider,
      cwd: state.model.secretary.workspacePath,
      internal: true,
      ...(provider.model ? { model: provider.model } : {}),
      ...(provider.modeId ? { modeId: provider.modeId } : {}),
      ...(provider.thinkingOptionId ? { thinkingOptionId: provider.thinkingOptionId } : {}),
      ...(provider.featureValues ? { featureValues: provider.featureValues } : {}),
      ...(runtime && provider.provider === "codex"
        ? {
            extra: {
              codex: {
                thothClarifyRuntimeTools: true,
              },
            },
          }
        : {}),
    };
    const env =
      runtime && provider.provider === "codex"
        ? {
            CODEX_HOME: prepareCodexSessionHome({
              thothHome: this.options.daemonConfigStore.getThothHome(),
              topicId,
            }),
          }
        : undefined;
    const agent = await this.options.agentManager.createAgent(config, undefined, {
      labels: {
        surface: "workspace-secretary",
        topicId,
        runtimeKind,
      },
      env,
      persistSession: true,
      initialTitle: "Workspace Secretary",
    });
    state.topicAgents.set(agentKey, agent.id);
    return agent.id;
  }

  private async refreshRuntimeStatus(state: WorkspaceSecretaryState): Promise<void> {
    const provider = await this.resolveProviderRuntime();
    const runtime = provider.runtime;
    this.applyResolvedRuntime(state, runtime);
    if (this.options.loopTaskService) {
      applyLoopTasksToModel(state, this.options.loopTaskService);
    } else {
      applyRegisteredTasksToModel(
        state,
        readRegisteredTasks(this.options.daemonConfigStore),
        readSelectedRegisteredTaskId(this.options.daemonConfigStore),
      );
    }
    state.model.authority = {
      source:
        runtime.ready && state.activeTopicProviderBacked
          ? "provider_backed_clean_ui_model"
          : "daemon_clean_ui_model",
      schemaVerified: true,
      label:
        runtime.ready && state.activeTopicProviderBacked
          ? "Provider-backed Workspace Secretary clean UI model"
          : "Daemon Workspace Secretary runtime status model",
    };
    if (!runtime.ready) {
      state.model.secretary.status = createStatusModel(runtimeStatusKind(runtime), runtime.detail);
    } else if (state.model.secretary.status.kind === "provider_required") {
      state.model.secretary.status = createStatusModel("ready");
    }
  }

  private async refreshRelayStatus(state: WorkspaceSecretaryState): Promise<void> {
    const nextStatus = await (this.options.probeRelayHealth ?? probeRelayHealth)();
    state.model.settings.relay = createRelayModel(nextStatus);
  }

  private async resolveWorkspaceIdentity(request?: {
    workspaceId?: string;
    workspacePath?: string;
    workspaceName?: string;
  }): Promise<{
    workspaceName: string;
    workspacePath: string;
  }> {
    const workspaces = await this.options.host.listWorkspaces();
    const requestedWorkspacePath = request?.workspacePath;
    const requestedWorkspace =
      (request?.workspaceId
        ? workspaces.find((workspace) => workspace.workspaceId === request.workspaceId)
        : null) ??
      (requestedWorkspacePath
        ? workspaces.find((workspace) => resolve(workspace.cwd) === resolve(requestedWorkspacePath))
        : null);
    if (requestedWorkspace) {
      return {
        workspaceName:
          requestedWorkspace.title?.trim() ||
          requestedWorkspace.displayName?.trim() ||
          request?.workspaceName?.trim() ||
          "Thoth workspace",
        workspacePath: requestedWorkspace.cwd,
      };
    }
    if (request?.workspacePath) {
      return {
        workspaceName: request.workspaceName?.trim() || "Thoth workspace",
        workspacePath: request.workspacePath,
      };
    }
    const activeWorkspace = workspaces.find((workspace) => !workspace.archivedAt) ?? workspaces[0];
    if (activeWorkspace) {
      return {
        workspaceName:
          activeWorkspace.title?.trim() || activeWorkspace.displayName?.trim() || "Thoth workspace",
        workspacePath: activeWorkspace.cwd,
      };
    }
    return {
      workspaceName: "Thoth workspace",
      workspacePath: process.cwd(),
    };
  }

  private async emitResponse(
    type:
      | "workspace_secretary.snapshot.response"
      | "workspace_secretary.send.response"
      | "workspace_secretary.answer.response"
      | "workspace_secretary.cancel.response"
      | "workspace_secretary.topic.create.response",
    requestId: string,
    run: () => Promise<WorkspaceSecretaryState>,
  ): Promise<void> {
    try {
      const state = await run();
      await this.refreshRuntimeStatus(state);
      await this.refreshRelayStatus(state);
      const model = withSchemaVerifiedModel(state.model);
      persistTopicSnapshot(this.options.daemonConfigStore, state);
      this.options.host.emit({
        type,
        payload: {
          requestId,
          model,
          error: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const state = await this.ensureState().catch(() => null);
      if (state) {
        state.model.secretary.status = createStatusModel(
          "recoverable_error",
          toSafeRuntimeErrorMessage(message),
        );
        await this.refreshRuntimeStatus(state).catch(() => undefined);
        await this.refreshRelayStatus(state).catch(() => undefined);
      }
      this.options.host.emit({
        type,
        payload: {
          requestId,
          model: state ? withSchemaVerifiedModel(state.model) : null,
          error: state ? null : toSafeRuntimeErrorMessage(message),
        },
      });
    }
  }
}
