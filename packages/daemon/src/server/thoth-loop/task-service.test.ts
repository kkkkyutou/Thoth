import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent } from "../agent/agent-sdk-types.js";
import type { AgentManager, ManagedAgent } from "../agent/agent-manager.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { type RegisterLoopTaskInput, ThothLoopTaskService } from "./task-service.js";

type CreateAgentCall = {
  config: Parameters<AgentManager["createAgent"]>[0];
  options: Parameters<AgentManager["createAgent"]>[2];
  id: string;
};

class FakeAgentManager {
  readonly createAgentCalls: CreateAgentCall[] = [];
  readonly streamCalls: Array<{ agentId: string; prompt: string }> = [];
  readonly canceledAgentIds: string[] = [];

  async createAgent(
    config: Parameters<AgentManager["createAgent"]>[0],
    _agentId?: string,
    options?: Parameters<AgentManager["createAgent"]>[2],
  ): Promise<ManagedAgent> {
    const id = `agent-${this.createAgentCalls.length + 1}`;
    this.createAgentCalls.push({ config, options, id });
    return {
      id,
      provider: config.provider,
      cwd: config.cwd,
      config,
      labels: options?.labels ?? {},
    } as ManagedAgent;
  }

  streamAgent(agentId: string, prompt: string): AsyncGenerator<AgentStreamEvent> {
    this.streamCalls.push({ agentId, prompt });
    return (async function* emptyStream() {})();
  }

