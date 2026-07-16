import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

import type { SessionOutboundMessage } from "../messages.js";
import type {
  LoopTaskModel,
  ThothCleanUiModel,
  ThothClarifyCardModel,
  ThothComposerModel,
  ThothGoalsCardModel,
  ThothTaskCardModel,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestThothDaemon, type TestThothDaemon } from "../test-utils/thoth-daemon.js";
import {
  buildRealProviderFixturePrompt,
  THOTH_REAL_PROVIDER_FLOW_SCRIPTS,
  type ThothRealProviderFlowScript,
} from "../../test-fixtures/thoth-real-provider-flow-script.js";
import {
  canRunNativeCodexProvider,
  createNativeCodexProviderClient,
  getNativeCodexProviderConfig,
} from "./real-provider-test-config.js";

const UI_AGENT_ID = "thoth-real-flow-fixture-ui";
const SECRETARY_TIMEOUT_MS = 150_000;
const LOOP_TIMEOUT_MS = 420_000;
const THOTH_RUNTIME_WORKSPACE_ENTRIES = new Set([".agents", ".codex", ".git"]);

interface FlowRuntime {
  daemon: TestThothDaemon;
  client: DaemonClient;
  cwd: string;
  workspaceId: string;
  streamed: Array<Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"]>;
  dispose: () => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compose(input: {
  mode: "quick" | "loop";
  clarifyStrength: "none" | "light";
  loop: "one_plan_one_do" | "light" | null;
}): ThothComposerModel {
  return {
    mode: input.mode,
    clarifyStrength: input.clarifyStrength,
    loop: input.loop,
    authorityLabel: "Real Codex fixture",
    authorityReady: true,
  };
}

function createFixtureLogger(): ReturnType<typeof pino> {
  const traceFile = process.env.THOTH_REAL_FLOW_TRACE_FILE?.trim();
  if (!traceFile) {
    return pino({ level: "silent" });
  }
  return pino({ level: "trace" }, pino.destination({ dest: traceFile, sync: false }));
}

async function createFlowRuntime(): Promise<FlowRuntime> {
  const logger = createFixtureLogger();
  const cwd = mkdtempSync(path.join(tmpdir(), "thoth-real-flow-workspace-"));
  const daemon = await createTestThothDaemon({
    agentClients: { codex: createNativeCodexProviderClient(logger) },
    logger,
  });
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
  const streamed: FlowRuntime["streamed"] = [];
  let unsubscribe: (() => void) | null = null;

  try {
    await client.connect();
    await client.fetchAgents({ subscribe: { subscriptionId: "thoth-real-flow-fixtures" } });
    unsubscribe = client.on("agent_stream", (message) => {
      if (message.payload.agentId === UI_AGENT_ID) {
        streamed.push(message.payload);
      }
    });
    await client.patchDaemonConfig({
      appendSystemPrompt: [
        "You are participating in an automated Thoth transport verification.",
        "When the user supplies a THOTH REAL FLOW FIXTURE script, follow its literal calls and text exactly.",
        "Do not independently inspect or alter the workspace.",
      ].join(" "),
      workspaceSecretary: {
        providerSession: getNativeCodexProviderConfig(),
      },
    });
    const created = await client.createWorkspace({ source: { kind: "directory", path: cwd } });
    if (created.error || !created.workspace) {
      throw new Error(
        `Failed to create temporary flow workspace: ${created.error ?? "unknown error"}`,
      );
    }

    return {
      daemon,
      client,
      cwd,
      workspaceId: created.workspace.id,
      streamed,
      dispose: async () => {
        unsubscribe?.();
        await client.close().catch(() => undefined);
        await daemon.close().catch(() => undefined);
        rmSync(cwd, { recursive: true, force: true });
      },
    };
  } catch (error) {
    unsubscribe?.();
    await client.close().catch(() => undefined);
    await daemon.close().catch(() => undefined);
    rmSync(cwd, { recursive: true, force: true });
    throw error;
  }
}

function secretaryIdentity(runtime: FlowRuntime, topicId?: string) {
  return {
    workspaceId: runtime.workspaceId,
    workspacePath: runtime.cwd,
    ...(topicId ? { topicId } : {}),
  };
}

function snapshotSummary(model: ThothCleanUiModel | null): object {
  return {
    status: model?.secretary.status,
    topicId: model?.secretary.activeTopicId,
    turns:
      model?.secretary.turns.map((turn) => ({
        kind: turn.kind,
        title: "card" in turn ? turn.card.title : "text" in turn ? turn.text : turn.task.title,
        submitted: "card" in turn ? turn.card.submitted : undefined,
      })) ?? [],
  };
}

async function waitForSecretary(
  runtime: FlowRuntime,
  predicate: (model: ThothCleanUiModel) => boolean,
  label: string,
  topicId?: string,
  timeoutMs = SECRETARY_TIMEOUT_MS,
): Promise<ThothCleanUiModel> {
  const deadline = Date.now() + timeoutMs;
  let last: ThothCleanUiModel | null = null;
  while (Date.now() < deadline) {
    const response = await runtime.client.fetchWorkspaceSecretarySnapshot(
      secretaryIdentity(runtime, topicId),
    );
    if (response.error) {
      throw new Error(
        `Workspace Secretary returned an error while waiting for ${label}: ${response.error}`,
      );
    }
    last = response.model;
    if (last && predicate(last)) {
      return last;
    }
    await sleep(500);
  }
  throw new Error(
    `Timed out waiting for ${label}. Last Secretary model=${JSON.stringify(snapshotSummary(last))}`,
  );
}

function openClarifyCard(model: ThothCleanUiModel, title: string): ThothClarifyCardModel | null {
  const turn = model.secretary.turns.find(
    (candidate) =>
      candidate.kind === "clarify_card" &&
      candidate.card.title === title &&
      candidate.card.submitted === false,
  );
  return turn?.kind === "clarify_card" ? turn.card : null;
}

function openTaskCard(model: ThothCleanUiModel, title: string): ThothTaskCardModel | null {
  const turn = model.secretary.turns.find(
    (candidate) =>
      candidate.kind === "task_card" &&
      candidate.card.title === title &&
      candidate.card.submitted === false,
  );
  return turn?.kind === "task_card" ? turn.card : null;
}

function openGoalsCard(model: ThothCleanUiModel, title: string): ThothGoalsCardModel | null {
  const turn = model.secretary.turns.find(
    (candidate) =>
      candidate.kind === "goal_card" &&
      "goals" in candidate.card &&
      candidate.card.title === title &&
      candidate.card.submitted === false,
  );
  return turn?.kind === "goal_card" && "goals" in turn.card ? turn.card : null;
}

async function waitForClarifyCard(
  runtime: FlowRuntime,
  title: string,
  topicId?: string,
): Promise<ThothClarifyCardModel> {
  const model = await waitForSecretary(
    runtime,
    (candidate) => openClarifyCard(candidate, title) !== null,
    `Clarify card ${title}`,
    topicId,
  );
  const card = openClarifyCard(model, title);
  if (!card) {
    throw new Error(`Clarify card ${title} disappeared after its wait completed`);
  }
  return card;
}

async function waitForTaskCard(
  runtime: FlowRuntime,
  title: string,
  topicId?: string,
): Promise<ThothTaskCardModel> {
  const model = await waitForSecretary(
    runtime,
    (candidate) => openTaskCard(candidate, title) !== null,
    `Task card ${title}`,
    topicId,
  );
  const card = openTaskCard(model, title);
  if (!card) {
    throw new Error(`Task card ${title} disappeared after its wait completed`);
  }
  return card;
}

async function waitForGoalsCard(
  runtime: FlowRuntime,
  title: string,
  topicId?: string,
): Promise<ThothGoalsCardModel> {
  const model = await waitForSecretary(
    runtime,
    (candidate) => openGoalsCard(candidate, title) !== null,
    `Goals card ${title}`,
    topicId,
  );
  const card = openGoalsCard(model, title);
  if (!card) {
    throw new Error(`Goals card ${title} disappeared after its wait completed`);
  }
  return card;
}

async function submitFixedClarifyAnswer(
  runtime: FlowRuntime,
  card: ThothClarifyCardModel,
  topicId?: string,
): Promise<void> {
  if (!("questions" in card.card)) {
    throw new Error("The real fixture expected a multi-question Clarify card");
  }
  const response = await runtime.client.answerWorkspaceSecretaryClarify({
    ...secretaryIdentity(runtime, topicId),
    cardId: card.id,
    uiAgentId: UI_AGENT_ID,
    answer: {
      intent: "submit_choices",
      question_card_id: card.id,
      title: card.title,
      answers: card.card.questions.map((question) => ({
        question_id: question.id,
        choice_ids: [question.choices[0]!.id],
        choice_notes: {},
      })),
      raw_answer: "Use every first fixed option.",
    },
  });
  expect(response.error).toBeNull();
}

async function acceptApprovalCard(
  runtime: FlowRuntime,
  card: ThothTaskCardModel | ThothGoalsCardModel,
  intent: "accept_quick" | "accept_loop",
  topicId?: string,
): Promise<void> {
  const response = await runtime.client.answerWorkspaceSecretaryClarify({
    ...secretaryIdentity(runtime, topicId),
    cardId: card.id,
    uiAgentId: UI_AGENT_ID,
    answer: {
      intent,
      card_id: card.id,
      title: card.title,
      raw_answer:
        intent === "accept_loop"
          ? "Accept the fixed background flow."
          : "Accept the fixed foreground flow.",
    },
  });
  expect(response.error).toBeNull();
}

function mirroredAssistantText(runtime: FlowRuntime): string[] {
  return runtime.streamed.flatMap((payload) => {
    const event = payload.event;
    return event.type === "timeline" && event.item.type === "assistant_message"
      ? [event.item.text]
      : [];
  });
}

function mirroredToolNames(runtime: FlowRuntime): string[] {
  return runtime.streamed.flatMap((payload) => {
    const event = payload.event;
    return event.type === "timeline" && event.item.type === "tool_call" ? [event.item.name] : [];
  });
}

function assertNoFixtureWorkProducts(runtime: FlowRuntime): void {
  expect(
    readdirSync(runtime.cwd).filter((entry) => !THOTH_RUNTIME_WORKSPACE_ENTRIES.has(entry)),
  ).toEqual([]);
}

async function waitForMirroredAssistantMarker(
  runtime: FlowRuntime,
  marker: string,
  timeoutMs = SECRETARY_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mirroredAssistantText(runtime).join("").includes(marker)) {
      return;
    }
    await sleep(300);
  }
  throw new Error(
    `Timed out waiting for assistant marker ${marker}. Mirrored text=${JSON.stringify(mirroredAssistantText(runtime).slice(-8))}`,
  );
}

