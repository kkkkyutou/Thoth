import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolve } from "node:path";
import type { Logger } from "pino";
import type {
  ThothLoopPlanExecResultInput,
  ThothLoopReportBlockedInput,
  ThothLoopReviewVerdictInput,
  ThothRuntimeLoopStrength,
} from "@thoth/protocol/thoth-runtime-contract";
import type {
  BackgroundTaskAction,
  BackgroundTaskModel,
  LoopGoalRecord,
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
  AgentSessionConfig,
  AgentStreamEvent,
} from "../agent/agent-sdk-types.js";
import type { AgentManager } from "../agent/agent-manager.js";
import { respondToAgentPermission } from "../agent/permission-response.js";
import { loadRuntimeSkillArtifact, mountRuntimeSkillForSession } from "@thoth/drivers/clarify";

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
  logger: Logger;
  onTaskUpdated?: (task: LoopTaskModel) => void;
}

interface PersistedLoopTaskFile {
  version: 1;
  tasks: LoopTaskModel[];
}

interface LoopWorktreeLockRecord {
  workspacePath: string;
  taskId: string;
  phase: LoopPhaseKind | null;
  phaseAgentId?: string;
  createdAt: string;
  heartbeatAt: string;
}

interface PersistedLoopWorktreeLockFile {
  version: 1;
  locks: LoopWorktreeLockRecord[];
}

type PhaseResult =
  | { kind: "planexec"; result: ThothLoopPlanExecResultInput }
  | { kind: "review"; result: ThothLoopReviewVerdictInput }
  | { kind: "blocked"; result: ThothLoopReportBlockedInput };

