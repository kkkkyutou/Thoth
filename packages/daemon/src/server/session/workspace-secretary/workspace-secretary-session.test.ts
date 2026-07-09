import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MutableDaemonConfig, SessionOutboundMessage } from "@thoth/protocol/messages";
import type {
  ThothClarifyCardModel,
  ThothGoalCardModel,
  ThothTaskCardModel,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";
import type { AgentManager, ManagedAgent } from "../../agent/agent-manager.js";
import type { AgentSessionConfig, AgentStreamEvent } from "../../agent/agent-sdk-types.js";
import type { DaemonConfigStore } from "../../daemon-config-store.js";
import {
  createRuntimeAuthorityDecision,
  rejectRuntimeAuthorityDecision,
} from "../../agent/runtime-tool-decisions.js";
import { WorkspaceSecretarySession } from "./workspace-secretary-session.js";

const workspace: PersistedWorkspaceRecord = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  kind: "local_checkout",
  cwd: "/workspace/thoth",
  displayName: "Thoth workspace",
  title: "Thoth workspace",
  branch: null,
  baseBranch: null,
  archivedAt: null,
  createdAt: "2026-07-04T00:00:00Z",
  updatedAt: "2026-07-04T00:00:00Z",
};

function providerSession(): MutableDaemonConfig["workspaceSecretary"]["providerSession"] {
  return {
    provider: "codex",
    model: "gpt-5.5",
    modeId: "auto",
  };
}

function createConfig(input?: {
  providerSession?: MutableDaemonConfig["workspaceSecretary"]["providerSession"];
  workspaceSecretary?: Partial<NonNullable<MutableDaemonConfig["workspaceSecretary"]>>;
  mcpInjected?: boolean;
}): MutableDaemonConfig {
  const workspaceSecretary = {
    ...(input?.providerSession ? { providerSession: input.providerSession } : {}),
    ...(input?.workspaceSecretary ?? {}),
  };
  return {
    mcp: { injectIntoAgents: input?.mcpInjected ?? true },
    providers: {},
    metadataGeneration: { providers: [] },
    workspaceSecretary,
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
  };
}

function clarifyCard(id = "clarify-card-1"): ThothClarifyCardModel {
  return {
    id,
    roundLabel: "Clarify",
    title: "确认排序目标边界",
    whyNow: "这些选择会改变语言、交付形态和验收方式。",
    continuesClarify: true,
    submitted: false,
    card: {
      question_id: "question-card-1",
      title: "确认排序目标边界",
      behavior_tree_node: "sorting_boundary",
      why_now: "先定边界可以避免做成不合用的实现。",
      allow_choice_notes: true,
      allow_note_only: true,
      questions: [
        {
          id: "language",
          question: "要用什么语言实现？",
          behavior_tree_node: "language",
          selection_mode: "single",
          choices: [
            { id: "cpp", label: "C++", description: "贴近系统性能" },
            { id: "rust", label: "Rust", description: "安全且高性能" },
          ],
        },
        {
          id: "shape",
          question: "最终交付成什么形态？",
          behavior_tree_node: "shape",
          selection_mode: "single",
          choices: [
            { id: "library", label: "库函数", description: "最小可复用接口" },
            { id: "cli", label: "命令行", description: "可传参运行" },
          ],
        },
      ],
    },
  };
}

function taskCard(id = "task-card-1"): ThothTaskCardModel {
  return {
    id,
    roundLabel: "Task",
    title: "实现高性能快速排序",
    goal: "实现一个可复用的高性能快速排序。",
    constraints: ["使用用户选择的语言。"],
    acceptance: ["正确性测试通过。", "性能基准可运行。"],
    provenanceSummary: "基于完整 Clarify 原文记录整理",
    submitted: false,
  };
}

