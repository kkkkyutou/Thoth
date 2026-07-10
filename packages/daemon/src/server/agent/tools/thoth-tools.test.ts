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
        config: {
          provider: "codex",
          cwd: "/tmp/thoth-tool-test",
          extra: { codex: { thothClarifyRuntimeTools: true } },
        },
      }) as ManagedAgent,
  } as unknown as AgentManager;

  return {
    appendTimelineItem,
    catalog: createThothToolCatalog({
      agentManager,
      agentStorage: {} as AgentStorage,
      terminalManager: null,
      providerSnapshotManager: {} as ProviderSnapshotManager,
      logger: createTestLogger(),
      callerAgentId: "agent-1",
    }),
  };
}

function readyConvergenceReview() {
  return {
    frontier_ledger: {
      clarify_strength: "light",
      grounded_user_decisions: ["用户确认语言和交付形态。"],
      remaining_material_user_owned_assumptions: [],
      agent_owned_assumptions: ["实现细节由 agent 决定。"],
      discoverable_assumptions: ["测试命令从仓库发现。"],
      why_this_round: "已足够形成任务总览。",
      convergence_state: "ready_for_task",
    },
    why_task_is_now_grounded: "关键用户决策已经确认，剩余都是 agent 可决定或可发现事项。",
  };
}

function takeOnlyPendingCardId(): string {
  const pending = listPendingRuntimeAuthorityDecisions();
  expect(pending).toHaveLength(1);
  return pending[0]!.cardId;
}

async function submitAnsweredClarifyCard(
  catalog: ReturnType<typeof createCatalog>["catalog"],
  strength: "light" | "balanced" | "dive",
): Promise<void> {
  const toolResult = catalog.executeTool(
    "thoth_submit_clarify_card",
    {
      title: "确认目标边界",
      why_now: "这些选择会改变实现路线和验收边界。",
      public_badge_summary: "正在拆解目标边界：确认路线、接口和验收的材料分支。",
      frontier_ledger: {
        clarify_strength: strength,
        grounded_user_decisions: [],
        remaining_material_user_owned_assumptions: ["实现路线", "接口形态", "验收边界"],
        agent_owned_assumptions: ["具体实现策略由 agent 决定。"],
        discoverable_assumptions: ["仓库测试命令可发现。"],
        why_this_round: "这些答案决定任务合同边界。",
        convergence_state: "not_converged",
      },
      questions: [
        {
          id: "route",
          question: "这次优先交付哪类结果？",
          choices: [
            { id: "library", label: "库函数", description: "最小复用接口" },
            { id: "cli", label: "命令行", description: "可传参运行" },
          ],
        },
        {
          id: "interface",
          question: "接口更偏向哪种使用方式？",
          choices: [
            { id: "simple", label: "简单调用", description: "默认路径清晰" },
            { id: "config", label: "可配置", description: "保留参数入口" },
          ],
        },
        {
          id: "acceptance",
          question: "验收更看重什么？",
          choices: [
            { id: "correctness", label: "正确性", description: "覆盖边界输入" },
            { id: "benchmark", label: "性能基准", description: "给出耗时对比" },
          ],
        },
      ],
    },
    {
      providerToolCall: {
        provider: "codex",
        threadId: "thread-1",
        turnId: "turn-1",
        callId: `call-clarify-${strength}`,
        toolName: "thoth_submit_clarify_card",
      },
    },
  );
  await flushToolStart();
  const cardId = takeOnlyPendingCardId();
  answerRuntimeAuthorityDecision({
    cardId,
    submittedSummary: "已确认 3 个材料分支",
    answer: {
      intent: "submit_choices",
      card_id: cardId,
      title: "确认目标边界",
      raw_answer: "选择第一项",
    },
  });
  await toolResult;
}

afterEach(() => {
  resetRuntimeAuthorityDecisionsForTest();
});

