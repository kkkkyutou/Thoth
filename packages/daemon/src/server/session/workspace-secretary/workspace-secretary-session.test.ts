import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MutableDaemonConfig, SessionOutboundMessage } from "@thoth/protocol/messages";
import type {
  ThothClarifyCardModel,
  ThothGoalCardModel,
  ThothGoalsCardModel,
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

const secondWorkspace: PersistedWorkspaceRecord = {
  ...workspace,
  workspaceId: "workspace-2",
  projectId: "project-2",
  cwd: "/workspace/other",
  displayName: "Other workspace",
  title: "Other workspace",
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

function goalsCard(id = "goals-card-1"): ThothGoalsCardModel {
  return {
    id,
    roundLabel: "Goals",
    title: "高性能快速排序线性目标",
    summary: "按可验证的线性目标完成已确认的排序模块。",
    goals: [
      {
        id: "goal-api",
        order: 1,
        title: "交付排序接口",
        goal: "提供用户确认的可复用排序接口。",
        constraints: ["使用 C++。"],
        acceptance: ["接口可以被测试调用。"],
        provenance: "来自已确认的交付形态。",
      },
      {
        id: "goal-verify",
        order: 2,
        title: "验证正确性和性能",
        goal: "证明实现满足正确性和性能验收。",
        constraints: ["覆盖退化输入。"],
        acceptance: ["测试与基准可以运行。"],
        provenance: "来自已确认的验收边界。",
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
  workspaces?: PersistedWorkspaceRecord[];
  hasInFlightRun?: (agentId: string) => boolean;
}) {
  const emitted: SessionOutboundMessage[] = [];
  const runPrompts: unknown[] = [];
  const runOptions: unknown[] = [];
  const replacedPrompts: unknown[] = [];
  const replacedOptions: unknown[] = [];
  const createdAgentConfigs: AgentSessionConfig[] = [];
  const permissionResponses: Array<{ agentId: string; requestId: string; response: unknown }> = [];
  const canceledAgentIds: string[] = [];
  const thothHome = mkdtempSync(join(tmpdir(), "thoth-workspace-secretary-"));
  const streamRuns = [...(input?.streamRuns ?? [])];
  let config = createConfig({
    providerSession: input?.providerSession ?? providerSession(),
    workspaceSecretary: input?.workspaceSecretary,
  });
  let streamIndex = 0;
  const nextConfiguredStream = () => {
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
  };
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
      return nextConfiguredStream();
    },
    replaceAgentRun: (_agentId: string, prompt: unknown, options?: unknown) => {
      replacedPrompts.push(prompt);
      replacedOptions.push(options);
      return nextConfiguredStream();
    },
    respondToPermission: async (agentId: string, requestId: string, response: unknown) => {
      permissionResponses.push({ agentId, requestId, response });
    },
    cancelAgentRun: async (agentId: string) => {
      canceledAgentIds.push(agentId);
      return true;
    },
    hasInFlightRun: (agentId: string) => input?.hasInFlightRun?.(agentId) ?? true,
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
    listInternalAgentsByLabels: (labels: Record<string, string>) =>
      labels.surface === "workspace-secretary" && labels.topicId === "topic-main"
        ? [
            {
              id: "agent-workspace-secretary",
              cwd: workspace.cwd,
            },
          ]
        : [],
  } as unknown as AgentManager;
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
  const session = new WorkspaceSecretarySession({
    host: {
      emit: (message) => emitted.push(message),
      listWorkspaces: async () => input?.workspaces ?? [workspace],
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
    replacedPrompts,
    replacedOptions,
    createdAgentConfigs,
    permissionResponses,
    canceledAgentIds,
    getConfig: () => config,
    cleanup: () => rmSync(thothHome, { recursive: true, force: true }),
  };
}

function lastWorkspaceModel(emitted: SessionOutboundMessage[]) {
  const message = [...emitted]
    .reverse()
    .find(
      (entry) =>
        entry.type === "workspace_secretary.send.response" ||
        entry.type === "workspace_secretary.answer.response" ||
        entry.type === "workspace_secretary.cancel.response",
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

  it("keeps an in-flight workspace state when another workspace is opened and then left", async () => {
    const { session, emitted, cleanup } = createSession({
      workspaces: [workspace, secondWorkspace],
      streamRuns: [[]],
    });

    try {
      await session.handleSnapshotRequest({
        type: "workspace_secretary.snapshot.request",
        requestId: "snapshot-first",
        workspaceId: workspace.workspaceId,
      });
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-first",
        text: "实现一个仍在运行的任务",
        uiAgentId: "draft-first",
        composer: {
          mode: "quick",
          clarifyStrength: "light",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await session.handleSnapshotRequest({
        type: "workspace_secretary.snapshot.request",
        requestId: "snapshot-second",
        workspaceId: secondWorkspace.workspaceId,
      });
      await session.handleSnapshotRequest({
        type: "workspace_secretary.snapshot.request",
        requestId: "snapshot-first-return",
        workspaceId: workspace.workspaceId,
      });

      const returned = emitted.find(
        (entry) =>
          entry.type === "workspace_secretary.snapshot.response" &&
          entry.payload.requestId === "snapshot-first-return",
      );
      expect(returned && "payload" in returned ? returned.payload.model : null).toMatchObject({
        secretary: {
          workspacePath: workspace.cwd,
          status: { kind: "loading" },
          turns: [
            expect.objectContaining({
              kind: "message",
              speaker: "user",
              text: "实现一个仍在运行的任务",
            }),
          ],
        },
      });
    } finally {
      cleanup();
    }
  });

  it("restores the in-flight status when switching topics inside one workspace", async () => {
    const { session, emitted, cleanup } = createSession({ streamRuns: [[]] });

    try {
      await session.handleTopicCreateRequest({
        type: "workspace_secretary.topic.create.request",
        requestId: "topic-running",
        workspaceId: workspace.workspaceId,
      });
      const runningTopicResponse = emitted.find(
        (entry) =>
          entry.type === "workspace_secretary.topic.create.response" &&
          entry.payload.requestId === "topic-running",
      );
      const runningTopicId =
        runningTopicResponse && "payload" in runningTopicResponse
          ? runningTopicResponse.payload.model?.secretary.activeTopicId
          : null;
      expect(runningTopicId).toBeTruthy();

      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-running-topic",
        text: "继续运行",
        uiAgentId: "draft-running",
        composer: {
          mode: "quick",
          clarifyStrength: "light",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await session.handleTopicCreateRequest({
        type: "workspace_secretary.topic.create.request",
        requestId: "topic-other",
        workspaceId: workspace.workspaceId,
      });
      await session.handleSnapshotRequest({
        type: "workspace_secretary.snapshot.request",
        requestId: "snapshot-running-topic",
        workspaceId: workspace.workspaceId,
        topicId: runningTopicId!,
      });

      const restored = emitted.find(
        (entry) =>
          entry.type === "workspace_secretary.snapshot.response" &&
          entry.payload.requestId === "snapshot-running-topic",
      );
      expect(restored && "payload" in restored ? restored.payload.model : null).toMatchObject({
        secretary: {
          activeTopicId: runningTopicId,
          status: { kind: "loading" },
        },
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
                type: "user_message",
                text: "This is the provider-side prompt and must never appear in the UI.",
              },
            },
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
      expect(
        emitted.some(
          (message) =>
            message.type === "agent_stream" &&
            message.payload.agentId === "draft-secretary" &&
            message.payload.event.type === "timeline" &&
            message.payload.event.item.type === "user_message",
        ),
      ).toBe(false);
      const model = lastWorkspaceModel(emitted);
      expect(model.secretary.turns).toEqual([
        expect.objectContaining({ kind: "message", speaker: "user", text: "hi" }),
      ]);
    } finally {
      cleanup();
    }
  });

  it("atomically creates a client-bound topic with its first user turn", async () => {
    const { session, emitted, getConfig, runPrompts, cleanup } = createSession({
      streamRuns: [nativeStream({ type: "turn_started", provider: "codex", turnId: "turn-1" })],
    });
    const topicId = "topic-client-bound";

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-client-bound-topic",
        workspaceId: workspace.workspaceId,
        topicId,
        text: "刷新前也必须保留这条输入",
        uiAgentId: "draft-client-bound",
        composer: {
          mode: "quick",
          clarifyStrength: "light",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      expect(runPrompts).toHaveLength(1);
      const model = lastWorkspaceModel(emitted);
      expect(model.secretary.activeTopicId).toBe(topicId);
      expect(model.secretary.turns).toEqual([
        expect.objectContaining({
          kind: "message",
          speaker: "user",
          text: "刷新前也必须保留这条输入",
        }),
      ]);
      const snapshot = getConfig().workspaceSecretary?.topicSnapshots?.find(
        (entry) => entry.workspacePath === workspace.cwd,
      );
      expect(snapshot?.activeTopicId).toBe(topicId);
      expect(snapshot?.topicStates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            topicId,
            turns: [
              expect.objectContaining({
                kind: "message",
                speaker: "user",
                text: "刷新前也必须保留这条输入",
              }),
            ],
          }),
        ]),
      );
    } finally {
      cleanup();
    }
  });

  it("renames the active Workspace Secretary topic from the first user prompt", async () => {
    const { session, emitted, cleanup } = createSession();

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-title",
        text: "  实现一个高性能快速排序  \n需要 benchmark",
        uiAgentId: "draft-secretary",
        messageId: "message-title",
        composer: {
          mode: "quick",
          clarifyStrength: "balanced",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });

      const model = lastWorkspaceModel(emitted);
      const activeTopic = model.secretary.topics.find(
        (topic) => topic.id === model.secretary.activeTopicId,
      );
      expect(activeTopic?.title).toBe("实现一个高性能快速排序");
    } finally {
      cleanup();
    }
  });

  it("restores the requested Workspace Secretary topic after another same-title topic becomes active", async () => {
    const firstCard = clarifyCard("clarify-card-renderer-first");
    const secondCard = clarifyCard("clarify-card-renderer-second");
    const first = createSession({
      streamRuns: [
        nativeStream({
          type: "timeline",
          provider: "codex",
          turnId: "turn-1",
          item: { type: "clarify_card", card: firstCard },
        }),
        nativeStream({
          type: "timeline",
          provider: "codex",
          turnId: "turn-2",
          item: { type: "clarify_card", card: secondCard },
        }),
      ],
    });

    try {
      await first.session.handleTopicCreateRequest({
        type: "workspace_secretary.topic.create.request",
        requestId: "topic-1",
        workspaceId: workspace.workspaceId,
      });
      const topicOneResponse = first.emitted.findLast(
        (message) => message.type === "workspace_secretary.topic.create.response",
      );
      const topicOneId = topicOneResponse?.payload.model?.secretary.activeTopicId;
      expect(topicOneId).toBeTruthy();

      await first.session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-topic-1",
        text: "实现一个渲染器",
        uiAgentId: "draft-renderer-1",
        composer: {
          mode: "quick",
          clarifyStrength: "dive",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      await first.session.handleTopicCreateRequest({
        type: "workspace_secretary.topic.create.request",
        requestId: "topic-2",
        workspaceId: workspace.workspaceId,
      });
      const topicTwoResponse = first.emitted.findLast(
        (message) => message.type === "workspace_secretary.topic.create.response",
      );
      const topicTwoId = topicTwoResponse?.payload.model?.secretary.activeTopicId;
      expect(topicTwoId).toBeTruthy();
      expect(topicTwoId).not.toBe(topicOneId);

      await first.session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-topic-2",
        text: "实现一个渲染器",
        uiAgentId: "draft-renderer-2",
        composer: {
          mode: "quick",
          clarifyStrength: "dive",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      const restored = createSession({
        workspaceSecretary: first.getConfig().workspaceSecretary,
      });
      try {
        await restored.session.handleSnapshotRequest({
          type: "workspace_secretary.snapshot.request",
          requestId: "snapshot-topic-1",
          workspaceId: workspace.workspaceId,
          topicId: topicOneId!,
        });

        const snapshotResponse = restored.emitted.find(
          (message) => message.type === "workspace_secretary.snapshot.response",
        );
        const model = snapshotResponse?.payload.model;
        expect(model?.secretary.activeTopicId).toBe(topicOneId);
        expect(model?.secretary.turns).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ kind: "message", text: "实现一个渲染器" }),
            expect.objectContaining({
              kind: "clarify_card",
              card: expect.objectContaining({ id: firstCard.id }),
            }),
          ]),
        );
        expect(model?.secretary.turns).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "clarify_card",
              card: expect.objectContaining({ id: secondCard.id }),
            }),
          ]),
        );
      } finally {
        restored.cleanup();
      }
    } finally {
      first.cleanup();
    }
  });

  it("cancels the active topic provider agent instead of the draft ui agent", async () => {
    const { session, emitted, canceledAgentIds, cleanup } = createSession({
      streamRuns: [nativeStream({ type: "turn_started", provider: "codex", turnId: "turn-1" })],
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-cancel-provider",
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

      await session.handleCancelRequest({
        type: "workspace_secretary.cancel.request",
        requestId: "cancel-1",
        uiAgentId: "draft-secretary",
      });

      expect(canceledAgentIds).toEqual(["agent-workspace-secretary"]);
      const response = emitted.findLast(
        (message) => message.type === "workspace_secretary.cancel.response",
      );
      expect(response?.payload.model?.secretary.status).toMatchObject({
        kind: "ready",
        detail: "已中断当前请求，可继续输入。",
      });
      expect(canceledAgentIds).not.toContain("draft-secretary");
    } finally {
      cleanup();
    }
  });

  it("restores the topic provider agent after a browser refresh so cancel reaches the live run", async () => {
    const first = createSession({
      streamRuns: [nativeStream({ type: "turn_started", provider: "codex", turnId: "turn-1" })],
    });

    try {
      await first.session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-before-refresh",
        workspaceId: workspace.workspaceId,
        text: "实现一个渲染器",
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

      const restored = createSession({
        workspaceSecretary: first.getConfig().workspaceSecretary,
      });
      try {
        await restored.session.handleSnapshotRequest({
          type: "workspace_secretary.snapshot.request",
          requestId: "snapshot-after-refresh",
          workspaceId: workspace.workspaceId,
          topicId: "topic-main",
        });
        await restored.session.handleCancelRequest({
          type: "workspace_secretary.cancel.request",
          requestId: "cancel-after-refresh",
          workspaceId: workspace.workspaceId,
          topicId: "topic-main",
          uiAgentId: "draft-secretary",
        });

        expect(restored.canceledAgentIds).toEqual(["agent-workspace-secretary"]);
        const response = restored.emitted.findLast(
          (message) => message.type === "workspace_secretary.cancel.response",
        );
        expect(response?.payload.model?.secretary.status).toMatchObject({
          kind: "ready",
          detail: "已中断当前请求，可继续输入。",
        });
      } finally {
        restored.cleanup();
      }
    } finally {
      first.cleanup();
    }
  });

  it("finds a live provider agent by topic label when an older snapshot lacks topic agents", async () => {
    const first = createSession({
      streamRuns: [nativeStream({ type: "turn_started", provider: "codex", turnId: "turn-1" })],
    });

    try {
      await first.session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-legacy-snapshot",
        workspaceId: workspace.workspaceId,
        text: "实现一个渲染器",
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

      const legacyConfig = first.getConfig();
      const topicSnapshots = legacyConfig.workspaceSecretary?.topicSnapshots;
      expect(Array.isArray(topicSnapshots)).toBe(true);
      const legacyWorkspaceSecretary = {
        ...(legacyConfig.workspaceSecretary ?? {}),
        topicSnapshots: Array.isArray(topicSnapshots)
          ? topicSnapshots.map(({ topicAgents: _topicAgents, ...snapshot }) => snapshot)
          : [],
      };
      const restored = createSession({ workspaceSecretary: legacyWorkspaceSecretary });
      try {
        await restored.session.handleCancelRequest({
          type: "workspace_secretary.cancel.request",
          requestId: "cancel-legacy-snapshot",
          workspaceId: workspace.workspaceId,
          topicId: "topic-main",
          uiAgentId: "draft-secretary",
        });

        expect(restored.canceledAgentIds).toEqual(["agent-workspace-secretary"]);
      } finally {
        restored.cleanup();
      }
    } finally {
      first.cleanup();
    }
  });

  it("folds pending authority cards when the user cancels the secretary turn", async () => {
    const card = clarifyCard("clarify-card-cancel");
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
        requestId: "send-cancel-card",
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
        callId: "call-cancel",
        toolName: "thoth_submit_clarify_card",
        phase: "clarify",
        card: { kind: "clarify_card", card },
        redactedRawInputHash:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      });

      await session.handleCancelRequest({
        type: "workspace_secretary.cancel.request",
        requestId: "cancel-card",
        uiAgentId: "draft-secretary",
      });

      await expect(waitForAnswer).resolves.toMatchObject({
        submittedSummary: "已中断当前请求，可继续输入。",
        answer: { intent: "stop" },
      });
      const model = lastWorkspaceModel(emitted);
      const folded = model.secretary.turns.find(
        (turn) => turn.kind === "clarify_card" && turn.card.id === card.id,
      );
      expect(folded).toMatchObject({
        kind: "clarify_card",
        card: {
          submitted: true,
          submittedSummary: "已中断当前请求，可继续输入。",
        },
      });
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
      expect(model.secretary.status).toMatchObject({
        kind: "loading",
        detail: "已提交给真实 provider，正在继续当前 timeline。",
      });
    } finally {
      cleanup();
    }
  });

  it("answers the originating workspace topic after another workspace becomes the recent state", async () => {
    const card = clarifyCard("clarify-card-cross-workspace-answer");
    const { session, emitted, cleanup } = createSession({
      workspaces: [workspace, secondWorkspace],
      streamRuns: [
        nativeStream({
          type: "timeline",
          provider: "codex",
          turnId: "turn-cross-workspace",
          item: { type: "clarify_card", card },
        }),
      ],
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-cross-workspace",
        workspaceId: workspace.workspaceId,
        workspacePath: workspace.cwd,
        topicId: "topic-main",
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
        threadId: "thread-cross-workspace",
        turnId: "turn-cross-workspace",
        callId: "call-cross-workspace",
        toolName: "thoth_submit_clarify_card",
        phase: "clarify",
        card: { kind: "clarify_card", card },
        redactedRawInputHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });

      await session.handleSnapshotRequest({
        type: "workspace_secretary.snapshot.request",
        requestId: "snapshot-other-before-answer",
        workspaceId: secondWorkspace.workspaceId,
      });
      await session.handleAnswerRequest({
        type: "workspace_secretary.answer.request",
        requestId: "answer-cross-workspace",
        workspaceId: workspace.workspaceId,
        workspacePath: workspace.cwd,
        topicId: "topic-main",
        cardId: card.id,
        uiAgentId: "draft-secretary",
        answer: {
          intent: "stop",
          question_card_id: card.card.question_id,
          title: card.title,
          answers: [],
          raw_answer: "暂停继续询问",
        },
      });

      await expect(waitForAnswer).resolves.toMatchObject({
        submittedSummary: "已暂停继续询问",
      });
      const response = emitted.find(
        (message) =>
          message.type === "workspace_secretary.answer.response" &&
          message.payload.requestId === "answer-cross-workspace",
      );
      expect(response?.payload.model?.secretary).toMatchObject({
        workspacePath: workspace.cwd,
        activeTopicId: "topic-main",
      });
      expect(response?.payload.model?.secretary.turns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "clarify_card",
            card: expect.objectContaining({
              id: card.id,
              submitted: true,
            }),
          }),
        ]),
      );
    } finally {
      cleanup();
    }
  });

  it("folds an expired authority card instead of silently accepting its buttons", async () => {
    const card = clarifyCard("clarify-card-expired-action");
    const { session, emitted, cleanup } = createSession({
      streamRuns: [
        nativeStream({
          type: "timeline",
          provider: "codex",
          turnId: "turn-expired-action",
          item: { type: "clarify_card", card },
        }),
      ],
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-expired-action",
        workspaceId: workspace.workspaceId,
        workspacePath: workspace.cwd,
        topicId: "topic-main",
        text: "实现一个渲染器",
        uiAgentId: "draft-secretary",
        composer: {
          mode: "quick",
          clarifyStrength: "light",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();
      await session.handleAnswerRequest({
        type: "workspace_secretary.answer.request",
        requestId: "answer-expired-action",
        workspaceId: workspace.workspaceId,
        workspacePath: workspace.cwd,
        topicId: "topic-main",
        cardId: card.id,
        uiAgentId: "draft-secretary",
        answer: {
          intent: "stop",
          question_card_id: card.card.question_id,
          title: card.title,
          answers: [],
          raw_answer: "暂停继续询问",
        },
      });

      const response = emitted.find(
        (message) =>
          message.type === "workspace_secretary.answer.response" &&
          message.payload.requestId === "answer-expired-action",
      );
      expect(response?.payload.model?.secretary.status).toMatchObject({
        kind: "recoverable_error",
        detail: expect.stringContaining("已经失效"),
      });
      expect(response?.payload.model?.secretary.turns).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "clarify_card",
            card: expect.objectContaining({
              id: card.id,
              submitted: true,
              submittedSummary: expect.stringContaining("已经失效"),
            }),
          }),
        ]),
      );
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

  it("continues the same topic when Codex completes before a pending Clarify card is answered", async () => {
    const card = clarifyCard("clarify-card-completed-before-answer");
    const { session, emitted, runPrompts, cleanup } = createSession({
      hasInFlightRun: () => false,
      streamRuns: [
        nativeStream(
          { type: "turn_started", provider: "codex", turnId: "turn-1" },
          {
            type: "timeline",
            provider: "codex",
            turnId: "turn-1",
            item: { type: "clarify_card", card },
          },
          { type: "turn_completed", provider: "codex", turnId: "turn-1" },
        ),
        nativeStream({ type: "turn_started", provider: "codex", turnId: "turn-2" }),
      ],
    });
    const { waitForAnswer } = createRuntimeAuthorityDecision({
      provider: "codex",
      agentId: "agent-workspace-secretary",
      topicId: "topic-main",
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-completed-before-answer",
      toolName: "thoth_submit_clarify_card",
      phase: "clarify",
      card: { kind: "clarify_card", card },
      redactedRawInputHash:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-completed-before-answer",
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
      expect(lastWorkspaceModel(emitted).secretary.status.kind).toBe("loading");

      await session.handleAnswerRequest({
        type: "workspace_secretary.answer.request",
        requestId: "answer-completed-before-answer",
        cardId: card.id,
        uiAgentId: "draft-secretary",
        answer: {
          intent: "submit_choices",
          question_card_id: card.card.question_id,
          title: card.title,
          answers: [
            { question_id: "language", choice_ids: ["cpp"], choice_notes: {} },
            { question_id: "shape", choice_ids: ["library"], choice_notes: {} },
          ],
          raw_answer: "C++ 库函数",
        },
      });
      await flushBackgroundTurns();

      await expect(waitForAnswer).resolves.toMatchObject({
        submittedSummary: "已确认 2 个分支维度",
      });
      expect(runPrompts).toHaveLength(2);
      expect(JSON.stringify(runPrompts[1])).toContain("resolved the current Thoth authority card");
      expect(lastModelUpdate(emitted)).toMatchObject({ reason: "provider_turn_started" });

      // A replacement Codex turn may have started while the browser refreshes. The refresh
      // must not observe the submitted card as a dormant turn and launch a second continuation.
      await session.handleSnapshotRequest({
        type: "workspace_secretary.snapshot.request",
        requestId: "snapshot-during-continuation",
        workspaceId: workspace.workspaceId,
        topicId: "topic-main",
      });
      await flushBackgroundTurns();
      expect(runPrompts).toHaveLength(2);
    } finally {
      cleanup();
    }
  });

  it("starts a same-session foreground Plan+Exec turn for every approved Goals Card", async () => {
    const clarify = {
      ...clarifyCard("clarify-card-frozen-context"),
      submitted: true,
      submittedSummary: "已确认 2 个分支维度",
      submittedAnswers: [
        {
          questionId: "language",
          choiceIds: ["cpp"],
          choiceNotes: {},
        },
        {
          questionId: "shape",
          choiceIds: ["library"],
          choiceNotes: {},
        },
      ],
    };
    const task = {
      ...taskCard("task-card-frozen-context"),
      submitted: true,
      submittedSummary: "已确认并按 Quick 前台执行",
    };
    const goals = goalsCard("goals-card-frozen-context");
    const { waitForAnswer } = createRuntimeAuthorityDecision({
      provider: "codex",
      agentId: "agent-workspace-secretary",
      topicId: "topic-main",
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-goals-frozen-context",
      toolName: "thoth_submit_goals_card",
      phase: "approval_breakdown",
      card: { kind: "goals_card", card: goals },
      redactedRawInputHash:
        "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    });
    const { session, emitted, runPrompts, replacedPrompts, createdAgentConfigs, cleanup } =
      createSession({
        streamRuns: [
          nativeStream(
            { type: "turn_started", provider: "codex", turnId: "turn-1" },
            {
              type: "timeline",
              provider: "codex",
              turnId: "turn-1",
              item: { type: "clarify_card", card: clarify },
            },
            {
              type: "timeline",
              provider: "codex",
              turnId: "turn-1",
              item: { type: "task_card", card: task },
            },
            {
              type: "timeline",
              provider: "codex",
              turnId: "turn-1",
              item: { type: "goal_card", card: goals },
            },
          ),
          nativeStream(
            { type: "turn_started", provider: "codex", turnId: "turn-2" },
            {
              type: "timeline",
              provider: "codex",
              turnId: "turn-2",
              item: { type: "assistant_message", text: "ALL_GOALS_EXECUTED" },
            },
            { type: "turn_completed", provider: "codex", turnId: "turn-2" },
          ),
        ],
      });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-foreground-handoff",
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

      await session.handleAnswerRequest({
        type: "workspace_secretary.answer.request",
        requestId: "answer-foreground-handoff",
        cardId: goals.id,
        uiAgentId: "draft-secretary",
        answer: {
          intent: "accept_quick",
          card_id: goals.id,
          title: goals.title,
          raw_answer: "按前台执行",
        },
      });
      await flushBackgroundTurns();

      await expect(waitForAnswer).resolves.toMatchObject({
        answer: { intent: "accept_quick" },
      });
      expect(createdAgentConfigs).toHaveLength(1);
      expect(runPrompts).toHaveLength(1);
      expect(replacedPrompts).toHaveLength(1);
      const prompt = String(replacedPrompts[0]);
      expect(prompt).toContain("Thoth Quick foreground Plan+Exec agent");
      expect(prompt).toContain("Do not stop after Goal 1.");
      expect(prompt).toContain("goal id: goal-api");
      expect(prompt).toContain("goal id: goal-verify");
      expect(prompt).toContain("constraints:\n- 使用用户选择的语言。");
      expect(prompt).toContain("User decision: C++");
      expect(prompt).not.toContain("Thoth structured Workspace Secretary turn.");
      expect(lastModelUpdate(emitted)).toMatchObject({ reason: "provider_turn_completed" });
    } finally {
      cleanup();
    }
  });

  it("starts foreground Plan+Exec after a Goals Card even when the authority turn already completed", async () => {
    const task = {
      ...taskCard("task-card-completed-goals"),
      submitted: true,
      submittedSummary: "已确认并按 Quick 前台执行",
    };
    const goals = goalsCard("goals-card-completed-goals");
    const { waitForAnswer } = createRuntimeAuthorityDecision({
      provider: "codex",
      agentId: "agent-workspace-secretary",
      topicId: "topic-main",
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-goals-completed",
      toolName: "thoth_submit_goals_card",
      phase: "approval_breakdown",
      card: { kind: "goals_card", card: goals },
      redactedRawInputHash:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    const { session, runPrompts, replacedPrompts, cleanup } = createSession({
      hasInFlightRun: () => false,
      streamRuns: [
        nativeStream(
          { type: "turn_started", provider: "codex", turnId: "turn-1" },
          {
            type: "timeline",
            provider: "codex",
            turnId: "turn-1",
            item: { type: "task_card", card: task },
          },
          {
            type: "timeline",
            provider: "codex",
            turnId: "turn-1",
            item: { type: "goal_card", card: goals },
          },
          { type: "turn_completed", provider: "codex", turnId: "turn-1" },
        ),
        nativeStream({ type: "turn_started", provider: "codex", turnId: "turn-2" }),
      ],
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-completed-goals",
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

      await session.handleAnswerRequest({
        type: "workspace_secretary.answer.request",
        requestId: "answer-completed-goals",
        cardId: goals.id,
        uiAgentId: "draft-secretary",
        answer: {
          intent: "accept_quick",
          card_id: goals.id,
          title: goals.title,
          raw_answer: "按前台执行",
        },
      });
      await flushBackgroundTurns();

      await expect(waitForAnswer).resolves.toMatchObject({
        answer: { intent: "accept_quick" },
      });
      expect(runPrompts).toHaveLength(2);
      expect(replacedPrompts).toHaveLength(0);
      expect(String(runPrompts[1])).toContain("Do not stop after Goal 1.");
    } finally {
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

  it("recovers one converged Clarify-to-Task transition in the same provider session", async () => {
    const clarify = {
      ...clarifyCard("clarify-card-ready-for-task"),
      submitted: true,
      submittedSummary: "已确认 2 个分支维度",
      frontierLedger: {
        clarify_strength: "light" as const,
        grounded_user_decisions: ["用户已确认固定分支。"],
        remaining_material_user_owned_assumptions: [],
        agent_owned_assumptions: ["实现细节由 agent 决定。"],
        discoverable_assumptions: [],
        why_this_round: "已收敛到任务总览。",
        convergence_state: "ready_for_task" as const,
      },
    };
    const task = taskCard("task-card-recovered-after-clarify");
    const { session, emitted, runPrompts, replacedPrompts, cleanup } = createSession({
      hasInFlightRun: () => true,
      streamRuns: [
        nativeStream(
          { type: "turn_started", provider: "codex", turnId: "turn-1" },
          {
            type: "timeline",
            provider: "codex",
            turnId: "turn-1",
            item: { type: "clarify_card", card: clarify },
          },
          { type: "turn_completed", provider: "codex", turnId: "turn-1" },
        ),
        nativeStream(
          { type: "turn_started", provider: "codex", turnId: "turn-2" },
          {
            type: "timeline",
            provider: "codex",
            turnId: "turn-2",
            item: { type: "task_card", card: task },
          },
        ),
      ],
    });

    try {
      await session.handleSendRequest({
        type: "workspace_secretary.send.request",
        requestId: "send-recover-task-after-clarify",
        text: "实现一个高性能快速排序",
        uiAgentId: "draft-secretary",
        composer: {
          mode: "quick",
          clarifyStrength: "light",
          loop: null,
          authorityLabel: "Codex",
          authorityReady: true,
        },
      });
      await flushBackgroundTurns();

      expect(runPrompts).toHaveLength(1);
      expect(replacedPrompts).toHaveLength(1);
      expect(JSON.stringify(replacedPrompts[0])).toContain("thoth_submit_task_card");
      expect(JSON.stringify(replacedPrompts[0])).toContain("Do not submit a Goals Card");
      expect(lastWorkspaceModel(emitted).secretary.status.kind).not.toBe("recoverable_error");
    } finally {
      cleanup();
    }
  });

  it("keeps quick_exec state when a submitted Pyramid Plan timeline item is replayed", async () => {
    const card = goalCard("goal-card-quick");
    const task = {
      ...taskCard("task-card-quick"),
      submitted: true,
      submittedSummary: "已确认并按 Quick 前台执行",
    };
    const { session, cleanup } = createSession({
      streamRuns: [
        nativeStream(
          {
            type: "timeline",
            provider: "codex",
            turnId: "turn-1",
            item: { type: "task_card", card: task },
          },
          {
            type: "timeline",
            provider: "codex",
            turnId: "turn-1",
            item: { type: "goal_card", card },
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