  async cancelAgentRun(agentId: string): Promise<boolean> {
    this.canceledAgentIds.push(agentId);
    return true;
  }
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createService() {
  const thothHome = makeTempDir("thoth-loop-home-");
  const workspacePath = makeTempDir("thoth-loop-workspace-");
  const agentManager = new FakeAgentManager();
  const updates: string[] = [];
  const service = new ThothLoopTaskService({
    thothHome,
    agentManager: agentManager as unknown as AgentManager,
    logger: createTestLogger(),
    onTaskUpdated: (task) => updates.push(`${task.status}:${task.currentPhase ?? "none"}`),
  });
  return { service, agentManager, thothHome, workspacePath, updates };
}

function baseRegisterInput(workspacePath: string): RegisterLoopTaskInput {
  return {
    workspaceName: "Loop Workspace",
    workspacePath,
    sourceTopicId: "topic-loop",
    loopStrength: "balanced",
    provider: {
      provider: "codex",
      model: "gpt-5.4-codex",
      modeId: "quick",
      thinkingOptionId: "medium",
      featureValues: { sandbox: "workspace-write" },
    },
    clarifyTranscript: "User approved task and goals after clarification.",
    taskCard: {
      id: "task-card-1",
      roundLabel: "Task",
      title: "Implement sortable library",
      goal: "Ship a verified sortable library.",
      constraints: ["Keep the public API small."],
      acceptance: ["Unit tests cover core sorting behavior."],
      provenanceSummary: "Approved by user.",
      submitted: true,
      submittedSummary: "Task approved.",
    },
    goalsCard: {
      id: "goals-card-1",
      roundLabel: "Goals",
      title: "Linear goals",
      summary: "Break the work into two reviewable milestones.",
      provenanceSummary: "Derived from approved Task Card.",
      submitted: true,
      submittedSummary: "Goals approved.",
      goals: [
        {
          id: "goal-1",
          order: 1,
          title: "Core API",
          goal: "Implement the core sorting API.",
          constraints: ["Do not add CLI behavior yet."],
          acceptance: ["Core API has unit coverage."],
          provenance: "Task acceptance item 1.",
        },
        {
          id: "goal-2",
          order: 2,
          title: "Documentation",
          goal: "Document the public sorting API.",
          constraints: ["Keep docs concise."],
          acceptance: ["Usage example is present."],
          provenance: "Task constraints.",
        },
      ],
    },
  };
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(predicate(), label).toBe(true);
}

function planexecResult(goalId: string, round: number) {
  return {
    goal_id: goalId,
    round,
    plan_summary: `Plan for ${goalId} round ${round}.`,
    execution_summary: `Executed ${goalId} round ${round}.`,
    evidence: ["Provider timeline contains implementation evidence."],
    validation_performed: ["Ran focused verification."],
    remaining_risks: [],
    next_review_focus: "Validate acceptance criteria.",
  };
}

function reviewVerdict(goalId: string, round: number, outcome: "pass" | "fail") {
  return {
    goal_id: goalId,
    round,
    outcome,
    summary:
      outcome === "pass"
        ? `${goalId} passed review.`
        : `${goalId} failed review and needs a sharper retry.`,
    acceptance_matrix: [
      {
        acceptance: "Core acceptance",
        status: outcome === "pass" ? "met" : "not_met",
        evidence: outcome === "pass" ? "Verified." : "Missing evidence.",
      },
    ],
    failed_acceptance: outcome === "pass" ? [] : ["Core acceptance"],
    ...(outcome === "fail"
      ? {
          failure_root_cause: "Implementation did not satisfy the approved acceptance.",
          next_round_guidance: "Focus only on the missing acceptance and avoid broad rewrites.",
          anti_repeat_strategy: ["Do not repeat the same verification gap."],
        }
      : { anti_repeat_strategy: [] }),
    evidence_summary: outcome === "pass" ? "All criteria met." : "Review found a gap.",
  };
}

function latestAgentIdFor(
  service: ThothLoopTaskService,
  taskId: string,
  goalId: string,
  phase: "planexec" | "review",
): string {
  const task = service.inspect(taskId);
  const goal = task?.goals.find((entry) => entry.id === goalId);
  const record = goal?.phases
    .filter((entry) => entry.phase === phase && entry.agentId)
    .sort((left, right) => right.round - left.round)[0];
  expect(record?.agentId).toBeTruthy();
  return record!.agentId!;
}

describe("ThothLoopTaskService", () => {
  it("registers a Loop task, starts PlanExec in provider plan mode, and exposes it in the list", async () => {
    const { service, agentManager, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );

    const current = service.inspect(task.id);
    expect(current?.status).toBe("running");
    expect(current?.currentGoalId).toBe("goal-1");
    expect(current?.budget.maxFailedReviews).toBe(10);
    expect(agentManager.createAgentCalls).toHaveLength(1);
    expect(agentManager.createAgentCalls[0]?.config.featureValues).toMatchObject({
      sandbox: "workspace-write",
      plan_mode: true,
    });
    expect(agentManager.createAgentCalls[0]?.config.extra).toMatchObject({
      codex: { thothLoopRuntimeTools: true },
    });
    expect(agentManager.createAgentCalls[0]?.options?.labels).toMatchObject({
      surface: "thoth-loop",
      loopGoalId: "goal-1",
      loopPhase: "planexec",
    });
    expect(service.list({ workspacePath })[0]).toMatchObject({
      id: task.id,
      status: "running",
      detailLabel: "PlanExec in progress",
    });
  });

  it("advances linearly when Review passes and pass reviews do not consume budget", async () => {
    const { service, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "first PlanExec should start",
    );
    service.resolvePlanExecResult(
      latestAgentIdFor(service, task.id, "goal-1", "planexec"),
      planexecResult("goal-1", 1),
    );
    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "review",
      "first Review should start",
    );
    service.resolveReviewVerdict(
      latestAgentIdFor(service, task.id, "goal-1", "review"),
      reviewVerdict("goal-1", 1, "pass"),
    );
    await waitFor(
      () => service.inspect(task.id)?.currentGoalId === "goal-2",
      "task should advance to second goal",
    );

    const current = service.inspect(task.id);
    expect(current?.goals[0]?.status).toBe("passed");
    expect(current?.currentPhase).toBe("planexec");
    expect(current?.budget.usedFailedReviews).toBe(0);
  });

  it("retries the same goal after failed Review, reuses PlanExec agent, and creates a fresh Review agent", async () => {
    const { service, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "first PlanExec should start",
    );
    const planExecAgent = latestAgentIdFor(service, task.id, "goal-1", "planexec");
    service.resolvePlanExecResult(planExecAgent, planexecResult("goal-1", 1));
    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "review",
      "first Review should start",
    );
    const firstReviewAgent = latestAgentIdFor(service, task.id, "goal-1", "review");
    service.resolveReviewVerdict(firstReviewAgent, reviewVerdict("goal-1", 1, "fail"));
    await waitFor(
      () =>
        service.inspect(task.id)?.currentPhase === "planexec" &&
        service.inspect(task.id)?.goalRound === 2,
      "second PlanExec round should start",
    );

    expect(service.inspect(task.id)?.budget.usedFailedReviews).toBe(1);
    expect(latestAgentIdFor(service, task.id, "goal-1", "planexec")).toBe(planExecAgent);
    service.resolvePlanExecResult(planExecAgent, planexecResult("goal-1", 2));
    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "review",
      "second Review should start",
    );
    const secondReviewAgent = latestAgentIdFor(service, task.id, "goal-1", "review");
    expect(secondReviewAgent).not.toBe(firstReviewAgent);
  });

  it("blocks Single after the first failed Review because the failed-review budget is exhausted", async () => {
    const { service, workspacePath } = createService();
    const input = baseRegisterInput(workspacePath);
    input.loopStrength = "one_plan_one_do";
    const task = await service.register(input);

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );
    service.resolvePlanExecResult(
      latestAgentIdFor(service, task.id, "goal-1", "planexec"),
      planexecResult("goal-1", 1),
    );
    await waitFor(() => service.inspect(task.id)?.currentPhase === "review", "Review should start");
    service.resolveReviewVerdict(
      latestAgentIdFor(service, task.id, "goal-1", "review"),
      reviewVerdict("goal-1", 1, "fail"),
    );
    await waitFor(() => service.inspect(task.id)?.status === "blocked", "task should block");

    const current = service.inspect(task.id);
    expect(current?.budget.usedFailedReviews).toBe(1);
    expect(current?.goals[0]?.status).toBe("blocked");
    expect(current?.summary).toContain("预算已耗尽");
  });

  it("keeps one active task per worktree and queues the next task until the lock is released", async () => {
    const { service, agentManager, workspacePath } = createService();
    const first = await service.register(baseRegisterInput(workspacePath));
    const second = await service.register({
      ...baseRegisterInput(workspacePath),
      taskCard: {
        ...baseRegisterInput(workspacePath).taskCard,
        id: "task-card-2",
        title: "Second task",
      },
      goalsCard: {
        ...baseRegisterInput(workspacePath).goalsCard,
        id: "goals-card-2",
      },
    });

    await waitFor(
      () => service.inspect(first.id)?.currentPhase === "planexec",
      "first task should start",
    );

    expect(service.inspect(first.id)?.status).toBe("running");
    expect(service.inspect(second.id)?.status).toBe("queued");
    expect(agentManager.createAgentCalls).toHaveLength(1);
  });

  it("pauses, resumes, and stops without converting a canceled phase into blocked", async () => {
    const { service, agentManager, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );
    const agentId = latestAgentIdFor(service, task.id, "goal-1", "planexec");
    await service.action(task.id, "pause");
    await waitFor(() => service.inspect(task.id)?.status === "paused", "task should pause");
    expect(agentManager.canceledAgentIds).toContain(agentId);
    expect(service.inspect(task.id)?.goals[0]?.status).toBe("paused");

    await service.action(task.id, "resume");
    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "task should restart PlanExec",
    );
    await service.action(task.id, "stop");
    await waitFor(() => service.inspect(task.id)?.status === "stopped", "task should stop");
    expect(service.inspect(task.id)?.goals[0]?.status).toBe("stopped");
  });

  it("loads running tasks as interrupted after daemon restart", async () => {
    const { service, agentManager, thothHome, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));
    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );

    const reloaded = new ThothLoopTaskService({
      thothHome,
      agentManager: agentManager as unknown as AgentManager,
      logger: createTestLogger(),
    });

    const current = reloaded.inspect(task.id);
    expect(current?.status).toBe("interrupted");
    expect(current?.goals[0]?.status).toBe("interrupted");
    expect(current?.summary).toContain("Resume");
  });
});
