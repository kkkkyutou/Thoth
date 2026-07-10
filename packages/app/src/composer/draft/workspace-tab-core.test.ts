import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  deriveWorkspaceSecretaryDraftTitleFromText,
  isWorkspaceSecretaryModelRunning,
  resolveWorkspaceSecretaryDraftTitleFromModel,
  shouldHydrateWorkspaceSecretarySnapshotForDraft,
  shouldKeepWorkspaceSecretaryAuthorityTurnRunning,
} from "@/composer/draft/workspace-tab-core";
import type { ThothCleanUiModel } from "@thoth/protocol/workspace-secretary/rpc-schemas";

describe("shouldHydrateWorkspaceSecretarySnapshotForDraft", () => {
  it("keeps a fresh New Agent draft empty instead of hydrating the workspace active topic", () => {
    expect(shouldHydrateWorkspaceSecretarySnapshotForDraft({ localStreamItemCount: 0 })).toBe(
      false,
    );
  });

  it("allows snapshot merge once the draft already owns local secretary stream items", () => {
    expect(shouldHydrateWorkspaceSecretarySnapshotForDraft({ localStreamItemCount: 1 })).toBe(true);
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
  it("keeps a non-none Clarify draft running before the first authority card arrives", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretarySubmitted: true,
        secretarySubmitting: false,
        clarifyStrength: "dive",
        streamItems: [assistantItem("assistant-1")],
      }),
    ).toBe(true);
  });

  it("does not keep Quick + none running after ordinary assistant output", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretarySubmitted: true,
        secretarySubmitting: false,
        clarifyStrength: "none",
        streamItems: [assistantItem("assistant-1")],
      }),
    ).toBe(false);
  });

  it("keeps a submitted Clarify card running while the next Clarify or Task card is expected", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretarySubmitted: true,
        secretarySubmitting: false,
        clarifyStrength: "dive",
        streamItems: [
          clarifyCardItem({ submitted: true, submittedSummary: "已确认 3 个分支维度" }),
        ],
      }),
    ).toBe(true);
  });

  it("stops keeping the turn running when Clarify was paused", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretarySubmitted: true,
        secretarySubmitting: false,
        clarifyStrength: "dive",
        streamItems: [clarifyCardItem({ submitted: true, submittedSummary: "已暂停继续询问" })],
      }),
    ).toBe(false);
  });

  it("keeps a submitted Task card running while the Pyramid Plan card is expected", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretarySubmitted: true,
        secretarySubmitting: false,
        clarifyStrength: "balanced",
        streamItems: [taskCardItem({ submitted: true, submittedSummary: "已确认 Task" })],
      }),
    ).toBe(true);
  });

  it("does not keep running after a submitted Pyramid Plan card", () => {
    expect(
      shouldKeepWorkspaceSecretaryAuthorityTurnRunning({
        secretarySubmitted: true,
        secretarySubmitting: false,
        clarifyStrength: "balanced",
        streamItems: [goalCardItem({ submitted: true })],
      }),
    ).toBe(false);
  });
});
