import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MutableDaemonConfig, SessionOutboundMessage } from "@thoth/protocol/messages";
import type {
  ThothClarifyCardModel,
  ThothGoalsCardModel,
  ThothTaskCardModel,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
import type { AgentManager, ManagedAgent } from "./agent/agent-manager.js";
import type { AgentSessionConfig, AgentStreamEvent } from "./agent/agent-sdk-types.js";
import {
  createRuntimeAuthorityDecision,
  resetRuntimeAuthorityDecisionsForTest,
} from "./agent/runtime-tool-decisions.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";
import { createTestLogger } from "../test-utils/test-logger.js";
import { ThothLoopTaskService, type RegisterLoopTaskInput } from "./thoth-loop/task-service.js";
import {
  THOTH_FLOW_FIXTURES,
  type ThothFixtureProviderStep,
} from "../test-fixtures/thoth-flow-contract.js";
import { WorkspaceSecretarySession } from "./session/workspace-secretary/workspace-secretary-session.js";

type CreatedAgent = {
  id: string;
  config: AgentSessionConfig;
  options: Parameters<AgentManager["createAgent"]>[2];
};

type FixtureSecretaryState = {
  model: {
    secretary: {
      activeTopicId: string;
      workspacePath: string;
      turns: Array<{
        kind: string;
        card?: { id: string; submitted?: boolean; submittedSummary?: string };
      }>;
      status: { kind: string };
    };
    backgroundTasks: {
      tasks: Array<{ id: string; status: string }>;
      detail?: { id: string } | null;
    };
  };
  topicAgents: Map<string, string>;
  activeTurnPhase: string;
  currentClarifyState: string;
};

class FixtureAgentManager {
  readonly createdAgents: CreatedAgent[] = [];
  readonly streamCalls: Array<{ agentId: string; prompt: string }> = [];
  readonly canceledAgentIds: string[] = [];

  constructor(private readonly streamRuns: AgentStreamEvent[][] = []) {}

  async getProviderAvailability(provider: string) {
    return { provider, available: true, error: null };
  }

  async createAgent(
    config: AgentSessionConfig,
    _agentId?: string,
    options?: Parameters<AgentManager["createAgent"]>[2],
  ): Promise<ManagedAgent> {
    const id = `fixture-agent-${this.createdAgents.length + 1}`;
    this.createdAgents.push({ id, config, options });
    return {
      id,
      provider: config.provider,
      cwd: config.cwd,
      config,
      labels: options?.labels ?? {},
      persistence: { provider: config.provider, sessionId: `fixture-session-${id}` },
    } as ManagedAgent;
  }

  streamAgent(agentId: string, prompt: unknown): AsyncGenerator<AgentStreamEvent> {
    const promptText = Array.isArray(prompt)
      ? prompt
          .map((part) =>
            part && typeof part === "object" && "text" in part && typeof part.text === "string"
              ? part.text
              : "",
          )
          .filter(Boolean)
          .join("\n")
      : String(prompt);
    this.streamCalls.push({ agentId, prompt: promptText });
    const events = this.streamRuns.shift() ?? [];
    return (async function* () {
      for (const event of events) {
        yield event;
      }
    })();
  }

  hasInFlightRun(): boolean {
    return false;
  }

  replaceAgentRun(agentId: string, prompt: unknown): AsyncGenerator<AgentStreamEvent> {
    return this.streamAgent(agentId, prompt);
  }

  async cancelAgentRun(agentId: string): Promise<boolean> {
    this.canceledAgentIds.push(agentId);
    return true;
  }

  getAgent(agentId: string): ManagedAgent | null {
    const created = this.createdAgents.find((agent) => agent.id === agentId);
    if (!created) {
      return null;
    }
    return {
      id: created.id,
      provider: created.config.provider,
      cwd: created.config.cwd,
      config: created.config,
      labels: created.options?.labels ?? {},
      persistence: {
        provider: created.config.provider,
        sessionId: `fixture-session-${created.id}`,
      },
    } as ManagedAgent;
  }
}

const tempDirs: string[] = [];

afterEach(() => {
  resetRuntimeAuthorityDecisionsForTest();
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

function waitFor(predicate: () => boolean, label: string, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 0);
    };
    poll();
  });
}

