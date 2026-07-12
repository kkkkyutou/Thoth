import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  deriveWorkspaceSecretaryDraftTitleFromText,
  isWorkspaceSecretaryModelRunning,
  resolveWorkspaceSecretaryTurnInFlight,
  resolveWorkspaceSecretaryDraftTitleFromModel,
  shouldApplyWorkspaceSecretaryModelUpdateForDraft,
  shouldApplyWorkspaceSecretarySnapshotForDraft,
  shouldHydrateWorkspaceSecretarySnapshotForDraft,
  shouldKeepWorkspaceSecretaryAuthorityTurnRunning,
} from "@/composer/draft/workspace-tab-core";
import type { ThothCleanUiModel } from "@thoth/protocol/workspace-secretary/rpc-schemas";

describe("shouldHydrateWorkspaceSecretarySnapshotForDraft", () => {
  it("keeps a fresh New Agent draft empty instead of hydrating the workspace active topic", () => {
    expect(shouldHydrateWorkspaceSecretarySnapshotForDraft({})).toBe(false);
  });

  it("allows snapshot merge for a persisted draft bound to a Workspace Secretary topic", () => {
    expect(
      shouldHydrateWorkspaceSecretarySnapshotForDraft({
        secretaryTopicId: "topic-renderer",
      }),
    ).toBe(true);
  });
});

describe("shouldApplyWorkspaceSecretaryModelUpdateForDraft", () => {
  it("ignores workspace-wide model updates for a fresh New Agent draft", () => {
    expect(shouldApplyWorkspaceSecretaryModelUpdateForDraft({})).toBe(false);
  });

  it("rejects model updates when a local stream exists but the draft is still unbound", () => {
    expect(
      shouldApplyWorkspaceSecretaryModelUpdateForDraft({
        modelActiveTopicId: "topic-other",
      }),
    ).toBe(false);
  });

  it("rejects a stale workspace broadcast while this draft is beginning submission", () => {
    expect(
      shouldApplyWorkspaceSecretaryModelUpdateForDraft({
        modelActiveTopicId: "topic-other",
      }),
    ).toBe(false);
  });

  it("accepts model updates for a matching persisted Workspace Secretary topic binding", () => {
    expect(
      shouldApplyWorkspaceSecretaryModelUpdateForDraft({
        secretaryTopicId: "topic-renderer",
        modelActiveTopicId: "topic-renderer",
      }),
    ).toBe(true);
  });

  it("rejects model updates for a different Workspace Secretary topic binding", () => {
    expect(
      shouldApplyWorkspaceSecretaryModelUpdateForDraft({
        secretaryTopicId: "topic-renderer",
        modelActiveTopicId: "topic-other",
      }),
    ).toBe(false);
  });
});

describe("shouldApplyWorkspaceSecretarySnapshotForDraft", () => {
  it("rejects an unbound draft snapshot and accepts only a matching bound topic", () => {
    expect(
      shouldApplyWorkspaceSecretarySnapshotForDraft({ modelActiveTopicId: "topic-current" }),
    ).toBe(false);
    expect(
      shouldApplyWorkspaceSecretarySnapshotForDraft({
        secretaryTopicId: "topic-current",
        modelActiveTopicId: "topic-current",
      }),
    ).toBe(true);
  });

  it("rejects a snapshot from another topic", () => {
    expect(
      shouldApplyWorkspaceSecretarySnapshotForDraft({
        secretaryTopicId: "topic-current",
        modelActiveTopicId: "topic-stale",
      }),
    ).toBe(false);
  });
});

describe("Workspace Secretary draft title helpers", () => {
  it("derives a provisional draft title from the first non-empty prompt line", () => {
    expect(
      deriveWorkspaceSecretaryDraftTitleFromText("\n  实现一个高性能快速排序  \n补充说明"),
    ).toBe("实现一个高性能快速排序");
  });

  it("ignores generic daemon topic names when resolving model titles", () => {
    const model = createSecretaryModelWithTopicTitle("话题 2");

    expect(resolveWorkspaceSecretaryDraftTitleFromModel(model)).toBeNull();
  });

  it("uses the active model topic title once it is semantic", () => {
    const model = createSecretaryModelWithTopicTitle("实现高性能快速排序");

    expect(resolveWorkspaceSecretaryDraftTitleFromModel(model)).toBe("实现高性能快速排序");
  });

  it("treats loading clean model status as an in-flight provider turn", () => {
    expect(
      isWorkspaceSecretaryModelRunning({
        ...createSecretaryModelWithTopicTitle("实现高性能快速排序"),
        secretary: {
          ...createSecretaryModelWithTopicTitle("实现高性能快速排序").secretary,
          status: { kind: "loading", title: "loading", detail: "loading" },
        },
      }),
    ).toBe(true);
    expect(
      isWorkspaceSecretaryModelRunning(createSecretaryModelWithTopicTitle("实现高性能快速排序")),
    ).toBe(false);
  });
});