describe("Thoth runtime authority tools", () => {
  it("registers Clarify tools from launch config before the caller agent is registered", () => {
    const agentManager = {
      appendTimelineItem: vi.fn(async () => undefined),
      getAgent: () => null,
    } as unknown as AgentManager;
    const catalog = createThothToolCatalog({
      agentManager,
      agentStorage: {} as AgentStorage,
      terminalManager: null,
      providerSnapshotManager: {} as ProviderSnapshotManager,
      logger: createTestLogger(),
      callerAgentId: "agent-launching",
      callerAgentConfig: {
        extra: { codex: { thothClarifyRuntimeTools: true } },
      },
    });

    expect(catalog.getTool("thoth_submit_clarify_card")).toBeDefined();
    expect(catalog.getTool("thoth_submit_task_card")).toBeDefined();
    expect(catalog.getTool("thoth_submit_goals_card")).toBeDefined();
    expect(catalog.getTool("thoth_report_blocked")).toBeDefined();
  });

  it("returns Task approval as a Goals Card handoff instead of Quick execution", async () => {
    const { catalog } = createCatalog();
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
        convergence_review: readyConvergenceReview(),
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
    expect(text).toContain("Next required runtime tool: thoth_submit_goals_card.");
    expect(text).toContain("Submit the Goals Card");
    expect(text).toContain("Do not execute yet.");
    expect(text).not.toContain("Continue in the same turn with normal execution.");
  });

  it("requires an explicit convergence review when Task is submitted below a strength soft target", async () => {
    const { catalog } = createCatalog();
    await expect(
      catalog.executeTool(
        "thoth_submit_task_card",
        {
          task_card: {
            title: "实现高性能快速排序",
            goal: "实现一个可复用的高性能快速排序。",
            constraints: ["保持用户选择的语言和交付形态。"],
            acceptance: ["正确性测试通过。", "性能基准可运行。"],
          },
          provenance: {
            clarify_transcript_verbatim: "用户确认了部分边界。",
          },
          convergence_review: {
            frontier_ledger: {
              clarify_strength: "dive",
              grounded_user_decisions: ["用户确认 C++。"],
              remaining_material_user_owned_assumptions: [],
              agent_owned_assumptions: ["pivot 策略由 agent 决定。"],
              discoverable_assumptions: ["测试命令可发现。"],
              why_this_round: "模型认为已可收敛。",
              convergence_state: "ready_for_task",
            },
            why_task_is_now_grounded: "模型认为剩余事项都不是用户材料决策。",
          },
        },
        {
          providerToolCall: {
            provider: "codex",
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "call-task-low-target",
            toolName: "thoth_submit_task_card",
          },
        },
      ),
    ).rejects.toThrow("Clarify soft target not reviewed");
  });

  it("rejects Task convergence reviews that downgrade the latest Clarify strength", async () => {
    const { catalog } = createCatalog();
    await submitAnsweredClarifyCard(catalog, "dive");

    await expect(
      catalog.executeTool(
        "thoth_submit_task_card",
        {
          task_card: {
            title: "实现高性能快速排序",
            goal: "实现一个可复用的高性能快速排序。",
            constraints: ["保持用户选择的语言和交付形态。"],
            acceptance: ["正确性测试通过。", "性能基准可运行。"],
          },
          provenance: {
            clarify_transcript_verbatim: "用户确认了部分边界。",
          },
          convergence_review: {
            frontier_ledger: {
              clarify_strength: "light",
              grounded_user_decisions: ["用户确认 C++。"],
              remaining_material_user_owned_assumptions: [],
              agent_owned_assumptions: ["pivot 策略由 agent 决定。"],
              discoverable_assumptions: ["测试命令可发现。"],
              why_this_round: "模型试图以 light 强度收敛。",
              convergence_state: "ready_for_task",
            },
            why_task_is_now_grounded: "模型认为剩余事项都不是用户材料决策。",
          },
        },
        {
          providerToolCall: {
            provider: "codex",
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "call-task-strength-mismatch",
            toolName: "thoth_submit_task_card",
          },
        },
      ),
    ).rejects.toThrow("Clarify convergence review strength mismatch");
  });

  it("returns Goals Card approval as the Quick execution handoff", async () => {
    const { catalog } = createCatalog();
    const toolResult = catalog.executeTool(
      "thoth_submit_goals_card",
      {
        goals_card: {
          title: "高性能快速排序",
          summary: "按线性目标完成实现、验证和基准。",
          goals_count_rationale: "这是单元测试级小任务，单个目标已经足够细粒度、线性且可 review。",
          goals: [
            {
              id: "goal-1",
              order: 1,
              title: "排序能力",
              goal: "提供可复用排序能力。",
              constraints: ["保持接口清晰。"],
              acceptance: ["排序结果正确。"],
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
          callId: "call-goals",
          toolName: "thoth_submit_goals_card",
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
    expect(text).not.toContain("Next required runtime tool: thoth_submit_goals_card.");
  });

  it("uses public_badge_summary for Clarify timeline badges instead of legacy decision text", async () => {
    const { catalog, appendTimelineItem } = createCatalog();
    const toolResult = catalog.executeTool(
      "thoth_submit_clarify_card",
      {
        title: "确认排序目标边界",
        why_now: "这些选择会改变接口、性能基线和验收方式。",
        decision_it_changes: "legacy internal generic decision text",
        public_badge_summary: "正在拆解排序需求：先确认语言、交付形态和性能验收的材料分支。",
        frontier_ledger: {
          clarify_strength: "dive",
          grounded_user_decisions: [],
          remaining_material_user_owned_assumptions: ["语言", "交付形态", "性能基线"],
          agent_owned_assumptions: ["具体 pivot 策略后续由 agent 决定。"],
          discoverable_assumptions: ["仓库测试框架可由 agent 发现。"],
          why_this_round: "这些答案决定后续实现路线和验收边界。",
          convergence_state: "not_converged",
        },
        questions: [
          {
            id: "language",
            question: "用什么语言实现？",
            choices: [
              { id: "cpp", label: "C++", description: "贴近系统性能" },
              { id: "rust", label: "Rust", description: "安全且高性能" },
            ],
          },
          {
            id: "shape",
            question: "最终交付成什么形态？",
            choices: [
              { id: "library", label: "库函数", description: "最小复用接口" },
              { id: "cli", label: "命令行", description: "可传参运行" },
            ],
          },
          {
            id: "baseline",
            question: "性能用什么方式验收？",
            choices: [
              { id: "bench", label: "跑基准", description: "给出耗时对比" },
              { id: "tests", label: "测正确性", description: "正确性优先" },
            ],
          },
        ],
      },
      {
        providerToolCall: {
          provider: "codex",
          threadId: "thread-1",
          turnId: "turn-1",
          callId: "call-clarify",
          toolName: "thoth_submit_clarify_card",
        },
      },
    );
    await flushToolStart();

    const runningToolCall = appendTimelineItem.mock.calls.find(
      ([, item]) => item.type === "tool_call" && item.callId === "call-clarify",
    )?.[1];
    expect(runningToolCall).toMatchObject({
      detail: {
        label: "需求拆解",
        text: "正在拆解排序需求：先确认语言、交付形态和性能验收的材料分支。",
      },
      metadata: {
        pendingAuthorityDecision: true,
        roundIndex: 1,
      },
    });
    expect(JSON.stringify(runningToolCall)).not.toContain("legacy internal generic decision text");

    const cardId = takeOnlyPendingCardId();
    answerRuntimeAuthorityDecision({
      cardId,
      submittedSummary: "已确认 3 个分支维度",
      answer: {
        intent: "submit_choices",
        card_id: cardId,
        title: "确认排序目标边界",
        raw_answer: "选择第一项",
      },
    });
    await toolResult;
  });
});
