import { describe, expect, it } from "vitest";
import {
  SecretaryClarifyAnswerPayloadSchema,
  ThothCleanUiModelSchema,
  WorkspaceSecretaryAnswerRequestSchema,
  WorkspaceSecretaryCancelRequestSchema,
  WorkspaceSecretaryCancelResponseSchema,
  WorkspaceSecretaryModelUpdateSchema,
  WorkspaceSecretarySendRequestSchema,
  WorkspaceSecretarySnapshotRequestSchema,
  WorkspaceSecretarySnapshotResponseSchema,
} from "./rpc-schemas.js";

function createModel() {
  const providerRuntime = {
    configured: true,
    ready: true,
    state: "ready",
    bridge: "native_output_schema",
    provider: "codex",
    model: "gpt-5.1",
    mode: "standard",
    safeLabel: "codex / gpt-5.1",
    detail: "使用原生 outputSchema。",
  };
  return {
    authority: {
      source: "provider_backed_clean_ui_model",
      schemaVerified: true,
      label: "Provider-backed Workspace Secretary clean UI model",
    },
    activeView: "workspace-secretary",
    secretary: {
      workspaceName: "Thoth workspace",
      workspacePath: "/workspace/thoth",
      topics: [
        { id: "topic-main", title: "当前需求收敛", status: "current", updatedLabel: "刚刚" },
      ],
      activeTopicId: "topic-main",
      status: {
        kind: "ready",
        title: "真实 provider 已连接",
        detail: "Quick 和 Loop 都会通过真实 provider 结果写入历史。",
      },
      turns: [
        {
          id: "turn-direct",
          kind: "message",
          speaker: "secretary",
          text: "我在。继续说你想推进的事。",
        },
        {
          id: "turn-card",
          kind: "clarify_card",
          card: {
            id: "clarify-card-1",
            roundLabel: "Clarify 1",
            title: "先定这条需求分叉",
            whyNow: "这一次只需要切清楚路线和验收证据。",
            continuesClarify: true,
            submitted: false,
            card: {
              question_id: "clarify-card-workspace-secretary-1",
              title: "先定这条需求分叉",
              behavior_tree_node: "workspace_secretary_branch",
              why_now: "这一次只需要切清楚路线和验收证据。",
              allow_choice_notes: true,
              allow_note_only: true,
              questions: [
                {
                  id: "branch-route",
                  question: "这轮更像哪条路线？",
                  behavior_tree_node: "branch_route",
                  choices: [
                    { id: "visible", label: "先可见", description: "先把体验跑通" },
                    { id: "product", label: "产品级", description: "收紧体验边界" },
                  ],
                },
                {
                  id: "branch-proof",
                  question: "用什么证明它成立？",
                  behavior_tree_node: "branch_proof",
                  choices: [
                    { id: "tests", label: "测试", description: "看断言和命令" },
                    { id: "review", label: "审查", description: "看边界与残留" },
                  ],
                },
              ],
            },
          },
        },
      ],
      composer: {
        mode: "quick",
        clarifyStrength: "balanced",
        loop: null,
        authorityLabel: "codex / gpt-5.1",
        authorityReady: true,
      },
      provider: providerRuntime,
      deprecatedLiveEvents: [
        {
          id: "event-provider-turn-completed",
          kind: "provider_turn_completed",
          title: "真实 provider 回复已校验",
          status: "completed",
        },
      ],
    },
    settings: {
      runtime: [
        { id: "provider", title: "Workspace Secretary provider", value: "codex / gpt-5.1" },
        { id: "bridge", title: "Structured channel", value: "native_output_schema" },
      ],
      relay: {
        endpoint: "relay.test.thoth.seeles.ai",
        healthUrl: "https://relay.test.thoth.seeles.ai/health",
        status: "checking",
        safeSummary: "正在检查真实测试服务",
        checkedAtLabel: "2026-07-04T00:00:00Z",
      },
      requiredRuntime: [
        {
          id: "clarify-secretary",
          title: "Clarify secretary",
          value: "必需，不能关闭",
          locked: true,
        },
      ],
      workspaceSecretaryProvider: providerRuntime,
    },
    backgroundTasks: {
      tasks: [{ id: "empty", title: "还没有后台任务", status: "empty", summary: "等待确认" }],
    },
  };
}