async function startSecretaryFixture(input: {
  runtime: FlowRuntime;
  script: ThothRealProviderFlowScript;
  composer: ThothComposerModel;
  prompt?: string;
}): Promise<string> {
  const fixturePrompt = input.prompt ?? buildRealProviderFixturePrompt({ script: input.script });
  const configured = await input.runtime.client.patchDaemonConfig({
    appendSystemPrompt: [
      "You are participating in an automated Thoth transport verification.",
      "The fixture actor instructions below are literal and apply only to Workspace Secretary, PlanExec, and Review sessions whose required runtime tool appears in that script.",
      "Do not inspect or alter the workspace. Do not replace the prescribed dynamic-tool arguments with your own wording.",
      "A dedicated Clarify or contract audit session must instead follow its own audit system prompt and required audit tool.",
      fixturePrompt,
    ].join("\n\n"),
  });
  expect(configured.error ?? null).toBeNull();
  const response = await input.runtime.client.sendWorkspaceSecretaryMessage({
    ...secretaryIdentity(input.runtime),
    text: fixturePrompt,
    composer: input.composer,
    uiAgentId: UI_AGENT_ID,
  });
  expect(response.error).toBeNull();
  const topicId = response.model?.secretary.activeTopicId;
  if (!topicId) {
    throw new Error("Workspace Secretary did not return an active topic id");
  }
  return topicId;
}