async function flushBackgroundTurns(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function composeInput(fixture: (typeof THOTH_FLOW_FIXTURES)[keyof typeof THOTH_FLOW_FIXTURES]) {
  return {
    mode: fixture.composer.mode,
    clarifyStrength: fixture.composer.clarifyStrength,
    loop: fixture.composer.loopStrength,
    authorityLabel: "Fixture Codex",
    authorityReady: true,
  } as const;
}

function clarifyCard(
  step: Extract<ThothFixtureProviderStep, { type: "clarify_card" }>,
): ThothClarifyCardModel {
  return {
    id: step.cardId,
    roundLabel: "Clarify",
    title: step.title,
    whyNow: "Fixture-owned branch for deterministic flow coverage.",
    continuesClarify: true,
    submitted: false,
    card: {
      question_id: `question-${step.cardId}`,
      title: step.title,
      behavior_tree_node: `fixture-${step.cardId}`,
      why_now: "Fixture provider emits this card without model inference.",
      allow_choice_notes: true,
      allow_note_only: true,
      questions: [
        {
          id: `choice-a-${step.cardId}`,
          question: "Fixture selection A",
          behavior_tree_node: "fixture_choice",
          selection_mode: "single",
          choices: [
            { id: "fixture_yes", label: "Continue", description: "Deterministic fixture choice" },
            { id: "fixture_no", label: "Stop", description: "Alternate fixture choice" },
          ],
        },
        {
          id: `choice-b-${step.cardId}`,
          question: "Fixture selection B",
          behavior_tree_node: "fixture_confirmation",
          selection_mode: "single",
          choices: [
            { id: "fixture_yes_b", label: "Confirm", description: "Deterministic confirmation" },
            { id: "fixture_no_b", label: "Reject", description: "Alternate fixture confirmation" },
          ],
        },
      ],
    },
  };
}

function taskCard(
  step: Extract<ThothFixtureProviderStep, { type: "task_card" }>,
): ThothTaskCardModel {
  return {
    id: step.cardId,
    roundLabel: "Task",
    title: step.title,
    goal: "Verify the deterministic foreground or background flow.",
    constraints: ["No real workspace mutation."],
    acceptance: ["Expected fixture markers appear in the authority timeline."],
    provenanceSummary: "Fixture transcript provenance.",
    submitted: false,
  };
}

function goalsCard(
  step: Extract<ThothFixtureProviderStep, { type: "goals_card" }>,
): ThothGoalsCardModel {
  return {
    id: step.cardId,
    roundLabel: "Goals",
    title: step.title,
    summary: "Two linear fixture goals.",
    goals: [
      {
        id: "goal-1",
        order: 1,
        title: "Fixture goal one",
        goal: "Emit deterministic phase-one markers.",
        constraints: ["Do not mutate the workspace."],
        acceptance: ["Goal one Review receives fixture evidence."],
        provenance: "Fixture task acceptance.",
      },
      {
        id: "goal-2",
        order: 2,
        title: "Fixture goal two",
        goal: "Emit deterministic phase-two markers.",
        constraints: ["Do not mutate the workspace."],
        acceptance: ["Goal two starts only after goal one passes."],
        provenance: "Fixture task acceptance.",
      },
    ],
    provenanceSummary: "Fixture task-card provenance.",
    submitted: false,
  };
}

function fixtureConfig(): MutableDaemonConfig {
  return {
    mcp: { injectIntoAgents: true },
    providers: {},
    metadataGeneration: { providers: [] },
    workspaceSecretary: {
      providerSession: { provider: "codex", model: "fixture-codex", modeId: "auto" },
    },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
  };
}

function fixtureRuntime(input?: { streamRuns?: AgentStreamEvent[][] }) {
  const thothHome = tempDirectory("thoth-flow-home-");
  const workspacePath = tempDirectory("thoth-flow-workspace-");
  const workspace: PersistedWorkspaceRecord = {
    workspaceId: "workspace-1",
    projectId: "project-1",
    kind: "local_checkout",
    cwd: workspacePath,
    displayName: "Fixture workspace",
    title: "Fixture workspace",
    branch: null,
    baseBranch: null,
    archivedAt: null,
    createdAt: "2026-07-11T00:00:00Z",
    updatedAt: "2026-07-11T00:00:00Z",
  };
  const secondWorkspace: PersistedWorkspaceRecord = {
    ...workspace,
    workspaceId: "workspace-2",
    projectId: "project-2",
    cwd: tempDirectory("thoth-flow-other-workspace-"),
    displayName: "Fixture other workspace",
    title: "Fixture other workspace",
  };
  const emitted: SessionOutboundMessage[] = [];
  const agentManager = new FixtureAgentManager(input?.streamRuns);
  let config = fixtureConfig();
  const daemonConfigStore = {
    getThothHome: () => thothHome,
    get: () => config,
    patch: (patch: Partial<MutableDaemonConfig>) => {
      config = {
        ...config,
        ...patch,
        workspaceSecretary: {
          ...(config.workspaceSecretary ?? {}),
          ...(patch.workspaceSecretary ?? {}),
        },
      };
    },
  } as unknown as DaemonConfigStore;
  const loopService = new ThothLoopTaskService({
    thothHome,
    agentManager: agentManager as unknown as AgentManager,
    logger: createTestLogger(),
  });
  const session = new WorkspaceSecretarySession({
    host: {
      emit: (message) => emitted.push(message),
      listWorkspaces: async () => [workspace, secondWorkspace],
    },
    agentManager: agentManager as unknown as AgentManager,
    daemonConfigStore,
    loopTaskService: loopService,
    probeRelayHealth: async () => "healthy",
  });
  return { session, loopService, agentManager, emitted, workspace, secondWorkspace, workspacePath };
}

function secretaryState(session: WorkspaceSecretarySession): FixtureSecretaryState {
  return (session as unknown as { state: FixtureSecretaryState }).state;
}

function injectSecretaryTimeline(
  session: WorkspaceSecretarySession,
  state: FixtureSecretaryState,
  item: Extract<AgentStreamEvent, { type: "timeline" }>["item"],
): void {
  (
    session as unknown as {
      recordTimelineForSecretaryState: (
        state: FixtureSecretaryState,
        event: AgentStreamEvent,
      ) => void;
    }
  ).recordTimelineForSecretaryState(state, {
    type: "timeline",
    provider: "codex",
    turnId: "fixture-turn",
    item,
  });
}

function providerAgentId(state: FixtureSecretaryState): string {
  const id = Array.from(state.topicAgents.values()).at(-1);
  if (!id) {
    throw new Error("Fixture provider agent was not created");
  }
  return id;
}

function createDecision(
  state: FixtureSecretaryState,
  card:
    | { kind: "clarify_card"; card: ThothClarifyCardModel }
    | { kind: "task_card"; card: ThothTaskCardModel }
    | { kind: "goals_card"; card: ThothGoalsCardModel },
) {
  const toolName =
    card.kind === "clarify_card"
      ? "thoth_submit_clarify_card"
      : card.kind === "task_card"
        ? "thoth_submit_task_card"
        : "thoth_submit_goals_card";
  return createRuntimeAuthorityDecision({
    provider: "codex",
    agentId: providerAgentId(state),
    topicId: state.model.secretary.activeTopicId,
    threadId: "fixture-thread",
    turnId: "fixture-turn",
    callId: `fixture-call-${card.card.id}`,
    toolName,
    phase: card.kind === "clarify_card" ? "clarify" : "approval_breakdown",
    card,
    redactedRawInputHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
}

async function answerClarifyCard(input: {
  session: WorkspaceSecretarySession;
  runtime: ReturnType<typeof fixtureRuntime>;
  card: ThothClarifyCardModel;
  stop?: boolean;
}) {
  const state = secretaryState(input.session);
  const decision = createDecision(state, { kind: "clarify_card", card: input.card });
  await input.session.handleAnswerRequest({
    type: "workspace_secretary.answer.request",
    requestId: `answer-${input.card.id}`,
    workspaceId: input.runtime.workspace.workspaceId,
    workspacePath: input.runtime.workspacePath,
    topicId: state.model.secretary.activeTopicId,
    cardId: input.card.id,
    answer: input.stop
      ? {
          intent: "stop",
          question_card_id: input.card.card.question_id,
          title: input.card.title,
          answers: [],
          raw_answer: "Fixture pause",
        }
      : {
          intent: "submit_choices",
          question_card_id: input.card.card.question_id,
          title: input.card.title,
          answers: [
            {
              question_id: input.card.card.questions[0]!.id,
              choice_ids: ["fixture_yes"],
              choice_notes: {},
            },
            {
              question_id: input.card.card.questions[1]!.id,
              choice_ids: ["fixture_yes_b"],
              choice_notes: {},
            },
          ],
          raw_answer: "Fixture answer",
        },
  });
  await expect(decision.waitForAnswer).resolves.toMatchObject({
    answer: { intent: input.stop ? "stop" : "submit_choices" },
  });
}

async function answerApprovalCard(input: {
  session: WorkspaceSecretarySession;
  runtime: ReturnType<typeof fixtureRuntime>;
  card: ThothTaskCardModel | ThothGoalsCardModel;
  intent: "accept_quick" | "accept_loop";
}) {
  const state = secretaryState(input.session);
  const decision = createDecision(
    state,
    "goals" in input.card
      ? { kind: "goals_card", card: input.card }
      : { kind: "task_card", card: input.card },
  );
  await input.session.handleAnswerRequest({
    type: "workspace_secretary.answer.request",
    requestId: `answer-${input.card.id}`,
    workspaceId: input.runtime.workspace.workspaceId,
    workspacePath: input.runtime.workspacePath,
    topicId: state.model.secretary.activeTopicId,
    cardId: input.card.id,
    answer: {
      intent: input.intent,
      card_id: input.card.id,
      title: input.card.title,
      raw_answer: `Fixture ${input.intent}`,
    },
  });
  await expect(decision.waitForAnswer).resolves.toMatchObject({ answer: { intent: input.intent } });
}

async function startFixtureSecretaryFlow(
  runtime: ReturnType<typeof fixtureRuntime>,
  fixture: (typeof THOTH_FLOW_FIXTURES)[keyof typeof THOTH_FLOW_FIXTURES],
  text = fixture.userPrompt,
): Promise<void> {
  const state = (runtime.session as unknown as { state: FixtureSecretaryState | null }).state;
  await runtime.session.handleSendRequest({
    type: "workspace_secretary.send.request",
    requestId: `send-${fixture.id}-${text === fixture.userPrompt ? "initial" : "continue"}`,
    workspaceId: runtime.workspace.workspaceId,
    workspacePath: runtime.workspacePath,
    ...(state ? { topicId: state.model.secretary.activeTopicId } : {}),
    uiAgentId: "fixture-draft-agent",
    text,
    composer: composeInput(fixture),
  });
  await flushBackgroundTurns();
}

function latestPhaseAgentId(
  service: ThothLoopTaskService,
  taskId: string,
  goalId: string,
  phase: "planexec" | "review",
): string {
  const task = service.inspect(taskId);
  const goal = task?.goals.find((candidate) => candidate.id === goalId);
  const record = goal?.phases
    .filter((candidate) => candidate.phase === phase && candidate.agentId)
    .sort((left, right) => right.round - left.round)[0];
  if (!record?.agentId) {
    throw new Error(`Missing ${phase} fixture agent for ${goalId}`);
  }
  return record.agentId;
}

function planexecResult(goalId: string, round: number, marker: string) {
  return {
    goal_id: goalId,
    round,
    plan_summary: `Fixture plan ${marker}.`,
    execution_summary: marker,
    evidence: [marker],
    validation_performed: ["Fixture validation"],
    remaining_risks: [],
    next_review_focus: `Review ${marker}.`,
  };
}

function reviewVerdict(
  goalId: string,
  round: number,
  outcome: "pass" | "fail",
  marker: string,
  failureRootCause = "REQUIRED_FIX_MARKER missing",
) {
  return {
    goal_id: goalId,
    round,
    outcome,
    summary: marker,
    acceptance_matrix: [
      {
        acceptance: "Fixture acceptance",
        status: outcome === "pass" ? "met" : "not_met",
        evidence: marker,
      },
    ],
    failed_acceptance: outcome === "pass" ? [] : ["Fixture acceptance"],
    ...(outcome === "fail"
      ? {
          failure_root_cause: failureRootCause,
          next_round_guidance: "Emit APPLY_REQUIRED_FIX_MARKER",
          anti_repeat_strategy: ["Do not repeat INITIAL_ATTEMPT"],
        }
      : { anti_repeat_strategy: [] }),
    evidence_summary: marker,
  };
}

describe("deterministic Thoth flow fixtures", () => {
  it(THOTH_FLOW_FIXTURES.quickDirect.id, async () => {
    const fixture = THOTH_FLOW_FIXTURES.quickDirect;
    const runtime = fixtureRuntime({
      streamRuns: [
        [
          { type: "turn_started", provider: "codex", turnId: "fixture-turn" },
          {
            type: "timeline",
            provider: "codex",
            turnId: "fixture-turn",
            item: { type: "assistant_message", text: fixture.providerScript[0]!.marker },
          },
          { type: "turn_completed", provider: "codex", turnId: "fixture-turn" },
        ],
      ],
    });

    await startFixtureSecretaryFlow(runtime, fixture);

    expect(
      runtime.agentManager.createdAgents[0]?.config.extra?.codex?.thothClarifyRuntimeTools,
    ).toBeUndefined();
    expect(runtime.agentManager.streamCalls).toEqual([
      expect.objectContaining({ prompt: fixture.userPrompt }),
    ]);
    expect(
      runtime.emitted.some(
        (message) =>
          message.type === "agent_stream" &&
          message.payload.event.type === "timeline" &&
          message.payload.event.item.type === "assistant_message" &&
          message.payload.event.item.text === "DIRECT_DONE",
      ),
    ).toBe(true);
    expect(
      secretaryState(runtime.session).model.secretary.turns.some(
        (turn) => turn.kind === "clarify_card",
      ),
    ).toBe(false);
    expect(runtime.loopService.list({ workspacePath: runtime.workspacePath })).toEqual([
      expect.objectContaining({ id: "empty", status: "empty" }),
    ]);
  });

  it(THOTH_FLOW_FIXTURES.quickClarifyForeground.id, async () => {
    const fixture = THOTH_FLOW_FIXTURES.quickClarifyForeground;
    const runtime = fixtureRuntime();
    const [first, second, taskStep, goalsStep, doneStep] = fixture.providerScript;
    const c1 = clarifyCard(first as Extract<ThothFixtureProviderStep, { type: "clarify_card" }>);
    const c2 = clarifyCard(second as Extract<ThothFixtureProviderStep, { type: "clarify_card" }>);
    const task = taskCard(taskStep as Extract<ThothFixtureProviderStep, { type: "task_card" }>);
    const goals = goalsCard(goalsStep as Extract<ThothFixtureProviderStep, { type: "goals_card" }>);

    await startFixtureSecretaryFlow(runtime, fixture);
    const state = secretaryState(runtime.session);
    injectSecretaryTimeline(runtime.session, state, { type: "clarify_card", card: c1 });
    await answerClarifyCard({ session: runtime.session, runtime, card: c1 });
    injectSecretaryTimeline(runtime.session, state, { type: "clarify_card", card: c2 });
    await answerClarifyCard({ session: runtime.session, runtime, card: c2 });
    injectSecretaryTimeline(runtime.session, state, { type: "task_card", card: task });
    await answerApprovalCard({
      session: runtime.session,
      runtime,
      card: task,
      intent: "accept_quick",
    });
    injectSecretaryTimeline(runtime.session, state, { type: "goal_card", card: goals });
    await answerApprovalCard({
      session: runtime.session,
      runtime,
      card: goals,
      intent: "accept_quick",
    });
    const foregroundHandoff = runtime.agentManager.streamCalls.at(-1);
    expect(foregroundHandoff).toEqual(
      expect.objectContaining({
        agentId: providerAgentId(state),
        prompt: expect.stringContaining("Thoth Quick foreground Plan+Exec agent"),
      }),
    );
    expect(foregroundHandoff?.prompt).toContain("Do not stop after Goal 1.");
    expect(foregroundHandoff?.prompt).toContain(`goal id: ${goals.goals[0]!.id}`);
    expect(foregroundHandoff?.prompt).toContain(`goal id: ${goals.goals[1]!.id}`);
    expect(foregroundHandoff?.prompt).toContain("Full Clarify and approval transcript:");
    expect(foregroundHandoff?.prompt).not.toContain("Thoth structured Workspace Secretary turn.");
    injectSecretaryTimeline(runtime.session, state, {
      type: "assistant_message",
      text: (doneStep as Extract<ThothFixtureProviderStep, { type: "assistant_text" }>).marker,
    });

    expect(state.activeTurnPhase).toBe("quick_exec");
    expect(runtime.loopService.list({ workspacePath: runtime.workspacePath })).toEqual([
      expect.objectContaining({ id: "empty", status: "empty" }),
    ]);
    expect(
      state.model.secretary.turns.filter(
        (turn) =>
          turn.kind === "clarify_card" || turn.kind === "task_card" || turn.kind === "goal_card",
      ),
    ).toHaveLength(4);
    expect(state.model.secretary.turns.every((turn) => !turn.card || turn.card.submitted)).toBe(
      true,
    );
  });

  it(THOTH_FLOW_FIXTURES.quickClarifyRecovery.id, async () => {
    const fixture = THOTH_FLOW_FIXTURES.quickClarifyRecovery;
    const runtime = fixtureRuntime();
    const [first, second, taskStep, goalsStep, doneStep] = fixture.providerScript;
    const c1 = clarifyCard(first as Extract<ThothFixtureProviderStep, { type: "clarify_card" }>);
    const c2 = clarifyCard(second as Extract<ThothFixtureProviderStep, { type: "clarify_card" }>);
    const task = taskCard(taskStep as Extract<ThothFixtureProviderStep, { type: "task_card" }>);
    const goals = goalsCard(goalsStep as Extract<ThothFixtureProviderStep, { type: "goals_card" }>);

    await startFixtureSecretaryFlow(runtime, fixture);
    let state = secretaryState(runtime.session);
    injectSecretaryTimeline(runtime.session, state, { type: "clarify_card", card: c1 });
    expect(state.model.secretary.status.kind).toBe("loading");

    await runtime.session.handleSnapshotRequest({
      type: "workspace_secretary.snapshot.request",
      requestId: "switch-to-other-workspace",
      workspaceId: runtime.secondWorkspace.workspaceId,
    });
    await runtime.session.handleSnapshotRequest({
      type: "workspace_secretary.snapshot.request",
      requestId: "reload-original-topic",
      workspaceId: runtime.workspace.workspaceId,
      workspacePath: runtime.workspacePath,
      topicId: state.model.secretary.activeTopicId,
    });
    state = secretaryState(runtime.session);
    expect(state.model.secretary.turns.filter((turn) => turn.kind === "clarify_card")).toHaveLength(
      1,
    );
    expect(state.model.secretary.status.kind).toBe("loading");

    await answerClarifyCard({ session: runtime.session, runtime, card: c1, stop: true });
    expect(state.model.secretary.turns.find((turn) => turn.card?.id === c1.id)?.card).toMatchObject(
      {
        submitted: true,
        submittedSummary: "已暂停继续询问",
      },
    );
    expect(state.model.secretary.status.kind).toBe("ready");

    await startFixtureSecretaryFlow(runtime, fixture, "continue");
    state = secretaryState(runtime.session);
    injectSecretaryTimeline(runtime.session, state, { type: "clarify_card", card: c2 });
    await answerClarifyCard({ session: runtime.session, runtime, card: c2 });
    injectSecretaryTimeline(runtime.session, state, { type: "task_card", card: task });
    await answerApprovalCard({
      session: runtime.session,
      runtime,
      card: task,
      intent: "accept_quick",
    });
    injectSecretaryTimeline(runtime.session, state, { type: "goal_card", card: goals });
    await answerApprovalCard({
      session: runtime.session,
      runtime,
      card: goals,
      intent: "accept_quick",
    });
    injectSecretaryTimeline(runtime.session, state, {
      type: "assistant_message",
      text: (doneStep as Extract<ThothFixtureProviderStep, { type: "assistant_text" }>).marker,
    });

    expect(state.activeTurnPhase).toBe("quick_exec");
    expect(runtime.loopService.list({ workspacePath: runtime.workspacePath })).toEqual([
      expect.objectContaining({ id: "empty", status: "empty" }),
    ]);
  });

  it(THOTH_FLOW_FIXTURES.loopLinearPass.id, async () => {
    const fixture = THOTH_FLOW_FIXTURES.loopLinearPass;
    const runtime = fixtureRuntime();
    const [clarifyStep, taskStep, goalsStep, firstExec, firstReview, secondExec, secondReview] =
      fixture.providerScript;
    const clarify = clarifyCard(
      clarifyStep as Extract<ThothFixtureProviderStep, { type: "clarify_card" }>,
    );
    const task = taskCard(taskStep as Extract<ThothFixtureProviderStep, { type: "task_card" }>);
    const goals = goalsCard(goalsStep as Extract<ThothFixtureProviderStep, { type: "goals_card" }>);

    await startFixtureSecretaryFlow(runtime, fixture);
    const state = secretaryState(runtime.session);
    injectSecretaryTimeline(runtime.session, state, { type: "clarify_card", card: clarify });
    await answerClarifyCard({ session: runtime.session, runtime, card: clarify });
    injectSecretaryTimeline(runtime.session, state, { type: "task_card", card: task });
    await answerApprovalCard({
      session: runtime.session,
      runtime,
      card: task,
      intent: "accept_loop",
    });
    injectSecretaryTimeline(runtime.session, state, { type: "goal_card", card: goals });
    await answerApprovalCard({
      session: runtime.session,
      runtime,
      card: goals,
      intent: "accept_loop",
    });

    const taskId = state.model.backgroundTasks.detail?.id;
    expect(taskId).toBeTruthy();
    await waitFor(
      () => runtime.loopService.inspect(taskId!)?.currentPhase === "planexec",
      "goal one PlanExec",
    );
    expect(runtime.loopService.inspect(taskId!)?.currentGoalId).toBe("goal-1");
    expect(
      runtime.loopService.inspect(taskId!)?.goals[1]?.phases.some((phase) => phase.agentId),
    ).toBe(false);

    runtime.loopService.resolvePlanExecResult(
      latestPhaseAgentId(runtime.loopService, taskId!, "goal-1", "planexec"),
      planexecResult(
        (firstExec as Extract<ThothFixtureProviderStep, { type: "planexec_result" }>).goalId,
        1,
        (firstExec as Extract<ThothFixtureProviderStep, { type: "planexec_result" }>).marker,
      ),
    );
    await waitFor(
      () => runtime.loopService.inspect(taskId!)?.currentPhase === "review",
      "goal one Review",
    );
    runtime.loopService.resolveReviewVerdict(
      latestPhaseAgentId(runtime.loopService, taskId!, "goal-1", "review"),
      reviewVerdict(
        (firstReview as Extract<ThothFixtureProviderStep, { type: "review_verdict" }>).goalId,
        1,
        "pass",
        (firstReview as Extract<ThothFixtureProviderStep, { type: "review_verdict" }>).marker,
      ),
    );
    await waitFor(
      () => runtime.loopService.inspect(taskId!)?.currentGoalId === "goal-2",
      "goal two start",
    );

    runtime.loopService.resolvePlanExecResult(
      latestPhaseAgentId(runtime.loopService, taskId!, "goal-2", "planexec"),
      planexecResult(
        (secondExec as Extract<ThothFixtureProviderStep, { type: "planexec_result" }>).goalId,
        1,
        (secondExec as Extract<ThothFixtureProviderStep, { type: "planexec_result" }>).marker,
      ),
    );
    await waitFor(
      () => runtime.loopService.inspect(taskId!)?.currentPhase === "review",
      "goal two Review",
    );
    runtime.loopService.resolveReviewVerdict(
      latestPhaseAgentId(runtime.loopService, taskId!, "goal-2", "review"),
      reviewVerdict(
        (secondReview as Extract<ThothFixtureProviderStep, { type: "review_verdict" }>).goalId,
        1,
        "pass",
        (secondReview as Extract<ThothFixtureProviderStep, { type: "review_verdict" }>).marker,
      ),
    );
    await waitFor(() => runtime.loopService.inspect(taskId!)?.status === "done", "task done");

    expect(runtime.loopService.inspect(taskId!)?.budget).toMatchObject({
      maxFailedReviews: fixture.expected.expectedLoopBudget,
      usedFailedReviews: fixture.expected.expectedFailedReviews,
    });
  });

  it(THOTH_FLOW_FIXTURES.loopRetryAndBudget.id, async () => {
    const fixture = THOTH_FLOW_FIXTURES.loopRetryAndBudget;
    const runtime = fixtureRuntime();
    const [clarifyStep, taskStep, goalsStep] = fixture.providerScript;
    const clarify = clarifyCard(
      clarifyStep as Extract<ThothFixtureProviderStep, { type: "clarify_card" }>,
    );
    const approvalTask = taskCard(
      taskStep as Extract<ThothFixtureProviderStep, { type: "task_card" }>,
    );
    const approvalGoals = goalsCard(
      goalsStep as Extract<ThothFixtureProviderStep, { type: "goals_card" }>,
    );
    const loopInput: RegisterLoopTaskInput = {
      workspaceName: "Fixture workspace",
      workspacePath: runtime.workspacePath,
      sourceTopicId: "fixture-topic",
      loopStrength: fixture.composer.loopStrength!,
      provider: { provider: "codex", model: "fixture-codex", modeId: "auto" },
      clarifyTranscript: fixture.userPrompt,
      taskCard: approvalTask,
      goalsCard: approvalGoals,
    };

    await startFixtureSecretaryFlow(runtime, fixture);
    const state = secretaryState(runtime.session);
    injectSecretaryTimeline(runtime.session, state, { type: "clarify_card", card: clarify });
    await answerClarifyCard({ session: runtime.session, runtime, card: clarify });
    injectSecretaryTimeline(runtime.session, state, { type: "task_card", card: approvalTask });
    await answerApprovalCard({
      session: runtime.session,
      runtime,
      card: approvalTask,
      intent: "accept_loop",
    });
    injectSecretaryTimeline(runtime.session, state, { type: "goal_card", card: approvalGoals });
    await answerApprovalCard({
      session: runtime.session,
      runtime,
      card: approvalGoals,
      intent: "accept_loop",
    });

    const taskId = state.model.backgroundTasks.detail?.id;
    expect(taskId).toBeTruthy();
    const task = runtime.loopService.inspect(taskId!);
    expect(task).toBeTruthy();

    await waitFor(
      () => runtime.loopService.inspect(task!.id)?.currentPhase === "planexec",
      "retry first PlanExec",
    );
    runtime.loopService.resolvePlanExecResult(
      latestPhaseAgentId(runtime.loopService, task!.id, "goal-1", "planexec"),
      planexecResult("goal-1", 1, "INITIAL_ATTEMPT"),
    );
    await waitFor(
      () => runtime.loopService.inspect(task!.id)?.currentPhase === "review",
      "retry first Review",
    );
    runtime.loopService.resolveReviewVerdict(
      latestPhaseAgentId(runtime.loopService, task!.id, "goal-1", "review"),
      reviewVerdict("goal-1", 1, "fail", "REQUIRED_FIX_MARKER_MISSING"),
    );
    await waitFor(
      () => runtime.loopService.inspect(task!.id)?.goalRound === 2,
      "goal one retry PlanExec",
    );

    const retryTask = runtime.loopService.inspect(task!.id);
    expect(retryTask?.currentGoalId).toBe("goal-1");
    expect(retryTask?.budget.usedFailedReviews).toBe(1);
    expect(retryTask?.goals[1]?.phases.some((phase) => phase.agentId)).toBe(false);
    const retryPrompt = runtime.agentManager.streamCalls.findLast((call) =>
      call.prompt.includes("APPLY_REQUIRED_FIX_MARKER"),
    )?.prompt;
    expect(retryPrompt).toContain("REQUIRED_FIX_MARKER missing");
    expect(retryPrompt).toContain("Do not repeat INITIAL_ATTEMPT");
    expect(retryPrompt).toContain("Failed Review budget: 1/5");

    runtime.loopService.resolvePlanExecResult(
      latestPhaseAgentId(runtime.loopService, task!.id, "goal-1", "planexec"),
      planexecResult("goal-1", 2, "APPLY_REQUIRED_FIX_MARKER"),
    );
    await waitFor(
      () => runtime.loopService.inspect(task!.id)?.currentPhase === "review",
      "retry second Review",
    );
    runtime.loopService.resolveReviewVerdict(
      latestPhaseAgentId(runtime.loopService, task!.id, "goal-1", "review"),
      reviewVerdict("goal-1", 2, "pass", "GOAL_1_PASS"),
    );
    await waitFor(
      () => runtime.loopService.inspect(task!.id)?.currentGoalId === "goal-2",
      "goal two after retry",
    );
    runtime.loopService.resolvePlanExecResult(
      latestPhaseAgentId(runtime.loopService, task!.id, "goal-2", "planexec"),
      planexecResult("goal-2", 1, "GOAL_2_EXEC_DONE"),
    );
    await waitFor(
      () => runtime.loopService.inspect(task!.id)?.currentPhase === "review",
      "goal two Review",
    );
    runtime.loopService.resolveReviewVerdict(
      latestPhaseAgentId(runtime.loopService, task!.id, "goal-2", "review"),
      reviewVerdict("goal-2", 1, "pass", "GOAL_2_PASS"),
    );
    await waitFor(
      () => runtime.loopService.inspect(task!.id)?.status === "done",
      "retry task done",
    );
    expect(runtime.loopService.inspect(task!.id)?.budget).toMatchObject({
      maxFailedReviews: fixture.expected.expectedLoopBudget,
      usedFailedReviews: fixture.expected.expectedFailedReviews,
    });

    const budgetWorkspace = tempDirectory("thoth-flow-budget-workspace-");
    const budgetTask = await runtime.loopService.register({
      ...loopInput,
      workspacePath: budgetWorkspace,
    });
    for (let round = 1; round <= 5; round += 1) {
      await waitFor(
        () => runtime.loopService.inspect(budgetTask.id)?.currentPhase === "planexec",
        `budget PlanExec ${round}`,
      );
      runtime.loopService.resolvePlanExecResult(
        latestPhaseAgentId(runtime.loopService, budgetTask.id, "goal-1", "planexec"),
        planexecResult("goal-1", round, `BUDGET_FAIL_${round}`),
      );
      await waitFor(
        () => runtime.loopService.inspect(budgetTask.id)?.currentPhase === "review",
        `budget Review ${round}`,
      );
      runtime.loopService.resolveReviewVerdict(
        latestPhaseAgentId(runtime.loopService, budgetTask.id, "goal-1", "review"),
        reviewVerdict(
          "goal-1",
          round,
          "fail",
          `BUDGET_FAIL_${round}`,
          `BUDGET_ROOT_CAUSE_${round}`,
        ),
      );
    }
    await waitFor(
      () => runtime.loopService.inspect(budgetTask.id)?.status === "budget_wait",
      "Light budget wait",
    );
    const waiting = runtime.loopService.inspect(budgetTask.id);
    expect(waiting?.budget).toMatchObject({ maxFailedReviews: 5, usedFailedReviews: 5 });
    expect(waiting?.budgetWait?.exhaustedDimensions).toContain("failed_reviews");
    expect(waiting?.goals[0]?.round).toBe(6);
    expect(waiting?.goals[0]?.phases.some((phase) => phase.round === 6)).toBe(true);
    expect(waiting?.goals[1]?.phases.some((phase) => phase.agentId)).toBe(false);

    await runtime.loopService.action(budgetTask.id, "budget_continue");
    await waitFor(
      () =>
        runtime.loopService.inspect(budgetTask.id)?.currentPhase === "planexec" &&
        runtime.loopService.inspect(budgetTask.id)?.goalRound === 6,
      "budget continuation PlanExec",
    );
    expect(runtime.loopService.inspect(budgetTask.id)?.loopStrength).toBe("balanced");
  });
});