describe("resolveWorkspaceSecretaryTurnInFlight", () => {
  it("keeps an authority continuation running across a stale ready progress snapshot", () => {
    expect(
      resolveWorkspaceSecretaryTurnInFlight({
        current: true,
        model: createSecretaryModelWithTopicTitle("实现高性能快速排序"),
        reason: "provider_progress",
      }),
    ).toBe(true);
  });

  it("keeps a submitted card continuation running when the RPC response is ready but nonterminal", () => {
    expect(
      resolveWorkspaceSecretaryTurnInFlight({
        current: true,
        model: createSecretaryModelWithTopicTitle("实现高性能快速排序"),
      }),
    ).toBe(true);
  });

  it("stops only on an explicit provider terminal update", () => {
    expect(
      resolveWorkspaceSecretaryTurnInFlight({
        current: true,
        model: createSecretaryModelWithTopicTitle("实现高性能快速排序"),
        reason: "provider_turn_completed",
      }),
    ).toBe(false);
  });

  it("starts when the daemon reports loading", () => {
    const model = createSecretaryModelWithTopicTitle("实现高性能快速排序");
    model.secretary.status = { kind: "loading", title: "loading", detail: "loading" };

    expect(resolveWorkspaceSecretaryTurnInFlight({ current: false, model })).toBe(true);
  });
});

function createSecretaryModelWithTopicTitle(title: string): ThothCleanUiModel {
  return {
    authority: {
      source: "daemon_clean_ui_model",
      schemaVerified: true,
      label: "test",
    },
    activeView: "workspace-secretary",
    secretary: {
      workspaceName: "Thoth",
      workspacePath: "/repo",
      activeTopicId: "topic-main",
      topics: [{ id: "topic-main", title, status: "current", updatedLabel: "刚刚" }],
      status: { kind: "ready", title: "ready", detail: "ready" },
      turns: [],
      composer: {
        mode: "quick",
        clarifyStrength: "balanced",
        loop: null,
        authorityLabel: "Codex",
        authorityReady: true,
      },
    },
    settings: {
      runtime: [],
      relay: {
        endpoint: "relay.test.thoth.seeles.ai",
        healthUrl: "https://relay.test.thoth.seeles.ai/health",
        status: "checking",
        safeSummary: "checking",
        checkedAtLabel: "刚刚",
      },
      requiredRuntime: [],
    },
    backgroundTasks: {
      tasks: [],
    },
  };
}

function assistantItem(id: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: "正在拆解需求",
    timestamp: new Date(1000),
  };
}

function userItem(id: string): StreamItem {
  return {
    kind: "user_message",
    id,
    text: "实现一个渲染器",
    timestamp: new Date(1000),
  };
}

function runningToolItem(id: string, status: "running" | "completed" = "running"): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(1000),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: id,
        name: "Shell",
        status,
        error: null,
        detail: { type: "shell", command: "npm test", cwd: "/repo" },
      },
    },
  };
}

function clarifyCardItem(input?: { submitted?: boolean; submittedSummary?: string }): StreamItem {
  return {
    kind: "clarify_card",
    id: "clarify-card-item",
    timestamp: new Date(1000),
    card: {
      id: "clarify-card",
      roundLabel: "Clarify 1",
      title: "先定边界",
      whyNow: "会改变实现路线。",
      continuesClarify: true,
      submitted: input?.submitted ?? false,
      ...(input?.submittedSummary ? { submittedSummary: input.submittedSummary } : {}),
      card: {
        question_id: "q-card",
        title: "先定边界",
        behavior_tree_node: "boundary",
        why_now: "会改变实现路线。",
        allow_choice_notes: true,
        allow_note_only: true,
        questions: [
          {
            id: "language",
            question: "用什么语言？",
            behavior_tree_node: "language",
            selection_mode: "single",
            choices: [{ id: "python", label: "Python", description: "便于运行" }],
          },
        ],
      },
    },
  };
}

