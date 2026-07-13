import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Logger } from "pino";
import type {
  ThothLoopPlanExecResultInput,
  ThothLoopReportBlockedInput,
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
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
import {
  BackgroundTaskModelSchema,
  LoopTaskModelSchema,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
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
  sourceTopicId: string;
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

type PhaseResult =
  | { kind: "planexec"; result: ThothLoopPlanExecResultInput }
  | { kind: "review"; result: ThothLoopReviewVerdictInput }
  | { kind: "blocked"; result: ThothLoopReportBlockedInput };

interface PendingPhaseResult {
  taskId: string;
  goalId: string;
  phase: LoopPhaseKind;
  round: number;
  phaseRunId?: string;
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

const PHASE_RESULT_TIMEOUT_MS = 30 * 60 * 1000;
const WORKTREE_LEASE_MS = 2 * 60 * 1000;
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
    sourceTopicId: task.sourceTopicId,
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
  private schedulerRunning = false;
  private schedulerQueued = false;

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
    if (existing) {
      if (!existing.internal) {
        await storage.upsert({ ...existing, internal: true, updatedAt: nowIso() });
      }
      this.options.agentManager.markAgentInternal(agentId);
      return true;
    }

    const { task, goal, phase } = phaseOwner;
    const recovered = recoverProviderPhaseRecord({
      provider: task.providerSession.provider,
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
      sourceTopicId: input.sourceTopicId,
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
      providerSession: input.provider,
      createdAt: now,
      updatedAt: now,
    });
    this.tasks.set(task.id, task);
    this.providerByTask.set(task.id, input.provider);
    this.touch(task, "task_registered", {
      sourceTopicId: input.sourceTopicId,
      loopStrength: input.loopStrength,
    });
    this.appendTaskMemory(task, "clarify_transcript", input.clarifyTranscript);
    this.appendTaskMemory(task, "task_card", input.taskCard);
    this.appendTaskMemory(task, "goals_card", input.goalsCard);
    this.schedule();
    return task;
  }

  async action(taskId: string, action: BackgroundTaskAction): Promise<LoopTaskModel | null> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }
    if (action === "stop") {
      task.status = "stopped";
      task.controlIntent = "stopped";
      task.stoppedAt = nowIso();
      task.summary = "用户已停止后台任务。";
      this.markCurrentGoal(task, "stopped");
      await this.cancelCurrentPhase(task);
      this.touch(task);
      return task;
    }
    if (action === "pause") {
      if (task.status === "running") {
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
        task.status === "evidence_invalid" ||
        task.status === "workspace_changed_concurrently"
      ) {
        const rebaselineRequired =
          task.status === "evidence_invalid" || task.status === "workspace_changed_concurrently";
        const resumeKind = task.status === "stopped" ? "stopped_recovery" : "paused_continuation";
        const goal = this.currentGoal(task);
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
          : resumeKind === "stopped_recovery"
            ? "后台任务将从停止时的阶段游标继续，并优先复用原 provider session。"
            : "后台任务将从已完成阶段后的游标继续。";
        this.touch(task);
        if (rebaselineEvidence) {
          this.appendTaskMemory(task, "baseline_evidence", rebaselineEvidence);
        }
        this.schedule();
      }
      return task;
    }
    if (action === "budget_continue") {
      if (task.status !== "budget_wait") {
        return task;
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
      const goal = this.currentGoal(task);
      if (!goal?.latestPlanExecResult) {
        task.summary = "当前 goal 还没有可供 Review 的 PlanExec 证据。";
        this.touch(task, "review_only_rejected");
        return task;
      }
      task.currentPhase = "review";
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

  resolvePlanExecResult(agentId: string, input: ThothLoopPlanExecResultInput): boolean {
    return this.resolvePhaseResult(agentId, { kind: "planexec", result: input });
  }

  resolveReviewVerdict(agentId: string, input: ThothLoopReviewVerdictInput): boolean {
    return this.resolvePhaseResult(agentId, { kind: "review", result: input });
  }

  resolveBlocked(agentId: string, input: ThothLoopReportBlockedInput): boolean {
    return this.resolvePhaseResult(agentId, { kind: "blocked", result: input });
  }

  private resolvePhaseResult(agentId: string, result: PhaseResult): boolean {
    const pending = this.pendingByAgent.get(agentId);
    if (!pending) {
      return false;
    }
    const normalizedResult = this.normalizeCurrentGoalOrdinal(pending, result);
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
    pending.resolve(normalizedResult);
    return true;
  }

  /**
   * The runtime contract uses immutable goal ids such as `g1`, but providers
   * can occasionally copy the user-facing ordinal (`1`) from the prompt.
   * Accept only the exact ordinal of the pending goal; every other reference
   * remains a hard mismatch so an old or cross-goal result cannot advance a
   * task.
   */
  private normalizeCurrentGoalOrdinal(
    pending: PendingPhaseResult,
    result: PhaseResult,
  ): PhaseResult {
    if (result.kind === "blocked" || result.result.goal_id === pending.goalId) {
      return result;
    }
    const task = this.tasks.get(pending.taskId);
    const pendingGoal = task?.goals.find((goal) => goal.id === pending.goalId);
    if (!pendingGoal || result.result.goal_id !== String(pendingGoal.order)) {
      return result;
    }
    this.options.logger.warn(
      {
        taskId: pending.taskId,
        goalId: pending.goalId,
        receivedGoalReference: result.result.goal_id,
      },
      "Normalized Loop result display ordinal to the active stable goal id",
    );
    if (result.kind === "planexec") {
      return {
        kind: "planexec",
        result: {
          ...result.result,
          goal_id: pending.goalId,
        },
      };
    }
    return {
      kind: "review",
      result: {
        ...result.result,
        goal_id: pending.goalId,
      },
    };
  }

  private validatePendingPhaseResult(
    pending: PendingPhaseResult,
    result: PhaseResult,
  ): string | null {
    if (result.kind === "blocked") {
      if (result.result.goal_id && result.result.goal_id !== pending.goalId) {
        return `Loop blocked result targeted ${result.result.goal_id}, but current goal is ${pending.goalId}.`;
      }
      if (result.result.phase && result.result.phase !== pending.phase) {
        return `Loop blocked result targeted ${result.result.phase}, but current phase is ${pending.phase}.`;
      }
      return null;
    }
    if (result.kind !== pending.phase) {
      return `Loop result used ${result.kind}, but current phase is ${pending.phase}.`;
    }
    if (result.result.goal_id !== pending.goalId) {
      return `Loop result targeted ${result.result.goal_id}, but current goal is ${pending.goalId}.`;
    }
    if (result.result.round !== pending.round) {
      return `Loop result targeted round ${result.result.round}, but current round is ${pending.round}.`;
    }
    if (
      pending.phaseRunId &&
      result.kind === "planexec" &&
      result.result.phase_run_id !== undefined &&
      result.result.phase_run_id !== pending.phaseRunId
    ) {
      return `Loop result targeted phase run ${result.result.phase_run_id}, but active phase run is ${pending.phaseRunId}.`;
    }
    return null;
  }

  private load(): void {
    try {
      for (const task of this.authorityStore.listTasks()) {
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
        this.providerByTask.set(task.id, task.providerSession);
        if (task.status === "interrupted" && task.authorityRevision !== undefined) {
          this.touch(task, "daemon_restart_interrupted");
        }
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
    for (const task of this.tasks.values()) {
      for (const goal of task.goals) {
        const phase = goal.phases.find((entry) => entry.agentId === agentId);
        if (phase) {
          return { task, goal, phase };
        }
      }
    }
    return null;
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
    return true;
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
      void this.runScheduler().finally(() => {
        this.schedulerRunning = false;
        if (Array.from(this.tasks.values()).some((task) => task.status === "queued")) {
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
    const provider = this.providerByTask.get(task.id) ?? task.providerSession;
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
      task.baselineEvidence = baselineEvidence;
      this.appendTaskMemory(task, "baseline_evidence", baselineEvidence);
      this.touch(task, "task_baseline_captured", { baselineEvidenceId: baselineEvidence.id });
      return true;
    } catch (error) {
      task.status = "blocked";
      task.currentPhase = null;
      task.summary = "无法封存后台任务的 workspace evidence baseline。";
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
    task.budgetUsage = {
      ...current,
      activeDurationMs: current.activeDurationMs + input.activeDurationMs,
      tokens: current.tokens + input.tokens,
      toolCalls: current.toolCalls + input.toolCalls,
      changedFiles: manifest?.workspace.changedFiles ?? current.changedFiles,
      changedLines: manifest?.workspace.changedLines ?? current.changedLines,
      tokenMetered: current.tokenMetered || input.tokenMetered,
    };
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
    const planExecResult = this.toPlanExecResult(result.result, phase.phaseRunId);
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
    const exhausted = this.budgetExceeded(task);
    if (exhausted.length > 0) {
      this.enterBudgetWait(task, goal, exhausted);
      return;
    }
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
    const reviewStartEvidence = phase.evidenceRef;
    const planExecEvidence = goal.latestPlanExecResult?.evidenceRef;
    if (
      planExecEvidence &&
      reviewStartEvidence &&
      !this.evidenceStore.reviewWorkspaceUnchanged(planExecEvidence, reviewStartEvidence)
    ) {
      phase.status = "blocked";
      phase.providerExitStatus = "blocked";
      phase.completedAt = nowIso();
      phase.summary =
        "PlanExec 完成后、Review 开始前 workspace 发生外部修改；需要重新建立 evidence baseline。";
      task.status = "workspace_changed_concurrently";
      task.currentGoalId = goal.id;
      task.currentPhase = null;
      task.summary =
        "检测到无法归因于当前 PlanExec 的 workspace 修改；未启动 Review，等待用户确认后重新建立 evidence baseline。";
      goal.status = "blocked";
      if (phase.phaseRunId) {
        this.activePhaseTelemetry.delete(phase.phaseRunId);
      }
      this.touch(task, "workspace_changed_concurrently", {
        goalId: goal.id,
        phaseRunId: phase.phaseRunId,
      });
      return;
    }
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
    const verdict = this.toReviewVerdict(result.result);
    const telemetry = phase.phaseRunId
      ? this.activePhaseTelemetry.get(phase.phaseRunId)
      : undefined;
    const evidenceRef = await this.completePhaseEvidence({
      task,
      goal,
      phase: "review",
      record: phase,
      declaredEvidence: [result.result.evidence_summary],
    });
    if (
      telemetry?.reviewStartEvidence &&
      evidenceRef &&
      !this.evidenceStore.reviewWorkspaceUnchanged(telemetry.reviewStartEvidence, evidenceRef)
    ) {
      phase.status = "blocked";
      phase.providerExitStatus = "blocked";
      phase.summary = "Review 修改或检测到并发修改 workspace；证据无效。";
      task.status = "evidence_invalid";
      task.currentGoalId = goal.id;
      task.currentPhase = null;
      task.summary = "Review 期间 workspace 发生非外置评测资产修改；已保留 diff 与证据，等待处理。";
      goal.status = "blocked";
      this.touch(task, "review_evidence_invalid", {
        goalId: goal.id,
        phaseRunId: phase.phaseRunId,
      });
      return;
    }
    if (evidenceRef) {
      verdict.evidenceRef = evidenceRef;
    }
    goal.latestReview = verdict;
    task.latestVerdictSummary = verdict.summary;
    phase.completedAt = nowIso();
    phase.providerExitStatus = verdict.outcome === "blocked" ? "blocked" : "completed";
    phase.resultToolCallId = result.result.result_tool_call_id;
    phase.summary = verdict.summary;
    if (verdict.outcome === "pass") {
      phase.status = "completed";
      goal.status = "passed";
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
    if (verdict.outcome === "blocked") {
      phase.status = "blocked";
      this.blockTask(task, goal, verdict.summary);
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
      if (input.task.status === "paused" || input.task.status === "stopped") {
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
        this.pendingByAgent.delete(input.agentId);
        const message = `${phaseTitle(input.phase)} 阶段没有提交可验证的 Loop 结果。`;
        const record = goalPhase(input.goal, input.phase, input.goal.round);
        record.status = "blocked";
        record.providerExitStatus = "timeout";
        record.completedAt = nowIso();
        record.summary = message;
        this.touch(input.task);
        rejectPromise(new Error(message));
      }, PHASE_RESULT_TIMEOUT_MS);
      timeout.unref?.();
      this.pendingByAgent.set(input.agentId, {
        taskId: input.task.id,
        goalId: input.goal.id,
        phase: input.phase,
        round: input.goal.round,
        phaseRunId: goalPhase(input.goal, input.phase, input.goal.round).phaseRunId,
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
  ): Promise<void> {
    try {
      for await (const event of events) {
        const phaseRecord = goalPhase(goal, phase, round);
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
          task.summary = `${phaseTitle(phase)} provider 回合失败：${event.error}`;
          record.providerExitStatus = "failed";
          record.summary = task.summary;
          this.touch(task);
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
          record.providerExitStatus = "canceled";
          record.canceledReason = "provider turn canceled";
          record.summary = "Provider turn canceled.";
          this.touch(task);
        }
      }
      // A phase is only completed by its semantic runtime tool. If the
      // provider turn ends without one, waiting for the generic 30 minute
      // timeout falsely presents a completed PlanExec while Review can never
      // start. Give an already-delivered tool callback one event-loop turn,
      // then fail this exact pending phase with an actionable state.
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 0));
      const pending = this.pendingByAgent.get(agentId);
      if (pending && pending.phase === phase && pending.round === round) {
        clearTimeout(pending.timeout);
        this.pendingByAgent.delete(agentId);
        const message = `${phaseTitle(phase)} provider 回合结束，但没有提交可验证的 Loop 结果。`;
        const record = goalPhase(goal, phase, round);
        record.status = "blocked";
        // The provider did complete its turn; the task-level blocked state
        // below records that its required semantic result was absent.
        record.providerExitStatus = "completed";
        record.completedAt = nowIso();
        record.summary = message;
        this.touch(task);
        pending.reject(new Error(message));
      }
    } catch (error) {
      const pending = this.pendingByAgent.get(agentId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingByAgent.delete(agentId);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
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
    const sessionId = `loop-${task.id}-${goal.id}-planexec`;
    const runtimeSession = prepareLoopRuntimeSession({
      provider: provider.provider,
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
    const sessionId = `loop-${task.id}-${goal.id}-review-${goal.round}`;
    const runtimeSession = prepareLoopRuntimeSession({
      provider: provider.provider,
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
    const previousGuidance = previousReview?.nextRoundGuidance ?? "none";
    const previousRootCause = previousReview?.failureRootCause ?? "none";
    const previousAntiRepeat = previousReview?.antiRepeatStrategy.join("; ") || "none";
    const memoryRefs = this.taskMemoryReferenceSummary(task);
    return [
      "You are the Thoth Loop PlanExec agent for one background task goal.",
      "Do not ask the user any clarification questions. Treat all supplied cards and context as final.",
      "First produce a concise plan in provider plan mode, then implement only the current goal.",
      "Do not jump to later goals. Do not work outside the current goal boundary.",
      "At the end, call thoth_loop_submit_planexec_result exactly once.",
      "For the result tool, use the exact Current goal id and Current phase run id below. Do not substitute the displayed goal number.",
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
      `Goals Card summary: ${task.goalsCard.summary}`,
      `Approved linear goals:\n${task.goals
        .map(
          (candidate) =>
            `${candidate.order}. ${candidate.title}\nGoal: ${candidate.goal}\nAcceptance: ${candidate.acceptance.join("; ")}`,
        )
        .join("\n\n")}`,
      `Current goal ${goal.order}/${task.goals.length}: ${goal.title}`,
      `Current goal id: ${goal.id}`,
      `Current phase run id: ${goalPhase(goal, "planexec", goal.round).phaseRunId ?? "not assigned"}`,
      `Goal: ${goal.goal}`,
      `Goal constraints:\n${goal.constraints.map((item) => `- ${item}`).join("\n")}`,
      `Goal acceptance:\n${goal.acceptance.map((item) => `- ${item}`).join("\n")}`,
      `Round: ${goal.round}`,
      `Failed Review budget: ${task.budget.usedFailedReviews}/${task.budget.maxFailedReviews}`,
      `Previous Review root cause: ${previousRootCause}`,
      `Previous Review guidance: ${previousGuidance}`,
      `Previous anti-repeat strategy: ${previousAntiRepeat}`,
      `Task memory references: ${memoryRefs}`,
      "The approved Task Card and Goals Card above are the complete execution authority. Do not request the raw Clarify transcript unless a real provenance blocker is recorded.",
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
    const planExecPhase = goal.phases.find(
      (phase) => phase.phase === "planexec" && phase.round === goal.round,
    );
    const planExecResult = goal.latestPlanExecResult;
    const memoryRefs = this.taskMemoryReferenceSummary(task);
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
      "If validation fails, be direct, creative, and precise about the root cause and next-round guidance.",
      "If validation passes, provide enough evidence for the next goal to start with context.",
      "At the end, call thoth_loop_submit_review_verdict exactly once.",
      "For the verdict tool, use the exact Current goal id below. Do not substitute the displayed goal number.",
      ...(resumeKind
        ? [
            "This is a continuation of the existing provider session after a user control action.",
            "Read the existing timeline and continue the unfinished validation; do not restart completed checks.",
          ]
        : []),
      "",
      `Task title: ${task.taskCard.title}`,
      `Task goal: ${task.taskCard.goal}`,
      `Goals Card summary: ${task.goalsCard.summary}`,
      `Approved linear goals:\n${task.goals
        .map(
          (candidate) =>
            `${candidate.order}. ${candidate.title}\nGoal: ${candidate.goal}\nAcceptance: ${candidate.acceptance.join("; ")}`,
        )
        .join("\n\n")}`,
      `Current goal ${goal.order}/${task.goals.length}: ${goal.title}`,
      `Current goal id: ${goal.id}`,
      `Current phase run id: ${goalPhase(goal, "review", goal.round).phaseRunId ?? "not assigned"}`,
      `Goal: ${goal.goal}`,
      `Goal constraints:\n${goal.constraints.map((item) => `- ${item}`).join("\n")}`,
      `Goal acceptance:\n${goal.acceptance.map((item) => `- ${item}`).join("\n")}`,
      `Round: ${goal.round}`,
      `PlanExec agent id: ${planExecPhase?.agentId ?? "unknown"}`,
      `PlanExec phase run id: ${planExecPhase?.phaseRunId ?? "unknown"}`,
      `PlanExec result:\n${planExecResult ? JSON.stringify(planExecResult, null, 2) : "not submitted"}`,
      `Task memory references: ${memoryRefs}`,
      "Treat the approved cards and sealed PlanExec evidence above as authority; do not infer extra user requirements from absent transcript text.",
      `Failed Review budget: ${task.budget.usedFailedReviews}/${task.budget.maxFailedReviews}`,
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
    const provider = input.task.providerSession;
    if (
      this.options.agentManager.getProviderCapabilities(provider.provider)
        ?.supportsNativeThothTools !== true
    ) {
      throw new Error("Automatic replan audit requires provider runtime-tool support.");
    }
    const auditRuntimeSession = prepareProviderRuntimeSession({
      provider: provider.provider,
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
    input: ThothLoopPlanExecResultInput,
    phaseRunId: string | undefined,
  ): LoopPlanExecResult {
    return {
      goalId: input.goal_id,
      round: input.round,
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

  private taskMemoryReferenceSummary(task: LoopTaskModel): string {
    const kinds = [
      "clarify_transcript",
      "task_card",
      "goals_card",
      "baseline_evidence",
      "planexec_result",
      "review_verdict",
    ] as const;
    const refs = kinds.flatMap((kind) => {
      const node = this.authorityStore.latestMemory(task.id, kind);
      return node ? [`${kind}@${node.revision}:${node.contentSha256.slice(0, 12)}`] : [];
    });
    return refs.join(", ") || "none";
  }

  private toReviewVerdict(input: ThothLoopReviewVerdictInput): LoopReviewVerdict {
    return {
      outcome: input.outcome,
      round: input.round,
      summary: input.summary,
      acceptanceMatrix: input.acceptance_matrix.map((entry) => ({
        acceptance: entry.acceptance,
        status: entry.status,
        ...(entry.evidence ? { evidence: entry.evidence } : {}),
      })),
      failedAcceptance: input.failed_acceptance,
      ...(input.failure_root_cause ? { failureRootCause: input.failure_root_cause } : {}),
      ...(input.next_round_guidance ? { nextRoundGuidance: input.next_round_guidance } : {}),
      antiRepeatStrategy: input.anti_repeat_strategy,
      evidenceSummary: input.evidence_summary,
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
      if (current && current.status !== "passed") {
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