function goalCard(id = "goal-card-1"): ThothGoalCardModel {
  return {
    id,
    roundLabel: "Plan",
    title: "高性能快速排序目标树",
    summary: "把已批准任务拆成目标层次，而不是实现步骤。",
    pyramid: [
      {
        id: "stage-library",
        title: "库函数能力",
        goal: "提供可复用的快速排序库函数。",
        acceptance: ["库函数接口可被测试调用。"],
        subgoals: [
          {
            id: "subgoal-correctness",
            title: "正确性覆盖",
            goal: "覆盖常见输入形态。",
            acceptance: ["空数组、重复值和逆序输入通过。"],
          },
        ],
      },
    ],
    provenanceSummary: "受 Clarify 原文和已确认 Task Card 约束",
    submitted: false,
  };
}

function nativeStream(...items: AgentStreamEvent[]): AgentStreamEvent[] {
  return items;
}

function createSession(input?: {
  providerSession?: MutableDaemonConfig["workspaceSecretary"]["providerSession"];
  workspaceSecretary?: Partial<NonNullable<MutableDaemonConfig["workspaceSecretary"]>>;
  streamRuns?: AgentStreamEvent[][];
}) {
  const emitted: SessionOutboundMessage[] = [];
  const runPrompts: unknown[] = [];
  const runOptions: unknown[] = [];
  const createdAgentConfigs: AgentSessionConfig[] = [];
  const permissionResponses: Array<{ agentId: string; requestId: string; response: unknown }> = [];
  const thothHome = mkdtempSync(join(tmpdir(), "thoth-workspace-secretary-"));
  const streamRuns = [...(input?.streamRuns ?? [])];
  let streamIndex = 0;
  const agentManager = {
    getProviderAvailability: async (provider: string) => ({
      provider,
      available: true,
      error: null,
    }),
    createAgent: async (config: AgentSessionConfig) => {
      createdAgentConfigs.push(config);
      return { id: "agent-workspace-secretary" } as ManagedAgent;
    },
    streamAgent: (_agentId: string, prompt: unknown, options?: unknown) => {
      runPrompts.push(prompt);
      runOptions.push(options);
      const configuredRun =
        streamRuns[streamIndex] ??
        nativeStream(
          { type: "turn_started", provider: "codex", turnId: "turn-1" },
          {
            type: "timeline",
            provider: "codex",
            turnId: "turn-1",
            item: { type: "assistant_message", text: "bare quick response" },
          },
          { type: "turn_completed", provider: "codex", turnId: "turn-1" },
        );
      streamIndex += 1;
      return (async function* () {
        for (const event of configuredRun) {
          yield event;
        }
      })();
    },
    respondToPermission: async (agentId: string, requestId: string, response: unknown) => {
      permissionResponses.push({ agentId, requestId, response });
    },
    appendTimelineItem: async (_agentId: string, item: unknown) => {
      emitted.push({
        type: "agent_stream",
        payload: {
          agentId: "agent-workspace-secretary",
          event: { type: "timeline", provider: "codex", item } as AgentStreamEvent,
          timestamp: new Date().toISOString(),
        },
      });
    },
    getAgent: () =>
      ({
        id: "agent-workspace-secretary",
        persistence: { provider: "codex", sessionId: "provider-session-1" },
        labels: { topicId: "topic-main" },
      }) as ManagedAgent,
  } as unknown as AgentManager;
  const daemonConfigStore = {
    getThothHome: () => thothHome,
    get: () =>
      createConfig({
        providerSession: input?.providerSession ?? providerSession(),
        workspaceSecretary: input?.workspaceSecretary,
      }),
    patch: () => undefined,
  } as unknown as DaemonConfigStore;
  const session = new WorkspaceSecretarySession({
    host: {
      emit: (message) => emitted.push(message),
      listWorkspaces: async () => [workspace],
    },
    agentManager,
    daemonConfigStore,
    probeRelayHealth: async () => "healthy",
  });
  return {
    session,
    emitted,
    runPrompts,
    runOptions,
    createdAgentConfigs,
    permissionResponses,
    cleanup: () => rmSync(thothHome, { recursive: true, force: true }),
  };
}

function lastWorkspaceModel(emitted: SessionOutboundMessage[]) {
  const message = [...emitted]
    .reverse()
    .find(
      (entry) =>
        entry.type === "workspace_secretary.send.response" ||
        entry.type === "workspace_secretary.answer.response",
    );
  if (!message || !("payload" in message) || !message.payload.model) {
    throw new Error("Workspace Secretary model response missing");
  }
  return message.payload.model;
}