function taskCardItem(input?: { submitted?: boolean; submittedSummary?: string }): StreamItem {
  return {
    kind: "task_card",
    id: "task-card-item",
    timestamp: new Date(1000),
    card: {
      id: "task-card",
      roundLabel: "Task",
      title: "实现排序",
      goal: "实现可复用排序。",
      constraints: ["使用已确认语言。"],
      acceptance: ["测试通过。"],
      provenanceSummary: "基于 Clarify。",
      submitted: input?.submitted ?? false,
      ...(input?.submittedSummary ? { submittedSummary: input.submittedSummary } : {}),
    },
  };
}

function goalCardItem(input?: { submitted?: boolean }): StreamItem {
  return {
    kind: "goal_card",
    id: "goal-card-item",
    timestamp: new Date(1000),
    card: {
      id: "goal-card",
      roundLabel: "Plan",
      title: "排序目标树",
      summary: "目标层次。",
      pyramid: [],
      provenanceSummary: "基于 Task。",
      submitted: input?.submitted ?? false,
    },
  };
}

describe("shouldKeepWorkspaceSecretaryAuthorityTurnRunning", () => {
  it("uses the daemon in-flight state before the first authority card arrives", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretaryTurnInFlight: true,
        streamItems: [assistantItem("assistant-1")],
      }),
    ).toBe(true);
  });

  it("restores running from retained live tool state while a remounted tab hydrates", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretaryTurnInFlight: false,
        streamItems: [userItem("user-1"), runningToolItem("shell-1")],
      }),
    ).toBe(true);
  });

  it("does not treat a completed retained tool as live work", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretaryTurnInFlight: false,
        streamItems: [userItem("user-1"), runningToolItem("shell-1", "completed")],
      }),
    ).toBe(false);
  });

  it("does not turn a completed Direct conversation back into running after config changes", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretaryTurnInFlight: false,
        streamItems: [userItem("user-1"), assistantItem("assistant-1")],
      }),
    ).toBe(false);
  });

  it("ignores stale authority cards from before the latest user message", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretaryTurnInFlight: false,
        streamItems: [
          clarifyCardItem({ submitted: true, submittedSummary: "已确认 3 个分支维度" }),
          userItem("user-2"),
          assistantItem("assistant-2"),
        ],
      }),
    ).toBe(false);
  });

  it("does not infer a live turn from a submitted Clarify card without daemon or tool evidence", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretaryTurnInFlight: false,
        streamItems: [
          clarifyCardItem({ submitted: true, submittedSummary: "已确认 3 个分支维度" }),
        ],
      }),
    ).toBe(false);
  });

  it("stops keeping the turn running when Clarify was paused", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretaryTurnInFlight: false,
        streamItems: [clarifyCardItem({ submitted: true, submittedSummary: "已暂停继续询问" })],
      }),
    ).toBe(false);
  });

  it("stops keeping the turn running when the user interrupted it", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretaryTurnInFlight: false,
        streamItems: [
          clarifyCardItem({
            submitted: true,
            submittedSummary: "已中断当前请求，可继续输入。",
          }),
        ],
      }),
    ).toBe(false);
  });

  it("does not resurrect an expired Clarify card as a running turn after refresh", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretaryTurnInFlight: false,
        streamItems: [
          clarifyCardItem({
            submitted: true,
            submittedSummary: "这张询问已经失效；请使用当前 topic 最新显示的卡片。",
          }),
        ],
      }),
    ).toBe(false);
  });

  it("does not infer a live turn from a submitted Task card without daemon or tool evidence", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretaryTurnInFlight: false,
        streamItems: [taskCardItem({ submitted: true, submittedSummary: "已确认 Task" })],
      }),
    ).toBe(false);
  });

  it("does not keep running after a submitted Pyramid Plan card", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretaryTurnInFlight: false,
        streamItems: [goalCardItem({ submitted: true })],
      }),
    ).toBe(false);
  });
});
