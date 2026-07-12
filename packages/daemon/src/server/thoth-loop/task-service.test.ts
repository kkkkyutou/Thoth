import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoopTaskModel } from "@thoth/protocol/workspace-secretary/rpc-schemas";
import type { AgentStreamEvent } from "../agent/agent-sdk-types.js";
import type { AgentManager, ManagedAgent } from "../agent/agent-manager.js";
import { AgentStorage } from "../agent/agent-storage.js";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { resolveContractPreservationAudit } from "../agent/clarify-audit-broker.js";
import { LoopAuthorityStore } from "./authority-store.js";
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
  readonly replacedAgentIds: string[] = [];
  readonly inFlightAgentIds = new Set<string>();
  readonly agents = new Map<string, ManagedAgent>();
  readonly nextStreamEventBatches: AgentStreamEvent[][] = [];

  async createAgent(
    config: Parameters<AgentManager["createAgent"]>[0],
    _agentId?: string,
    options?: Parameters<AgentManager["createAgent"]>[2],
  ): Promise<ManagedAgent> {
    const id = `agent-${this.createAgentCalls.length + 1}`;
    this.createAgentCalls.push({ config, options, id });
    const agent = {
      id,
      provider: config.provider,
      cwd: config.cwd,
      config,
      internal: config.internal ?? false,
      labels: options?.labels ?? {},
    } as ManagedAgent;
    this.agents.set(id, agent);
    return agent;
  }

  getAgent(agentId: string): ManagedAgent | null {
    return this.agents.get(agentId) ?? null;
  }

  markAgentInternal(agentId: string): boolean {
    return this.setAgentInternal(agentId, true);
  }

  setAgentInternal(agentId: string, internal: boolean): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }
    agent.internal = internal;
    return true;
  }

  streamAgent(agentId: string, prompt: string): AsyncGenerator<AgentStreamEvent> {
    this.streamCalls.push({ agentId, prompt });
    const batch = this.nextStreamEventBatches.shift();
    if (batch) {
      return (async function* scriptedStream() {
        yield* batch;
      })();
    }
    // A live provider phase stays open until a runtime tool settles it. An
    // empty generator incorrectly models a completed turn and hides control
    // lifecycle races in scheduler tests.
    return (async function* pendingStream() {
      await new Promise<void>(() => undefined);
    })();
  }

  hasInFlightRun(agentId: string): boolean {
    return this.inFlightAgentIds.has(agentId);
  }

  replaceAgentRun(agentId: string, prompt: string): AsyncGenerator<AgentStreamEvent> {
    this.replacedAgentIds.push(agentId);
    this.inFlightAgentIds.delete(agentId);
    return this.streamAgent(agentId, prompt);
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

function hasPhaseAgent(
  service: ThothLoopTaskService,
  taskId: string,
  goalId: string,
  phase: "planexec" | "review",
): boolean {
  const task = service.inspect(taskId);
  return Boolean(
    task?.goals
      .find((goal) => goal.id === goalId)
      ?.phases.some((record) => record.phase === phase && Boolean(record.agentId)),
  );
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
      codex: { thothLoopRuntimeTools: true, thothLoopPhase: "planexec" },
    });
    expect(agentManager.createAgentCalls[0]?.options?.labels).toMatchObject({
      surface: "thoth-loop",
      loopGoalId: "goal-1",
      loopPhase: "planexec",
    });
    expect(agentManager.createAgentCalls[0]?.options?.persistInternal).toBe(true);
    expect(service.list({ workspacePath })[0]).toMatchObject({
      id: task.id,
      status: "running",
      detailLabel: "PlanExec in progress · Goal 1: Core API · failed reviews 0/10",
    });
  });

  it("recovers a legacy completed phase agent from its Codex session metadata", async () => {
    const { service, agentManager, thothHome, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));
    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );
    const phaseAgentId = latestAgentIdFor(service, task.id, "goal-1", "planexec");
    const sessionDir = join(
      thothHome,
      "provider-sessions",
      `loop-${task.id}-goal-1-planexec`,
      "sessions",
      "2026",
      "07",
      "10",
    );
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "rollout-2026-07-10T10-00-00-thread-loop-planexec.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-07-10T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "019f4b00-0000-7000-8000-000000000001",
          timestamp: "2026-07-10T10:00:00.000Z",
          cwd: workspacePath,
        },
      })}\n`,
      "utf8",
    );
    const storage = new AgentStorage(join(thothHome, "agents"), createTestLogger());
    await storage.initialize();
    const reloaded = new ThothLoopTaskService({
      thothHome,
      agentManager: agentManager as unknown as AgentManager,
      agentStorage: storage,
      logger: createTestLogger(),
    });

    await expect(reloaded.recoverPhaseAgent(phaseAgentId)).resolves.toBe(true);
    expect(await storage.get(phaseAgentId)).toMatchObject({
      id: phaseAgentId,
      internal: true,
      title: "PlanExec: Core API",
      labels: {
        surface: "thoth-loop",
        loopTaskId: task.id,
        loopGoalId: "goal-1",
        loopPhase: "planexec",
      },
      persistence: {
        provider: "codex",
        sessionId: "019f4b00-0000-7000-8000-000000000001",
      },
    });
  });

  it("never turns a normal persisted agent into an internal Loop phase", async () => {
    const { agentManager, thothHome, workspacePath } = createService();
    const storage = new AgentStorage(join(thothHome, "agents"), createTestLogger());
    await storage.initialize();
    const agentId = "foreground-agent";
    await storage.upsert({
      id: agentId,
      provider: "codex",
      cwd: workspacePath,
      createdAt: "2026-07-11T00:00:00.000Z",
      updatedAt: "2026-07-11T00:00:00.000Z",
      lastActivityAt: "2026-07-11T00:00:00.000Z",
      lastUserMessageAt: "2026-07-11T00:00:00.000Z",
      title: "Implement a renderer",
      labels: {},
      lastStatus: "idle",
      lastModeId: "full-access",
      config: { modeId: "full-access", model: "gpt-5.5" },
      runtimeInfo: {
        provider: "codex",
        sessionId: "thread-foreground",
        model: "gpt-5.5",
        thinkingOptionId: null,
        modeId: "full-access",
      },
      persistence: {
        provider: "codex",
        sessionId: "thread-foreground",
        nativeHandle: "thread-foreground",
      },
      // Simulate the old overly broad recoverPhaseAgent mutation.
      internal: true,
      archivedAt: "2026-07-11T00:00:00.000Z",
    });
    agentManager.agents.set(agentId, {
      id: agentId,
      provider: "codex",
      cwd: workspacePath,
      internal: true,
      labels: {},
    } as ManagedAgent);
    const service = new ThothLoopTaskService({
      thothHome,
      agentManager: agentManager as unknown as AgentManager,
      agentStorage: storage,
      logger: createTestLogger(),
    });

    await expect(service.recoverPhaseAgent(agentId)).resolves.toBe(false);
    expect(await storage.get(agentId)).toMatchObject({ internal: false });
    expect(agentManager.getAgent(agentId)?.internal).toBe(false);
  });

  it.each([
    ["light", 5],
    ["balanced", 10],
    ["run_until_stopped", 30],
  ] as const)("sets %s failed-review budget to %i", async (loopStrength, expectedBudget) => {
    const { service, agentManager, workspacePath } = createService();
    const input = baseRegisterInput(workspacePath);
    input.loopStrength = loopStrength;
    const task = await service.register(input);

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );

    expect(service.inspect(task.id)?.budget.maxFailedReviews).toBe(expectedBudget);
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

  it("reaches done when every goal passes Review", async () => {
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
    await waitFor(() => service.inspect(task.id)?.currentPhase === "review", "Review should start");
    service.resolveReviewVerdict(
      latestAgentIdFor(service, task.id, "goal-1", "review"),
      reviewVerdict("goal-1", 1, "pass"),
    );
    await waitFor(
      () => service.inspect(task.id)?.currentGoalId === "goal-2",
      "second goal should start",
    );
    service.resolvePlanExecResult(
      latestAgentIdFor(service, task.id, "goal-2", "planexec"),
      planexecResult("goal-2", 1),
    );
    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "review",
      "second Review should start",
    );
    service.resolveReviewVerdict(
      latestAgentIdFor(service, task.id, "goal-2", "review"),
      reviewVerdict("goal-2", 1, "pass"),
    );
    await waitFor(() => service.inspect(task.id)?.status === "done", "task should be done");

    const current = service.inspect(task.id);
    expect(current?.currentGoalId).toBeNull();
    expect(current?.goals.every((goal) => goal.status === "passed")).toBe(true);
    expect(current?.budget.usedFailedReviews).toBe(0);
  });

  it("retries the same goal after failed Review, reuses PlanExec agent, and creates a fresh Review agent", async () => {
    const { service, agentManager, workspacePath } = createService();
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
    agentManager.inFlightAgentIds.add(planExecAgent);
    service.resolveReviewVerdict(firstReviewAgent, reviewVerdict("goal-1", 1, "fail"));
    await waitFor(
      () =>
        service.inspect(task.id)?.currentPhase === "planexec" &&
        service.inspect(task.id)?.goalRound === 2,
      "second PlanExec round should start",
    );

    expect(service.inspect(task.id)?.budget.usedFailedReviews).toBe(1);
    expect(latestAgentIdFor(service, task.id, "goal-1", "planexec")).toBe(planExecAgent);
    expect(agentManager.replacedAgentIds).toEqual([planExecAgent]);
    service.resolvePlanExecResult(planExecAgent, planexecResult("goal-1", 2));
    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "review",
      "second Review should start",
    );
    const secondReviewAgent = latestAgentIdFor(service, task.id, "goal-1", "review");
    expect(secondReviewAgent).not.toBe(firstReviewAgent);
  });

  it("rejects Loop tool results that target the wrong goal or round", async () => {
    const { service, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );
    const planExecAgent = latestAgentIdFor(service, task.id, "goal-1", "planexec");

    expect(service.resolvePlanExecResult(planExecAgent, planexecResult("goal-2", 1))).toBe(false);
    await waitFor(() => service.inspect(task.id)?.status === "blocked", "task should block");
    expect(service.inspect(task.id)?.summary).toContain("current goal is goal-1");
  });

  it("normalizes only the active goal display ordinal and then starts Review", async () => {
    const { service, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );
    const planExecAgent = latestAgentIdFor(service, task.id, "goal-1", "planexec");

    expect(service.resolvePlanExecResult(planExecAgent, planexecResult("1", 1))).toBe(true);
    await waitFor(() => service.inspect(task.id)?.currentPhase === "review", "Review should start");

    const current = service.inspect(task.id);
    expect(current?.status).toBe("running");
    expect(current?.goals[0]?.status).toBe("running_review");
    expect(current?.goals[0]?.latestPlanExecResult?.goalId).toBe("goal-1");
  });

  it("does not normalize a different display ordinal", async () => {
    const { service, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );
    const planExecAgent = latestAgentIdFor(service, task.id, "goal-1", "planexec");

    expect(service.resolvePlanExecResult(planExecAgent, planexecResult("2", 1))).toBe(false);
    await waitFor(() => service.inspect(task.id)?.status === "blocked", "task should block");
    expect(service.inspect(task.id)?.summary).toContain("current goal is goal-1");
  });

  it("blocks promptly when a provider turn ends without its required semantic result", async () => {
    const { service, agentManager, workspacePath } = createService();
    agentManager.nextStreamEventBatches.push([
      { type: "turn_completed", provider: "codex", turnId: "turn-without-result" },
    ]);
    const task = await service.register(baseRegisterInput(workspacePath));

    await waitFor(
      () => service.inspect(task.id)?.status === "blocked",
      "a completed provider turn without result should not wait for timeout",
    );

    const current = service.inspect(task.id);
    expect(current?.summary).toContain("没有提交可验证的 Loop 结果");
    expect(current?.goals[0]?.status).toBe("blocked");
    expect(current?.goals[0]?.phases[0]).toMatchObject({
      phase: "planexec",
      status: "blocked",
      providerExitStatus: "blocked",
    });
  });

  it("feeds the full PlanExec result into the Review prompt", async () => {
    const { service, agentManager, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );
    service.resolvePlanExecResult(latestAgentIdFor(service, task.id, "goal-1", "planexec"), {
      ...planexecResult("goal-1", 1),
      evidence: ["Specific evidence A.", "Specific evidence B."],
      validation_performed: ["Ran npm test."],
      remaining_risks: ["Benchmark not yet broad."],
      next_review_focus: "Inspect the specific evidence and risk.",
    });
    await waitFor(() => service.inspect(task.id)?.currentPhase === "review", "Review should start");

    const reviewPrompt = agentManager.streamCalls.find((call) =>
      call.prompt.includes("You are the independent Thoth Loop Review agent."),
    )?.prompt;
    expect(reviewPrompt).toContain("Specific evidence A.");
    expect(reviewPrompt).toContain("Ran npm test.");
    expect(reviewPrompt).toContain("Benchmark not yet broad.");
    expect(reviewPrompt).toContain("Inspect the specific evidence and risk.");
    expect(reviewPrompt).toContain("Current goal id: goal-1");
    expect(reviewPrompt).toContain("Current phase run id: loop-phase-");
  });

  it("puts the stable goal id and phase run id in the PlanExec prompt", async () => {
    const { service, agentManager, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );

    const prompt = agentManager.streamCalls[0]?.prompt;
    expect(prompt).toContain("Current goal 1/2: Core API");
    expect(prompt).toContain("Current goal id: goal-1");
    expect(prompt).toContain("Current phase run id: loop-phase-");
    expect(prompt).toContain("Do not substitute the displayed goal number.");
  });

  it("enters durable budget_wait after the first failed Single Review", async () => {
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
    await waitFor(
      () => service.inspect(task.id)?.status === "budget_wait",
      "task should wait for an explicit budget decision",
    );

    const current = service.inspect(task.id);
    expect(current?.budget.usedFailedReviews).toBe(1);
    expect(current?.goals[0]?.status).toBe("paused");
    expect(current?.budgetWait?.exhaustedDimensions).toContain("failed_reviews");
    expect(service.list({ workspacePath })[0]?.status).toBe("budget_wait");
  });

  it("keeps one active task per worktree and queues the next task until the lock is released", async () => {
    const { service, agentManager, thothHome, workspacePath } = createService();
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
    expect(existsSync(join(thothHome, "thoth-loop", "authority.sqlite"))).toBe(true);
  });

  it("pauses at the PlanExec boundary, then resumes Review without replaying PlanExec", async () => {
    const { service, agentManager, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));

    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "planexec",
      "PlanExec should start",
    );
    const planExecAgentId = latestAgentIdFor(service, task.id, "goal-1", "planexec");
    await service.action(task.id, "pause");
    expect(service.inspect(task.id)).toMatchObject({
      status: "running",
      controlIntent: "pause_after_phase",
    });
    expect(agentManager.canceledAgentIds).not.toContain(planExecAgentId);

    service.resolvePlanExecResult(planExecAgentId, planexecResult("goal-1", 1));
    await waitFor(
      () => service.inspect(task.id)?.status === "paused",
      "task should pause at boundary",
    );
    expect(service.inspect(task.id)?.currentPhase).toBe("review");
    expect(service.inspect(task.id)?.goals[0]?.status).toBe("paused");
    expect(agentManager.createAgentCalls).toHaveLength(1);

    await service.action(task.id, "resume");
    await waitFor(
      () => service.inspect(task.id)?.currentPhase === "review",
      "task should continue into Review",
    );
    const reviewAgentId = latestAgentIdFor(service, task.id, "goal-1", "review");
    expect(agentManager.createAgentCalls).toHaveLength(2);

    await service.action(task.id, "stop");
    await waitFor(() => service.inspect(task.id)?.status === "stopped", "task should stop");
    expect(agentManager.canceledAgentIds).toContain(reviewAgentId);
    expect(service.inspect(task.id)?.goals[0]).toMatchObject({ status: "stopped" });

    await service.action(task.id, "resume");
    await waitFor(
      () =>
        service.inspect(task.id)?.currentPhase === "review" && agentManager.streamCalls.length >= 3,
      "stopped Review should continue in the same provider session",
    );
    expect(latestAgentIdFor(service, task.id, "goal-1", "review")).toBe(reviewAgentId);
    expect(agentManager.createAgentCalls).toHaveLength(2);
    expect(agentManager.streamCalls.at(-1)?.prompt).toContain(
      "continuation of the existing provider session",
    );
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
    expect(existsSync(join(thothHome, "thoth-loop", "worktree-locks.json"))).toBe(false);
  });

  it("writes replayable SQLite authority events instead of a mutable JSON snapshot", async () => {
    const { service, workspacePath, thothHome } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));
    await waitFor(
      () => hasPhaseAgent(service, task.id, "goal-1", "planexec"),
      "PlanExec agent should exist",
    );

    const events = service.authorityEvents(task.id);
    expect(events.map((event) => event.kind)).toContain("task_registered");
    expect(events.at(-1)?.projection.authorityRevision).toBe(events.at(-1)?.revision);
    expect(
      events.every((event) => event.causationId.length > 0 && event.correlationId.length > 0),
    ).toBe(true);
    const detail = service.inspect(task.id);
    expect(detail?.recentEvents.length).toBeGreaterThan(0);
    expect(detail?.taskMemoryRefs.map((node) => node.kind)).toEqual(
      expect.arrayContaining([
        "clarify_transcript",
        "task_card",
        "goals_card",
        "baseline_evidence",
      ]),
    );
    expect(detail?.currentLease?.taskId).toBe(task.id);
    expect(existsSync(join(thothHome, "thoth-loop", "authority.sqlite"))).toBe(true);
    expect(existsSync(join(thothHome, "thoth-loop", "tasks.json"))).toBe(false);
  });

  it("makes duplicate authority event ids idempotent before a stale projection can overwrite state", async () => {
    const { service, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));
    await waitFor(
      () => hasPhaseAgent(service, task.id, "goal-1", "planexec"),
      "PlanExec agent should exist",
    );
    const detail = service.inspect(task.id)!;
    const {
      currentLease: _currentLease,
      recentEvents: _recentEvents,
      taskMemoryRefs: _taskMemoryRefs,
      ...projection
    } = detail;
    const store = (service as unknown as { authorityStore: LoopAuthorityStore }).authorityStore;
    const first = store.append(
      { ...projection, summary: "idempotent authority event" },
      { eventId: "event-idempotent", kind: "idempotency_probe" },
    );
    const duplicate = store.append(
      { ...projection, summary: "stale duplicate must not replace projection" },
      { eventId: "event-idempotent", kind: "idempotency_probe" },
    );

    expect(duplicate.authorityRevision).toBe(first.authorityRevision);
    expect(duplicate.summary).toBe("idempotent authority event");
    expect(
      store.readEvents(task.id).filter((event) => event.eventId === "event-idempotent"),
    ).toHaveLength(1);
  });

  it("enters durable budget_wait after a phase evidence envelope is exhausted", async () => {
    const { service, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));
    await waitFor(
      () => hasPhaseAgent(service, task.id, "goal-1", "planexec"),
      "PlanExec should start",
    );
    const current = (service as unknown as { tasks: Map<string, LoopTaskModel> }).tasks.get(
      task.id,
    )!;
    current.budgetEnvelope = {
      ...current.budgetEnvelope!,
      maxActiveDurationMs: 1,
    };
    service.resolvePlanExecResult(
      latestAgentIdFor(service, task.id, "goal-1", "planexec"),
      planexecResult("goal-1", 1),
    );
    await waitFor(
      () => service.inspect(task.id)?.status === "budget_wait",
      "budget should pause task",
    );

    expect(service.inspect(task.id)?.budgetWait?.exhaustedDimensions).toContain("active_time");
    expect(service.inspect(task.id)?.goals[0]?.latestPlanExecResult?.evidenceRef).toBeTruthy();
  });

  it("invalidates a Review verdict when the original workspace changes during Review", async () => {
    const { service, workspacePath } = createService();
    writeFileSync(join(workspacePath, "before.txt"), "before\n");
    const task = await service.register(baseRegisterInput(workspacePath));
    await waitFor(
      () => hasPhaseAgent(service, task.id, "goal-1", "planexec"),
      "PlanExec should start",
    );
    service.resolvePlanExecResult(
      latestAgentIdFor(service, task.id, "goal-1", "planexec"),
      planexecResult("goal-1", 1),
    );
    await waitFor(() => hasPhaseAgent(service, task.id, "goal-1", "review"), "Review should start");
    writeFileSync(join(workspacePath, "unexpected-review-write.txt"), "mutation\n");
    service.resolveReviewVerdict(
      latestAgentIdFor(service, task.id, "goal-1", "review"),
      reviewVerdict("goal-1", 1, "pass"),
    );
    await waitFor(
      () => service.inspect(task.id)?.status === "evidence_invalid",
      "Review mutation should invalidate evidence",
    );

    expect(service.inspect(task.id)?.goals[0]?.status).toBe("blocked");
  });

  it("holds Review before provider creation when the workspace changed after PlanExec, then re-baselines explicitly", async () => {
    const { service, agentManager, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));
    await waitFor(
      () => hasPhaseAgent(service, task.id, "goal-1", "planexec"),
      "PlanExec should start",
    );
    const originalBaseline = service.inspect(task.id)?.baselineEvidence?.id;
    const planExecAgentId = latestAgentIdFor(service, task.id, "goal-1", "planexec");
    await service.action(task.id, "pause");
    service.resolvePlanExecResult(planExecAgentId, planexecResult("goal-1", 1));
    await waitFor(
      () => service.inspect(task.id)?.status === "paused",
      "task should pause before Review",
    );

    writeFileSync(join(workspacePath, "external-after-planexec.txt"), "external mutation\n");
    await service.action(task.id, "resume");
    await waitFor(
      () => service.inspect(task.id)?.status === "workspace_changed_concurrently",
      "Review should not start against an un-attributed workspace mutation",
    );

    const held = service.inspect(task.id);
    expect(held?.goals[0]?.status).toBe("blocked");
    const heldReview = held?.goals[0]?.phases.find(
      (phase) => phase.phase === "review" && phase.round === 1,
    );
    expect(heldReview?.status).toBe("blocked");
    expect(heldReview?.agentId).toBeUndefined();
    expect(agentManager.createAgentCalls).toHaveLength(1);

    await service.action(task.id, "resume");
    await waitFor(
      () =>
        service.inspect(task.id)?.currentPhase === "planexec" &&
        service.inspect(task.id)?.goalRound === 2,
      "explicit resume should seal a new baseline and start a fresh PlanExec round",
    );
    expect(service.inspect(task.id)?.baselineEvidence?.id).not.toBe(originalBaseline);
  });

  it("applies only an independently approved replan for unstarted goals", async () => {
    const { service, agentManager, workspacePath } = createService();
    const task = await service.register(baseRegisterInput(workspacePath));
    await waitFor(
      () => hasPhaseAgent(service, task.id, "goal-1", "planexec"),
      "PlanExec should start",
    );
    service.resolvePlanExecResult(
      latestAgentIdFor(service, task.id, "goal-1", "planexec"),
      planexecResult("goal-1", 1),
    );
    await waitFor(() => hasPhaseAgent(service, task.id, "goal-1", "review"), "Review should start");
    service.resolveReviewVerdict(latestAgentIdFor(service, task.id, "goal-1", "review"), {
      ...reviewVerdict("goal-1", 1, "pass"),
      deferred_goal_replan_proposal: {
        base_goals_revision: 0,
        rationale: "The documentation milestone needs the completed API evidence first.",
        expected_benefit: "The unstarted milestone is clearer without changing acceptance.",
        affected_goal_ids: ["goal-2"],
        goals: [
          {
            id: "goal-2",
            order: 2,
            title: "API evidence documentation",
            goal: "Document the public sorting API using the verified core behavior.",
            constraints: ["Keep docs concise."],
            acceptance: ["Usage example is present."],
          },
        ],
      },
    });
    await waitFor(
      () =>
        agentManager.createAgentCalls.some(
          (call) => call.options?.labels?.surface === "thoth-loop-contract-audit",
        ),
      "contract audit should start",
    );
    const auditCall = agentManager.createAgentCalls.find(
      (call) => call.options?.labels?.surface === "thoth-loop-contract-audit",
    )!;
    expect(
      resolveContractPreservationAudit(auditCall.id, {
        outcome: "proceed",
        summary: "Only unstarted Goal 2 is refined; the approved contract remains intact.",
        affected_goal_ids: ["goal-2"],
      }),
    ).toBe(true);
    await waitFor(() => service.inspect(task.id)?.goalsRevision === 1, "replan should apply");

    expect(service.inspect(task.id)?.goals[0]?.title).toBe("Core API");
    expect(service.inspect(task.id)?.goals[1]?.title).toBe("API evidence documentation");
    expect(service.inspect(task.id)?.replanHistory[0]?.status).toBe("applied");
  });
});
