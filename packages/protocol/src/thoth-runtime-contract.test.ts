import { describe, expect, it } from "vitest";
import {
  ClarifyAnswerPacketSchema,
  ClarifyConvergenceAuditSchema,
  ClarifyDecisionDeltaSchema,
  ClarificationCardCandidateSchema,
  ClarifyRepairInputPacketSchema,
  ClarifyQuestionCardSchema,
  ClarifyRuntimePacketSchema,
  ClarifySessionStartInputPacketSchema,
  ClarifyTransitionInputPacketSchema,
  ClarifyTurnInputPacketSchema,
  LoopRuntimePacketSchema,
  ProviderQuestionEventSchema,
  RuntimePacketCandidateSchema,
  THOTH_CLARIFY_CODES,
  THOTH_LOOP_CODES,
  THOTH_RUNTIME_PACKET_FIELDS,
  ThothSubmitClarifyCardInputSchema,
  ThothSubmitClarifyConvergenceAuditInputSchema,
  ThothSubmitContractPreservationAuditInputSchema,
  ThothSubmitGoalsCardInputSchema,
  ThothLoopPlanExecResultInputSchema,
  ThothLoopReviewVerdictInputSchema,
  ThothSubmitTaskCardInputSchema,
  ThothProviderInputEnvelopeSchema,
  ThothRuntimePacketSchema,
  isAllowedClarifyMechanicalTransition,
} from "./thoth-runtime-contract.js";

const clarifyQuestionCard = {
  question_id: "card_goal_route",
  title: "先定目标路线",
  behavior_tree_node: "goal_route",
  why_now: "先排除最容易做偏的路线。",
  questions: [
    {
      id: "q_goal_route",
      question: "这次最需要我优先切掉哪条错误路线？",
      behavior_tree_node: "goal_route",
      selection_mode: "single",
      choices: [
        {
          id: "production",
          label: "生产落地",
          description: "按真实交付闭环",
        },
        {
          id: "research",
          label: "研究验证",
          description: "先证明关键假设",
        },
      ],
    },
    {
      id: "q_owner",
      question: "哪些判断应该由我直接决定？",
      behavior_tree_node: "assumption_owner",
      selection_mode: "single",
      choices: [
        {
          id: "agent",
          label: "你决定",
          description: "技术细节你定",
        },
        {
          id: "ask",
          label: "先问我",
          description: "偏好风险问我",
        },
      ],
    },
  ],
  allow_choice_notes: true,
  allow_note_only: true,
};

const clarifyAskMeta = {
  effective_clarify_strength: "balanced",
  decision_tree_depth: 1,
  qa_round_count: 1,
  remaining_material_assumptions: [
    {
      id: "goal_route",
      owner: "user_must_decide",
      summary: "目标路线会改变后续 Task Card。",
      impact: "high",
    },
  ],
  question_value_reason: "当前最高价值分叉会排除做偏路线。",
};

const readyFrontierLedger = {
  clarify_strength: "balanced",
  grounded_user_decisions: ["用户确认目标路线。"],
  remaining_material_user_owned_assumptions: [],
  agent_owned_assumptions: ["技术细节由 agent 决定。"],
  discoverable_assumptions: ["仓库测试命令可发现。"],
  why_this_round: "已完成关键材料分支确认。",
  convergence_state: "ready_for_task",
};

const skillRef = {
  id: "thoth.clarify",
  digest: `sha256:${"a".repeat(64)}`,
};