async function driveScriptedSecretaryToGoals(input: {
  runtime: FlowRuntime;
  script: ThothRealProviderFlowScript;
  composer: ThothComposerModel;
  startAtClarifyIndex?: number;
  topicId?: string;
}): Promise<{ topicId: string; goals: ThothGoalsCardModel }> {
  const startAt = input.startAtClarifyIndex ?? 0;
  const topicId = await startSecretaryFixture({
    runtime: input.runtime,
    script: input.script,
    composer: input.composer,
    prompt: buildRealProviderFixturePrompt({ script: input.script, startAtClarifyIndex: startAt }),
  });
  for (const payload of input.script.clarify.slice(startAt)) {
    const card = await waitForClarifyCard(input.runtime, payload.title, topicId);
    await submitFixedClarifyAnswer(input.runtime, card, topicId);
  }
  if (!input.script.task || !input.script.goals) {
    throw new Error(`Script ${input.script.id} does not define approval cards`);
  }
  const task = await waitForTaskCard(input.runtime, input.script.task.task_card.title, topicId);
  await acceptApprovalCard(
    input.runtime,
    task,
    input.composer.mode === "loop" ? "accept_loop" : "accept_quick",
    topicId,
  );
  const goals = await waitForGoalsCard(input.runtime, input.script.goals.goals_card.title, topicId);
  return { topicId, goals };
}

