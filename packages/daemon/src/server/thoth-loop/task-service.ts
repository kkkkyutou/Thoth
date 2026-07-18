import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Logger } from "pino";
import type {
  ThothLoopPlanExecResultInput,
  ThothLoopReportBlockedInput,
  ThothLoopReviewIndependentAssessmentInput,
  ThothLoopReviewVerdictInput,
  ThothRuntimeLoopStrength,
  ContractPreservationAudit,
} from "@thoth/protocol/thoth-runtime-contract";
import type {
  BackgroundTaskAction,
  BackgroundTaskModel,
  LoopGoalRecord,
  LoopEvidenceRef,
  LoopDeferredGoalReplanProposal,
  LoopPlanExecResult,
  LoopPhaseKind,
  LoopPhaseRecord,
  LoopReviewVerdict,
  LoopTaskModel,
  ThothGoalsCardModel,
  ThothTaskCardModel,
} from "@thoth/protocol/thoth/rpc-schemas";
import { BackgroundTaskModelSchema, LoopTaskModelSchema } from "@thoth/protocol/thoth/rpc-schemas";
import {
  getAgentStreamEventTurnId,
  getAgentStreamEventProviderTurnId,
} from "../agent/agent-sdk-types.js";
import type {
  AgentPermissionResponse,
  AgentPromptInput,
  AgentStreamEvent,
  AgentUsage,
} from "../agent/agent-sdk-types.js";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "../agent/agent-storage.js";
import { ensureAgentLoaded } from "../agent/agent-loading.js";
import { respondToAgentPermission } from "../agent/permission-response.js";
import { recoverProviderPhaseRecord } from "../agent/provider-phase-recovery.js";
import { prepareProviderRuntimeSession } from "../agent/provider-runtime-session.js";
import {
  readThothRuntimeToolsConfig,
  withThothRuntimeTools,
} from "../agent/thoth-runtime-tools-config.js";
import { loadRuntimeSkillArtifact, mountRuntimeSkillForSession } from "@thoth/drivers/clarify";
import { LoopAuthorityStore, type LoopWorktreeLease } from "./authority-store.js";
import { LoopEvidenceStore, type CommandReceipt } from "./evidence-store.js";
import {
  rejectContractPreservationAudit,
  waitForContractPreservationAudit,
} from "../agent/clarify-audit-broker.js";