describe("workspace secretary RPC schemas", () => {
  it("accepts secretary send requests with message id, images, and structured attachments", () => {
    const parsed = WorkspaceSecretarySendRequestSchema.parse({
      type: "workspace_secretary.send.request",
      requestId: "req-send",
      workspaceId: "workspace-1",
      workspacePath: "/workspace/thoth",
      topicId: "topic-main",
      text: "clarify this",
      messageId: "msg-1",
      images: [{ data: "base64", mimeType: "image/png" }],
      attachments: [
        {
          type: "text",
          mimeType: "text/plain",
          title: "Context",
          text: "Important context",
        },
      ],
      composer: {
        mode: "quick",
        clarifyStrength: "light",
        loop: null,
        authorityLabel: "codex",
        authorityReady: true,
      },
    });

    expect(parsed.messageId).toBe("msg-1");
    expect(parsed).toMatchObject({
      workspaceId: "workspace-1",
      workspacePath: "/workspace/thoth",
      topicId: "topic-main",
    });
    expect(parsed.images).toEqual([{ data: "base64", mimeType: "image/png" }]);
    expect(parsed.attachments).toHaveLength(1);
  });

  it("accepts provider-backed clean UI models without raw runtime packet fields", () => {
    const model = ThothCleanUiModelSchema.parse(createModel());

    expect(model.authority.source).toBe("provider_backed_clean_ui_model");
    expect(JSON.stringify(model)).not.toMatch(/C_ASK|raw JSON|provider role|repair/);
  });

  it("accepts an optional provider timeline reference for virtual secretary-tab recovery", () => {
    const input = createModel();
    input.secretary.timelineAgentId = "provider-agent-topic-main";
    input.secretary.turns[0] = {
      ...input.secretary.turns[0],
      messageId: "user-message-1",
    };

    const model = ThothCleanUiModelSchema.parse(input);

    expect(model.secretary.timelineAgentId).toBe("provider-agent-topic-main");
    expect(model.secretary.turns[0]).toMatchObject({ messageId: "user-message-1" });
  });

  it("accepts deprecated clean-event compatibility updates without raw provider payloads", () => {
    const model = createModel();
    model.secretary.turns = [
      {
        id: "turn-user",
        kind: "message",
        speaker: "user",
        text: "hi",
      },
    ];
    model.secretary.deprecatedLiveEvents = [
      {
        id: "event-secretary-draft",
        kind: "secretary_reply_delta",
        title: "秘书正在起草回复",
        detail: "我在，继续说你想推进的事。",
        status: "running",
      },
    ];
    const update = WorkspaceSecretaryModelUpdateSchema.parse({
      type: "workspace_secretary.model.update",
      payload: {
        model,
        reason: "provider_reply_delta",
      },
    });

    expect(update.payload.model.secretary.deprecatedLiveEvents?.[0]?.kind).toBe(
      "secretary_reply_delta",
    );
    expect(JSON.stringify(update)).not.toMatch(/raw JSON|schema error|provider role|C_DIRECT/);
  });

  it("still parses legacy liveEvents for old payload compatibility", () => {
    const model = createModel();
    delete (model.secretary as { deprecatedLiveEvents?: unknown }).deprecatedLiveEvents;
    model.secretary.liveEvents = [
      {
        id: "event-legacy",
        kind: "provider_turn_started",
        title: "Legacy provider event",
        status: "running",
      },
    ];

    const parsed = ThothCleanUiModelSchema.parse(model);

    expect(parsed.secretary.liveEvents?.[0]?.kind).toBe("provider_turn_started");
  });

  it("accepts provider-required status with a disabled composer", () => {
    const model = createModel();
    model.authority = {
      source: "daemon_clean_ui_model",
      schemaVerified: true,
      label: "Daemon Workspace Secretary runtime status model",
    };
    model.secretary.status = {
      kind: "provider_required",
      title: "需要配置真实 provider",
      detail: "Workspace Secretary 不会生成本地假回复或保存待发送草稿。",
      actionLabel: "打开 Settings",
    };
    model.secretary.turns = [];
    model.secretary.composer = {
      mode: "quick",
      clarifyStrength: "balanced",
      loop: null,
      authorityLabel: "需要真实 provider",
      authorityReady: false,
      disabledReason: "需要先在 Settings 配置真实 provider",
    };
    model.secretary.provider = {
      configured: false,
      ready: false,
      state: "not_configured",
      safeLabel: "未配置",
      detail: "Settings 需要选择真实 provider。",
    };
    model.settings.workspaceSecretaryProvider = model.secretary.provider;

    const parsed = ThothCleanUiModelSchema.parse(model);

    expect(parsed.secretary.status.kind).toBe("provider_required");
    expect(parsed.secretary.composer.authorityReady).toBe(false);
  });

  it("accepts first-class clarify answer intents including stop", () => {
    const answer = SecretaryClarifyAnswerPayloadSchema.parse({
      intent: "stop",
      question_card_id: "clarify-card-workspace-secretary-1",
      title: "先定这条需求分叉",
      answers: [
        {
          question_id: "branch-route",
          choice_ids: [],
          choice_notes: {},
        },
      ],
      raw_answer: "停止 Clarify",
    });

    expect(answer.intent).toBe("stop");
  });

  it("validates request and response wire shapes", () => {
    const snapshotRequest = WorkspaceSecretarySnapshotRequestSchema.parse({
      type: "workspace_secretary.snapshot.request",
      requestId: "req-snapshot",
      workspacePath: "/repo",
      topicId: "topic-main",
    });
    const response = WorkspaceSecretarySnapshotResponseSchema.parse({
      type: "workspace_secretary.snapshot.response",
      payload: {
        requestId: "req-1",
        model: createModel(),
        error: null,
      },
    });
    const request = WorkspaceSecretaryAnswerRequestSchema.parse({
      type: "workspace_secretary.answer.request",
      requestId: "req-2",
      workspaceId: "workspace-1",
      workspacePath: "/workspace/thoth",
      topicId: "topic-main",
      cardId: "clarify-card-1",
      answer: {
        intent: "decide",
        question_card_id: "clarify-card-workspace-secretary-1",
        title: "先定这条需求分叉",
        answers: [
          {
            question_id: "branch-route",
            choice_ids: [],
            choice_notes: {},
          },
        ],
        raw_answer: "你决定",
      },
    });

    expect(snapshotRequest.topicId).toBe("topic-main");
    expect(response.payload.model?.activeView).toBe("workspace-secretary");
    expect(request.answer.intent).toBe("decide");
    expect(request.topicId).toBe("topic-main");
  });

  it("accepts Workspace Secretary cancel request and response wire shapes", () => {
    const request = WorkspaceSecretaryCancelRequestSchema.parse({
      type: "workspace_secretary.cancel.request",
      requestId: "req-cancel",
      workspaceId: "workspace-1",
      workspacePath: "/workspace/thoth",
      uiAgentId: "draft-tab-1",
      topicId: "topic-main",
    });
    const response = WorkspaceSecretaryCancelResponseSchema.parse({
      type: "workspace_secretary.cancel.response",
      payload: {
        requestId: "req-cancel",
        model: createModel(),
        error: null,
      },
    });

    expect(request.uiAgentId).toBe("draft-tab-1");
    expect(request.workspaceId).toBe("workspace-1");
    expect(response.payload.model?.secretary.status.kind).toBe("ready");
  });

  it("keeps Loop budget and evidence wait states visible in background task summaries", () => {
    const model = createModel();
    model.backgroundTasks.tasks = [
      {
        id: "loop-budget-wait",
        title: "Budgeted task",
        status: "budget_wait",
        summary: "Waiting for a budget decision.",
      },
      {
        id: "loop-evidence-invalid",
        title: "Evidence task",
        status: "evidence_invalid",
        summary: "Workspace evidence needs attention.",
      },
      {
        id: "loop-workspace-changed",
        title: "Concurrent workspace task",
        status: "workspace_changed_concurrently",
        summary: "The workspace changed outside the phase.",
      },
    ];

    const parsed = ThothCleanUiModelSchema.parse(model);

    expect(parsed.backgroundTasks.tasks.map((task) => task.status)).toEqual([
      "budget_wait",
      "evidence_invalid",
      "workspace_changed_concurrently",
    ]);
  });
});