describe("thoth runtime contract", () => {
  it("keeps clarify and loop state code sets under ten entries", () => {
    expect(THOTH_CLARIFY_CODES).toHaveLength(7);
    expect(THOTH_LOOP_CODES).toHaveLength(8);
  });

  it("keeps runtime packet top-level fields compact", () => {
    expect(THOTH_RUNTIME_PACKET_FIELDS).toEqual([
      "type",
      "code",
      "session_id",
      "task_id",
      "content",
      "ui",
      "next",
      "errors",
    ]);
    expect(THOTH_RUNTIME_PACKET_FIELDS.length).toBeLessThan(10);
  });

  it("parses a direct quick clarify packet", () => {
    expect(
      ClarifyRuntimePacketSchema.parse({
        type: "clarify",
        code: "C_DIRECT",
        session_id: "sec_123",
        task_id: null,
        content: {
          message: "Hi. What should we work on in this workspace?",
          receipt: null,
        },
        ui: {
          kind: "message",
          text: "Hi. What should we work on in this workspace?",
        },
        next: "C_DIRECT",
        errors: [],
      }),
    ).toMatchObject({
      type: "clarify",
      code: "C_DIRECT",
      ui: { kind: "message" },
      next: "C_DIRECT",
    });
  });

  it("keeps provider questions separate from permission and packet candidates", () => {
    const providerQuestion = ProviderQuestionEventSchema.parse({
      type: "provider_question_event",
      provider: "claude",
      provider_session_id: "provider-session-1",
      transport: "claude_ask_user_question",
      authority_kind: "question",
      prompt: "这次验收更偏真实设备还是源码边界？",
      choices: [
        { id: "device", label: "真实设备", description: "先看端上结果" },
        { id: "source", label: "源码边界", description: "先看约束落实" },
      ],
    });

    expect(
      ClarificationCardCandidateSchema.parse({
        type: "clarification_card_candidate",
        source: "provider_question_event",
        provider_event: providerQuestion,
        card: clarifyQuestionCard,
        accepted: true,
      }).accepted,
    ).toBe(true);

    expect(() =>
      ClarificationCardCandidateSchema.parse({
        type: "clarification_card_candidate",
        source: "provider_question_event",
        provider_event: {
          ...providerQuestion,
          authority_kind: "permission",
        },
        card: clarifyQuestionCard,
        accepted: false,
      }),
    ).toThrow(/only provider question events/);
  });

  it("parses runtime packet candidates from structured provider channels", () => {
    const packet = ClarifyRuntimePacketSchema.parse({
      type: "clarify",
      code: "C_DIRECT",
      session_id: "sec_123",
      task_id: null,
      content: {
        message: "我在。继续说你想推进的事。",
      },
      ui: {
        kind: "message",
        text: "我在。继续说你想推进的事。",
      },
      next: "C_DIRECT",
      errors: [],
    });

    expect(
      RuntimePacketCandidateSchema.parse({
        type: "runtime_packet_candidate",
        source: "native_output_schema",
        provider: "codex",
        provider_session_id: "provider-session-2",
        packet,
        schema_verified: true,
      }).schema_verified,
    ).toBe(true);
  });

  it("parses a pyramid plan card after task overview approval", () => {
    const parsed = ClarifyRuntimePacketSchema.parse({
      type: "clarify",
      code: "C_GOAL_CARD",
      session_id: "sec_123",
      task_id: null,
      content: {
        goal_card: {
          title: "整理设置页账号安全区域",
          summary: "按金字塔层次拆出目标、阶段和验收。",
          pyramid: [
            {
              id: "stage-1",
              title: "安全入口归因",
              goal: "找出账号安全相关入口和分散点。",
              acceptance: ["列出入口、问题和归并建议"],
              subgoals: [
                {
                  id: "subgoal-1",
                  title: "入口清单",
                  goal: "形成当前入口清单。",
                  acceptance: ["每个入口都有来源和用途说明"],
                },
              ],
            },
          ],
        },
        provenance: {
          clarify_transcript_verbatim: "Q: 验收到什么程度才算完成？\nA: 列出入口、问题和归并建议。",
          approved_ceo_task_card_verbatim:
            "Task Card: 整理设置页账号安全区域；验收为列出入口、问题和归并建议。",
        },
      },
      ui: {
        kind: "goal_contract_card",
        title: "确认金字塔计划",
      },
      next: "C_REGISTER",
      errors: [],
    });

    expect(parsed.content.goal_card.pyramid).toHaveLength(1);
  });

  it("parses a clarify question card with branch choices and note-only support", () => {
    expect(ClarifyQuestionCardSchema.parse(clarifyQuestionCard)).toMatchObject({
      question_id: "card_goal_route",
      questions: expect.arrayContaining([
        expect.objectContaining({
          selection_mode: "single",
          choices: expect.arrayContaining([expect.objectContaining({ label: "生产落地" })]),
        }),
      ]),
      allow_choice_notes: true,
      allow_note_only: true,
    });
  });

  it("accepts explicit multi-select clarify questions", () => {
    const card = structuredClone(clarifyQuestionCard);
    card.questions[1].selection_mode = "multiple";

    expect(ClarifyQuestionCardSchema.parse(card).questions[1]).toMatchObject({
      selection_mode: "multiple",
    });
  });

  it("accepts 15-character choice labels and 30-character descriptions", () => {
    const card = structuredClone(clarifyQuestionCard);
    card.questions[0].choices[0] = {
      id: "longer-choice",
      label: "高性能库函数交付路径",
      description: "以复用接口和可验证性能结果作为验收",
    };

    expect(ClarifyQuestionCardSchema.parse(card).questions[0].choices[0]).toMatchObject({
      label: "高性能库函数交付路径",
      description: "以复用接口和可验证性能结果作为验收",
    });
  });

  it("rejects risk as a Task Card contract field", () => {
    expect(() =>
      ClarifyRuntimePacketSchema.parse({
        type: "clarify",
        code: "C_TASK_CARD",
        session_id: "sec_123",
        task_id: null,
        content: {
          task_card: {
            title: "实现高性能排序",
            goal: "实现可复用的高性能排序能力。",
            constraints: ["不降级成 demo"],
            acceptance: ["有正确性和性能证据"],
            risk: "Python 可能不适合绝对性能竞赛。",
          },
          provenance: {
            clarify_transcript_verbatim: "Q: 用什么语言？\nA: Python。",
          },
        },
        ui: {
          kind: "task_registration_card",
          title: "任务总览确认",
        },
        next: "C_GOAL_CARD",
        errors: [],
      }),
    ).toThrow();
  });

  it("parses a note-only clarify answer packet", () => {
    expect(
      ClarifyAnswerPacketSchema.parse({
        question_card_id: "card_goal_route",
        title: "先定目标路线",
        answers: [
          {
            question_id: "q_goal_route",
            choice_ids: [],
            choice_notes: {},
            note: "你决定，但不要降级目标。",
          },
        ],
        note: "你决定，但不要降级目标。",
        raw_answer: "你决定，但不要降级目标。",
      }),
    ).toMatchObject({
      question_card_id: "card_goal_route",
      answers: [expect.objectContaining({ question_id: "q_goal_route" })],
    });
  });

  it("parses a normal clarify turn input packet without skill rules", () => {
    const parsed = ClarifyTurnInputPacketSchema.parse({
      type: "clarify_turn",
      session_id: "sec_123",
      current_state: "C_ASK",
      controls: {
        mode: "loop",
        clarify_strength: "balanced",
        effective_clarify_strength: "balanced",
        loop: "balanced",
      },
      user_input: "继续",
      transcript_ref: "transcript:sec_123:v4",
      assumption_ledger_ref: "assumptions:sec_123:v4",
      decision_tree_frontier_ref: "frontier:sec_123:v4",
      context_summary: "workspace facts already discovered",
    });

    expect(parsed).toMatchObject({
      type: "clarify_turn",
      current_state: "C_ASK",
    });
  });

  it("parses a first-session clarify packet with a skill digest", () => {
    const parsed = ClarifySessionStartInputPacketSchema.parse({
      type: "clarify_session_start",
      session_id: "sec_123",
      skill_ref: skillRef,
      current_state: "C_DIRECT",
      controls: {
        mode: "quick",
        clarify_strength: "none",
        effective_clarify_strength: "none",
        loop: null,
      },
      user_input: "hi",
      transcript_ref: "transcript:sec_123:v0",
      basis: "session_scoped_skill_loaded",
    });

    expect(parsed.skill_ref.digest).toBe(skillRef.digest);
    expect(parsed.basis).toBe("session_scoped_skill_loaded");
  });

  it("rejects skill references on normal same-state clarify turns", () => {
    expect(() =>
      ClarifyTurnInputPacketSchema.parse({
        type: "clarify_turn",
        session_id: "sec_123",
        current_state: "C_ASK",
        controls: {
          mode: "loop",
          clarify_strength: "balanced",
          effective_clarify_strength: "balanced",
          loop: "balanced",
        },
        user_input: "继续",
        transcript_ref: "transcript:sec_123:v4",
        skill_ref: skillRef,
      }),
    ).toThrow();
  });

  it("parses a clarify transition packet with skill digest and no copied rules", () => {
    const parsed = ClarifyTransitionInputPacketSchema.parse({
      type: "clarify_transition",
      session_id: "sec_123",
      skill_ref: skillRef,
      from: "C_ASK",
      to: "C_TASK_CARD",
      basis: "according_to_loaded_skill",
      controls: {
        mode: "loop",
        clarify_strength: "dive",
        effective_clarify_strength: "dive",
        loop: "balanced",
      },
      controls_changed: {
        clarify_strength_from: "balanced",
        clarify_strength_to: "dive",
        reason: "user asked to go deeper before Task Card",
      },
      transcript_ref: "transcript:sec_123:v5",
      user_input: "按刚才说的注册后台任务",
    });

    expect(parsed.skill_ref.digest).toBe(skillRef.digest);
    expect(parsed.basis).toBe("according_to_loaded_skill");
  });

  it("rejects mechanically impossible clarify transitions", () => {
    expect(isAllowedClarifyMechanicalTransition("C_DIRECT", "C_GOAL_CARD")).toBe(false);
    expect(() =>
      ClarifyTransitionInputPacketSchema.parse({
        type: "clarify_transition",
        session_id: "sec_123",
        skill_ref: skillRef,
        from: "C_DIRECT",
        to: "C_GOAL_CARD",
        basis: "according_to_loaded_skill",
        controls: {
          mode: "loop",
          clarify_strength: "balanced",
          effective_clarify_strength: "balanced",
          loop: "balanced",
        },
        transcript_ref: "transcript:sec_123:v1",
        user_input: "确认",
      }),
    ).toThrow();
  });

  it("parses repair packets that repair shape only", () => {
    expect(
      ClarifyRepairInputPacketSchema.parse({
        type: "clarify_repair",
        session_id: "sec_123",
        skill_ref: skillRef,
        previous_state: "C_ASK",
        intended_output_state: "C_ASK",
        controls: {
          mode: "loop",
          clarify_strength: "balanced",
          effective_clarify_strength: "balanced",
          loop: "balanced",
        },
        bad_output: "{}",
        schema_errors: ["C_ASK packets must include content.question_card"],
        transition_errors: [],
        repair_instruction:
          "repair packet shape only; do not reinterpret user intent; do not change transcript; do not fabricate transcript; do not change approved CEO Task Card; do not downgrade target",
      }).intended_output_state,
    ).toBe("C_ASK");
  });

  it("rejects oversized clarify choice labels", () => {
    expect(() =>
      ClarifyQuestionCardSchema.parse({
        ...clarifyQuestionCard,
        questions: [
          {
            ...clarifyQuestionCard.questions[0],
            choices: [
              {
                id: "long",
                label: "这是一个明确超过十五个字符的选项标签",
                description: "太长",
              },
              {
                id: "ok",
                label: "保留目标",
                description: "继续按原目标",
              },
            ],
          },
          clarifyQuestionCard.questions[1],
        ],
      }),
    ).toThrow();
  });

  it("requires semantic Clarify tools to carry public badge summary and frontier ledger", () => {
    expect(
      ThothSubmitClarifyCardInputSchema.parse({
        title: "确认目标边界",
        why_now: "这些选择会改变任务路线。",
        public_badge_summary: "正在拆解目标边界：先确认路线、验收和风险取舍。",
        frontier_ledger: {
          ...readyFrontierLedger,
          convergence_state: "not_converged",
          remaining_material_user_owned_assumptions: ["验收基线"],
        },
        questions: clarifyQuestionCard.questions,
      }).public_badge_summary,
    ).toContain("拆解目标边界");

    expect(() =>
      ThothSubmitClarifyCardInputSchema.parse({
        title: "确认目标边界",
        why_now: "这些选择会改变任务路线。",
        decision_it_changes: "legacy compatibility text",
        questions: clarifyQuestionCard.questions,
      }),
    ).toThrow();

    expect(
      ThothSubmitClarifyCardInputSchema.parse({
        title: "确认目标边界",
        why_now: "这些选择会改变任务路线。",
        decision_it_changes: "legacy compatibility text",
        public_badge_summary: "正在拆解目标边界：先确认路线、验收和风险取舍。",
        frontier_ledger: {
          ...readyFrontierLedger,
          convergence_state: "not_converged",
          remaining_material_user_owned_assumptions: ["风险取舍"],
        },
        questions: clarifyQuestionCard.questions,
      }).decision_it_changes,
    ).toBe("legacy compatibility text");
  });

  it("requires Task Card submissions to include a ready convergence review", () => {
    expect(
      ThothSubmitTaskCardInputSchema.parse({
        task_card: {
          title: "整理设置页账号安全区域",
          goal: "让账号安全状态可确认。",
          constraints: ["保持现有设置入口。"],
          acceptance: ["用户能看到当前登录状态。"],
        },
        provenance: {
          clarify_transcript_verbatim: "完整 Clarify 原文。",
        },
        convergence_review: {
          frontier_ledger: readyFrontierLedger,
          why_task_is_now_grounded: "剩余事项均可由 agent 决定或在仓库中发现。",
        },
      }).convergence_review.frontier_ledger.convergence_state,
    ).toBe("ready_for_task");

    expect(() =>
      ThothSubmitTaskCardInputSchema.parse({
        task_card: {
          title: "整理设置页账号安全区域",
          goal: "让账号安全状态可确认。",
          constraints: ["保持现有设置入口。"],
          acceptance: ["用户能看到当前登录状态。"],
        },
        provenance: {
          clarify_transcript_verbatim: "完整 Clarify 原文。",
        },
        convergence_review: {
          frontier_ledger: {
            ...readyFrontierLedger,
            remaining_material_user_owned_assumptions: ["是否允许改动认证流程"],
            convergence_state: "not_converged",
          },
          why_task_is_now_grounded: "仍有用户决策未确认。",
        },
      }),
    ).toThrow();
  });

  it("parses persisted Clarify decision deltas without exposing them in card copy", () => {
    const delta = ClarifyDecisionDeltaSchema.parse({
      affected_contract_fields: ["goal", "acceptance"],
      safe_if_unanswered: "Stop at the card and do not choose a delivery route.",
      eliminated_routes: ["A benchmark-only delivery"],
      irreversible_or_cost_impact: "Changing the public interface later is costly.",
      downstream_refs: ["task_card.goal", "task_card.acceptance"],
    });
    const card = ThothSubmitClarifyCardInputSchema.parse({
      title: "确认交付边界",
      why_now: "交付形式会改变后续合同。",
      public_badge_summary: "正在拆解交付边界和验收口径。",
      frontier_ledger: {
        ...readyFrontierLedger,
        convergence_state: "not_converged",
        remaining_material_user_owned_assumptions: ["交付形态"],
      },
      decision_delta: delta,
      questions: clarifyQuestionCard.questions,
    });

    expect(card.decision_delta?.downstream_refs).toEqual([
      "task_card.goal",
      "task_card.acceptance",
    ]);
    expect(JSON.stringify(card.questions)).not.toContain("safe_if_unanswered");
  });

  it("requires an independent audit to name the frontier before it can revise Clarify", () => {
    expect(
      ThothSubmitClarifyConvergenceAuditInputSchema.parse({
        outcome: "revise_frontier",
        summary: "Acceptance evidence still belongs to the user.",
        missing_material_frontier: ["performance baseline"],
      }),
    ).toMatchObject({ outcome: "revise_frontier" });
    expect(() =>
      ClarifyConvergenceAuditSchema.parse({
        outcome: "revise_frontier",
        summary: "A frontier remains.",
      }),
    ).toThrow(/material frontier/);
    expect(
      ThothSubmitContractPreservationAuditInputSchema.parse({
        outcome: "proceed",
        summary: "The future-goal change preserves the approved contract.",
        affected_goal_ids: ["goal-3"],
      }),
    ).toMatchObject({ outcome: "proceed" });
  });

  it("requires C_ASK packets to carry the question card in content and ui", () => {
    const parsed = ClarifyRuntimePacketSchema.parse({
      type: "clarify",
      code: "C_ASK",
      session_id: "sec_123",
      task_id: null,
      content: {
        question_card: clarifyQuestionCard,
        meta: clarifyAskMeta,
      },
      ui: {
        kind: "clarify_card",
        title: "先定目标路线",
        question_card: clarifyQuestionCard,
      },
      next: "C_ASK",
      errors: [],
    });

    expect(parsed.content.question_card).toMatchObject({ title: "先定目标路线" });
  });

  it("rejects C_TASK_CARD without transcript provenance", () => {
    expect(() =>
      ClarifyRuntimePacketSchema.parse({
        type: "clarify",
        code: "C_TASK_CARD",
        session_id: "sec_123",
        task_id: null,
        content: {
          title: "整理设置页账号安全区域",
        },
        ui: {
          kind: "task_registration_card",
          title: "确认后台任务",
        },
        next: "C_GOAL_CARD",
        errors: [],
      }),
    ).toThrow();
  });

  it("rejects extra runtime packet top-level fields", () => {
    expect(() =>
      ClarifyRuntimePacketSchema.parse({
        type: "clarify",
        code: "C_DIRECT",
        session_id: "sec_123",
        task_id: null,
        content: {},
        ui: { kind: "message" },
        next: "C_DIRECT",
        errors: [],
        debug: true,
      }),
    ).toThrow();
  });

  it("rejects clarify packets with loop UI kinds", () => {
    expect(() =>
      ClarifyRuntimePacketSchema.parse({
        type: "clarify",
        code: "C_DIRECT",
        session_id: "sec_123",
        task_id: null,
        content: {},
        ui: { kind: "goal_started" },
        next: "C_DIRECT",
        errors: [],
      }),
    ).toThrow();
  });

  it("requires loop cursor on active loop packets", () => {
    expect(() =>
      LoopRuntimePacketSchema.parse({
        type: "loop",
        code: "L_WORK",
        session_id: "loop_789",
        task_id: "task_456",
        content: {
          message: "正在调整安全区域的信息结构。",
        },
        ui: {
          kind: "progress",
          title: "正在执行 Goal 2",
        },
        next: "L_WORK",
        errors: [],
      }),
    ).toThrow();
  });

  it("parses loop progress with a compact goal and round cursor", () => {
    const parsed = LoopRuntimePacketSchema.parse({
      type: "loop",
      code: "L_WORK",
      session_id: "loop_789",
      task_id: "task_456",
      content: {
        cursor: { goal: 2, goals: 5, round: 1, rounds: 3 },
        message: "正在调整安全区域的信息结构。",
        evidence: [],
        changed: ["SettingsSecuritySection.tsx"],
      },
      ui: {
        kind: "progress",
        title: "正在执行 Goal 2",
      },
      next: "L_WORK",
      errors: [],
    });

    expect(parsed.content.cursor).toEqual({ goal: 2, goals: 5, round: 1, rounds: 3 });
  });

  it("rejects impossible loop cursor positions", () => {
    expect(() =>
      LoopRuntimePacketSchema.parse({
        type: "loop",
        code: "L_RETRY",
        session_id: "loop_789",
        task_id: "task_456",
        content: {
          cursor: { goal: 6, goals: 5, round: 4, rounds: 3 },
          failed: "移动宽度文本溢出。",
          change: "下一轮只修移动布局，并补移动截图。",
          avoid: ["不要只重复桌面截图验证"],
        },
        ui: {
          kind: "retry_card",
          title: "Starting round 4 / 3",
        },
        next: "L_START",
        errors: [],
      }),
    ).toThrow();
  });

  it("parses a matching clarify provider input envelope", () => {
    const parsed = ThothProviderInputEnvelopeSchema.parse({
      type: "provider_input",
      skill: "thoth.clarify",
      session_id: "sec_123",
      task_id: null,
      code: "C_DIRECT",
      controls: {
        mode: "quick",
        clarify: "none",
        loop: null,
      },
      turn_phase: "clarify",
      input: "hi",
      inject: "none",
      expect: "clarify",
    });

    expect(parsed.skill).toBe("thoth.clarify");
    expect(parsed.code).toBe("C_DIRECT");
  });

  it("rejects envelopes whose skill and state code do not match", () => {
    expect(() =>
      ThothProviderInputEnvelopeSchema.parse({
        type: "provider_input",
        skill: "thoth.clarify",
        session_id: "sec_123",
        task_id: "task_456",
        code: "L_WORK",
        controls: {
          mode: "loop",
          clarify: "balanced",
          loop: "balanced",
        },
        input: "continue",
        inject: "state_refresh",
        expect: "clarify",
      }),
    ).toThrow();
  });

  it("parses either runtime packet through the union schema", () => {
    expect(
      ThothRuntimePacketSchema.parse({
        type: "loop",
        code: "L_TASK_DONE",
        session_id: "loop_789",
        task_id: "task_456",
        content: {
          summary: "所有目标已完成。",
        },
        ui: {
          kind: "task_done",
          title: "Task completed",
        },
        next: "L_TASK_DONE",
        errors: [],
      }).type,
    ).toBe("loop");
  });

  it("requires a rationale when Goals Card count is outside the usual 8-16 range", () => {
    const oneGoal = {
      goals_card: {
        title: "小型修复 goals",
        summary: "单个 reviewable milestone 足够完成。",
        goals: [
          {
            id: "goal-1",
            order: 1,
            title: "修复入口",
            goal: "修复一个明确 UI 入口。",
            constraints: ["不扩展范围。"],
            acceptance: ["入口可点击。"],
          },
        ],
      },
      provenance: {
        clarify_transcript_verbatim: "用户确认这是小型修复。",
        approved_ceo_task_card_verbatim: "Task: 修复入口。",
      },
    };

    expect(() => ThothSubmitGoalsCardInputSchema.parse(oneGoal)).toThrow(/goals_count_rationale/);
    expect(
      ThothSubmitGoalsCardInputSchema.parse({
        ...oneGoal,
        goals_card: {
          ...oneGoal.goals_card,
          goals_count_rationale: "这是小型修复；单个目标已足够细、线性且可 review。",
        },
      }).goals_card.goals_count_rationale,
    ).toContain("小型修复");
  });

  it("parses Loop PlanExec and Review tool inputs with audit fields", () => {
    expect(
      ThothLoopPlanExecResultInputSchema.parse({
        goal_id: "goal-1",
        round: 2,
        phase_run_id: "phase-plan-2",
        result_tool_call_id: "tool-plan-2",
        plan_summary: "Plan the focused retry.",
        execution_summary: "Implemented the retry.",
        evidence: ["Tests passed."],
        validation_performed: ["Ran focused tests."],
        remaining_risks: [],
        next_review_focus: "Check the previously failed acceptance.",
      }).phase_run_id,
    ).toBe("phase-plan-2");

    expect(
      ThothLoopReviewVerdictInputSchema.parse({
        goal_id: "goal-1",
        round: 2,
        result_tool_call_id: "tool-review-2",
        outcome: "pass",
        summary: "Accepted.",
        acceptance_matrix: [{ acceptance: "Tests pass", status: "met", evidence: "green" }],
        failed_acceptance: [],
        anti_repeat_strategy: [],
        evidence_summary: "Focused tests passed.",
      }).result_tool_call_id,
    ).toBe("tool-review-2");

    expect(() =>
      ThothLoopReviewVerdictInputSchema.parse({
        goal_id: "goal-1",
        round: 2,
        outcome: "fail",
        summary: "Rejected.",
        acceptance_matrix: [{ acceptance: "Tests pass", status: "not_met", evidence: "red" }],
        failed_acceptance: ["Tests pass"],
        failure_root_cause: "No focused proof.",
        next_round_guidance: "Add focused proof.",
        anti_repeat_strategy: [],
        evidence_summary: "Focused tests were missing.",
      }),
    ).toThrow(/anti_repeat_strategy/);
  });
});