interface ProviderSessionConfig {
  provider: string;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

export interface RegisterLoopTaskInput {
  workspaceName: string;
  workspacePath: string;
  sourceAgentId: string;
  taskCard: ThothTaskCardModel;
  goalsCard: ThothGoalsCardModel;
  clarifyTranscript: string;
  loopStrength: ThothRuntimeLoopStrength;
  provider: ProviderSessionConfig;
}

interface ThothLoopTaskServiceOptions {
  thothHome: string;
  agentManager: AgentManager;
  agentStorage?: AgentStorage;
  logger: Logger;
  onTaskUpdated?: (task: LoopTaskModel) => void;
}

type LoopWorktreeLockRecord = LoopWorktreeLease;

type DaemonBoundPlanExecResult = ThothLoopPlanExecResultInput & {
  goal_id: string;
  round: number;
  phase_run_id?: string;
  result_tool_call_id?: string;
};

type DaemonBoundReviewVerdict = ThothLoopReviewVerdictInput & {
  goal_id: string;
  round: number;
  result_tool_call_id?: string;
};

type DaemonBoundBlockedResult = ThothLoopReportBlockedInput & {
  goal_id?: string;
  phase?: LoopPhaseKind;
};

type PhaseResult =
  | { kind: "planexec"; result: DaemonBoundPlanExecResult }
  | { kind: "review"; result: DaemonBoundReviewVerdict }
  | { kind: "blocked"; result: DaemonBoundBlockedResult };

interface PendingPhaseResult {
  taskId: string;
  goalId: string;
  phase: LoopPhaseKind;
  round: number;
  phaseRunId?: string;
  attemptId?: string;
  executionGeneration?: number;
  providerTurnId?: string;
  reviewAssessment?: ThothLoopReviewIndependentAssessmentInput;
  resolve: (result: PhaseResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface ActivePhaseTelemetry {
  startedAtMs: number;
  commandReceipts: Map<string, CommandReceipt>;
  timelineRefs: Set<string>;
  usage?: AgentUsage;
  reviewStartEvidence?: NonNullable<LoopPhaseRecord["evidenceRef"]>;
  artifactRoot?: string;
}

const WORKTREE_LEASE_MS = 2 * 60 * 1000;
const WORKTREE_HEARTBEAT_MS = Math.floor(WORKTREE_LEASE_MS / 3);
const PHASE_AWAITING_PROVIDER_MS = 60 * 1000;
function nowIso(): string {
  return new Date().toISOString();
}

function budgetForStrength(strength: ThothRuntimeLoopStrength): number {
  switch (strength) {
    case "light":
      return 5;
    case "balanced":
      return 10;
    case "run_until_stopped":
      return 30;
    case "auto":
    case "one_plan_one_do":
    default:
      return 1;
  }
}

function budgetEnvelopeForStrength(strength: ThothRuntimeLoopStrength) {
  switch (strength) {
    case "light":
      return {
        maxActiveDurationMs: 8 * 60 * 60 * 1000,
        maxTokens: 4_000_000,
        maxToolCalls: 1_200,
        maxChangedFiles: 300,
        maxChangedLines: 100_000,
        maxReplans: 3,
        maxConsecutiveSameRootCause: 2,
      };
    case "balanced":
      return {
        maxActiveDurationMs: 24 * 60 * 60 * 1000,
        maxTokens: 12_000_000,
        maxToolCalls: 3_600,
        maxChangedFiles: 600,
        maxChangedLines: 300_000,
        maxReplans: 5,
        maxConsecutiveSameRootCause: 3,
      };
    case "run_until_stopped":
      return {
        maxActiveDurationMs: 72 * 60 * 60 * 1000,
        maxTokens: 36_000_000,
        maxToolCalls: 10_800,
        maxChangedFiles: 1_800,
        maxChangedLines: 900_000,
        maxReplans: 10,
        maxConsecutiveSameRootCause: 3,
      };
    case "auto":
    case "one_plan_one_do":
    default:
      return {
        maxActiveDurationMs: 2 * 60 * 60 * 1000,
        maxTokens: 1_000_000,
        maxToolCalls: 300,
        maxChangedFiles: 75,
        maxChangedLines: 25_000,
        maxReplans: 1,
        maxConsecutiveSameRootCause: 1,
      };
  }
}

function nextLoopStrength(strength: ThothRuntimeLoopStrength): ThothRuntimeLoopStrength | null {
  switch (strength) {
    case "one_plan_one_do":
    case "auto":
      return "light";
    case "light":
      return "balanced";
    case "balanced":
      return "run_until_stopped";
    default:
      return null;
  }
}

function toBackgroundTaskModel(task: LoopTaskModel): BackgroundTaskModel {
  const currentGoal = task.currentGoalId
    ? task.goals.find((goal) => goal.id === task.currentGoalId)
    : null;
  const phaseLabelText =
    task.status === "running"
      ? `${task.currentPhase === "review" ? "Review" : "PlanExec"} in progress`
      : task.status;
  const budgetLabel = `failed reviews ${task.budget.usedFailedReviews}/${task.budget.maxFailedReviews}`;
  return BackgroundTaskModelSchema.parse({
    id: task.id,
    title: task.title,
    status: task.status,
    summary: task.latestVerdictSummary
      ? `${task.summary} Latest Review: ${task.latestVerdictSummary}`
      : task.summary,
    workspaceName: task.workspaceName,
    workspacePath: task.workspacePath,
    sourceAgentId: task.sourceAgentId,
    detailLabel: [
      phaseLabelText,
      currentGoal ? `Goal ${currentGoal.order}: ${currentGoal.title}` : null,
      budgetLabel,
    ]
      .filter(Boolean)
      .join(" · "),
  });
}

function goalPhase(goal: LoopGoalRecord, phase: LoopPhaseKind, round: number): LoopPhaseRecord {
  const existing = goal.phases.find((entry) => entry.phase === phase && entry.round === round);
  if (existing) {
    return existing;
  }
  const created: LoopPhaseRecord = {
    phase,
    status: "queued",
    round,
  };
  goal.phases.push(created);
  return created;
}

function phaseTitle(phase: LoopPhaseKind): string {
  return phase === "planexec" ? "PlanExec" : "Review";
}

function loopPhaseSessionId(input: {
  taskId: string;
  goalId: string;
  phase: LoopPhaseKind;
  round: number;
}): string {
  return input.phase === "planexec"
    ? `loop-${input.taskId}-${input.goalId}-planexec`
    : `loop-${input.taskId}-${input.goalId}-review-${input.round}`;
}

function asPromptText(input: AgentPromptInput): string {
  if (typeof input === "string") {
    return input;
  }
  return input
    .map((part) => {
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function prepareLoopRuntimeSession(input: {
  provider: string;
  thothHome: string;
  sessionId: string;
}): ReturnType<typeof prepareProviderRuntimeSession> {
  const runtimeSession = prepareProviderRuntimeSession(input);
  mountRuntimeSkillForSession({
    artifact: loadRuntimeSkillArtifact("thoth.loop"),
    thothSessionHome: input.thothHome,
    sessionId: input.sessionId,
  });
  return runtimeSession;
}

export class ThothLoopTaskService {
  private readonly tasks = new Map<string, LoopTaskModel>();
  private readonly providerByTask = new Map<string, ProviderSessionConfig>();
  private readonly worktreeLocks = new Map<string, LoopWorktreeLockRecord>();
  private readonly pendingByAgent = new Map<string, PendingPhaseResult>();
  private readonly authorityStore: LoopAuthorityStore;
  private readonly evidenceStore: LoopEvidenceStore;
  private readonly activePhaseTelemetry = new Map<string, ActivePhaseTelemetry>();
  private readonly worktreeHeartbeatTimers = new Map<string, NodeJS.Timeout>();
  private readonly actionTails = new Map<string, Promise<void>>();
  private schedulerRunning = false;
  private schedulerQueued = false;
  // `schedule()` can be called by a phase completion while the scheduler owns
  // the current worktree lease. Preserve that request until the active loop
  // releases the lease; dropping it leaves PlanExec completed and Review queued.
  private schedulerRerunRequested = false;

  constructor(private readonly options: ThothLoopTaskServiceOptions) {
    this.authorityStore = new LoopAuthorityStore({
      thothHome: options.thothHome,
      logger: options.logger,
    });
    this.evidenceStore = new LoopEvidenceStore(options.thothHome);
    this.load();
    this.loadLocks();
    this.reconcileLoadedLocks();
    void this.reconcileStoredPhaseAgents();
  }

  list(input?: { workspacePath?: string }): BackgroundTaskModel[] {
    const workspacePath = input?.workspacePath ? resolve(input.workspacePath) : null;
    const tasks = Array.from(this.tasks.values())
      .filter((task) => (workspacePath ? resolve(task.workspacePath) === workspacePath : true))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return tasks.length > 0
      ? tasks.map((task) => toBackgroundTaskModel(task))
      : [
          {
            id: "empty",
            title: "还没有后台任务",
            status: "empty",
            summary: "Loop 会在 Goals Card 确认后出现在这里。",
          },
        ];
  }

  inspect(taskId: string): LoopTaskModel | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }
    const lease = this.authorityStore.getLease(resolve(task.workspacePath));
    const recentEvents = this.authorityStore
      .readEvents(task.id)
      .slice(-50)
      .map(({ projection: _projection, ...event }) => event);
    return LoopTaskModelSchema.parse({
      ...task,
      ...(lease ? { currentLease: lease } : {}),
      recentEvents,
      taskMemoryRefs: this.authorityStore.listMemoryRefs(task.id),
    });
  }

  findBySourceBinding(input: {
    workspacePath: string;
    sourceAgentId: string;
    sourceGoalsCardId: string;
  }): LoopTaskModel | null {
    const workspacePath = resolve(input.workspacePath);
    return (
      Array.from(this.tasks.values()).find(
        (task) =>
          resolve(task.workspacePath) === workspacePath &&
          task.sourceAgentId === input.sourceAgentId &&
          task.sourceGoalsCardId === input.sourceGoalsCardId,
      ) ?? null
    );
  }

  authorityEvents(taskId: string) {
    return this.authorityStore.readEvents(taskId);
  }

  async recoverPhaseAgent(agentId: string): Promise<boolean> {
    const storage = this.options.agentStorage;
    if (!storage) {
      return false;
    }
    const phaseOwner = this.findPhaseOwner(agentId);
    const existing = await storage.get(agentId);
    if (!phaseOwner) {
      await this.restoreLegacyForegroundVisibility(agentId, existing);
      return false;
    }
    prepareLoopRuntimeSession({
      provider: this.options.agentManager.getProviderRuntimeSessionProvider(
        phaseOwner.task.providerBinding.provider,
      ),
      thothHome: this.options.thothHome,
      sessionId: loopPhaseSessionId({
        taskId: phaseOwner.task.id,
        goalId: phaseOwner.goal.id,
        phase: phaseOwner.phase.phase,
        round: phaseOwner.phase.round,
      }),
    });
    if (existing) {
      if (!existing.internal) {
        await storage.upsert({ ...existing, internal: true, updatedAt: nowIso() });
      }
      this.options.agentManager.markAgentInternal(agentId);
      return true;
    }

    const { task, goal, phase } = phaseOwner;
    const recovered = recoverProviderPhaseRecord({
      provider: task.providerBinding.provider,
      thothHome: this.options.thothHome,
      agentId,
      task,
      goal,
      phase,
    });
    if (!recovered) {
      return false;
    }
    await storage.upsert(recovered);
    this.options.logger.info(
      { taskId: task.id, goalId: goal.id, phase: phase.phase, agentId },
      "Recovered persisted Loop phase agent through provider recovery adapter",
    );
    return true;
  }

  async register(input: RegisterLoopTaskInput): Promise<LoopTaskModel> {
    const now = nowIso();
    const goals: LoopGoalRecord[] = input.goalsCard.goals
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((goal) => ({
        id: goal.id,
        order: goal.order,
        title: goal.title,
        goal: goal.goal,
        constraints: goal.constraints,
        acceptance: goal.acceptance,
        status: "queued",
        round: 1,
        phases: [
          { phase: "planexec", status: "queued", round: 1 },
          { phase: "review", status: "queued", round: 1 },
        ],
      }));
    const firstGoal = goals[0] ?? null;
    const task: LoopTaskModel = LoopTaskModelSchema.parse({
      id: `loop-task-${randomUUID()}`,
      title: input.taskCard.title,
      workspaceName: input.workspaceName,
      workspacePath: input.workspacePath,
      sourceAgentId: input.sourceAgentId,
      sourceGoalsCardId: input.goalsCard.id,
      status: "queued",
      summary: "已注册后台 Loop，等待当前 worktree 执行锁。",
      loopStrength: input.loopStrength,
      budget: {
        loopStrength: input.loopStrength,
        maxFailedReviews: budgetForStrength(input.loopStrength),
        usedFailedReviews: 0,
      },
      budgetEnvelope: budgetEnvelopeForStrength(input.loopStrength),
      budgetUsage: {
        activeDurationMs: 0,
        tokens: 0,
        toolCalls: 0,
        changedFiles: 0,
        changedLines: 0,
        replans: 0,
        consecutiveSameRootCause: 0,
        tokenMetered: false,
      },
      goalsRevision: 0,
      replanHistory: [],
      currentGoalId: firstGoal?.id ?? null,
      currentPhase: null,
      controlIntent: "run",
      goalRound: 1,
      globalFailureCount: 0,
      goals,
      taskCard: input.taskCard,
      goalsCard: input.goalsCard,
      clarifyTranscript: input.clarifyTranscript,
      providerBinding: input.provider,
      createdAt: now,
      updatedAt: now,
    });
    const registrationKey = `${resolve(input.workspacePath)}:${input.sourceAgentId}:${input.goalsCard.id}`;
    const registration = this.authorityStore.registerTask(task, registrationKey, {
      kind: "task_registered",
      correlationId: input.sourceAgentId,
      payload: {
        sourceAgentId: input.sourceAgentId,
        sourceGoalsCardId: input.goalsCard.id,
        loopStrength: input.loopStrength,
      },
    });
    const persistedTask = registration.task;
    this.tasks.set(persistedTask.id, persistedTask);
    this.providerByTask.set(persistedTask.id, input.provider);
    if (!registration.created) {
      return persistedTask;
    }
    this.appendTaskMemory(persistedTask, "clarify_transcript", input.clarifyTranscript);
    this.appendTaskMemory(persistedTask, "task_card", input.taskCard);
    this.appendTaskMemory(persistedTask, "goals_card", input.goalsCard);
    this.schedule();
    return persistedTask;
  }

  async action(
    taskId: string,
    action: BackgroundTaskAction,
    input: { expectedAuthorityRevision?: number; commandId?: string } = {},
  ): Promise<LoopTaskModel | null> {
    const previous = this.actionTails.get(taskId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.actionTails.set(taskId, tail);
    await previous.catch(() => undefined);
    try {
      const priorCommand = input.commandId ? this.authorityStore.getCommand(input.commandId) : null;
      if (priorCommand) {
        if (priorCommand.taskId !== taskId || priorCommand.action !== action) {
          throw new Error("Background task command id is already bound to another command.");
        }
        return this.tasks.get(taskId) ?? null;
      }
      const task = this.tasks.get(taskId);
      if (!task) {
        return null;
      }
      if (
        input.expectedAuthorityRevision !== undefined &&
        task.authorityRevision !== input.expectedAuthorityRevision
      ) {
        throw new Error(
          `Background task revision conflict: expected ${input.expectedAuthorityRevision}, found ${task.authorityRevision ?? "unknown"}.`,
        );
      }
      if (
        input.commandId &&
        !this.authorityStore.claimCommand({ commandId: input.commandId, taskId, action })
      ) {
        return this.tasks.get(taskId) ?? null;
      }
      const result = await this.performAction(taskId, action);
      if (result && input.commandId) {
        this.authorityStore.rememberCommand({
          commandId: input.commandId,
          taskId,
          action,
          resultRevision: result.authorityRevision,
        });
      }
      return result;
    } finally {
      release?.();
      if (this.actionTails.get(taskId) === tail) {
        this.actionTails.delete(taskId);
      }
    }
  }

  async answerUserDecision(input: {
    taskId: string;
    decisionId: string;
    choiceId: string;
    note?: string;
    expectedAuthorityRevision?: number;
    commandId?: string;
  }): Promise<LoopTaskModel | null> {
    const previous = this.actionTails.get(input.taskId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.actionTails.set(input.taskId, tail);
    await previous.catch(() => undefined);
    try {
      const commandAction = "answer_user_decision";
      const priorCommand = input.commandId ? this.authorityStore.getCommand(input.commandId) : null;
      if (priorCommand) {
        if (priorCommand.taskId !== input.taskId || priorCommand.action !== commandAction) {
          throw new Error("Background task command id is already bound to another command.");
        }
        return this.tasks.get(input.taskId) ?? null;
      }
      const task = this.tasks.get(input.taskId);
      if (!task) {
        return null;
      }
      if (
        input.expectedAuthorityRevision !== undefined &&
        task.authorityRevision !== input.expectedAuthorityRevision
      ) {
        throw new Error(
          `Background task revision conflict: expected ${input.expectedAuthorityRevision}, found ${task.authorityRevision ?? "unknown"}.`,
        );
      }
      if (
        input.commandId &&
        !this.authorityStore.claimCommand({
          commandId: input.commandId,
          taskId: task.id,
          action: commandAction,
        })
      ) {
        return this.tasks.get(task.id) ?? null;
      }
      const decision = task.pendingUserDecision;
      if (
        task.status !== "awaiting_user_decision" ||
        !decision ||
        decision.status !== "pending" ||
        decision.id !== input.decisionId
      ) {
        throw new Error("This Loop user decision is no longer awaiting an answer.");
      }
      const choice = decision.options.find((option) => option.id === input.choiceId);
      if (!choice) {
        throw new Error("The selected Loop decision option is not available.");
      }
      const answer = [choice.label, input.note?.trim()].filter(Boolean).join("\n\n");
      decision.status = "submitted";
      decision.submittedAt = nowIso();
      decision.answer = answer;
      const goal = this.currentGoal(task);
      if (!goal) {
        throw new Error("The Loop task has no current goal to resume.");
      }
      goal.status = "queued";
      task.status = "queued";
      task.currentGoalId = goal.id;
      task.currentPhase = "planexec";
      task.controlIntent = "run";
      task.resumeKind = "paused_continuation";
      task.summary = `用户已回答 Review 决策；将继续 Goal ${goal.order}。`;
      this.touch(task, "loop_user_decision_answered", {
        goalId: goal.id,
        decisionId: decision.id,
        choiceId: choice.id,
      });
      this.appendTaskMemory(task, "execution_note", {
        kind: "loop_user_decision_answer",
        title: decision.title,
        question: decision.question,
        choice: choice.label,
        ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      });
      if (input.commandId) {
        this.authorityStore.rememberCommand({
          commandId: input.commandId,
          taskId: task.id,
          action: commandAction,
          resultRevision: task.authorityRevision,
        });
      }
      this.schedule();
      return task;
    } finally {
      release?.();
      if (this.actionTails.get(input.taskId) === tail) {
        this.actionTails.delete(input.taskId);
      }
    }
  }

  private async performAction(
    taskId: string,
    action: BackgroundTaskAction,
  ): Promise<LoopTaskModel | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }
    if (action === "stop") {
      if (["done", "stopped", "blocked"].includes(task.status)) {
        throw new Error(`Cannot stop a ${task.status} background task.`);
      }
      task.status = "stopped";
      task.controlIntent = "stopped";
      task.stoppedAt = nowIso();
      task.summary = "用户已停止后台任务。";
      if (task.pendingUserDecision?.status === "pending") {
        task.pendingUserDecision.status = "canceled";
      }
      this.markCurrentGoal(task, "stopped");
      await this.cancelCurrentPhase(task);
      this.touch(task);
      return task;
    }
    if (action === "pause") {
      if (task.status === "running" || task.status === "awaiting_provider") {
        task.controlIntent = "pause_after_phase";
        task.pauseRequestedAt = nowIso();
        task.summary = `${phaseTitle(task.currentPhase ?? "planexec")} 会完成当前原子阶段，然后暂停后续 Loop。`;
        this.touch(task);
        return task;
      }
      task.status = "paused";
      task.controlIntent = "pause_after_phase";
      task.pauseRequestedAt = nowIso();
      task.summary = "后台任务已暂停；Resume 会从当前工作游标继续。";
      if (task.currentPhase) {
        this.markCurrentGoal(task, "paused");
      }
      this.touch(task);
      return task;
    }
    if (action === "resume") {
      if (
        task.status === "paused" ||
        task.status === "interrupted" ||
        task.status === "stopped" ||
        task.status === "blocked" ||
        task.status === "evidence_capture_failed" ||
        task.status === "evidence_invalid" ||
        task.status === "workspace_changed_concurrently"
      ) {
        const blockedPhase =
          task.status === "blocked"
            ? [...(this.currentGoal(task)?.phases ?? [])]
                .reverse()
                .find((phase) => phase.status === "blocked")
            : undefined;
        const rebaselineRequired =
          task.status === "evidence_invalid" || task.status === "workspace_changed_concurrently";
        const retryingBaselineCapture = task.status === "evidence_capture_failed";
        const resumeKind = task.status === "stopped" ? "stopped_recovery" : "paused_continuation";
        const goal = this.currentGoal(task);
        if (blockedPhase && goal) {
          blockedPhase.status = "interrupted";
          blockedPhase.interruptedReason = "user_resumed_blocked_phase";
          task.currentPhase = blockedPhase.phase;
          goal.status = "interrupted";
        }
        let rebaselineEvidence: LoopTaskModel["baselineEvidence"];
        if (rebaselineRequired && goal) {
          // The user explicitly chose to continue after reviewing an external
          // workspace mutation. Never reuse the old PlanExec receipt as proof:
          // start a new round from a newly sealed workspace baseline instead.
          goal.round += 1;
          goal.status = "queued";
          goal.phases.push({ phase: "planexec", status: "queued", round: goal.round });
          goal.phases.push({ phase: "review", status: "queued", round: goal.round });
          task.goalRound = goal.round;
          task.currentPhase = null;
          rebaselineEvidence = await this.evidenceStore.captureAsync({
            kind: "task_baseline",
            taskId: task.id,
            workspacePath: task.workspacePath,
            timelineRefs: [],
          });
          task.baselineEvidence = rebaselineEvidence;
        }
        task.status = "queued";
        task.controlIntent = "run";
        task.resumeKind = resumeKind;
        task.pauseRequestedAt = undefined;
        task.stoppedAt = undefined;
        if (
          task.currentPhase === "review" &&
          goal?.phases.find((phase) => phase.phase === "review" && phase.round === goal.round)
            ?.agentId === undefined
        ) {
          // Review was queued by a pause boundary, not actually started.
          task.currentPhase = null;
        }
        task.summary = rebaselineRequired
          ? `已重新建立 workspace evidence baseline；将重跑 Goal ${goal?.order ?? "当前"} 的 PlanExec。`
          : retryingBaselineCapture
            ? "正在重新封存 workspace evidence baseline；完成后会自动开始当前 Goal。"
            : blockedPhase
              ? `将从 Goal ${goal?.order ?? "当前"} 的 ${phaseTitle(blockedPhase.phase)} 阶段恢复。`
              : resumeKind === "stopped_recovery"
                ? "后台任务将从停止时的阶段游标继续，并优先复用原 provider session。"
                : "后台任务将从已完成阶段后的游标继续。";
        this.touch(task);
        if (rebaselineEvidence) {
          this.appendTaskMemory(task, "baseline_evidence", rebaselineEvidence);
        }
        this.schedule();
        return task;
      }
      throw new Error(`Cannot resume a ${task.status} background task.`);
    }
    if (action === "budget_continue") {
      if (task.status !== "budget_wait") {
        throw new Error("Raise strength is only available while the task is waiting on budget.");
      }
      const nextStrength = nextLoopStrength(task.loopStrength);
      if (nextStrength) {
        task.loopStrength = nextStrength;
        task.budget.loopStrength = nextStrength;
        task.budget.maxFailedReviews = budgetForStrength(nextStrength);
        task.budgetEnvelope = budgetEnvelopeForStrength(nextStrength);
        task.summary = `用户已将后台 Loop 预算提升到 ${nextStrength}。`;
      } else {
        const envelope = task.budgetEnvelope ?? budgetEnvelopeForStrength(task.loopStrength);
        task.budgetEnvelope = {
          ...envelope,
          maxActiveDurationMs:
            envelope.maxActiveDurationMs +
            budgetEnvelopeForStrength(task.loopStrength).maxActiveDurationMs,
          maxTokens: envelope.maxTokens + budgetEnvelopeForStrength(task.loopStrength).maxTokens,
          maxToolCalls:
            envelope.maxToolCalls + budgetEnvelopeForStrength(task.loopStrength).maxToolCalls,
          maxChangedFiles:
            envelope.maxChangedFiles + budgetEnvelopeForStrength(task.loopStrength).maxChangedFiles,
          maxChangedLines:
            envelope.maxChangedLines + budgetEnvelopeForStrength(task.loopStrength).maxChangedLines,
          maxReplans: envelope.maxReplans + budgetEnvelopeForStrength(task.loopStrength).maxReplans,
        };
        task.budget.maxFailedReviews += budgetForStrength(task.loopStrength);
        if (task.budgetUsage) {
          task.budgetUsage.consecutiveSameRootCause = 0;
        }
        task.summary = "用户已批准一段额外 Infinite Loop 预算。";
      }
      task.status = "queued";
      task.budgetWait = undefined;
      task.controlIntent = "run";
      this.touch(task, "budget_continued");
      this.schedule();
      return task;
    }
    if (action === "review_only") {
      if (task.status !== "budget_wait") {
        throw new Error("Review evidence is only available while the task is waiting on budget.");
      }
      const currentMarkedGoal = task.currentGoalId
        ? (task.goals.find((goal) => goal.id === task.currentGoalId) ?? null)
        : null;
      const goal = currentMarkedGoal?.latestPlanExecResult
        ? currentMarkedGoal
        : this.currentGoal(task);
      if (!goal?.latestPlanExecResult) {
        throw new Error("The current goal has no PlanExec evidence available for Review.");
      }
      task.currentPhase = "review";
      task.currentGoalId = goal.id;
      task.status = "queued";
      task.budgetWait = undefined;
      task.controlIntent = "run";
      task.summary = `将仅重新 Review Goal ${goal.order} 的现有 PlanExec 证据。`;
      this.touch(task, "review_only_queued", { goalId: goal.id });
      this.schedule();
      return task;
    }
    return task;
  }

  resolvePlanExecResult(
    agentId: string,
    input: ThothLoopPlanExecResultInput,
    providerTurnId?: string,
    resultToolCallId?: string,
  ): boolean {
    return this.resolvePhaseResult(
      agentId,
      {
        kind: "planexec",
        result: {
          ...input,
          goal_id: "",
          round: 0,
          ...(resultToolCallId ? { result_tool_call_id: resultToolCallId } : {}),
        },
      },
      providerTurnId,
    );
  }

  resolveReviewIndependentAssessment(
    agentId: string,
    input: ThothLoopReviewIndependentAssessmentInput,
    providerTurnId?: string,
  ): string | null {
    const pending = this.pendingByAgent.get(agentId);
    if (!pending || pending.phase !== "review" || pending.reviewAssessment) {
      return null;
    }
    if (
      providerTurnId &&
      providerTurnId !== "unknown-turn" &&
      pending.providerTurnId &&
      pending.providerTurnId !== providerTurnId
    ) {
      this.options.logger.warn(
        {
          taskId: pending.taskId,
          goalId: pending.goalId,
          phase: pending.phase,
          attemptId: pending.attemptId,
          expectedTurnId: pending.providerTurnId,
          receivedTurnId: providerTurnId,
        },
        "Ignored stale Loop independent Review assessment from an older provider turn",
      );
      return null;
    }
    if (providerTurnId && providerTurnId !== "unknown-turn" && !pending.providerTurnId) {
      pending.providerTurnId = providerTurnId;
    }
    const task = this.tasks.get(pending.taskId);
    const goal = task?.goals.find((entry) => entry.id === pending.goalId);
    const planExec = goal?.latestPlanExecResult;
    if (!task || !goal || !planExec) {
      return null;
    }
    pending.reviewAssessment = input;
    task.summary = `Review 已形成独立判断，正在对照 PlanExec 对 Goal ${goal.order} 的工作说明。`;
    this.touch(task, "review_independent_assessment", {
      goalId: goal.id,
      phaseRunId: pending.phaseRunId,
    });
    this.appendTaskMemory(task, "execution_note", {
      kind: "review_independent_assessment",
      goalTitle: goal.title,
      observations: input.observations,
      workingTheory: input.working_theory,
      inspectionFocus: input.inspection_focus,
    });
    return [
      "You have now completed the independent assessment. Compare it against PlanExec's semantic account below; treat it as a fallible account, not authority.",
      `Plan used: ${planExec.planSummary}`,
      `Work claimed: ${planExec.executionSummary}`,
      `Inspectible evidence offered: ${planExec.evidence.join("; ")}`,
      `Validation claimed: ${planExec.validationPerformed.join("; ") || "none reported"}`,
      `Remaining risks claimed: ${planExec.remainingRisks.join("; ") || "none reported"}`,
      `Requested review focus: ${planExec.nextReviewFocus}`,
      "Now submit the final Review Direction Memo and exactly one semantic outcome.",
    ].join("\n\n");
  }

  resolveReviewVerdict(
    agentId: string,
    input: ThothLoopReviewVerdictInput,
    providerTurnId?: string,
    resultToolCallId?: string,
  ): boolean {
    const pending = this.pendingByAgent.get(agentId);
    if (pending?.phase === "review" && !pending.reviewAssessment) {
      this.options.logger.warn(
        { taskId: pending.taskId, goalId: pending.goalId, agentId },
        "Rejected Review verdict before independent assessment",
      );
      return false;
    }
    return this.resolvePhaseResult(
      agentId,
      {
        kind: "review",
        result: {
          ...input,
          goal_id: "",
          round: 0,
          ...(resultToolCallId ? { result_tool_call_id: resultToolCallId } : {}),
        },
      },
      providerTurnId,
    );
  }

  resolveBlocked(
    agentId: string,
    input: ThothLoopReportBlockedInput,
    providerTurnId?: string,
  ): boolean {
    return this.resolvePhaseResult(
      agentId,
      { kind: "blocked", result: { ...input } },
      providerTurnId,
    );
  }

  private resolvePhaseResult(
    agentId: string,
    result: PhaseResult,
    providerTurnId?: string,
  ): boolean {
    const pending = this.pendingByAgent.get(agentId);
    if (!pending) {
      return false;
    }
    if (
      providerTurnId &&
      providerTurnId !== "unknown-turn" &&
      pending.providerTurnId &&
      pending.providerTurnId !== providerTurnId
    ) {
      this.options.logger.warn(
        {
          taskId: pending.taskId,
          goalId: pending.goalId,
          phase: pending.phase,
          attemptId: pending.attemptId,
          expectedTurnId: pending.providerTurnId,
          receivedTurnId: providerTurnId,
        },
        "Ignored stale Loop runtime-tool result from an older provider turn",
      );
      return false;
    }
    const normalizedResult = this.bindPendingPhaseResult(pending, result);
    const mismatch = this.validatePendingPhaseResult(pending, normalizedResult);
    if (mismatch) {
      clearTimeout(pending.timeout);
      this.pendingByAgent.delete(agentId);
      const task = this.tasks.get(pending.taskId);
      const goal = task?.goals.find((entry) => entry.id === pending.goalId);
      if (task && goal) {
        this.blockTask(task, goal, mismatch);
      }
      pending.reject(new Error(mismatch));
      return false;
    }
    clearTimeout(pending.timeout);
    this.pendingByAgent.delete(agentId);
    const task = this.tasks.get(pending.taskId);
    if (task?.status === "awaiting_provider") {
      const goal = task.goals.find((entry) => entry.id === pending.goalId);
      const phase = goal ? goalPhase(goal, pending.phase, pending.round) : null;
      if (phase) {
        phase.status = "running";
        phase.lastActivityAt = nowIso();
      }
      task.status = "running";
      task.summary = `${phaseTitle(pending.phase)} 已收到 provider 语义结论，正在收敛当前阶段。`;
      this.touch(task, "provider_result_resumed", { phaseRunId: pending.phaseRunId });
    }
    pending.resolve(normalizedResult);
    return true;
  }

  /**
   * Phase identity is daemon authority, never an Agent Harness task. The
   * caller's active execution generation owns this binding, so late provider
   * tool callbacks cannot redirect a result to another goal or round.
   */
  private bindPendingPhaseResult(pending: PendingPhaseResult, result: PhaseResult): PhaseResult {
    if (result.kind === "blocked") {
      return {
        kind: "blocked",
        result: {
          ...result.result,
          goal_id: pending.goalId,
          phase: pending.phase,
        },
      };
    }
    const withBinding =
      result.kind === "planexec"
        ? {
            kind: "planexec" as const,
            result: {
              ...result.result,
              goal_id: pending.goalId,
              round: pending.round,
              phase_run_id: pending.phaseRunId,
            },
          }
        : {
            kind: "review" as const,
            result: {
              ...result.result,
              goal_id: pending.goalId,
              round: pending.round,
            },
          };
    return withBinding;
  }

  private validatePendingPhaseResult(
    pending: PendingPhaseResult,
    result: PhaseResult,
  ): string | null {
    if (result.kind === "blocked") {
      return null;
    }
    if (result.kind !== pending.phase) {
      return `Loop result used ${result.kind}, but current phase is ${pending.phase}.`;
    }
    if (result.result.goal_id && result.result.goal_id !== pending.goalId) {
      return `Loop result targeted ${result.result.goal_id}, but current goal is ${pending.goalId}.`;
    }
    if (result.result.round !== undefined && result.result.round !== pending.round) {
      return `Loop result targeted round ${result.result.round}, but current round is ${pending.round}.`;
    }
    if (
      pending.phaseRunId &&
      result.kind === "planexec" &&
      result.result.phase_run_id !== pending.phaseRunId
    ) {
      return `Loop result targeted phase run ${result.result.phase_run_id}, but active phase run is ${pending.phaseRunId}.`;
    }
    return null;
  }

  private load(): void {
    try {
      let recoveredLegacyBudgetWait = false;
      for (const task of this.authorityStore.listTasks()) {
        const migrateLegacyBaselineFailure =
          task.status === "blocked" &&
          !task.baselineEvidence &&
          task.summary === "无法封存后台任务的 workspace evidence baseline。";
        if (task.status === "running") {
          task.status = "interrupted";
          task.summary = "daemon 重启后检测到阶段中断；Resume 会从当前阶段重开。";
          task.updatedAt = nowIso();
          const goal = this.currentGoal(task);
          if (goal && (goal.status === "running_planexec" || goal.status === "running_review")) {
            goal.status = "interrupted";
          }
        }
        this.tasks.set(task.id, task);
        this.providerByTask.set(task.id, task.providerBinding);
        if (migrateLegacyBaselineFailure) {
          task.status = "evidence_capture_failed";
          task.currentPhase = null;
          task.summary =
            "workspace evidence baseline 未封存成功；可以 Resume 后重新封存并继续当前 Goal。";
          this.touch(task, "legacy_baseline_capture_failure_reclassified");
        }
        recoveredLegacyBudgetWait =
          this.repairLegacyWorkspaceSizeBudgetWait(task) || recoveredLegacyBudgetWait;
        if (task.status === "interrupted" && task.authorityRevision !== undefined) {
          this.touch(task, "daemon_restart_interrupted");
        }
      }
      if (recoveredLegacyBudgetWait) {
        // Run after constructor initialization, when every persisted task and
        // worktree lock has been loaded into this scheduler instance.
        queueMicrotask(() => this.schedule());
      }
    } catch (error) {
      this.options.logger.warn({ err: error }, "Failed to load Thoth loop tasks");
    }
  }

  /**
   * Older Loop records could persist a phase agent as a normal workspace agent
   * or lose the phase's agentId while the durable record still existed. Repair
   * both forms from the Loop authority labels before any UI list is hydrated.
   */
  private async reconcileStoredPhaseAgents(): Promise<void> {
    const storage = this.options.agentStorage;
    if (!storage) {
      return;
    }
    try {
      const records = await storage.list();
      const loopPhaseAgentIds = new Set(
        Array.from(this.tasks.values()).flatMap((task) =>
          task.goals.flatMap((goal) =>
            goal.phases.flatMap((phase) => (phase.agentId ? [phase.agentId] : [])),
          ),
        ),
      );
      for (const record of records) {
        if (loopPhaseAgentIds.has(record.id) || record.labels?.surface === "thoth-loop") {
          continue;
        }
        await this.restoreLegacyForegroundVisibility(record.id, record);
      }
      for (const task of this.tasks.values()) {
        let changed = false;
        for (const goal of task.goals) {
          for (const phase of goal.phases) {
            const record = records.find(
              (candidate) =>
                candidate.labels?.surface === "thoth-loop" &&
                candidate.labels.loopTaskId === task.id &&
                candidate.labels.loopGoalId === goal.id &&
                candidate.labels.loopPhase === phase.phase &&
                (phase.phase !== "review" || candidate.labels.loopRound === String(phase.round)),
            );
            if (!record) {
              continue;
            }
            if (!record.internal) {
              await storage.upsert({ ...record, internal: true, updatedAt: nowIso() });
            }
            this.options.agentManager.markAgentInternal(record.id);
            if (!phase.agentId) {
              phase.agentId = record.id;
              changed = true;
            }
          }
        }
        if (changed) {
          this.touch(task, "phase_agent_reconciled");
        }
      }
    } catch (error) {
      this.options.logger.warn({ err: error }, "Failed to reconcile stored Loop phase agents");
    }
  }

  private findPhaseOwner(agentId: string): {
    task: LoopTaskModel;
    goal: LoopGoalRecord;
    phase: LoopPhaseRecord;
  } | null {
    const candidates: Array<{
      task: LoopTaskModel;
      goal: LoopGoalRecord;
      phase: LoopPhaseRecord;
    }> = [];
    for (const task of this.tasks.values()) {
      for (const goal of task.goals) {
        for (const phase of goal.phases) {
          if (phase.agentId === agentId) {
            candidates.push({ task, goal, phase });
          }
        }
      }
    }
    return (
      candidates.sort((left, right) => {
        const leftCurrent =
          left.task.currentGoalId === left.goal.id && left.task.currentPhase === left.phase.phase
            ? 1
            : 0;
        const rightCurrent =
          right.task.currentGoalId === right.goal.id &&
          right.task.currentPhase === right.phase.phase
            ? 1
            : 0;
        if (leftCurrent !== rightCurrent) {
          return rightCurrent - leftCurrent;
        }
        if (left.phase.round !== right.phase.round) {
          return right.phase.round - left.phase.round;
        }
        if ((left.phase.executionGeneration ?? 0) !== (right.phase.executionGeneration ?? 0)) {
          return (right.phase.executionGeneration ?? 0) - (left.phase.executionGeneration ?? 0);
        }
        return (
          Date.parse(right.phase.attemptStartedAt ?? "") -
          Date.parse(left.phase.attemptStartedAt ?? "")
        );
      })[0] ?? null
    );
  }

  private async restoreLegacyForegroundVisibility(
    agentId: string,
    record: StoredAgentRecord | null,
  ): Promise<void> {
    if (!record || !this.isLegacyMisclassifiedForegroundAgent(record)) {
      return;
    }
    await this.options.agentStorage?.upsert({
      ...record,
      internal: false,
      updatedAt: nowIso(),
    });
    this.options.agentManager.setAgentInternal(agentId, false);
    this.options.logger.info(
      { agentId },
      "Restored foreground visibility for agent misclassified by legacy Loop phase recovery",
    );
  }

  private isLegacyMisclassifiedForegroundAgent(record: StoredAgentRecord): boolean {
    const labels = record.labels ?? {};
    const hasOwnerLabel = Object.keys(labels).length > 0;
    const runtimeTools = readThothRuntimeToolsConfig(record.config ?? {});
    const isLoopRuntime =
      runtimeTools?.scope === "loop_planexec" || runtimeTools?.scope === "loop_review";
    const isLegacySecretaryPacket = record.title?.startsWith('{"type":"provider_input"') === true;
    return record.internal === true && !hasOwnerLabel && !isLoopRuntime && !isLegacySecretaryPacket;
  }

  private loadLocks(): void {
    try {
      for (const raw of this.authorityStore.listLeases()) {
        this.worktreeLocks.set(resolve(raw.workspacePath), {
          workspacePath: resolve(raw.workspacePath),
          taskId: raw.taskId,
          phase: raw.phase ?? null,
          ...(raw.phaseAgentId ? { phaseAgentId: raw.phaseAgentId } : {}),
          createdAt: raw.createdAt,
          heartbeatAt: raw.heartbeatAt,
          expiresAt: raw.expiresAt,
        });
      }
    } catch (error) {
      this.options.logger.warn({ err: error }, "Failed to load Thoth loop worktree locks");
    }
  }

  private reconcileLoadedLocks(): void {
    let changed = false;
    for (const [workspacePath, lock] of Array.from(this.worktreeLocks.entries())) {
      const task = this.tasks.get(lock.taskId);
      if (!task || task.status !== "running") {
        this.worktreeLocks.delete(workspacePath);
        this.authorityStore.releaseLease(workspacePath, lock.taskId);
        changed = true;
        continue;
      }
      task.status = "interrupted";
      task.summary = "daemon 重启后检测到后台 Loop worktree lock；Resume 会从当前阶段重开。";
      const goal = this.currentGoal(task);
      if (goal && (goal.status === "running_planexec" || goal.status === "running_review")) {
        goal.status = "interrupted";
      }
      this.worktreeLocks.delete(workspacePath);
      this.authorityStore.releaseLease(workspacePath, lock.taskId);
      changed = true;
    }
    if (changed) {
      for (const task of this.tasks.values()) {
        if (task.status === "interrupted") {
          this.touch(task, "daemon_restart_interrupted");
        }
      }
      this.worktreeLocks.clear();
    }
  }

  private acquireWorktreeLock(task: LoopTaskModel): boolean {
    const workspacePath = resolve(task.workspacePath);
    if (this.worktreeLocks.has(workspacePath)) {
      return false;
    }
    const now = nowIso();
    const lock: LoopWorktreeLockRecord = {
      workspacePath,
      taskId: task.id,
      phase: task.currentPhase,
      createdAt: now,
      heartbeatAt: now,
      expiresAt: new Date(Date.now() + WORKTREE_LEASE_MS).toISOString(),
    };
    if (!this.authorityStore.acquireLease(lock)) {
      return false;
    }
    this.worktreeLocks.set(workspacePath, lock);
    this.startWorktreeHeartbeat(task);
    return true;
  }

  private startWorktreeHeartbeat(task: LoopTaskModel): void {
    const workspacePath = resolve(task.workspacePath);
    if (this.worktreeHeartbeatTimers.has(workspacePath)) {
      return;
    }
    const timer = setInterval(() => {
      const current = this.tasks.get(task.id);
      if (!current || !this.worktreeLocks.has(workspacePath)) {
        return;
      }
      this.updateWorktreeLock(current);
    }, WORKTREE_HEARTBEAT_MS);
    timer.unref?.();
    this.worktreeHeartbeatTimers.set(workspacePath, timer);
  }

  private updateWorktreeLock(task: LoopTaskModel, input: { phaseAgentId?: string } = {}): void {
    const workspacePath = resolve(task.workspacePath);
    const current = this.worktreeLocks.get(workspacePath);
    if (!current || current.taskId !== task.id) {
      return;
    }
    const next: LoopWorktreeLockRecord = {
      ...current,
      phase: task.currentPhase,
      ...(input.phaseAgentId ? { phaseAgentId: input.phaseAgentId } : {}),
      heartbeatAt: nowIso(),
      expiresAt: new Date(Date.now() + WORKTREE_LEASE_MS).toISOString(),
    };
    this.worktreeLocks.set(workspacePath, next);
    this.authorityStore.acquireLease(next);
  }

  private releaseWorktreeLock(task: LoopTaskModel): void {
    const workspacePath = resolve(task.workspacePath);
    const heartbeat = this.worktreeHeartbeatTimers.get(workspacePath);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.worktreeHeartbeatTimers.delete(workspacePath);
    }
    if (this.worktreeLocks.get(workspacePath)?.taskId === task.id) {
      this.worktreeLocks.delete(workspacePath);
      this.authorityStore.releaseLease(workspacePath, task.id);
    }
  }

  private touch(
    task: LoopTaskModel,
    kind = "task_projection_updated",
    payload: Record<string, unknown> = {},
  ): void {
    try {
      const persisted = this.authorityStore.append(task, {
        kind,
        goalId: task.currentGoalId ?? undefined,
        phaseRunId:
          task.currentGoalId && task.currentPhase
            ? this.currentGoal(task)?.phases.find(
                (phase) => phase.phase === task.currentPhase && phase.round === task.goalRound,
              )?.phaseRunId
            : undefined,
        payload,
      });
      // Keep in-flight goal/phase references stable. `persisted` is a parsed
      // projection snapshot of this same object; replacing nested arrays here
      // would detach the active phase from later provider/session updates.
      task.authorityRevision = persisted.authorityRevision;
      task.updatedAt = persisted.updatedAt;
    } catch (error) {
      this.options.logger.error(
        { err: error, taskId: task.id, kind },
        "Failed to append Loop authority event",
      );
      throw error;
    }
    this.emit(task);
  }

  private appendTaskMemory(
    task: LoopTaskModel,
    kind:
      | "clarify_transcript"
      | "task_card"
      | "goals_card"
      | "baseline_evidence"
      | "planexec_result"
      | "review_verdict"
      | "execution_note",
    content: unknown,
  ): void {
    if (task.authorityRevision === undefined) {
      return;
    }
    this.authorityStore.appendMemory(task.id, kind, content, task.authorityRevision);
  }

  private emit(task: LoopTaskModel): void {
    this.options.onTaskUpdated?.(task);
  }

  private schedule(): void {
    this.schedulerRerunRequested = true;
    if (this.schedulerRunning || this.schedulerQueued) {
      return;
    }
    this.schedulerQueued = true;
    setImmediate(() => {
      this.schedulerQueued = false;
      if (this.schedulerRunning) {
        return;
      }
      this.schedulerRunning = true;
      this.schedulerRerunRequested = false;
      void this.runScheduler()
        .catch((error) => {
          this.options.logger.error({ err: error }, "Thoth Loop scheduler run failed");
        })
        .finally(() => {
          this.schedulerRunning = false;
          if (
            this.schedulerRerunRequested ||
            Array.from(this.tasks.values()).some((task) => task.status === "queued")
          ) {
            this.schedule();
          }
        });
    });
  }

  private async runScheduler(): Promise<void> {
    while (true) {
      const next = Array.from(this.tasks.values())
        .filter((task) => task.status === "queued")
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
        .find((task) => !this.worktreeLocks.has(resolve(task.workspacePath)));
      if (!next) {
        return;
      }
      if (!this.acquireWorktreeLock(next)) {
        return;
      }
      try {
        await this.runTask(next);
      } finally {
        this.releaseWorktreeLock(next);
      }
    }
  }

  private async runTask(task: LoopTaskModel): Promise<void> {
    const provider = this.providerByTask.get(task.id) ?? task.providerBinding;
    if (!provider) {
      task.status = "blocked";
      task.summary = "缺少 provider session 配置，无法启动后台 Loop。";
      this.touch(task);
      return;
    }
    if (
      this.options.agentManager.getProviderCapabilities(provider.provider)
        ?.supportsNativeThothTools !== true
    ) {
      task.status = "blocked";
      task.summary = `后台 Loop 需要 provider ${provider.provider} 支持 Thoth runtime tools；该 adapter 尚未声明此能力。`;
      this.touch(task);
      return;
    }
    const goal = this.currentGoal(task);
    if (!goal) {
      task.status = "done";
      task.currentGoalId = null;
      task.currentPhase = null;
      task.summary = "所有 goals 已通过 Review。";
      this.touch(task, "task_completed");
      return;
    }

    task.status = "running";
    task.currentGoalId = goal.id;
    task.goalRound = goal.round;
    if (!(await this.ensureTaskBaseline(task))) {
      return;
    }
    const phase = task.currentPhase ?? (this.hasCompletedPlanExec(goal) ? "review" : "planexec");
    if (phase === "review") {
      await this.runReview(task, goal, provider);
    } else {
      await this.runPlanExec(task, goal, provider);
    }
    if (task.status !== "running") {
      return;
    }

    if (phase === "planexec" && goal.latestPlanExecResult) {
      if (this.pauseAfterPhaseRequested(task)) {
        this.pauseAfterPlanExec(task, goal);
        return;
      }
      task.status = "queued";
      task.summary = `PlanExec 已完成；等待独立 Review Goal ${goal.order}。`;
      this.touch(task, "phase_queued", { phase: "review", goalId: goal.id });
      this.schedule();
      return;
    }

    if (phase === "review" && goal.status === "passed") {
      const nextGoal = task.goals.find((candidate) => candidate.status === "queued");
      task.currentGoalId = nextGoal?.id ?? null;
      task.currentPhase = null;
      task.goalRound = nextGoal?.round ?? task.goalRound;
      if (nextGoal && this.pauseAfterPhaseRequested(task)) {
        task.status = "paused";
        task.summary = `Review 已完成；将在 Goal ${nextGoal.order} 开始前暂停。`;
      } else {
        task.status = nextGoal ? "queued" : "done";
        task.controlIntent = nextGoal ? task.controlIntent : "run";
        task.summary = nextGoal
          ? `Goal ${goal.order} 已通过，准备推进到 Goal ${nextGoal.order}。`
          : "所有 goals 已通过 Review。";
      }
      this.touch(task, nextGoal ? "goal_advanced" : "task_completed");
    }
  }

  private async ensureTaskBaseline(task: LoopTaskModel): Promise<boolean> {
    if (task.baselineEvidence) {
      return true;
    }
    task.summary = "后台任务已注册，正在封存 workspace evidence baseline。";
    this.touch(task, "task_baseline_capture_started");
    try {
      const baselineEvidence = await this.evidenceStore.captureAsync({
        kind: "task_baseline",
        taskId: task.id,
        workspacePath: task.workspacePath,
        timelineRefs: [],
      });
      if (task.status !== "running") {
        // Stop/restart may settle while a filesystem digest is in flight. The
        // capture is then historical diagnostic data, not authority to launch
        // a new PlanExec phase after the task has been stopped.
        return false;
      }
      if (task.controlIntent === "pause_after_phase") {
        task.status = "paused";
        task.summary = "workspace evidence baseline 已封存；已在开始 PlanExec 前暂停。";
        this.touch(task, "task_baseline_capture_paused");
        return false;
      }
      task.baselineEvidence = baselineEvidence;
      this.appendTaskMemory(task, "baseline_evidence", baselineEvidence);
      this.touch(task, "task_baseline_captured", { baselineEvidenceId: baselineEvidence.id });
      return true;
    } catch (error) {
      task.status = "evidence_capture_failed";
      task.currentPhase = null;
      task.summary =
        "workspace evidence baseline 未封存成功；可以 Resume 后重试，不会执行半完成的 Goal。";
      this.touch(task, "task_baseline_capture_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async beginPhaseTelemetry(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    phase: LoopPhaseKind,
    record: LoopPhaseRecord,
  ): Promise<ActivePhaseTelemetry> {
    const telemetry: ActivePhaseTelemetry = {
      startedAtMs: Date.now(),
      commandReceipts: new Map(),
      timelineRefs: new Set(),
    };
    if (record.phaseRunId) {
      const startKind = phase === "review" ? "review_start" : "planexec_start";
      const artifactRoot =
        phase === "review"
          ? this.evidenceStore.createReviewArtifactDirectory({
              taskId: task.id,
              phaseRunId: record.phaseRunId,
            })
          : undefined;
      telemetry.artifactRoot = artifactRoot;
      const startEvidence = await this.evidenceStore.captureAsync({
        kind: startKind,
        taskId: task.id,
        goalId: goal.id,
        phase,
        phaseRunId: record.phaseRunId,
        workspacePath: task.workspacePath,
        ...(artifactRoot ? { artifactRoot } : {}),
      });
      record.evidenceRef = startEvidence;
      if (phase === "review") {
        telemetry.reviewStartEvidence = startEvidence;
      }
    }
    if (record.phaseRunId) {
      this.activePhaseTelemetry.set(record.phaseRunId, telemetry);
    }
    return telemetry;
  }

  private async completePhaseEvidence(input: {
    task: LoopTaskModel;
    goal: LoopGoalRecord;
    phase: LoopPhaseKind;
    record: LoopPhaseRecord;
    declaredEvidence?: string[];
    validationPerformed?: string[];
  }): Promise<LoopEvidenceRef | undefined> {
    const phaseRunId = input.record.phaseRunId;
    if (!phaseRunId) {
      return undefined;
    }
    const telemetry = this.activePhaseTelemetry.get(phaseRunId);
    const durationMs = Math.max(0, Date.now() - (telemetry?.startedAtMs ?? Date.now()));
    const usage = telemetry?.usage;
    const ref = await this.evidenceStore.captureAsync({
      kind: input.phase === "planexec" ? "planexec_result" : "review_result",
      taskId: input.task.id,
      goalId: input.goal.id,
      phase: input.phase,
      phaseRunId,
      workspacePath: input.task.workspacePath,
      commandReceipts: Array.from(telemetry?.commandReceipts.values() ?? []),
      timelineRefs: Array.from(telemetry?.timelineRefs ?? []),
      ...(usage ? { usage } : {}),
      ...(input.declaredEvidence ? { declaredEvidence: input.declaredEvidence } : {}),
      ...(input.validationPerformed ? { validationPerformed: input.validationPerformed } : {}),
      ...(telemetry?.artifactRoot ? { artifactRoot: telemetry.artifactRoot } : {}),
    });
    input.record.evidenceRef = ref;
    this.updateBudgetUsage(input.task, {
      activeDurationMs: durationMs,
      tokens: this.usageTokens(usage),
      toolCalls: telemetry?.commandReceipts.size ?? 0,
      tokenMetered: usage !== undefined,
      latestEvidence: ref,
    });
    this.activePhaseTelemetry.delete(phaseRunId);
    return ref;
  }

  private usageTokens(usage: AgentUsage | undefined): number {
    if (!usage) {
      return 0;
    }
    return (usage.inputTokens ?? 0) + (usage.cachedInputTokens ?? 0) + (usage.outputTokens ?? 0);
  }

  private updateBudgetUsage(
    task: LoopTaskModel,
    input: {
      activeDurationMs: number;
      tokens: number;
      toolCalls: number;
      tokenMetered: boolean;
      latestEvidence: LoopEvidenceRef;
    },
  ): void {
    const current = task.budgetUsage ?? {
      activeDurationMs: 0,
      tokens: 0,
      toolCalls: 0,
      changedFiles: 0,
      changedLines: 0,
      replans: 0,
      consecutiveSameRootCause: 0,
      tokenMetered: false,
    };
    const manifest = this.evidenceStore.readManifest(input.latestEvidence);
    const baselineManifest = task.baselineEvidence
      ? this.evidenceStore.readManifest(task.baselineEvidence)
      : null;
    const changedFiles = manifest
      ? Math.max(
          0,
          manifest.workspace.changedFiles - (baselineManifest?.workspace.changedFiles ?? 0),
        )
      : current.changedFiles;
    const changedLines = manifest
      ? Math.max(
          0,
          manifest.workspace.changedLines - (baselineManifest?.workspace.changedLines ?? 0),
        )
      : current.changedLines;
    task.budgetUsage = {
      ...current,
      activeDurationMs: current.activeDurationMs + input.activeDurationMs,
      tokens: current.tokens + input.tokens,
      toolCalls: current.toolCalls + input.toolCalls,
      // The budget belongs to this task, not to arbitrary pre-existing files
      // in a selected workspace. Manifest totals are therefore measured from
      // the sealed task baseline rather than used as absolute workspace size.
      changedFiles,
      changedLines,
      tokenMetered: current.tokenMetered || input.tokenMetered,
    };
  }

  /**
   * Before task-scoped baselines existed, file and line envelopes used a
   * whole-workspace manifest total. Rebuild only these two dimensions from
   * durable evidence while loading so broad pre-existing workspaces cannot
   * remain in a false budget wait after the accounting correction ships.
   */
  private repairLegacyWorkspaceSizeBudgetWait(task: LoopTaskModel): boolean {
    const baseline = task.baselineEvidence
      ? this.evidenceStore.readManifest(task.baselineEvidence)
      : null;
    const latestEvidence = this.latestPhaseEvidence(task);
    const latest = latestEvidence ? this.evidenceStore.readManifest(latestEvidence) : null;
    const usage = task.budgetUsage;
    if (!baseline || !latest || !usage) {
      return false;
    }

    const changedFiles = Math.max(
      0,
      latest.workspace.changedFiles - baseline.workspace.changedFiles,
    );
    const changedLines = Math.max(
      0,
      latest.workspace.changedLines - baseline.workspace.changedLines,
    );
    if (usage.changedFiles === changedFiles && usage.changedLines === changedLines) {
      return false;
    }

    usage.changedFiles = changedFiles;
    usage.changedLines = changedLines;
    const wasWorkspaceOnlyBudgetWait =
      task.status === "budget_wait" &&
      (task.budgetWait?.exhaustedDimensions ?? []).every(
        (dimension) => dimension === "changed_files" || dimension === "changed_lines",
      );
    const exhausted = this.budgetExceeded(task);
    if (wasWorkspaceOnlyBudgetWait && exhausted.length === 0) {
      const goal = this.currentGoal(task);
      if (goal?.status === "paused") {
        goal.status = "queued";
      }
      task.status = "queued";
      task.currentPhase = null;
      task.controlIntent = "run";
      task.budgetWait = undefined;
      task.summary = "已按任务基线重算 workspace 改动预算；继续当前 Goal。";
      this.touch(task, "legacy_workspace_size_budget_wait_recovered", {
        changedFiles,
        changedLines,
      });
      return true;
    }
    this.touch(task, "workspace_size_budget_usage_recomputed", {
      changedFiles,
      changedLines,
    });
    return false;
  }

  private latestPhaseEvidence(task: LoopTaskModel): LoopEvidenceRef | null {
    const refs = task.goals.flatMap((goal) =>
      goal.phases.flatMap((phase) => (phase.evidenceRef ? [phase.evidenceRef] : [])),
    );
    if (refs.length === 0) {
      return null;
    }
    return refs.reduce((latest, candidate) =>
      Date.parse(candidate.createdAt) > Date.parse(latest.createdAt) ? candidate : latest,
    );
  }

  private budgetExceeded(task: LoopTaskModel): string[] {
    const envelope = task.budgetEnvelope ?? budgetEnvelopeForStrength(task.loopStrength);
    const usage = task.budgetUsage;
    if (!usage) {
      return [];
    }
    const exceeded: string[] = [];
    if (usage.activeDurationMs >= envelope.maxActiveDurationMs) exceeded.push("active_time");
    if (usage.tokenMetered && usage.tokens >= envelope.maxTokens) exceeded.push("tokens");
    if (usage.toolCalls >= envelope.maxToolCalls) exceeded.push("tool_calls");
    if (usage.changedFiles >= envelope.maxChangedFiles) exceeded.push("changed_files");
    if (usage.changedLines >= envelope.maxChangedLines) exceeded.push("changed_lines");
    if (usage.replans >= envelope.maxReplans) exceeded.push("replans");
    if (usage.consecutiveSameRootCause >= envelope.maxConsecutiveSameRootCause) {
      exceeded.push("same_root_cause");
    }
    if (task.budget.usedFailedReviews >= task.budget.maxFailedReviews) {
      exceeded.push("failed_reviews");
    }
    return exceeded;
  }

  private enterBudgetWait(task: LoopTaskModel, goal: LoopGoalRecord, exhausted: string[]): void {
    if (exhausted.length === 0) {
      return;
    }
    task.status = "budget_wait";
    task.currentGoalId = goal.id;
    task.summary = `后台 Loop 已达到预算边界：${exhausted.join(", ")}。等待下一步决定。`;
    task.budgetWait = {
      reason: task.summary,
      exhaustedDimensions: exhausted,
      enteredAt: nowIso(),
    };
    goal.status = "paused";
    this.touch(task, "budget_wait_entered", { exhausted });
  }

  private recordPhaseTelemetryEvent(phaseRunId: string | undefined, event: AgentStreamEvent): void {
    if (!phaseRunId) {
      return;
    }
    const telemetry = this.activePhaseTelemetry.get(phaseRunId);
    if (!telemetry) {
      return;
    }
    if (event.type === "usage_updated" || event.type === "turn_completed") {
      if (event.usage) {
        telemetry.usage = event.usage;
      }
      return;
    }
    if (event.type !== "timeline") {
      return;
    }
    const item = event.item;
    if (item.type === "tool_call") {
      telemetry.timelineRefs.add(item.callId);
      const detail = item.detail as Record<string, unknown>;
      const existing = telemetry.commandReceipts.get(item.callId);
      telemetry.commandReceipts.set(item.callId, {
        callId: item.callId,
        name: item.name,
        status: item.status,
        ...(typeof detail.command === "string" ? { command: detail.command } : {}),
        ...(typeof detail.exitCode === "number" || detail.exitCode === null
          ? { exitCode: detail.exitCode as number | null }
          : {}),
        ...(existing?.outputSha256 ? { outputSha256: existing.outputSha256 } : {}),
      });
    } else if ("messageId" in item && typeof item.messageId === "string") {
      telemetry.timelineRefs.add(item.messageId);
    }
  }

  private async runPlanExec(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    provider: ProviderSessionConfig,
  ): Promise<void> {
    const phase = goalPhase(goal, "planexec", goal.round);
    phase.status = "running";
    phase.startedAt = nowIso();
    phase.attemptStartedAt = phase.startedAt;
    phase.phaseRunId = `loop-phase-${randomUUID()}`;
    phase.attemptId = `loop-attempt-${randomUUID()}`;
    phase.executionGeneration = (phase.executionGeneration ?? 0) + 1;
    phase.providerExitStatus = undefined;
    phase.canceledReason = undefined;
    phase.resultToolCallId = undefined;
    await this.beginPhaseTelemetry(task, goal, "planexec", phase);
    task.summary = `正在执行 Goal ${goal.order}: ${goal.title}`;
    this.touch(task);
    this.updateWorktreeLock(task);

    const resumeKind = task.resumeKind;
    const resumableAgentId =
      resumeKind && phase.agentId ? await this.restorePhaseAgent(phase.agentId) : null;
    const reusedAgentId =
      resumableAgentId ??
      goal.phases
        .filter(
          (entry) => entry.phase === "planexec" && entry.agentId && entry.status === "completed",
        )
        .sort((left, right) => right.round - left.round)[0]?.agentId;
    const agentId = reusedAgentId ?? (await this.createPlanExecAgent(task, goal, provider));
    phase.agentId = agentId;
    task.currentPhase = "planexec";
    goal.status = "running_planexec";
    task.resumeKind = undefined;
    this.touch(task);
    this.updateWorktreeLock(task, { phaseAgentId: agentId });
    const result = await this.runPhaseAndWait({
      task,
      goal,
      phase: "planexec",
      agentId,
      prompt: this.buildPlanExecPrompt(task, goal, resumeKind),
    });
    if (!result) {
      return;
    }
    if (result.kind === "blocked") {
      this.blockTask(task, goal, result.result.reason);
      return;
    }
    if (result.kind !== "planexec") {
      this.blockTask(task, goal, "PlanExec 阶段提交了错误类型的 Loop 结果。");
      return;
    }
    const planExecResult = this.toPlanExecResult(
      result.result,
      phase.phaseRunId,
      goal.id,
      goal.round,
    );
    const evidenceRef = await this.completePhaseEvidence({
      task,
      goal,
      phase: "planexec",
      record: phase,
      declaredEvidence: result.result.evidence,
      validationPerformed: result.result.validation_performed,
    });
    if (evidenceRef) {
      planExecResult.evidenceRef = evidenceRef;
    }
    goal.latestPlanExecSummary = result.result.execution_summary;
    goal.latestPlanExecResult = planExecResult;
    phase.status = "completed";
    phase.completedAt = nowIso();
    phase.providerExitStatus = "completed";
    phase.resultToolCallId = planExecResult.resultToolCallId;
    phase.summary = result.result.execution_summary;
    task.currentPhase = null;
    goal.status = "queued";
    this.touch(task, "planexec_completed", { goalId: goal.id, phaseRunId: phase.phaseRunId });
    this.appendTaskMemory(task, "planexec_result", planExecResult);
  }

  private async runReview(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    provider: ProviderSessionConfig,
  ): Promise<void> {
    const phase = goalPhase(goal, "review", goal.round);
    phase.status = "running";
    phase.startedAt = nowIso();
    phase.attemptStartedAt = phase.startedAt;
    phase.phaseRunId = `loop-phase-${randomUUID()}`;
    phase.attemptId = `loop-attempt-${randomUUID()}`;
    phase.executionGeneration = (phase.executionGeneration ?? 0) + 1;
    phase.providerExitStatus = undefined;
    phase.canceledReason = undefined;
    phase.resultToolCallId = undefined;
    await this.beginPhaseTelemetry(task, goal, "review", phase);
    task.summary = `正在 Review Goal ${goal.order}: ${goal.title}`;
    this.touch(task);
    this.updateWorktreeLock(task);

    const resumeKind = task.resumeKind;
    const resumableAgentId =
      resumeKind && phase.agentId ? await this.restorePhaseAgent(phase.agentId) : null;
    const reviewArtifactRoot = phase.phaseRunId
      ? this.activePhaseTelemetry.get(phase.phaseRunId)?.artifactRoot
      : undefined;
    // Review runs under the selected provider trust policy. Workspace receipts
    // remain auditable evidence, but daemon-side manifest comparison must not
    // replace the Review agent's judgment or create an automatic lifecycle hold.
    const agentId =
      resumableAgentId ??
      (await this.createReviewAgent(task, goal, provider, phase.phaseRunId, reviewArtifactRoot));
    phase.agentId = agentId;
    task.currentPhase = "review";
    goal.status = "running_review";
    task.resumeKind = undefined;
    this.touch(task);
    this.updateWorktreeLock(task, { phaseAgentId: agentId });
    const result = await this.runPhaseAndWait({
      task,
      goal,
      phase: "review",
      agentId,
      prompt: this.buildReviewPrompt(task, goal, resumeKind, reviewArtifactRoot),
    });
    if (!result) {
      return;
    }
    if (result.kind === "blocked") {
      this.blockTask(task, goal, result.result.reason);
      return;
    }
    if (result.kind !== "review") {
      this.blockTask(task, goal, "Review 阶段提交了错误类型的 Loop 结果。");
      return;
    }
    const previousRootCause = goal.latestReview?.failureRootCause?.trim();
    const verdict = this.toReviewVerdict(result.result, goal.round);
    const evidenceRef = await this.completePhaseEvidence({
      task,
      goal,
      phase: "review",
      record: phase,
      declaredEvidence: result.result.evidence_summary ? [result.result.evidence_summary] : [],
    });
    if (evidenceRef) {
      verdict.evidenceRef = evidenceRef;
    }
    goal.latestReview = verdict;
    task.latestVerdictSummary = verdict.summary;
    phase.completedAt = nowIso();
    phase.providerExitStatus = verdict.outcome === "real_blocker" ? "blocked" : "completed";
    phase.resultToolCallId = result.result.result_tool_call_id;
    phase.summary = verdict.summary;
    if (verdict.outcome === "pass" || verdict.outcome === "replan_unstarted_goals") {
      phase.status = "completed";
      goal.status = "passed";
      if (verdict.outcome === "replan_unstarted_goals" && !verdict.deferredGoalReplanProposal) {
        this.blockTask(task, goal, "Review 要求重规划未开始 goals，但没有提供可审计的 proposal。 ");
        return;
      }
      if (
        !(await this.maybeApplyDeferredGoalReplan(task, goal, verdict.deferredGoalReplanProposal))
      ) {
        return;
      }
      const exhausted = this.budgetExceeded(task);
      if (exhausted.length > 0) {
        this.enterBudgetWait(task, goal, exhausted);
        return;
      }
      this.touch(task, "review_passed", { goalId: goal.id, phaseRunId: phase.phaseRunId });
      this.appendTaskMemory(task, "review_verdict", verdict);
      return;
    }
    if (verdict.outcome === "return_to_user_decision") {
      if (!result.result.user_decision) {
        this.blockTask(task, goal, "Review 要求用户决策，但没有提供可回答的决策卡。 ");
        return;
      }
      phase.status = "completed";
      task.pendingUserDecision = {
        id: `loop-decision-${randomUUID()}`,
        title: result.result.user_decision.title,
        question: result.result.user_decision.question,
        options: result.result.user_decision.options,
        ...(result.result.user_decision.note_placeholder
          ? { notePlaceholder: result.result.user_decision.note_placeholder }
          : {}),
        status: "pending",
        createdAt: nowIso(),
      };
      task.status = "awaiting_user_decision";
      task.currentPhase = null;
      goal.status = "awaiting_user_decision";
      task.summary = `Review 需要用户决定后才能继续 Goal ${goal.order}。`;
      this.touch(task, "loop_user_decision_requested", {
        goalId: goal.id,
        phaseRunId: phase.phaseRunId,
      });
      this.appendTaskMemory(task, "review_verdict", verdict);
      return;
    }
    if (verdict.outcome === "real_blocker") {
      phase.status = "blocked";
      this.blockTask(task, goal, verdict.summary);
      return;
    }
    if (verdict.outcome !== "continue" && verdict.outcome !== "reframe_current_goal") {
      this.blockTask(task, goal, `Review 提交了无法映射的语义结论：${verdict.outcome}`);
      return;
    }
    phase.status = "failed";
    task.budget.usedFailedReviews += 1;
    task.globalFailureCount = task.budget.usedFailedReviews;
    if (task.budgetUsage) {
      const rootCause = verdict.failureRootCause?.trim();
      task.budgetUsage.consecutiveSameRootCause =
        rootCause && previousRootCause === rootCause
          ? task.budgetUsage.consecutiveSameRootCause + 1
          : 1;
    }
    goal.round += 1;
    task.goalRound = goal.round;
    goal.status = this.pauseAfterPhaseRequested(task) ? "paused" : "queued";
    goal.phases.push({ phase: "planexec", status: "queued", round: goal.round });
    goal.phases.push({ phase: "review", status: "queued", round: goal.round });
    task.currentPhase = null;
    task.status = this.pauseAfterPhaseRequested(task) ? "paused" : "queued";
    task.summary = this.pauseAfterPhaseRequested(task)
      ? `Review 未通过；将在 Goal ${goal.order} 第 ${goal.round} 轮开始前暂停。`
      : `Review 未通过，准备按反馈重跑 Goal ${goal.order} 第 ${goal.round} 轮。`;
    const exhausted = this.budgetExceeded(task);
    if (exhausted.length > 0) {
      this.enterBudgetWait(task, goal, exhausted);
      this.appendTaskMemory(task, "review_verdict", verdict);
      return;
    }
    this.touch(task, "review_failed_retry_queued", {
      goalId: goal.id,
      phaseRunId: phase.phaseRunId,
    });
    this.appendTaskMemory(task, "review_verdict", verdict);
  }

  private async runPhaseAndWait(input: {
    task: LoopTaskModel;
    goal: LoopGoalRecord;
    phase: LoopPhaseKind;
    agentId: string;
    prompt: string;
  }): Promise<PhaseResult | null> {
    const waitForResult = this.createPendingPhaseResult(input);
    const round = input.goal.round;
    const events = this.options.agentManager.hasInFlightRun(input.agentId)
      ? this.options.agentManager.replaceAgentRun(input.agentId, input.prompt)
      : this.options.agentManager.streamAgent(input.agentId, input.prompt);
    void this.consumePhaseEvents(input.task, input.goal, input.agentId, input.phase, round, events);
    try {
      return await waitForResult;
    } catch (error) {
      if (
        input.task.status === "paused" ||
        input.task.status === "stopped" ||
        input.task.status === "interrupted"
      ) {
        return null;
      }
      this.blockTask(
        input.task,
        input.goal,
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private createPendingPhaseResult(input: {
    task: LoopTaskModel;
    goal: LoopGoalRecord;
    phase: LoopPhaseKind;
    agentId: string;
  }): Promise<PhaseResult> {
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        const pending = this.pendingByAgent.get(input.agentId);
        if (
          !pending ||
          pending.phaseRunId !== goalPhase(input.goal, input.phase, input.goal.round).phaseRunId
        ) {
          return;
        }
        const record = goalPhase(input.goal, input.phase, input.goal.round);
        if (input.task.status !== "running" || record.status !== "running") {
          return;
        }
        record.status = "awaiting_provider";
        record.lastActivityAt = nowIso();
        input.task.status = "awaiting_provider";
        input.task.summary = `${phaseTitle(input.phase)} 仍在等待 provider 继续；尚未判定失败。`;
        this.touch(input.task, "phase_awaiting_provider", {
          phase: input.phase,
          phaseRunId: record.phaseRunId,
        });
      }, PHASE_AWAITING_PROVIDER_MS);
      timeout.unref?.();
      this.pendingByAgent.set(input.agentId, {
        taskId: input.task.id,
        goalId: input.goal.id,
        phase: input.phase,
        round: input.goal.round,
        phaseRunId: goalPhase(input.goal, input.phase, input.goal.round).phaseRunId,
        attemptId: goalPhase(input.goal, input.phase, input.goal.round).attemptId,
        executionGeneration: goalPhase(input.goal, input.phase, input.goal.round)
          .executionGeneration,
        resolve: resolvePromise,
        reject: rejectPromise,
        timeout,
      });
    });
  }

  private async consumePhaseEvents(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    agentId: string,
    phase: LoopPhaseKind,
    round: number,
    events: AsyncGenerator<AgentStreamEvent>,
    protocolRepair = false,
  ): Promise<void> {
    try {
      for await (const event of events) {
        const phaseRecord = goalPhase(goal, phase, round);
        const pending = this.pendingByAgent.get(agentId);
        // `turnId` is the daemon stream lifecycle id. A provider can expose a
        // different native id for runtime-tool callbacks, so fence semantic
        // results on `providerTurnId` whenever an adapter supplies it.
        const eventTurnId =
          getAgentStreamEventProviderTurnId(event) ?? getAgentStreamEventTurnId(event);
        if (
          pending &&
          eventTurnId &&
          pending.providerTurnId &&
          pending.providerTurnId !== eventTurnId
        ) {
          this.options.logger.debug(
            {
              taskId: task.id,
              goalId: goal.id,
              phase,
              attemptId: pending.attemptId,
              expectedTurnId: pending.providerTurnId,
              receivedTurnId: eventTurnId,
            },
            "Ignored stale Loop phase stream event",
          );
          continue;
        }
        if (pending && eventTurnId && !pending.providerTurnId) {
          pending.providerTurnId = eventTurnId;
        }
        phaseRecord.lastActivityAt = nowIso();
        if (task.status === "awaiting_provider") {
          task.status = "running";
          phaseRecord.status = "running";
          task.summary = `${phaseTitle(phase)} 已收到 provider 活动，继续执行。`;
          this.touch(task, "provider_activity_resumed", {
            phase,
            phaseRunId: phaseRecord.phaseRunId,
          });
        }
        this.recordPhaseTelemetryEvent(phaseRecord.phaseRunId, event);
        this.updateWorktreeLock(task, { phaseAgentId: agentId });
        if (event.type === "permission_requested" && event.request.kind === "plan") {
          await this.autoApprovePlanPermission(agentId, event.request.id);
          continue;
        }
        if (event.type === "permission_requested") {
          task.summary = `${phaseTitle(phase)} 正在等待权限确认。`;
          this.touch(task);
          continue;
        }
        if (event.type === "turn_failed") {
          const record = goalPhase(goal, phase, round);
          if (record.status === "completed") {
            return;
          }
          this.interruptPhase(task, goal, phase, round, "failed", event.error);
          const pending = this.pendingByAgent.get(agentId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingByAgent.delete(agentId);
            pending.reject(new Error(task.summary));
          }
          return;
        }
        if (event.type === "turn_canceled") {
          const record = goalPhase(goal, phase, round);
          if (record.status === "completed") {
            return;
          }
          if (task.status !== "stopped") {
            this.interruptPhase(
              task,
              goal,
              phase,
              round,
              "canceled",
              event.reason ?? "provider turn canceled",
            );
          }
          const pending = this.pendingByAgent.get(agentId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingByAgent.delete(agentId);
            pending.reject(new Error("Loop provider turn canceled"));
          }
          return;
        }
      }
      // A semantic tool result is still required. Ask the same provider session
      // once to close its protocol before treating this as an interrupted phase.
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
      const pending = this.pendingByAgent.get(agentId);
      if (pending && pending.phase === phase && pending.round === round) {
        const record = goalPhase(goal, phase, round);
        if (!protocolRepair && !record.protocolRepairAttempted) {
          record.protocolRepairAttempted = true;
          record.status = "awaiting_provider";
          task.status = "awaiting_provider";
          task.summary = `${phaseTitle(phase)} 已结束但缺少语义结论；正在请求同一 session 完成协议收敛。`;
          this.touch(task, "provider_protocol_repair_requested", {
            phase,
            phaseRunId: record.phaseRunId,
          });
          void this.requestProtocolRepair(task, goal, phase, round, agentId);
          return;
        }
        clearTimeout(pending.timeout);
        this.pendingByAgent.delete(agentId);
        const message = `${phaseTitle(phase)} provider 回合结束，但没有提交语义结论；可 Resume 后继续同一 session。`;
        this.interruptPhase(
          task,
          goal,
          phase,
          round,
          "completed",
          message,
          "provider_protocol_incomplete",
        );
        pending.reject(new Error(message));
      }
    } catch (error) {
      const pending = this.pendingByAgent.get(agentId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingByAgent.delete(agentId);
        const failure = error instanceof Error ? error : new Error(String(error));
        const record = goalPhase(goal, phase, round);
        if (
          record.status !== "completed" &&
          task.status !== "paused" &&
          task.status !== "stopped" &&
          task.status !== "interrupted"
        ) {
          this.interruptPhase(
            task,
            goal,
            phase,
            round,
            "failed",
            failure.message,
            "provider_stream_error",
          );
        }
        pending.reject(failure);
      }
    }
  }

  private async requestProtocolRepair(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    phase: LoopPhaseKind,
    round: number,
    agentId: string,
  ): Promise<void> {
    const prompt = [
      "Your previous turn ended without the required Thoth Loop semantic result.",
      `Do not redo implementation or investigation. Complete only the current ${phaseTitle(phase)} conclusion now.`,
      phase === "planexec"
        ? "Call thoth_loop_submit_planexec_result exactly once with the work and evidence already available."
        : "If you have not done so, submit the independent assessment first; then call thoth_loop_submit_review_verdict exactly once.",
    ].join("\n\n");
    try {
      const events = this.options.agentManager.hasInFlightRun(agentId)
        ? this.options.agentManager.replaceAgentRun(agentId, prompt)
        : this.options.agentManager.streamAgent(agentId, prompt);
      await this.consumePhaseEvents(task, goal, agentId, phase, round, events, true);
    } catch (error) {
      const pending = this.pendingByAgent.get(agentId);
      if (!pending) {
        return;
      }
      clearTimeout(pending.timeout);
      this.pendingByAgent.delete(agentId);
      const message = `无法恢复 ${phaseTitle(phase)} provider 协议：${
        error instanceof Error ? error.message : String(error)
      }`;
      this.interruptPhase(
        task,
        goal,
        phase,
        round,
        "failed",
        message,
        "provider_protocol_incomplete",
      );
      pending.reject(new Error(message));
    }
  }

  private interruptPhase(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    phase: LoopPhaseKind,
    round: number,
    providerExitStatus: NonNullable<LoopPhaseRecord["providerExitStatus"]>,
    reason: string,
    interruptedReason = "provider_terminal",
  ): void {
    const record = goalPhase(goal, phase, round);
    record.status = "interrupted";
    record.providerExitStatus = providerExitStatus;
    record.canceledReason = providerExitStatus === "canceled" ? reason : undefined;
    record.interruptedReason = interruptedReason;
    record.completedAt = nowIso();
    record.summary = reason;
    task.status = "interrupted";
    task.currentGoalId = goal.id;
    task.currentPhase = phase;
    task.summary = `${phaseTitle(phase)} 已中断：${reason}`;
    goal.status = "interrupted";
    this.touch(task, "phase_interrupted", { phase, phaseRunId: record.phaseRunId, reason });
  }

  private async autoApprovePlanPermission(agentId: string, requestId: string): Promise<void> {
    const response: AgentPermissionResponse = {
      behavior: "allow",
      selectedActionId: "implement",
    };
    await respondToAgentPermission({
      agentManager: this.options.agentManager,
      agentId,
      requestId,
      response,
      logger: this.options.logger,
    });
  }

  private async createPlanExecAgent(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    provider: ProviderSessionConfig,
  ): Promise<string> {
    const sessionId = loopPhaseSessionId({
      taskId: task.id,
      goalId: goal.id,
      phase: "planexec",
      round: goal.round,
    });
    const runtimeSession = prepareLoopRuntimeSession({
      provider: this.options.agentManager.getProviderRuntimeSessionProvider(provider.provider),
      thothHome: this.options.thothHome,
      sessionId,
    });
    const config = withThothRuntimeTools(
      {
        provider: provider.provider,
        cwd: task.workspacePath,
        internal: true,
        ...(provider.model ? { model: provider.model } : {}),
        ...(provider.modeId ? { modeId: provider.modeId } : {}),
        ...(provider.thinkingOptionId ? { thinkingOptionId: provider.thinkingOptionId } : {}),
        featureValues: {
          ...(provider.featureValues ?? {}),
          plan_mode: true,
        },
      },
      {
        enabled: true,
        scope: "loop_planexec",
        ...(runtimeSession.home ? { sessionHome: runtimeSession.home } : {}),
      },
    );
    const agent = await this.options.agentManager.createAgent(config, undefined, {
      labels: {
        surface: "thoth-loop",
        loopTaskId: task.id,
        loopGoalId: goal.id,
        loopPhase: "planexec",
      },
      ...(Object.keys(runtimeSession.env).length > 0 ? { env: runtimeSession.env } : {}),
      persistSession: true,
      persistInternal: true,
      initialTitle: `PlanExec: ${goal.title}`,
    });
    return agent.id;
  }

  private async createReviewAgent(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    provider: ProviderSessionConfig,
    phaseRunId?: string,
    artifactRoot?: string,
  ): Promise<string> {
    const sessionId = loopPhaseSessionId({
      taskId: task.id,
      goalId: goal.id,
      phase: "review",
      round: goal.round,
    });
    const runtimeSession = prepareLoopRuntimeSession({
      provider: this.options.agentManager.getProviderRuntimeSessionProvider(provider.provider),
      thothHome: this.options.thothHome,
      sessionId,
    });
    const config = withThothRuntimeTools(
      {
        provider: provider.provider,
        cwd: task.workspacePath,
        internal: true,
        ...(provider.model ? { model: provider.model } : {}),
        modeId: "auto",
        ...(provider.thinkingOptionId ? { thinkingOptionId: provider.thinkingOptionId } : {}),
        ...(provider.featureValues ? { featureValues: provider.featureValues } : {}),
      },
      {
        enabled: true,
        scope: "loop_review",
        ...(runtimeSession.home ? { sessionHome: runtimeSession.home } : {}),
      },
    );
    const agent = await this.options.agentManager.createAgent(config, undefined, {
      labels: {
        surface: "thoth-loop",
        loopTaskId: task.id,
        loopGoalId: goal.id,
        loopPhase: "review",
        loopRound: String(goal.round),
      },
      env: {
        ...runtimeSession.env,
        ...(artifactRoot ? { THOTH_REVIEW_ARTIFACT_DIR: artifactRoot } : {}),
        ...(artifactRoot
          ? {
              TMPDIR: this.evidenceStore.createTemporaryDirectory({
                taskId: task.id,
                phaseRunId: phaseRunId ?? "review",
              }),
            }
          : {}),
      },
      persistSession: true,
      persistInternal: true,
      initialTitle: `Review: ${goal.title}`,
    });
    return agent.id;
  }

  private buildPlanExecPrompt(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    resumeKind?: LoopTaskModel["resumeKind"],
  ): string {
    const previousReview = goal.latestReview;
    const previousDirection = previousReview?.directionMemo
      ? [
          `Conclusion: ${previousReview.directionMemo.conclusion}`,
          `Reality: ${previousReview.directionMemo.reality.join("; ")}`,
          `Diagnosis: ${previousReview.directionMemo.diagnosis}`,
          `Abandon: ${previousReview.directionMemo.abandon.join("; ") || "none"}`,
          `Reframe: ${previousReview.directionMemo.reframe}`,
          `Highest-leverage direction: ${previousReview.directionMemo.nextDirection}`,
        ].join("\n")
      : previousReview
        ? [
            `Diagnosis: ${previousReview.failureRootCause ?? previousReview.summary}`,
            `Next direction: ${previousReview.nextRoundGuidance ?? "Re-examine the current approach from the approved goal."}`,
          ].join("\n")
        : "none";
    return [
      "You are the Thoth Loop PlanExec agent for one background task goal.",
      "Do not ask the user any clarification questions. Treat all supplied cards and context as final.",
      "First produce a concise plan in provider plan mode, then implement only the current goal.",
      "Do not jump to later goals. Do not work outside the current goal boundary.",
      "At the end, call thoth_loop_submit_planexec_result exactly once. Thoth binds the active goal and attempt automatically.",
      ...(resumeKind
        ? [
            "This is a continuation of the existing provider session after a user control action.",
            "Read the existing timeline, continue only unfinished work, and do not restart the goal or repeat completed work.",
          ]
        : []),
      "",
      `Task title: ${task.taskCard.title}`,
      `Task goal: ${task.taskCard.goal}`,
      `Task constraints:\n${task.taskCard.constraints.map((item) => `- ${item}`).join("\n")}`,
      `Task acceptance:\n${task.taskCard.acceptance.map((item) => `- ${item}`).join("\n")}`,
      `Current goal: ${goal.title}`,
      `Goal: ${goal.goal}`,
      `Goal constraints:\n${goal.constraints.map((item) => `- ${item}`).join("\n")}`,
      `Goal acceptance:\n${goal.acceptance.map((item) => `- ${item}`).join("\n")}`,
      `Previous Review Direction Memo:\n${previousDirection}`,
      "The approved Task Card and current goal above are the execution authority. Do not request the raw Clarify transcript unless a real provenance blocker is recorded.",
      `Passed goals:\n${
        task.goals
          .filter((candidate) => candidate.status === "passed")
          .map(
            (candidate) => `- ${candidate.title}: ${candidate.latestReview?.summary ?? "passed"}`,
          )
          .join("\n") || "none"
      }`,
    ].join("\n\n");
  }

  private buildReviewPrompt(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    resumeKind?: LoopTaskModel["resumeKind"],
    artifactRoot?: string,
  ): string {
    const previousDirection = goal.latestReview?.directionMemo
      ? [
          `Conclusion: ${goal.latestReview.directionMemo.conclusion}`,
          `Reality: ${goal.latestReview.directionMemo.reality.join("; ")}`,
          `Diagnosis: ${goal.latestReview.directionMemo.diagnosis}`,
          `Abandon: ${goal.latestReview.directionMemo.abandon.join("; ") || "none"}`,
          `Reframe: ${goal.latestReview.directionMemo.reframe}`,
          `Highest-leverage direction: ${goal.latestReview.directionMemo.nextDirection}`,
        ].join("\n")
      : "none";
    return [
      "You are the independent Thoth Loop Review agent.",
      "Strictly validate the current goal against the approved cards and acceptance criteria.",
      "You may inspect the workspace and run tests. Do not modify source files, project tests, configs, or docs.",
      ...(artifactRoot
        ? [
            `Write any new test, benchmark, evaluation script, cache, and output only under ${artifactRoot}.`,
            "That artifact directory is evidence-only and is outside the user workspace/git diff.",
          ]
        : [
            "Do not create files; an external Review artifact directory is unavailable for this run.",
          ]),
      "If validation fails, be direct, creative, and precise about the root cause and next-round direction. Do not preserve an incremental approach merely because PlanExec used it.",
      "First inspect independently and call thoth_loop_submit_review_independent_assessment exactly once. Thoth will then return PlanExec's semantic account for comparison. Only after that call thoth_loop_submit_review_verdict exactly once with a direction memo and outcome.",
      ...(resumeKind
        ? [
            "This is a continuation of the existing provider session after a user control action.",
            "Read the existing timeline and continue the unfinished validation; do not restart completed checks.",
          ]
        : []),
      "",
      `Task title: ${task.taskCard.title}`,
      `Task goal: ${task.taskCard.goal}`,
      `Current goal: ${goal.title}`,
      `Goal: ${goal.goal}`,
      `Goal constraints:\n${goal.constraints.map((item) => `- ${item}`).join("\n")}`,
      `Goal acceptance:\n${goal.acceptance.map((item) => `- ${item}`).join("\n")}`,
      `Prior Review Direction Memo for this goal:\n${previousDirection}`,
      "Do not infer extra user requirements from absent transcript text. The approved Task Card and current goal define the boundary; inspect reality before reading PlanExec's account.",
      `Earlier passed goals:\n${
        task.goals
          .filter((candidate) => candidate.status === "passed")
          .map(
            (candidate) => `- ${candidate.title}: ${candidate.latestReview?.summary ?? "passed"}`,
          )
          .join("\n") || "none"
      }`,
    ].join("\n\n");
  }

  private async runContractPreservationAudit(input: {
    task: LoopTaskModel;
    goal: LoopGoalRecord;
    proposal: LoopDeferredGoalReplanProposal;
  }): Promise<ContractPreservationAudit> {
    const provider = input.task.providerBinding;
    if (
      this.options.agentManager.getProviderCapabilities(provider.provider)
        ?.supportsNativeThothTools !== true
    ) {
      throw new Error("Automatic replan audit requires provider runtime-tool support.");
    }
    const auditRuntimeSession = prepareProviderRuntimeSession({
      provider: this.options.agentManager.getProviderRuntimeSessionProvider(provider.provider),
      thothHome: this.options.thothHome,
      sessionId: `loop-${input.task.id}-${input.goal.id}-contract-audit-${randomUUID()}`,
    });
    const auditAgent = await this.options.agentManager.createAgent(
      withThothRuntimeTools(
        {
          provider: provider.provider,
          cwd: input.task.workspacePath,
          internal: true,
          ...(provider.model ? { model: provider.model } : {}),
          modeId: "auto",
          ...(provider.thinkingOptionId ? { thinkingOptionId: provider.thinkingOptionId } : {}),
          systemPrompt:
            "You are an independent Thoth contract-preservation auditor. Do not edit files or ask the user questions. Decide only whether a proposed change to unstarted goals preserves the already approved Task Card and Goals Card contract. Call thoth_submit_contract_preservation_audit exactly once.",
        },
        {
          enabled: true,
          scope: "contract_audit",
          ...(auditRuntimeSession.home ? { sessionHome: auditRuntimeSession.home } : {}),
        },
      ),
      undefined,
      {
        labels: {
          surface: "thoth-loop-contract-audit",
          loopTaskId: input.task.id,
          loopGoalId: input.goal.id,
        },
        persistSession: true,
        persistInternal: true,
        initialTitle: "Loop contract preservation audit",
        ...(Object.keys(auditRuntimeSession.env).length > 0
          ? { env: auditRuntimeSession.env }
          : {}),
      },
    );
    const wait = waitForContractPreservationAudit(auditAgent.id);
    const originalFutureGoals = input.task.goals
      .filter((candidate) => candidate.status === "queued")
      .map((candidate) => ({
        id: candidate.id,
        order: candidate.order,
        title: candidate.title,
        goal: candidate.goal,
        constraints: candidate.constraints,
        acceptance: candidate.acceptance,
      }));
    const prompt = [
      "Audit the replan proposal below. It is allowed to change only unstarted goals and must not change the user-approved outcome, constraints, or acceptance boundary.",
      `Approved Task Card:\n${JSON.stringify(input.task.taskCard, null, 2)}`,
      `Approved Goals Card:\n${JSON.stringify(input.task.goalsCard, null, 2)}`,
      `Current passed goal: ${input.goal.id}`,
      `Existing unstarted goals:\n${JSON.stringify(originalFutureGoals, null, 2)}`,
      `Proposal:\n${JSON.stringify(input.proposal, null, 2)}`,
      "Use proceed only when every proposed change preserves the contract. Otherwise reject and state the exact boundary that would change.",
    ].join("\n\n");
    void (async () => {
      try {
        for await (const event of this.options.agentManager.streamAgent(auditAgent.id, prompt)) {
          if (event.type === "turn_failed") {
            rejectContractPreservationAudit(auditAgent.id, event.error);
            return;
          }
          if (event.type === "turn_canceled") {
            rejectContractPreservationAudit(auditAgent.id, event.reason);
            return;
          }
        }
      } catch (error) {
        rejectContractPreservationAudit(
          auditAgent.id,
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
    return wait;
  }

  private async maybeApplyDeferredGoalReplan(
    task: LoopTaskModel,
    currentGoal: LoopGoalRecord,
    proposal: LoopDeferredGoalReplanProposal | undefined,
  ): Promise<boolean> {
    if (!proposal) {
      return true;
    }
    const currentRevision = task.goalsRevision ?? 0;
    const affected = new Set(proposal.affectedGoalIds);
    const proposedIds = new Set(proposal.goals.map((goal) => goal.id));
    const valid =
      proposal.baseGoalsRevision === currentRevision &&
      affected.size === proposal.affectedGoalIds.length &&
      affected.size === proposedIds.size &&
      Array.from(affected).every((id) => {
        const goal = task.goals.find((candidate) => candidate.id === id);
        return goal?.status === "queued" && goal.order > currentGoal.order && proposedIds.has(id);
      });
    if (!valid) {
      task.status = "blocked";
      task.summary = "Review 提交的自动 replan 不只涉及未开始 goals 或基于过期 revision。";
      this.touch(task, "replan_rejected_structural", { goalId: currentGoal.id });
      return false;
    }
    let audit: ContractPreservationAudit;
    try {
      audit = await this.runContractPreservationAudit({ task, goal: currentGoal, proposal });
    } catch (error) {
      task.status = "blocked";
      task.summary = `自动 replan 审计未完成：${error instanceof Error ? error.message : String(error)}`;
      this.touch(task, "replan_audit_unavailable", { goalId: currentGoal.id });
      return false;
    }
    const record = {
      id: `replan-${randomUUID()}`,
      baseGoalsRevision: proposal.baseGoalsRevision,
      appliedGoalsRevision: currentRevision + 1,
      status: audit.outcome === "proceed" ? "applied" : "rejected",
      rationale: proposal.rationale,
      expectedBenefit: proposal.expectedBenefit,
      affectedGoalIds: proposal.affectedGoalIds,
      auditSummary: audit.summary,
      createdAt: nowIso(),
    } as const;
    task.replanHistory = [...(task.replanHistory ?? []), record];
    if (audit.outcome !== "proceed") {
      task.status = "blocked";
      task.summary = `自动 replan 未通过 contract 审计：${audit.summary}`;
      this.touch(task, "replan_rejected_audit", { goalId: currentGoal.id });
      return false;
    }
    for (const proposed of proposal.goals) {
      const target = task.goals.find((goal) => goal.id === proposed.id);
      if (!target) {
        continue;
      }
      target.order = proposed.order;
      target.title = proposed.title;
      target.goal = proposed.goal;
      target.constraints = proposed.constraints;
      target.acceptance = proposed.acceptance;
    }
    task.goals.sort((left, right) => left.order - right.order);
    task.goalsRevision = currentRevision + 1;
    if (task.budgetUsage) {
      task.budgetUsage.replans += 1;
    }
    this.touch(task, "goals_replanned", {
      goalId: currentGoal.id,
      affectedGoalIds: proposal.affectedGoalIds,
    });
    this.appendTaskMemory(task, "execution_note", { replan: record });
    return true;
  }

  private toPlanExecResult(
    input: DaemonBoundPlanExecResult,
    phaseRunId: string | undefined,
    goalId: string,
    round: number,
  ): LoopPlanExecResult {
    return {
      goalId: input.goal_id ?? goalId,
      round: input.round ?? round,
      phaseRunId: input.phase_run_id ?? phaseRunId,
      resultToolCallId: input.result_tool_call_id,
      planSummary: input.plan_summary,
      executionSummary: input.execution_summary,
      evidence: input.evidence,
      validationPerformed: input.validation_performed,
      remainingRisks: input.remaining_risks,
      nextReviewFocus: input.next_review_focus,
      createdAt: nowIso(),
    };
  }

  private toReviewVerdict(input: DaemonBoundReviewVerdict, round: number): LoopReviewVerdict {
    return {
      outcome: input.outcome,
      round: input.round || round,
      summary: input.summary,
      // These legacy projection slots remain for existing task history and UI
      // parsing, but no longer shape the Review agent's live semantic tool.
      acceptanceMatrix: [],
      failedAcceptance: [],
      ...(input.direction_memo ? { failureRootCause: input.direction_memo.diagnosis } : {}),
      ...(input.direction_memo ? { nextRoundGuidance: input.direction_memo.next_direction } : {}),
      antiRepeatStrategy: input.direction_memo?.abandon ?? [],
      evidenceSummary: input.evidence_summary ?? "",
      ...(input.direction_memo
        ? {
            directionMemo: {
              conclusion: input.direction_memo.conclusion,
              reality: input.direction_memo.reality,
              diagnosis: input.direction_memo.diagnosis,
              abandon: input.direction_memo.abandon,
              reframe: input.direction_memo.reframe,
              nextDirection: input.direction_memo.next_direction,
            },
          }
        : {}),
      ...(input.deferred_goal_replan_proposal
        ? {
            deferredGoalReplanProposal: {
              baseGoalsRevision: input.deferred_goal_replan_proposal.base_goals_revision,
              rationale: input.deferred_goal_replan_proposal.rationale,
              expectedBenefit: input.deferred_goal_replan_proposal.expected_benefit,
              affectedGoalIds: input.deferred_goal_replan_proposal.affected_goal_ids,
              goals: input.deferred_goal_replan_proposal.goals.map((goal) => ({
                id: goal.id,
                order: goal.order,
                title: goal.title,
                goal: goal.goal,
                constraints: goal.constraints,
                acceptance: goal.acceptance,
              })),
            },
          }
        : {}),
      createdAt: nowIso(),
    };
  }

  private pauseAfterPhaseRequested(task: LoopTaskModel): boolean {
    return task.controlIntent === "pause_after_phase";
  }

  private pauseAfterPlanExec(task: LoopTaskModel, goal: LoopGoalRecord): void {
    task.status = "paused";
    task.currentPhase = "review";
    if (goal.status !== "passed") {
      goal.status = "paused";
    }
    task.summary = "PlanExec 已完成；Review 尚未启动，后台 Loop 已在阶段边界暂停。";
    this.touch(task);
  }

  /**
   * A phase timeline may be opened after a daemon restart. Restore the same
   * persisted provider session rather than allocating a second foreground-like
   * agent or restarting the goal from zero.
   */
  private async restorePhaseAgent(agentId: string): Promise<string | null> {
    const live = this.options.agentManager.getAgent(agentId);
    if (live) {
      return live.id;
    }
    if (!this.options.agentStorage) {
      return null;
    }
    try {
      await this.recoverPhaseAgent(agentId);
      const restored = await ensureAgentLoaded(agentId, {
        agentManager: this.options.agentManager,
        agentStorage: this.options.agentStorage,
        logger: this.options.logger,
      });
      return restored.id;
    } catch (error) {
      this.options.logger.warn({ err: error, agentId }, "Failed to restore Loop phase agent");
      return null;
    }
  }

  private currentGoal(task: LoopTaskModel): LoopGoalRecord | null {
    if (task.currentGoalId) {
      const current = task.goals.find((goal) => goal.id === task.currentGoalId);
      if (
        current &&
        (current.status !== "passed" ||
          (task.currentPhase === "review" && current.latestPlanExecResult !== undefined))
      ) {
        return current;
      }
    }
    return task.goals.find((goal) => goal.status !== "passed") ?? null;
  }

  private hasCompletedPlanExec(goal: LoopGoalRecord): boolean {
    return Boolean(
      goal.latestPlanExecResult &&
      goal.phases.some(
        (phase) =>
          phase.phase === "planexec" && phase.round === goal.round && phase.status === "completed",
      ),
    );
  }

  private markCurrentGoal(task: LoopTaskModel, status: LoopGoalRecord["status"]): void {
    const goal = this.currentGoal(task);
    if (goal) {
      goal.status = status;
    }
  }

  private blockTask(task: LoopTaskModel, goal: LoopGoalRecord, reason: string): void {
    if (task.currentPhase) {
      const phase = goalPhase(goal, task.currentPhase, goal.round);
      phase.status = "blocked";
      phase.providerExitStatus = "blocked";
      phase.completedAt = phase.completedAt ?? nowIso();
      phase.summary = reason;
    }
    task.status = "blocked";
    task.currentGoalId = goal.id;
    task.currentPhase = null;
    task.summary = reason;
    goal.status = "blocked";
    this.touch(task);
  }

  private async cancelCurrentPhase(task: LoopTaskModel): Promise<void> {
    const goal = this.currentGoal(task);
    const phase = goal?.phases.find(
      (entry) => entry.phase === task.currentPhase && entry.round === goal.round,
    );
    if (phase?.agentId) {
      await this.options.agentManager.cancelAgentRun(phase.agentId).catch(() => false);
      phase.status = "canceled";
      phase.completedAt = nowIso();
      phase.providerExitStatus = "canceled";
      phase.canceledReason = task.status === "paused" ? "user paused task" : "user stopped task";
    }
    if (phase?.agentId) {
      const pending = this.pendingByAgent.get(phase.agentId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingByAgent.delete(phase.agentId);
        pending.reject(new Error("Loop phase canceled"));
      }
    }
  }
}

export function summarizeLoopTask(task: LoopTaskModel): BackgroundTaskModel {
  return toBackgroundTaskModel(task);
}

export function debugPromptText(prompt: AgentPromptInput): string {
  return asPromptText(prompt);
}