async function waitForLoopTask(
  runtime: FlowRuntime,
  predicate: (task: LoopTaskModel) => boolean,
  label: string,
  timeoutMs = LOOP_TIMEOUT_MS,
): Promise<LoopTaskModel> {
  const deadline = Date.now() + timeoutMs;
  let last: LoopTaskModel | null = null;
  while (Date.now() < deadline) {
    const listed = await runtime.client.listBackgroundTasks({ workspaceId: runtime.workspaceId });
    if (listed.error) {
      throw new Error(`Background task list failed while waiting for ${label}: ${listed.error}`);
    }
    const summary = listed.tasks.find((task) => task.id !== "empty");
    if (summary) {
      const inspected = await runtime.client.inspectBackgroundTask({
        taskId: summary.id,
        workspaceId: runtime.workspaceId,
        workspacePath: runtime.cwd,
      });
      if (inspected.error) {
        throw new Error(
          `Background task inspect failed while waiting for ${label}: ${inspected.error}`,
        );
      }
      last = inspected.task;
      if (last && predicate(last)) {
        return last;
      }
    }
    await sleep(750);
  }
  throw new Error(`Timed out waiting for Loop task ${label}. Last task=${JSON.stringify(last)}`);
}

async function acceptLoopGoals(
  runtime: FlowRuntime,
  topicId: string,
  goals: ThothGoalsCardModel,
): Promise<LoopTaskModel> {
  await acceptApprovalCard(runtime, goals, "accept_loop", topicId);
  return await waitForLoopTask(runtime, () => true, "background task registration");
}

function phaseAgentIds(task: LoopTaskModel, phase: "planexec" | "review"): string[] {
  return task.goals.flatMap((goal) =>
    goal.phases
      .filter((entry) => entry.phase === phase && entry.agentId)
      .map((entry) => entry.agentId!),
  );
}

async function phaseTimelineText(runtime: FlowRuntime, agentId: string): Promise<{ text: string }> {
  const timeline = await runtime.client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: 0,
    projection: "canonical",
  });
  return {
    text: timeline.entries
      .filter(
        (entry) => entry.item.type === "assistant_message" || entry.item.type === "user_message",
      )
      .map((entry) => entry.item.text)
      .join("\n"),
  };
}

async function assertLoopPhaseTransport(runtime: FlowRuntime, task: LoopTaskModel): Promise<void> {
  const planexecAgents = phaseAgentIds(task, "planexec");
  const reviewAgents = phaseAgentIds(task, "review");
  expect(planexecAgents.length).toBeGreaterThan(0);
  expect(reviewAgents.length).toBeGreaterThan(0);

  const planexecTimelines = await Promise.all(
    [...new Set(planexecAgents)].map((agentId) => phaseTimelineText(runtime, agentId)),
  );
  const reviewTimelines = await Promise.all(
    [...new Set(reviewAgents)].map((agentId) => phaseTimelineText(runtime, agentId)),
  );
  expect(planexecTimelines.every((timeline) => timeline.text.length > 0)).toBe(true);
  expect(reviewTimelines.every((timeline) => timeline.text.length > 0)).toBe(true);
}