interface PendingPhaseResult {
  taskId: string;
  goalId: string;
  phase: LoopPhaseKind;
  round: number;
  resolve: (result: PhaseResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const PHASE_RESULT_TIMEOUT_MS = 30 * 60 * 1000;
const CODEX_AUTH_MIRROR_FILES = ["auth.json", "config.toml"] as const;

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

function defaultCodexHome(): string {
  const explicit = process.env.CODEX_HOME?.trim();
  return explicit && explicit.length > 0 ? explicit : path.join(homedir(), ".codex");
}

function mirrorCodexAuthFile(input: {
  sourceHome: string;
  targetHome: string;
  fileName: string;
}): void {
  const source = path.join(input.sourceHome, input.fileName);
  const target = path.join(input.targetHome, input.fileName);
  if (!existsSync(source) || existsSync(target)) {
    return;
  }
  mkdirSync(path.dirname(target), { recursive: true });
  try {
    symlinkSync(source, target);
  } catch {
    copyFileSync(source, target);
  }
}

function prepareCodexLoopSessionHome(input: { thothHome: string; sessionId: string }): string {
  const providerSessionHome = resolve(input.thothHome, "provider-sessions", input.sessionId);
  mkdirSync(providerSessionHome, { recursive: true });
  const sourceHome = defaultCodexHome();
  for (const fileName of CODEX_AUTH_MIRROR_FILES) {
    mirrorCodexAuthFile({ sourceHome, targetHome: providerSessionHome, fileName });
  }
  mountRuntimeSkillForSession({
    artifact: loadRuntimeSkillArtifact("thoth.loop"),
    thothSessionHome: input.thothHome,
    sessionId: input.sessionId,
  });
  return providerSessionHome;
}

export class ThothLoopTaskService {
  private readonly tasks = new Map<string, LoopTaskModel>();
  private readonly providerByTask = new Map<string, ProviderSessionConfig>();
  private readonly worktreeLocks = new Map<string, LoopWorktreeLockRecord>();
  private readonly pendingByAgent = new Map<string, PendingPhaseResult>();
  private readonly storePath: string;
  private readonly lockStorePath: string;
  private schedulerRunning = false;

  constructor(private readonly options: ThothLoopTaskServiceOptions) {
    this.storePath = path.join(options.thothHome, "thoth-loop", "tasks.json");
    this.lockStorePath = path.join(options.thothHome, "thoth-loop", "worktree-locks.json");
    this.load();
    this.loadLocks();
    this.reconcileLoadedLocks();
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
    return this.tasks.get(taskId) ?? null;
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
      currentGoalId: firstGoal?.id ?? null,
      currentPhase: null,
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
    this.persist();
    this.emit(task);
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
      task.summary = "用户已停止后台任务。";
      this.markCurrentGoal(task, "stopped");
      await this.cancelCurrentPhase(task);
      this.touch(task);
      return task;
    }
    if (action === "pause") {
      task.status = "paused";
      task.summary = "用户已暂停后台任务；Resume 会从当前阶段重开。";
      this.markCurrentGoal(task, "paused");
      await this.cancelCurrentPhase(task);
      this.touch(task);
      return task;
    }
    if (action === "resume") {
      if (task.status === "paused" || task.status === "interrupted") {
        task.status = "queued";
        task.summary = "后台任务已恢复排队。";
        this.touch(task);
        this.schedule();
      }
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
    const mismatch = this.validatePendingPhaseResult(pending, result);
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
    pending.resolve(result);
    return true;
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
    return null;
  }

  private load(): void {
    if (!existsSync(this.storePath)) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.storePath, "utf8")) as PersistedLoopTaskFile;
      for (const raw of parsed.tasks ?? []) {
        const parsedTask = LoopTaskModelSchema.safeParse(raw);
        if (!parsedTask.success) {
          continue;
        }
        const task = parsedTask.data;
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
      }
      this.persist();
    } catch (error) {
      this.options.logger.warn({ err: error }, "Failed to load Thoth loop tasks");
    }
  }

  private loadLocks(): void {
    if (!existsSync(this.lockStorePath)) {
      return;
    }
    try {
      const parsed = JSON.parse(
        readFileSync(this.lockStorePath, "utf8"),
      ) as PersistedLoopWorktreeLockFile;
      for (const raw of parsed.locks ?? []) {
        if (!raw?.workspacePath || !raw.taskId || !raw.createdAt || !raw.heartbeatAt) {
          continue;
        }
        this.worktreeLocks.set(resolve(raw.workspacePath), {
          workspacePath: resolve(raw.workspacePath),
          taskId: raw.taskId,
          phase: raw.phase ?? null,
          ...(raw.phaseAgentId ? { phaseAgentId: raw.phaseAgentId } : {}),
          createdAt: raw.createdAt,
          heartbeatAt: raw.heartbeatAt,
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
      changed = true;
    }
    if (changed) {
      this.persist();
      this.persistLocks();
    }
  }

  private persist(): void {
    try {
      mkdirSync(path.dirname(this.storePath), { recursive: true });
      writeFileSync(
        this.storePath,
        `${JSON.stringify({ version: 1, tasks: Array.from(this.tasks.values()) }, null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      this.options.logger.warn({ err: error }, "Failed to persist Thoth loop tasks");
    }
  }

  private persistLocks(): void {
    try {
      mkdirSync(path.dirname(this.lockStorePath), { recursive: true });
      const locks = Array.from(this.worktreeLocks.values());
      if (locks.length === 0) {
        rmSync(this.lockStorePath, { force: true });
        return;
      }
      writeFileSync(
        this.lockStorePath,
        `${JSON.stringify({ version: 1, locks }, null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      this.options.logger.warn({ err: error }, "Failed to persist Thoth loop worktree locks");
    }
  }

  private acquireWorktreeLock(task: LoopTaskModel): boolean {
    const workspacePath = resolve(task.workspacePath);
    if (this.worktreeLocks.has(workspacePath)) {
      return false;
    }
    const now = nowIso();
    this.worktreeLocks.set(workspacePath, {
      workspacePath,
      taskId: task.id,
      phase: task.currentPhase,
      createdAt: now,
      heartbeatAt: now,
    });
    this.persistLocks();
    return true;
  }

  private updateWorktreeLock(task: LoopTaskModel, input: { phaseAgentId?: string } = {}): void {
    const workspacePath = resolve(task.workspacePath);
    const current = this.worktreeLocks.get(workspacePath);
    if (!current || current.taskId !== task.id) {
      return;
    }
    this.worktreeLocks.set(workspacePath, {
      ...current,
      phase: task.currentPhase,
      ...(input.phaseAgentId ? { phaseAgentId: input.phaseAgentId } : {}),
      heartbeatAt: nowIso(),
    });
    this.persistLocks();
  }

  private releaseWorktreeLock(task: LoopTaskModel): void {
    const workspacePath = resolve(task.workspacePath);
    if (this.worktreeLocks.get(workspacePath)?.taskId === task.id) {
      this.worktreeLocks.delete(workspacePath);
      this.persistLocks();
    }
  }

  private touch(task: LoopTaskModel): void {
    task.updatedAt = nowIso();
    this.persist();
    this.emit(task);
  }

  private emit(task: LoopTaskModel): void {
    this.options.onTaskUpdated?.(task);
  }

  private schedule(): void {
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
    if (provider.provider !== "codex") {
      task.status = "blocked";
      task.summary = `后台 Loop 当前只支持 Codex dynamicTools；provider ${provider.provider} 尚未接入。`;
      this.touch(task);
      return;
    }
    while (task.status === "queued" || task.status === "running") {
      const goal = this.currentGoal(task);
      if (!goal) {
        task.status = "done";
        task.currentGoalId = null;
        task.currentPhase = null;
        task.summary = "所有 goals 已通过 Review。";
        this.touch(task);
        return;
      }

      task.status = "running";
      task.currentGoalId = goal.id;
      task.goalRound = goal.round;
      await this.runPlanExec(task, goal, provider);
      if (task.status !== "running") {
        return;
      }
      await this.runReview(task, goal, provider);
      if (task.status !== "running" && task.status !== "queued") {
        return;
      }
      if (goal.status === "passed") {
        const nextGoal = task.goals.find((candidate) => candidate.status === "queued");
        task.currentGoalId = nextGoal?.id ?? null;
        task.currentPhase = null;
        task.goalRound = nextGoal?.round ?? task.goalRound;
        task.status = nextGoal ? "queued" : "done";
        task.summary = nextGoal
          ? `Goal ${goal.order} 已通过，准备推进到 Goal ${nextGoal.order}。`
          : "所有 goals 已通过 Review。";
        this.touch(task);
      }
    }
  }

  private async runPlanExec(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    provider: ProviderSessionConfig,
  ): Promise<void> {
    task.currentPhase = "planexec";
    goal.status = "running_planexec";
    const phase = goalPhase(goal, "planexec", goal.round);
    phase.status = "running";
    phase.startedAt = nowIso();
    phase.attemptStartedAt = phase.startedAt;
    phase.phaseRunId = `loop-phase-${randomUUID()}`;
    phase.providerExitStatus = undefined;
    phase.canceledReason = undefined;
    phase.resultToolCallId = undefined;
    task.summary = `正在执行 Goal ${goal.order}: ${goal.title}`;
    this.touch(task);
    this.updateWorktreeLock(task);

    const reusedAgentId = goal.phases
      .filter(
        (entry) => entry.phase === "planexec" && entry.agentId && entry.status === "completed",
      )
      .sort((left, right) => right.round - left.round)[0]?.agentId;
    const agentId = reusedAgentId ?? (await this.createPlanExecAgent(task, goal, provider));
    phase.agentId = agentId;
    this.touch(task);
    this.updateWorktreeLock(task, { phaseAgentId: agentId });
    const result = await this.runPhaseAndWait({
      task,
      goal,
      phase: "planexec",
      agentId,
      prompt: this.buildPlanExecPrompt(task, goal),
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
    goal.latestPlanExecSummary = result.result.execution_summary;
    goal.latestPlanExecResult = planExecResult;
    phase.status = "completed";
    phase.completedAt = nowIso();
    phase.providerExitStatus = "completed";
    phase.resultToolCallId = planExecResult.resultToolCallId;
    phase.summary = result.result.execution_summary;
    goal.status = "running_review";
    this.touch(task);
  }

  private async runReview(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    provider: ProviderSessionConfig,
  ): Promise<void> {
    task.currentPhase = "review";
    goal.status = "running_review";
    const phase = goalPhase(goal, "review", goal.round);
    phase.status = "running";
    phase.startedAt = nowIso();
    phase.attemptStartedAt = phase.startedAt;
    phase.phaseRunId = `loop-phase-${randomUUID()}`;
    phase.providerExitStatus = undefined;
    phase.canceledReason = undefined;
    phase.resultToolCallId = undefined;
    task.summary = `正在 Review Goal ${goal.order}: ${goal.title}`;
    this.touch(task);
    this.updateWorktreeLock(task);

    const agentId = await this.createReviewAgent(task, goal, provider);
    phase.agentId = agentId;
    this.touch(task);
    this.updateWorktreeLock(task, { phaseAgentId: agentId });
    const result = await this.runPhaseAndWait({
      task,
      goal,
      phase: "review",
      agentId,
      prompt: this.buildReviewPrompt(task, goal),
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
    const verdict = this.toReviewVerdict(result.result);
    goal.latestReview = verdict;
    task.latestVerdictSummary = verdict.summary;
    phase.completedAt = nowIso();
    phase.providerExitStatus = verdict.outcome === "blocked" ? "blocked" : "completed";
    phase.resultToolCallId = result.result.result_tool_call_id;
    phase.summary = verdict.summary;
    if (verdict.outcome === "pass") {
      phase.status = "completed";
      goal.status = "passed";
      this.touch(task);
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
    if (task.budget.usedFailedReviews >= task.budget.maxFailedReviews) {
      this.blockTask(
        task,
        goal,
        `Review 未通过且 ${task.loopStrength} 预算已耗尽：${verdict.summary}`,
      );
      return;
    }
    goal.round += 1;
    task.goalRound = goal.round;
    goal.status = "queued";
    goal.phases.push({ phase: "planexec", status: "queued", round: goal.round });
    goal.phases.push({ phase: "review", status: "queued", round: goal.round });
    task.currentPhase = null;
    task.status = "queued";
    task.summary = `Review 未通过，准备按反馈重跑 Goal ${goal.order} 第 ${goal.round} 轮。`;
    this.touch(task);
  }

  private async runPhaseAndWait(input: {
    task: LoopTaskModel;
    goal: LoopGoalRecord;
    phase: LoopPhaseKind;
    agentId: string;
    prompt: string;
  }): Promise<PhaseResult | null> {
    const waitForResult = this.createPendingPhaseResult(input);
    const events = this.options.agentManager.streamAgent(input.agentId, input.prompt);
    void this.consumePhaseEvents(input.task, input.goal, input.agentId, input.phase, events);
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
    events: AsyncGenerator<AgentStreamEvent>,
  ): Promise<void> {
    try {
      for await (const event of events) {
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
          task.summary = `${phaseTitle(phase)} provider 回合失败：${event.error}`;
          const record = goalPhase(goal, phase, goal.round);
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
          const record = goalPhase(goal, phase, goal.round);
          record.providerExitStatus = "canceled";
          record.canceledReason = "provider turn canceled";
          record.summary = "Provider turn canceled.";
          this.touch(task);
        }
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
    const config: AgentSessionConfig = {
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
      extra: {
        codex: {
          thothLoopRuntimeTools: true,
        },
      },
    };
    const agent = await this.options.agentManager.createAgent(config, undefined, {
      labels: {
        surface: "thoth-loop",
        loopTaskId: task.id,
        loopGoalId: goal.id,
        loopPhase: "planexec",
      },
      env: {
        CODEX_HOME: prepareCodexLoopSessionHome({
          thothHome: this.options.thothHome,
          sessionId,
        }),
      },
      persistSession: true,
      initialTitle: `PlanExec: ${goal.title}`,
    });
    return agent.id;
  }

  private async createReviewAgent(
    task: LoopTaskModel,
    goal: LoopGoalRecord,
    provider: ProviderSessionConfig,
  ): Promise<string> {
    const sessionId = `loop-${task.id}-${goal.id}-review-${goal.round}`;
    const config: AgentSessionConfig = {
      provider: provider.provider,
      cwd: task.workspacePath,
      internal: true,
      ...(provider.model ? { model: provider.model } : {}),
      modeId: "auto",
      ...(provider.thinkingOptionId ? { thinkingOptionId: provider.thinkingOptionId } : {}),
      ...(provider.featureValues ? { featureValues: provider.featureValues } : {}),
      extra: {
        codex: {
          thothLoopRuntimeTools: true,
        },
      },
    };
    const agent = await this.options.agentManager.createAgent(config, undefined, {
      labels: {
        surface: "thoth-loop",
        loopTaskId: task.id,
        loopGoalId: goal.id,
        loopPhase: "review",
        loopRound: String(goal.round),
      },
      env: {
        CODEX_HOME: prepareCodexLoopSessionHome({
          thothHome: this.options.thothHome,
          sessionId,
        }),
      },
      persistSession: true,
      initialTitle: `Review: ${goal.title}`,
    });
    return agent.id;
  }

  private buildPlanExecPrompt(task: LoopTaskModel, goal: LoopGoalRecord): string {
    const previousGuidance = goal.latestReview?.nextRoundGuidance ?? "none";
    return [
      "You are the Thoth Loop PlanExec agent for one background task goal.",
      "Do not ask the user any clarification questions. Treat all supplied cards and context as final.",
      "First produce a concise plan in provider plan mode, then implement only the current goal.",
      "Do not jump to later goals. Do not work outside the current goal boundary.",
      "At the end, call thoth_loop_submit_planexec_result exactly once.",
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
      `Goal: ${goal.goal}`,
      `Goal constraints:\n${goal.constraints.map((item) => `- ${item}`).join("\n")}`,
      `Goal acceptance:\n${goal.acceptance.map((item) => `- ${item}`).join("\n")}`,
      `Round: ${goal.round}`,
      `Failed Review budget: ${task.budget.usedFailedReviews}/${task.budget.maxFailedReviews}`,
      `Previous Review guidance: ${previousGuidance}`,
      `Full Clarify and approval transcript:\n${task.clarifyTranscript ?? "not captured"}`,
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

  private buildReviewPrompt(task: LoopTaskModel, goal: LoopGoalRecord): string {
    const planExecPhase = goal.phases.find(
      (phase) => phase.phase === "planexec" && phase.round === goal.round,
    );
    const planExecResult = goal.latestPlanExecResult;
    return [
      "You are the independent Thoth Loop Review agent.",
      "Strictly validate the current goal against the approved cards and acceptance criteria.",
      "You may inspect the workspace and run tests. Do not modify source files.",
      "If validation fails, be direct, creative, and precise about the root cause and next-round guidance.",
      "If validation passes, provide enough evidence for the next goal to start with context.",
      "At the end, call thoth_loop_submit_review_verdict exactly once.",
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
      `Goal: ${goal.goal}`,
      `Goal constraints:\n${goal.constraints.map((item) => `- ${item}`).join("\n")}`,
      `Goal acceptance:\n${goal.acceptance.map((item) => `- ${item}`).join("\n")}`,
      `Round: ${goal.round}`,
      `PlanExec agent id: ${planExecPhase?.agentId ?? "unknown"}`,
      `PlanExec phase run id: ${planExecPhase?.phaseRunId ?? "unknown"}`,
      `PlanExec result:\n${planExecResult ? JSON.stringify(planExecResult, null, 2) : "not submitted"}`,
      `Full Clarify and approval transcript:\n${task.clarifyTranscript ?? "not captured"}`,
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
      createdAt: nowIso(),
    };
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