function lastModelUpdate(emitted: SessionOutboundMessage[]) {
  const message = [...emitted]
    .reverse()
    .find((entry) => entry.type === "workspace_secretary.model.update");
  if (!message || !("payload" in message) || !message.payload.model) {
    throw new Error("Workspace Secretary model update missing");
  }
  return message.payload;
}

async function flushBackgroundTurns(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe("WorkspaceSecretarySession runtime tool bridge", () => {
  it("hydrates Loop composer strength from persisted config", async () => {
    const { session, emitted, cleanup } = createSession({
      workspaceSecretary: { mode: "loop", loopStrength: "light" },
    });

    try {
      await session.handleSnapshotRequest({
        type: "workspace_secretary.snapshot.request",
        requestId: "snapshot-1",
      });

      const message = emitted.find(
        (entry) => entry.type === "workspace_secretary.snapshot.response",
      );
      expect(
        message && "payload" in message ? message.payload.model?.secretary.composer : null,
      ).toMatchObject({
        mode: "loop",
        loop: "light",
      });
    } finally {
      cleanup();
    }
  });

  it("defaults missing Loop composer strength to Single", async () => {
    const { session, emitted, cleanup } = createSession({
      workspaceSecretary: { mode: "loop" },
    });

    try {
      await session.handleSnapshotRequest({
        type: "workspace_secretary.snapshot.request",
        requestId: "snapshot-1",
      });

      const message = emitted.find(
        (entry) => entry.type === "workspace_secretary.snapshot.response",
      );
      expect(
        message && "payload" in message ? message.payload.model?.secretary.composer : null,
      ).toMatchObject({
        mode: "loop",
        loop: "one_plan_one_do",
      });
    } finally {
      cleanup();
    }
  });

  it("starts Quick + none as a bare provider timeline without outputSchema", async () => {
    const { session, emitted, runPrompts, runOptions, createdAgentConfigs, cleanup } =
      createSession({
        streamRuns: [
          nativeStream(
            { type: "turn_started", provider: "codex", turnId: "turn-1" },
            {
              type: "timeline",
              provider: "codex",
              turnId: "turn-1",
              item: {
                type: "tool_call",
                callId: "shell-1",
                name: "CodexBash",
                status: "running",
                error: null,
                detail: {
                  type: "shell",
                  command: "echo hi",
                  cwd: "/workspace/thoth",
                  output: null,
                },
              },
            },
            {
              type: "timeline",
              provider: "codex",
              turnId: "turn-1",
              item: { type: "assistant_message", text: "hi from Codex" },
            },
            { type: "turn_completed", provider: "codex", turnId: "turn-1" },
          ),
        ],
      });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-1",
        text: "hi",
        uiAgentId: "draft-secretary",
        messageId: "message-1",
        composer: {
          mode: "quick",
          clarifyStrength: "none",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      expect(runPrompts).toEqual(["hi"]);
      expect(runOptions).toEqual([{ messageId: "message-1" }]);
      expect(createdAgentConfigs[0]?.extra?.codex?.thothClarifyRuntimeTools).toBeUndefined();
      expect(
        emitted.some(
          (message) =>
            message.type === "agent_stream" &&
            message.payload.agentId === "draft-secretary" &&
            message.payload.event.type === "timeline" &&
            message.payload.event.item.type === "tool_call",
        ),
      ).toBe(true);
      const model = lastWorkspaceModel(emitted);
      expect(model.secretary.turns).toEqual([
        expect.objectContaining({ kind: "message", speaker: "user", text: "hi" }),
      ]);
    } finally {
      cleanup();
    }
  });

  it("mirrors structured Clarify cards from the provider AgentTimeline", async () => {
    const card = clarifyCard();
    const { session, emitted, runPrompts, runOptions, createdAgentConfigs, cleanup } =
      createSession({
        streamRuns: [
          nativeStream(
            { type: "turn_started", provider: "codex", turnId: "turn-1" },
            {
              type: "timeline",
              provider: "codex",
              turnId: "turn-1",
              item: { type: "clarify_card", card },
            },
          ),
        ],
      });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-1",
        text: "实现一个高性能快速排序",
        uiAgentId: "draft-secretary",
        messageId: "message-1",
        composer: {
          mode: "quick",
          clarifyStrength: "dive",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      expect(String(runPrompts[0])).toContain("runtime_tools: thoth_submit_clarify_card");
      expect(String(runPrompts[0])).toContain("clarify_below_soft_target_policy:");
      expect(String(runPrompts[0])).toContain("below_soft_minimum: dive has 0/10 Clarify cards");
      expect(String(runPrompts[0])).toContain("material_frontier_categories:");
      expect(String(runPrompts[0])).toContain("performance_quality_scale_or_benchmark_baseline");
      expect(String(runPrompts[0])).not.toContain("submit_clarify_packet");
      expect(runOptions).toEqual([{ messageId: "message-1" }]);
      expect(createdAgentConfigs[0]?.extra?.codex?.thothClarifyRuntimeTools).toBe(true);
      expect(
        emitted.some(
          (message) =>
            message.type === "agent_stream" &&
            message.payload.agentId === "draft-secretary" &&
            message.payload.event.type === "timeline" &&
            message.payload.event.item.type === "clarify_card",
        ),
      ).toBe(true);
      const model = lastWorkspaceModel(emitted);
      expect(model.secretary.turns).toContainEqual(
        expect.objectContaining({ kind: "clarify_card", card }),
      );
    } finally {
      cleanup();
    }
  });

  it("answers a pending runtime decision instead of starting a new provider turn", async () => {
    const card = clarifyCard("clarify-card-answer");
    const { session, emitted, runPrompts, cleanup } = createSession({
      streamRuns: [
        nativeStream({
          type: "timeline",
          provider: "codex",
          turnId: "turn-1",
          item: { type: "clarify_card", card },
        }),
      ],
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-1",
        text: "实现一个高性能快速排序",
        uiAgentId: "draft-secretary",
        composer: {
          mode: "quick",
          clarifyStrength: "dive",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      const { waitForAnswer } = createRuntimeAuthorityDecision({
        provider: "codex",
        agentId: "agent-workspace-secretary",
        topicId: "topic-main",
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        toolName: "thoth_submit_clarify_card",
        phase: "clarify",
        card: { kind: "clarify_card", card },
        redactedRawInputHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });

      await session.handleAnswerRequest({
        type: "workspace_secretary.answer.request",
        requestId: "answer-1",
        cardId: card.id,
        uiAgentId: "draft-secretary",
        answer: {
          intent: "submit_choices",
          question_card_id: card.card.question_id,
          title: card.title,
          answers: [
            {
              question_id: "language",
              choice_ids: ["cpp"],
              choice_notes: {},
            },
            {
              question_id: "shape",
              choice_ids: ["library"],
              choice_notes: {},
            },
          ],
          raw_answer: "已确认 2 个分支维度",
        },
      });

      await expect(waitForAnswer).resolves.toMatchObject({
        submittedSummary: "已确认 2 个分支维度",
      });
      expect(runPrompts).toHaveLength(1);
      const model = lastWorkspaceModel(emitted);
      const answeredCard = model.secretary.turns.find(
        (turn) => turn.kind === "clarify_card" && turn.card.id === card.id,
      );
      expect(answeredCard).toMatchObject({
        kind: "clarify_card",
        card: { submitted: true, submittedSummary: "已确认 2 个分支维度" },
      });
    } finally {
      cleanup();
    }
  });

  it("rejects multiple choices for a single-select Clarify question", async () => {
    const card = clarifyCard("clarify-card-single-reject");
    const { session, emitted, cleanup } = createSession({
      streamRuns: [
        nativeStream({
          type: "timeline",
          provider: "codex",
          turnId: "turn-1",
          item: { type: "clarify_card", card },
        }),
      ],
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-1",
        text: "实现一个高性能快速排序",
        uiAgentId: "draft-secretary",
        composer: {
          mode: "quick",
          clarifyStrength: "dive",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      const { waitForAnswer } = createRuntimeAuthorityDecision({
        provider: "codex",
        agentId: "agent-workspace-secretary",
        topicId: "topic-main",
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        toolName: "thoth_submit_clarify_card",
        phase: "clarify",
        card: { kind: "clarify_card", card },
        redactedRawInputHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
      void waitForAnswer.catch(() => undefined);

      await session.handleAnswerRequest({
        type: "workspace_secretary.answer.request",
        requestId: "answer-1",
        cardId: card.id,
        uiAgentId: "draft-secretary",
        answer: {
          intent: "submit_choices",
          question_card_id: card.card.question_id,
          title: card.title,
          answers: [
            {
              question_id: "language",
              choice_ids: ["cpp", "rust"],
              choice_notes: {},
            },
            {
              question_id: "shape",
              choice_ids: ["library"],
              choice_notes: {},
            },
          ],
          raw_answer: "错误地多选了单选题",
        },
      });

      expect(lastWorkspaceModel(emitted).secretary.status).toMatchObject({
        kind: "recoverable_error",
        detail: expect.stringContaining("单选问题只能提交一个选项"),
      });
    } finally {
      rejectRuntimeAuthorityDecision({
        cardId: card.id,
        message: "test cleanup after invalid single-select answer",
      });
      cleanup();
    }
  });

  it("pauses Clarify without switching the user-selected Loop mode to Quick", async () => {
    const card = clarifyCard("clarify-card-pause");
    const { session, cleanup } = createSession({
      streamRuns: [
        nativeStream({
          type: "timeline",
          provider: "codex",
          turnId: "turn-1",
          item: { type: "clarify_card", card },
        }),
      ],
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-1",
        text: "实现一个高性能快速排序",
        uiAgentId: "draft-secretary",
        composer: {
          mode: "loop",
          clarifyStrength: "dive",
          loop: "one_plan_one_do",
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      const { waitForAnswer } = createRuntimeAuthorityDecision({
        provider: "codex",
        agentId: "agent-workspace-secretary",
        topicId: "topic-main",
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        toolName: "thoth_submit_clarify_card",
        phase: "clarify",
        card: { kind: "clarify_card", card },
        redactedRawInputHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });

      await session.handleAnswerRequest({
        type: "workspace_secretary.answer.request",
        requestId: "answer-1",
        cardId: card.id,
        uiAgentId: "draft-secretary",
        answer: {
          intent: "stop",
          question_card_id: card.card.question_id,
          title: card.title,
          answers: [
            { question_id: "language", choice_ids: [], choice_notes: {} },
            { question_id: "shape", choice_ids: [], choice_notes: {} },
          ],
          raw_answer: "暂停继续询问",
        },
      });

      await expect(waitForAnswer).resolves.toMatchObject({
        submittedSummary: "已暂停继续询问",
      });
      const internalState = (session as unknown as { state: WorkspaceSecretaryStateForTest }).state;
      expect(internalState.activeTurnPhase).toBe("clarify");
      expect(internalState.currentClarifyState).not.toBe("C_DIRECT");
      expect(internalState.model.secretary.composer).toMatchObject({
        mode: "loop",
        loop: "one_plan_one_do",
      });
    } finally {
      cleanup();
    }
  });

  it("denies native provider questions in structured Clarify without mirroring a permission card", async () => {
    const { session, emitted, permissionResponses, cleanup } = createSession({
      streamRuns: [
        nativeStream({
          type: "permission_requested",
          provider: "codex",
          turnId: "turn-1",
          request: {
            id: "permission-1",
            provider: "codex",
            name: "request_user_input",
            kind: "question",
            title: "Native question",
            input: {
              questions: [
                {
                  id: "q1",
                  header: "Q1",
                  question: "Use C++?",
                  options: [
                    { label: "Yes", description: "Use C++" },
                    { label: "No", description: "Do not use C++" },
                  ],
                },
              ],
            },
          },
        }),
      ],
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-1",
        text: "实现一个高性能快速排序",
        uiAgentId: "draft-secretary",
        composer: {
          mode: "quick",
          clarifyStrength: "dive",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      expect(permissionResponses).toContainEqual(
        expect.objectContaining({
          agentId: "agent-workspace-secretary",
          requestId: "permission-1",
          response: expect.objectContaining({ behavior: "deny", interrupt: true }),
        }),
      );
      expect(
        emitted.some(
          (message) =>
            message.type === "agent_permission_request" &&
            message.payload.request.id === "permission-1",
        ),
      ).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("blocks structured provider turns that end after Task Card without Goals Card", async () => {
    const card = {
      ...taskCard(),
      submitted: true,
      submittedSummary: "已确认并按 Quick 前台执行",
    };
    const { session, emitted, cleanup } = createSession({
      streamRuns: [
        nativeStream(
          { type: "turn_started", provider: "codex", turnId: "turn-1" },
          {
            type: "timeline",
            provider: "codex",
            turnId: "turn-1",
            item: { type: "task_card", card },
          },
          { type: "turn_completed", provider: "codex", turnId: "turn-1" },
        ),
      ],
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-1",
        text: "实现一个高性能快速排序",
        uiAgentId: "draft-secretary",
        composer: {
          mode: "quick",
          clarifyStrength: "dive",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      const update = lastModelUpdate(emitted);
      expect(update.reason).toBe("provider_blocked");
      expect(update.model.secretary.status).toMatchObject({
        kind: "recoverable_error",
        detail: expect.stringContaining("Goals Card"),
      });
    } finally {
      cleanup();
    }
  });

  it("keeps quick_exec state when a submitted Pyramid Plan timeline item is replayed", async () => {
    const card = goalCard("goal-card-quick");
    const { session, cleanup } = createSession({
      streamRuns: [
        nativeStream({
          type: "timeline",
          provider: "codex",
          turnId: "turn-1",
          item: { type: "goal_card", card },
        }),
      ],
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-1",
        text: "实现一个高性能快速排序",
        uiAgentId: "draft-secretary",
        composer: {
          mode: "quick",
          clarifyStrength: "dive",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      createRuntimeAuthorityDecision({
        provider: "codex",
        agentId: "agent-workspace-secretary",
        topicId: "topic-main",
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-goal",
        toolName: "thoth_submit_pyramid_plan",
        phase: "approval_breakdown",
        card: { kind: "pyramid_plan_card", card },
        redactedRawInputHash:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      });

      await session.handleAnswerRequest({
        type: "workspace_secretary.answer.request",
        requestId: "answer-1",
        cardId: card.id,
        uiAgentId: "draft-secretary",
        answer: {
          intent: "accept_quick",
          raw_answer: "已确认并按 Quick 前台执行",
        },
      });

      const internalState = (session as unknown as { state: WorkspaceSecretaryStateForTest }).state;
      expect(internalState.activeTurnPhase).toBe("quick_exec");
      expect(internalState.currentClarifyState).toBe("C_DIRECT");

      const submittedCard = {
        ...card,
        submitted: true,
        submittedSummary: "已确认并按 Quick 前台执行",
      };
      (
        session as unknown as {
          recordTimelineForSecretaryState: (
            state: WorkspaceSecretaryStateForTest,
            event: AgentStreamEvent,
          ) => void;
        }
      ).recordTimelineForSecretaryState(internalState, {
        type: "timeline",
        provider: "codex",
        turnId: "turn-1",
        item: { type: "goal_card", card: submittedCard },
      });

      expect(internalState.activeTurnPhase).toBe("quick_exec");
      expect(internalState.currentClarifyState).toBe("C_DIRECT");
      expect(
        internalState.model.secretary.turns.find(
          (turn) => turn.kind === "goal_card" && turn.card.id === card.id,
        ),
      ).toMatchObject({
        kind: "goal_card",
        card: {
          submitted: true,
          submittedSummary: "已确认并按 Quick 前台执行",
        },
      });
    } finally {
      cleanup();
    }
  });
});

type WorkspaceSecretaryStateForTest = {
  activeTurnPhase: string;
  currentClarifyState: string;
  model: {
    secretary: {
      turns: Array<
        | { kind: "clarify_card"; card: ThothClarifyCardModel }
        | { kind: "task_card"; card: ThothTaskCardModel }
        | { kind: "goal_card"; card: ThothGoalCardModel }
        | { kind: string; [key: string]: unknown }
      >;
    };
  };
};
