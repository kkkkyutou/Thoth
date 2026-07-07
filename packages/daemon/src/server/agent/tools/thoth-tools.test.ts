import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentManager, ManagedAgent } from "../agent-manager.js";
import type { AgentStorage } from "../agent-storage.js";
import type { ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import {
  answerRuntimeAuthorityDecision,
  listPendingRuntimeAuthorityDecisions,
  resetRuntimeAuthorityDecisionsForTest,
} from "../runtime-tool-decisions.js";
import { createThothToolCatalog } from "./thoth-tools.js";

async function flushToolStart(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createCatalog() {
  const appendTimelineItem = vi.fn(async () => undefined);
  const agentManager = {
    appendTimelineItem,
    getAgent: () =>
      ({
        id: "agent-1",
        provider: "codex",
        cwd: "/tmp/thoth-tool-test",
        labels: { topicId: "topic-main" },
        config: { provider: "codex", cwd: "/tmp/thoth-tool-test" },
      }) as ManagedAgent,
  } as unknown as AgentManager;

  return createThothToolCatalog({
    agentManager,
    agentStorage: {} as AgentStorage,
    terminalManager: null,
    providerSnapshotManager: {} as ProviderSnapshotManager,
    logger: createTestLogger(),
    callerAgentId: "agent-1",
  });
}

function takeOnlyPendingCardId(): string {
  const pending = listPendingRuntimeAuthorityDecisions();
  expect(pending).toHaveLength(1);
  return pending[0]!.cardId;
}

afterEach(() => {
  resetRuntimeAuthorityDecisionsForTest();
});

describe("Thoth runtime authority tools", () => {
  it("returns Task approval as a Pyramid Plan handoff instead of Quick execution", async () => {
    const catalog = createCatalog();
    const toolResult = catalog.executeTool(
      "thoth_submit_task_card",
      {
        task_card: {
          title: "实现高性能快速排序",
          goal: "实现一个可复用的高性能快速排序。",
          constraints: ["保持用户选择的语言和交付形态。"],
          acceptance: ["正确性测试通过。", "性能基准可运行。"],
        },
        provenance: {
          clarify_transcript_verbatim: "用户确认了语言、交付形态和验收边界。",
        },
      },
      {
        providerToolCall: {
          provider: "codex",
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-task",
          toolName: "thoth_submit_task_card",
        },
      },
    );
    await flushToolStart();

    const cardId = takeOnlyPendingCardId();
    answerRuntimeAuthorityDecision({
      cardId,
      submittedSummary: "已确认并保持 Quick",
      answer: {
        intent: "accept_quick",
        card_id: cardId,
        title: "实现高性能快速排序",
        raw_answer: "确认按 Quick 前台执行",
      },
    });

    const result = await toolResult;
    const text = result.content.map((item) => item.text ?? "").join("\n");
    expect(text).toContain("Next required runtime tool: thoth_submit_pyramid_plan.");
    expect(text).toContain("Do not execute yet.");
    expect(text).not.toContain("Continue in the same turn with normal execution.");
  });

  it("returns Pyramid Plan approval as the Quick execution handoff", async () => {
    const catalog = createCatalog();
    const toolResult = catalog.executeTool(
      "thoth_submit_pyramid_plan",
      {
        pyramid_plan: {
          title: "高性能快速排序",
          summary: "按目标层次完成实现、验证和基准。",
          pyramid: [
            {
              id: "stage-1",
              title: "排序能力",
              goal: "提供可复用排序能力。",
              acceptance: ["排序结果正确。"],
              subgoals: [
                {
                  id: "subgoal-1",
                  title: "泛型接口",
                  goal: "暴露清晰接口。",
                  acceptance: ["调用方可复用。"],
                },
              ],
            },
          ],
        },
        provenance: {
          clarify_transcript_verbatim: "完整 Clarify 原文。",
          approved_ceo_task_card_verbatim: "已确认 Task Card 原文。",
        },
      },
      {
        providerToolCall: {
          provider: "codex",
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-pyramid",
          toolName: "thoth_submit_pyramid_plan",
        },
      },
    );
    await flushToolStart();

    const cardId = takeOnlyPendingCardId();
    answerRuntimeAuthorityDecision({
      cardId,
      submittedSummary: "已确认并按 Quick 前台执行",
      answer: {
        intent: "accept_quick",
        card_id: cardId,
        title: "高性能快速排序",
        raw_answer: "确认按 Quick 前台执行",
      },
    });

    const result = await toolResult;
    const text = result.content.map((item) => item.text ?? "").join("\n");
    expect(text).toContain("executing the approved task in the current workspace");
    expect(text).toContain("create or edit the necessary files and verify the result");
    expect(text).not.toContain("Next required runtime tool: thoth_submit_pyramid_plan.");
  });
});