describe.sequential("Thoth fixture user journeys (real Codex dynamicTools)", () => {
  let canRun = false;
  const runtimes: FlowRuntime[] = [];

  beforeAll(async () => {
    canRun = await canRunNativeCodexProvider();
  });

  beforeEach((context) => {
    if (!canRun) {
      context.skip();
    }
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  });

  test(
    THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickDirect.id,
    async () => {
      const runtime = await createFlowRuntime();
      runtimes.push(runtime);
      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickDirect;
      const topicId = await startSecretaryFixture({
        runtime,
        script,
        composer: compose({ mode: "quick", clarifyStrength: "none", loop: null }),
      });

      await waitForMirroredAssistantMarker(runtime, script.finalMarker);
      const model = await waitForSecretary(
        runtime,
        (candidate) => candidate.secretary.status.kind === "ready",
        "Quick Direct completion",
        topicId,
      );

      expect(model.secretary.turns.some((turn) => turn.kind !== "message")).toBe(false);
      expect(mirroredToolNames(runtime).filter((name) => name.startsWith("thoth_"))).toEqual([]);
      assertNoFixtureWorkProducts(runtime);
    },
    180_000,
  );

  test(
    THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyForeground.id,
    async () => {
      const runtime = await createFlowRuntime();
      runtimes.push(runtime);
      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyForeground;
      const { topicId, goals } = await driveScriptedSecretaryToGoals({
        runtime,
        script,
        composer: compose({ mode: "quick", clarifyStrength: "light", loop: null }),
      });

      await acceptApprovalCard(runtime, goals, "accept_quick", topicId);
      await waitForSecretary(
        runtime,
        (model) => model.secretary.status.kind === "ready",
        "Quick foreground completion",
        topicId,
      );

      // This suite verifies provider transport and authority lifecycle, not whether
      // Codex chooses to echo a fixture-only marker after the daemon's Plan+Exec turn.
      expect(mirroredAssistantText(runtime).some((text) => text.trim().length > 0)).toBe(true);

      expect(mirroredToolNames(runtime)).toEqual(
        expect.arrayContaining(["clarify", "task_approval", "goals_approval"]),
      );
      const tasks = await runtime.client.listBackgroundTasks({ workspaceId: runtime.workspaceId });
      expect(tasks.tasks.filter((task) => task.id !== "empty")).toEqual([]);
      assertNoFixtureWorkProducts(runtime);
    },
    300_000,
  );

  test(
    THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyRecovery.id,
    async () => {
      const runtime = await createFlowRuntime();
      runtimes.push(runtime);
      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.quickClarifyRecovery;
      const composer = compose({ mode: "quick", clarifyStrength: "light", loop: null });
      const topicId = await startSecretaryFixture({ runtime, script, composer });
      const first = await waitForClarifyCard(runtime, script.clarify[0].title, topicId);

      const restored = await runtime.client.fetchWorkspaceSecretarySnapshot(
        secretaryIdentity(runtime, topicId),
      );
      expect(restored.error).toBeNull();
      expect(restored.model && openClarifyCard(restored.model, first.title)?.id).toBe(first.id);

      const canceled = await runtime.client.cancelWorkspaceSecretaryTurn(
        secretaryIdentity(runtime, topicId),
      );
      expect(canceled.error).toBeNull();
      await waitForSecretary(
        runtime,
        (model) =>
          model.secretary.status.kind === "ready" &&
          model.secretary.turns.some(
            (turn) =>
              turn.kind === "clarify_card" &&
              turn.card.id === first.id &&
              turn.card.submitted &&
              turn.card.submittedSummary === "已中断当前请求，可继续输入。",
          ),
        "canceled Clarify card",
        topicId,
      );

      const resumedTopicId = await startSecretaryFixture({
        runtime,
        script,
        composer,
        prompt: buildRealProviderFixturePrompt({ script, startAtClarifyIndex: 1 }),
      });
      expect(resumedTopicId).toBe(topicId);
      const second = await waitForClarifyCard(runtime, script.clarify[1].title, topicId);
      await submitFixedClarifyAnswer(runtime, second, topicId);
      const task = await waitForTaskCard(runtime, script.task!.task_card.title, topicId);
      await acceptApprovalCard(runtime, task, "accept_quick", topicId);
      const goals = await waitForGoalsCard(runtime, script.goals!.goals_card.title, topicId);
      await acceptApprovalCard(runtime, goals, "accept_quick", topicId);
      await waitForMirroredAssistantMarker(runtime, script.finalMarker);

      expect(mirroredToolNames(runtime)).toEqual(
        expect.arrayContaining(["clarify", "task_approval", "goals_approval"]),
      );
      assertNoFixtureWorkProducts(runtime);
    },
    360_000,
  );

  test(
    THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopLinearPass.id,
    async () => {
      const runtime = await createFlowRuntime();
      runtimes.push(runtime);
      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopLinearPass;
      const { topicId, goals } = await driveScriptedSecretaryToGoals({
        runtime,
        script,
        composer: compose({ mode: "loop", clarifyStrength: "light", loop: "one_plan_one_do" }),
      });
      const registered = await acceptLoopGoals(runtime, topicId, goals);
      const completed = await waitForLoopTask(
        runtime,
        (task) => task.id === registered.id && task.status === "done",
        "two linear goals to finish",
      );

      expect(completed.budget).toMatchObject({ maxFailedReviews: 1, usedFailedReviews: 0 });
      expect(completed.goals.map((goal) => goal.status)).toEqual(["passed", "passed"]);
      expect(
        completed.goals[0]?.phases.some((phase) => phase.round === 1 && phase.phase === "review"),
      ).toBe(true);
      expect(completed.goals[1]?.phases.some((phase) => phase.agentId)).toBe(true);
      expect(completed.goals[0]?.latestPlanExecResult?.executionSummary).toContain("UT04_G1_R1");
      expect(completed.goals[0]?.latestReview?.summary).toContain("UT04_G1_R1");
      expect(completed.goals[1]?.latestPlanExecResult?.executionSummary).toContain("UT04_G2_R1");
      expect(completed.goals[1]?.latestReview?.summary).toContain("UT04_G2_R1");
      await assertLoopPhaseTransport(runtime, completed);
      assertNoFixtureWorkProducts(runtime);
    },
    600_000,
  );

  test(
    THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopRetryAndBudget.id,
    async () => {
      const runtime = await createFlowRuntime();
      runtimes.push(runtime);
      const script = THOTH_REAL_PROVIDER_FLOW_SCRIPTS.loopRetryAndBudget;
      const { topicId, goals } = await driveScriptedSecretaryToGoals({
        runtime,
        script,
        composer: compose({ mode: "loop", clarifyStrength: "light", loop: "light" }),
      });
      const registered = await acceptLoopGoals(runtime, topicId, goals);
      await waitForLoopTask(
        runtime,
        (task) => task.id === registered.id && task.goals[0]?.round === 2,
        "failed Review retry round",
      );
      const completed = await waitForLoopTask(
        runtime,
        (task) => task.id === registered.id && task.status === "done",
        "retry task completion",
      );

      expect(completed.budget).toMatchObject({ maxFailedReviews: 5, usedFailedReviews: 1 });
      expect(completed.goals.map((goal) => goal.status)).toEqual(["passed", "passed"]);
      const firstGoal = completed.goals[0]!;
      expect(
        firstGoal.phases.some(
          (phase) => phase.phase === "review" && phase.round === 1 && phase.status === "failed",
        ),
      ).toBe(true);
      expect(
        firstGoal.phases.some((phase) => phase.phase === "planexec" && phase.round === 2),
      ).toBe(true);
      expect(firstGoal.latestPlanExecResult?.executionSummary).toContain("UT05_G1_R2");
      expect(firstGoal.latestReview?.summary).toContain("UT05_G1_R2");
      expect(completed.goals[1]?.latestPlanExecResult?.executionSummary).toContain("UT05_G2_R1");
      expect(completed.goals[1]?.latestReview?.summary).toContain("UT05_G2_R1");
      await assertLoopPhaseTransport(runtime, completed);

      const retryAgentId = firstGoal.phases.find(
        (phase) => phase.phase === "planexec" && phase.round === 2,
      )?.agentId;
      expect(retryAgentId).toBeTruthy();
      const retryTimeline = await phaseTimelineText(runtime, retryAgentId!);
      expect(retryTimeline.text).toContain("FIXTURE_R5_ROOT_CAUSE_UT05_G1_R1");
      expect(retryTimeline.text).toContain("FIXTURE_R5_GUIDANCE_UT05_G1_R1");
      expect(retryTimeline.text).toContain("FIXTURE_R5_ANTI_REPEAT_UT05_G1_R1");
      assertNoFixtureWorkProducts(runtime);
    },
    600_000,
  );
});
