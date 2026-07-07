import {
  ClarifyProviderRuntimeInputPacketSchema,
  ClarifyRuntimePacketSchema,
  type ClarifyProviderRuntimeInputPacket,
  type ClarifyRuntimeCode,
  type ClarifyRuntimePacket,
  type ThothRuntimeSkillRef,
} from "@thoth/protocol/thoth-runtime-contract";
import {
  buildClarifyRepairInputPacket,
  buildClarifySessionStartInputPacket,
  buildClarifyTransitionInputPacket,
  buildClarifyTurnInputPacket,
  CLARIFY_SKILL_ID,
  loadRuntimeSkillArtifact,
} from "./contract.js";

export interface ClarifyUserSimulationTurn {
  id: string;
  userInput: string;
  inputPacket: ClarifyProviderRuntimeInputPacket;
  outputPacket: ClarifyRuntimePacket;
  uiProjection: string;
  expectedBehavior: readonly string[];
}

export interface ClarifyUserSimulationReport {
  sessionId: string;
  transcriptVerbatim: string;
  approvedCeoTaskCardVerbatim: string;
  turns: readonly ClarifyUserSimulationTurn[];
  auxiliaryTurns: readonly ClarifyUserSimulationTurn[];
  repairPacket: ClarifyProviderRuntimeInputPacket;
}

export interface ClarifyUserSimulationValidation {
  passed: boolean;
  failures: string[];
}

const mainSessionId = "sec_user_sim_pathtracing";
const cleanupSessionId = "sec_user_sim_cleanup";
const conflictSessionId = "sec_user_sim_conflict";

const transcriptVerbatim = [
  "User: 我想把项目做成真正可用的 3D 渲染系统",
  "Q: 这次最需要先切掉哪条错误路线？",
  "A: 要做完整 Three.js PathTracing 引擎，能在项目里真实使用。",
  "Q: 完整引擎目标不变，优先按哪种真实使用路线？",
  "A: 选画质优先；注意要能集成真实项目。",
  "Q: 什么证据出现才算这条引擎路线完成？",
  "A: 不选，补充：验收要有路径追踪截图、性能基线和测试，不能做 demo 降级。",
  "Q: 这次最需要提前保护哪类风险边界？",
  "A: 你决定具体技术路线，优先用最稳方式。",
].join("\n");

const approvedCeoTaskCardVerbatim = [
  "CEO Task Card: 完整 Three.js PathTracing 引擎",
  "目标: 在项目中落地真实可用的 Three.js PathTracing 引擎。",
  "约束: 不降级为 demo/mock/MVP；技术路线由 agent 选择最稳方式；保留画质优先和真实集成。",
  "验收: 路径追踪截图、性能基线和测试证据齐全。",
].join("\n");

function askPacket(input: {
  sessionId: string;
  id: string;
  title: string;
  question: string;
  node: string;
  choices: Array<{ id: string; label: string; description: string }>;
  strength?: "none" | "auto" | "light" | "balanced" | "dive" | "deep";
  treeDepth?: number;
  qaRoundCount?: number;
  extraQuestions?: Array<{
    id: string;
    question: string;
    node: string;
    choices: Array<{ id: string; label: string; description: string }>;
  }>;
}): ClarifyRuntimePacket {
  const questions = [
    {
      id: input.id,
      question: input.question,
      behavior_tree_node: input.node,
      choices: input.choices,
    },
    ...(
      input.extraQuestions ?? [
        {
          id: `${input.id}_owner`,
          question: "这类细节谁来定？",
          node: "assumption_owner",
          choices: [
            { id: "agent", label: "你决定", description: "技术细节你定" },
            { id: "user", label: "先问我", description: "偏好风险问我" },
          ],
        },
      ]
    ).map((question) => ({
      id: question.id,
      question: question.question,
      behavior_tree_node: question.node,
      choices: question.choices,
    })),
  ];
  const questionCard = {
    question_id: input.id,
    title: input.title,
    behavior_tree_node: input.node,
    why_now: "这是当前最能减少做偏风险的分叉。",
    questions,
    allow_choice_notes: true,
    allow_note_only: true,
  };
  const strength = input.strength ?? "balanced";

  return {
    type: "clarify",
    code: "C_ASK",
    session_id: input.sessionId,
    task_id: null,
    content: {
      question_card: questionCard,
      meta: {
        effective_clarify_strength: strength,
        decision_tree_depth: input.treeDepth ?? 1,
        qa_round_count: input.qaRoundCount ?? 1,
        remaining_material_assumptions: [
          {
            id: input.node,
            owner: "user_must_decide",
            summary: "这个分叉会改变后续 Task Card。",
            impact: "high",
          },
          {
            id: `${input.node}_discoverable`,
            owner: "agent_can_discover",
            summary: "仓库事实由 agent 自行查证。",
            impact: "medium",
          },
        ],
        question_value_reason: "当前问题切掉最高影响的 user_must_decide 分叉。",
      },
    },
    ui: {
      kind: "clarify_card",
      title: input.title,
      question_card: questionCard,
    },
    next: "C_ASK",
    errors: [],
  };
}

function directPacket(sessionId: string, message: string): ClarifyRuntimePacket {
  return {
    type: "clarify",
    code: "C_DIRECT",
    session_id: sessionId,
    task_id: null,
    content: {
      message,
    },
    ui: {
      kind: "message",
      text: message,
    },
    next: "C_DIRECT",
    errors: [],
  };
}

function taskCardPacket(): ClarifyRuntimePacket {
  return {
    type: "clarify",
    code: "C_TASK_CARD",
    session_id: mainSessionId,
    task_id: null,
    content: {
      task_card: {
        title: "完整 Three.js PathTracing 引擎",
        goal: "在项目中落地真实可用的 Three.js PathTracing 引擎，画质优先并保持真实集成。",
        constraints: ["不降级为 demo/mock/MVP", "技术路线由 agent 选择最稳方式"],
        acceptance: ["路径追踪截图", "性能基线", "测试证据"],
      },
      provenance: {
        clarify_transcript_verbatim: transcriptVerbatim,
      },
    },
    ui: {
      kind: "task_registration_card",
      title: "确认后台任务",
    },
    next: "C_GOAL_CARD",
    errors: [],
  };
}

function stopClarifyTaskCardPacket(): ClarifyRuntimePacket {
  return {
    type: "clarify",
    code: "C_TASK_CARD",
    session_id: mainSessionId,
    task_id: null,
    content: {
      task_card: {
        title: "完整 Three.js PathTracing 引擎",
        goal: "用户要求停止澄清，按已有 transcript 编译真实可用 PathTracing 引擎任务。",
        constraints: ["不降级为 demo/mock/MVP", "技术路线由 agent 选择最稳方式"],
        acceptance: ["路径追踪截图", "性能基线", "测试证据"],
      },
      provenance: {
        clarify_transcript_verbatim: transcriptVerbatim,
      },
    },
    ui: {
      kind: "task_registration_card",
      title: "确认后台任务",
    },
    next: "C_GOAL_CARD",
    errors: [],
  };
}

function goalCardPacket(): ClarifyRuntimePacket {
  return {
    type: "clarify",
    code: "C_GOAL_CARD",
    session_id: mainSessionId,
    task_id: null,
    content: {
      goal_card: {
        title: "完整 Three.js PathTracing 引擎",
        summary: "按目标层次拆出从现状理解、核心落地到验收证据的金字塔计划。",
        pyramid: [
          {
            id: "stage-entry",
            title: "确认现有渲染接入点",
            goal: "找出现有 Three.js 场景、渲染入口和可插入 PathTracing 的边界。",
            acceptance: ["列出场景入口、渲染入口和可插入边界证据"],
            subgoals: [
              {
                id: "subgoal-entry-map",
                title: "入口图谱",
                goal: "建立渲染入口和场景生命周期的证据图谱。",
                acceptance: ["入口、生命周期和可插入点均有证据"],
              },
            ],
          },
          {
            id: "stage-core",
            title: "落地 PathTracing 核心路径",
            goal: "实现真实可接入项目的路径追踪核心路径，优先保证画质正确。",
            acceptance: ["路径追踪截图", "关键测试通过"],
            subgoals: [
              {
                id: "subgoal-core-integrated",
                title: "真实集成",
                goal: "让路径追踪能力进入真实渲染路径而不是孤立演示。",
                acceptance: ["真实项目路径可触发路径追踪结果"],
              },
            ],
          },
          {
            id: "stage-evidence",
            title: "补齐性能与回归证据",
            goal: "记录性能基线并证明集成不会破坏现有渲染路径。",
            acceptance: ["性能基线记录", "现有渲染回归测试通过"],
            subgoals: [
              {
                id: "subgoal-evidence-pack",
                title: "证据闭环",
                goal: "形成画质、性能和回归三个维度的验收证据。",
                acceptance: ["截图、基线和测试结果可复核"],
              },
            ],
          },
        ],
      },
      provenance: {
        clarify_transcript_verbatim: transcriptVerbatim,
        approved_ceo_task_card_verbatim: approvedCeoTaskCardVerbatim,
      },
    },
    ui: {
      kind: "goal_contract_card",
      title: "确认线性目标拆分",
    },
    next: "C_REGISTER",
    errors: [],
  };
}

function registerPacket(): ClarifyRuntimePacket {
  return {
    type: "clarify",
    code: "C_REGISTER",
    session_id: mainSessionId,
    task_id: "task_user_sim_pathtracing",
    content: {
      task_card: {
        title: "完整 Three.js PathTracing 引擎",
        goal: "在项目中落地真实可用的 Three.js PathTracing 引擎，画质优先并保持真实集成。",
        constraints: ["不降级为 demo/mock/MVP", "技术路线由 agent 选择最稳方式"],
        acceptance: ["路径追踪截图", "性能基线", "测试证据"],
      },
      goal_card: {
        title: "完整 Three.js PathTracing 引擎",
        summary: "按目标层次拆出从现状理解、核心落地到验收证据的金字塔计划。",
        pyramid: [
          {
            id: "stage-entry",
            title: "确认现有渲染接入点",
            goal: "找出现有 Three.js 场景、渲染入口和可插入 PathTracing 的边界。",
            acceptance: ["列出场景入口、渲染入口和可插入边界证据"],
            subgoals: [
              {
                id: "subgoal-entry-map",
                title: "入口图谱",
                goal: "建立渲染入口和场景生命周期的证据图谱。",
                acceptance: ["入口、生命周期和可插入点均有证据"],
              },
            ],
          },
        ],
      },
    },
    ui: {
      kind: "registered_card",
      title: "已注册后台任务",
    },
    next: "C_REGISTER",
    errors: [],
  };
}

function turn(
  id: string,
  userInput: string,
  inputPacket: ClarifyProviderRuntimeInputPacket,
  outputPacket: ClarifyRuntimePacket,
  uiProjection: string,
  expectedBehavior: readonly string[],
): ClarifyUserSimulationTurn {
  return {
    id,
    userInput,
    inputPacket,
    outputPacket,
    uiProjection,
    expectedBehavior,
  };
}

function transitionPacket(
  from: ClarifyRuntimeCode,
  to: ClarifyRuntimeCode,
  userInput: string,
  transcriptVersion: number,
  skillRef: ThothRuntimeSkillRef,
  clarify: "none" | "auto" | "light" | "balanced" | "dive" | "deep" = "balanced",
): ClarifyProviderRuntimeInputPacket {
  return buildClarifyTransitionInputPacket({
    sessionId: mainSessionId,
    from,
    to,
    userInput,
    transcriptRef: `transcript:${mainSessionId}:v${transcriptVersion}`,
    clarify,
    mode: "loop",
    loop: "balanced",
    skillRef,
  });
}

function packetProvenance(packet: ClarifyRuntimePacket): Record<string, unknown> | undefined {
  const provenance = packet.content.provenance;
  if (typeof provenance === "object" && provenance !== null) {
    return provenance as Record<string, unknown>;
  }
  return undefined;
}

export function buildClarifyUserSimulationReport(
  skillRef: ThothRuntimeSkillRef = {
    id: CLARIFY_SKILL_ID,
    digest: loadRuntimeSkillArtifact(CLARIFY_SKILL_ID).digest,
  },
): ClarifyUserSimulationReport {
  const turns: ClarifyUserSimulationTurn[] = [
    turn(
      "hi",
      "hi",
      buildClarifySessionStartInputPacket({
        sessionId: mainSessionId,
        currentState: "C_DIRECT",
        userInput: "hi",
        transcriptRef: `transcript:${mainSessionId}:v0`,
        skillRef,
      }),
      directPacket(mainSessionId, "你好，我在。你想推进什么？"),
      "你好，我在。你想推进什么？",
      ["该直答时直答", "新 provider session 第一轮带 skill digest"],
    ),
    turn(
      "vague-large-task",
      "我想把项目做成真正可用的 3D 渲染系统",
      transitionPacket("C_DIRECT", "C_ASK", "我想把项目做成真正可用的 3D 渲染系统", 1, skillRef),
      askPacket({
        sessionId: mainSessionId,
        id: "q_goal_route",
        title: "先定路线",
        question: "这次最需要先切掉哪条错误路线？",
        node: "goal_route",
        choices: [
          { id: "ship", label: "交付闭环", description: "按可用结果推进" },
          { id: "quality", label: "质量优先", description: "先修最大风险" },
          { id: "research", label: "研究验证", description: "先证明关键假设" },
        ],
      }),
      "先定路线：这次最需要先切掉哪条错误路线？",
      ["问最高杠杆行为树分叉", "不问字段问卷"],
    ),
    turn(
      "threejs-pathtracing",
      "实现完整 Three.js PathTracing 引擎，能在项目里真实使用",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "实现完整 Three.js PathTracing 引擎，能在项目里真实使用",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v2`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_target_grade",
        title: "先定交付级",
        question: "完整引擎目标不变，优先按哪种真实使用路线？",
        node: "target_grade",
        strength: "dive",
        treeDepth: 2,
        choices: [
          { id: "prod", label: "产品可用", description: "重视稳定集成" },
          { id: "quality", label: "画质优先", description: "重视渲染正确" },
          { id: "perf", label: "性能优先", description: "重视帧率预算" },
        ],
      }),
      "先定交付级：完整引擎目标不变，优先按哪种真实使用路线？",
      ["保留完整 PathTracing 目标", "不兜底降级"],
    ),
    turn(
      "branch-choice-answer",
      "选画质优先；注意要能集成真实项目",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "选画质优先；注意要能集成真实项目",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v3`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_acceptance",
        title: "先锁验收",
        question: "什么证据出现才算这条引擎路线完成？",
        node: "acceptance_boundary",
        strength: "dive",
        treeDepth: 3,
        choices: [
          { id: "screens", label: "截图证明", description: "画质可核对" },
          { id: "perf", label: "性能基线", description: "帧耗有记录" },
          { id: "tests", label: "测试通过", description: "回归可证明" },
        ],
      }),
      "先锁验收：什么证据出现才算这条引擎路线完成？",
      ["吸收用户分支选择", "验收不清时只问验收证据"],
    ),
    turn(
      "note-only-answer",
      "不选，补充：验收要有路径追踪截图、性能基线和测试，不能做 demo 降级",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "不选，补充：验收要有路径追踪截图、性能基线和测试，不能做 demo 降级",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v4`,
      }),
      askPacket({
        sessionId: mainSessionId,
        id: "q_risk_boundary",
        title: "先守边界",
        question: "这次最需要提前保护哪类风险边界？",
        node: "risk_resource_boundary",
        strength: "dive",
        treeDepth: 4,
        qaRoundCount: 3,
        choices: [
          { id: "integration", label: "集成风险", description: "不破坏现有渲染" },
          { id: "quality", label: "画质风险", description: "先保正确性" },
          { id: "rollback", label: "回滚路径", description: "保留恢复手段" },
        ],
      }),
      "先守边界：这次最需要提前保护哪类风险边界？",
      ["支持 note-only 回答", "继续推进到新分叉"],
    ),
    turn(
      "you-decide-task-card",
      "你决定具体技术路线，优先用最稳方式",
      transitionPacket("C_ASK", "C_TASK_CARD", "你决定具体技术路线，优先用最稳方式", 5, skillRef),
      taskCardPacket(),
      "确认后台任务：完整 Three.js PathTracing 引擎",
      ["用户说你决定时记录 agent-owned assumption", "C_TASK_CARD 带完整 transcript"],
    ),
    turn(
      "task-card-confirm",
      "确认 Task Card，进入 Goal Card",
      transitionPacket("C_TASK_CARD", "C_GOAL_CARD", "确认 Task Card，进入 Goal Card", 6, skillRef),
      goalCardPacket(),
      "确认线性目标拆分：3 个可验证目标",
      ["Task Card 确认后进入 C_GOAL_CARD", "Goal Card 带 transcript 和 approved CEO Task Card"],
    ),
    turn(
      "goal-card-confirm",
      "确认 Goal Card，注册后台任务",
      transitionPacket("C_GOAL_CARD", "C_REGISTER", "确认 Goal Card，注册后台任务", 7, skillRef),
      registerPacket(),
      "已注册后台任务：完整 Three.js PathTracing 引擎",
      ["Goal Card 确认后进入注册", "不暴露 provider/session internals"],
    ),
  ];

  const auxiliaryTurns: ClarifyUserSimulationTurn[] = [
    turn(
      "stop-clarify-enough",
      "够了，不要再问，按刚才整理 Task Card",
      buildClarifyTurnInputPacket({
        sessionId: mainSessionId,
        currentState: "C_ASK",
        userInput: "够了，不要再问，按刚才整理 Task Card",
        clarify: "dive",
        mode: "loop",
        loop: "balanced",
        transcriptRef: `transcript:${mainSessionId}:v5`,
      }),
      stopClarifyTaskCardPacket(),
      "确认后台任务：完整 Three.js PathTracing 引擎",
      ["用户说够了时停止 Clarify", "按已有 transcript 出 Task Card"],
    ),
    turn(
      "unclear-acceptance",
      "注册个后台任务，把设置页整理一下",
      buildClarifySessionStartInputPacket({
        sessionId: "sec_user_sim_acceptance",
        currentState: "C_DIRECT",
        userInput: "注册个后台任务，把设置页整理一下",
        skillRef,
      }),
      askPacket({
        sessionId: "sec_user_sim_acceptance",
        id: "q_acceptance_settings",
        title: "先锁验收",
        question: "整理到什么证据出现，才算这任务完成？",
        node: "acceptance_boundary",
        choices: [
          { id: "screens", label: "截图通过", description: "关键页面可核对" },
          { id: "tests", label: "测试通过", description: "门禁能证明" },
        ],
      }),
      "先锁验收：整理到什么证据出现，才算这任务完成？",
      ["验收不清时问验收", "不问可发现事实"],
    ),
    turn(
      "risk-delete-boundary",
      "清掉这个仓库里没用的东西，越快越好",
      buildClarifySessionStartInputPacket({
        sessionId: cleanupSessionId,
        currentState: "C_DIRECT",
        userInput: "清掉这个仓库里没用的东西，越快越好",
        skillRef,
      }),
      askPacket({
        sessionId: cleanupSessionId,
        id: "q_cleanup_boundary",
        title: "先定边界",
        question: "这次清理最该优先保护哪条边界？",
        node: "risk_resource_boundary",
        choices: [
          { id: "audit", label: "先出清单", description: "确认后再删除" },
          { id: "safe", label: "安全清理", description: "先排除成果" },
          { id: "space", label: "最大释放", description: "先标高占用项" },
        ],
      }),
      "先定边界：这次清理最该优先保护哪条边界？",
      ["删除风险先问边界", "不默认删除"],
    ),
    turn(
      "contradictory-demand",
      "不要改代码，但把这个 bug 修好并跑通",
      buildClarifySessionStartInputPacket({
        sessionId: conflictSessionId,
        currentState: "C_DIRECT",
        userInput: "不要改代码，但把这个 bug 修好并跑通",
        skillRef,
      }),
      askPacket({
        sessionId: conflictSessionId,
        id: "q_conflict",
        title: "先解冲突",
        question: "“不改代码”和“修好”冲突，按哪条边界走？",
        node: "contradiction_resolution",
        choices: [
          { id: "diagnose", label: "只诊断", description: "不改文件给证据" },
          { id: "patch", label: "允许修复", description: "最小改动并验证" },
        ],
      }),
      "先解冲突：“不改代码”和“修好”冲突，按哪条边界走？",
      ["矛盾需求只问一个决策", "不擅自改目标"],
    ),
  ];

  return {
    sessionId: mainSessionId,
    transcriptVerbatim,
    approvedCeoTaskCardVerbatim,
    turns,
    auxiliaryTurns,
    repairPacket: buildClarifyRepairInputPacket({
      sessionId: mainSessionId,
      previousState: "C_ASK",
      intendedOutputState: "C_ASK",
      badOutput: '{"type":"clarify","code":"C_ASK"}',
      schemaErrors: ["C_ASK packets must include content.question_card"],
      transitionErrors: [],
      skillRef,
    }),
  };
}

export function validateClarifyUserSimulationReport(
  report: ClarifyUserSimulationReport,
): ClarifyUserSimulationValidation {
  const failures: string[] = [];
  const allTurns = [...report.turns, ...report.auxiliaryTurns];
  const requiredTurnIds = [
    "hi",
    "vague-large-task",
    "threejs-pathtracing",
    "branch-choice-answer",
    "note-only-answer",
    "you-decide-task-card",
    "stop-clarify-enough",
    "unclear-acceptance",
    "risk-delete-boundary",
    "contradictory-demand",
    "task-card-confirm",
    "goal-card-confirm",
  ];

  for (const id of requiredTurnIds) {
    if (!allTurns.some((turn) => turn.id === id)) {
      failures.push(`missing user simulation turn: ${id}`);
    }
  }

  for (const turn of allTurns) {
    const inputParse = ClarifyProviderRuntimeInputPacketSchema.safeParse(turn.inputPacket);
    if (!inputParse.success) {
      failures.push(`${turn.id}: input packet failed schema validation`);
    }
    const controls = "controls" in turn.inputPacket ? turn.inputPacket.controls : undefined;
    if (controls && (!controls.clarify_strength || !controls.effective_clarify_strength)) {
      failures.push(`${turn.id}: input packet must carry clarify controls`);
    }
    if (!controls && turn.inputPacket.type !== "clarify_repair") {
      failures.push(`${turn.id}: input packet missing clarify controls`);
    }
    const outputParse = ClarifyRuntimePacketSchema.safeParse(turn.outputPacket);
    if (!outputParse.success) {
      failures.push(`${turn.id}: output packet failed schema validation`);
    }
    const inputJson = JSON.stringify(turn.inputPacket);
    if (inputJson.includes("## State Codes") || inputJson.includes("## Transition Rules")) {
      failures.push(`${turn.id}: input packet repeats full Skill rules`);
    }
    if (turn.inputPacket.type === "clarify_turn" && "skill_ref" in turn.inputPacket) {
      failures.push(`${turn.id}: normal turn must not include skill_ref`);
    }
    if (
      turn.inputPacket.type !== "clarify_turn" &&
      !("skill_ref" in turn.inputPacket) &&
      turn.id !== "hi"
    ) {
      failures.push(`${turn.id}: transition/session packet must include skill_ref`);
    }
    for (const internal of [CLARIFY_SKILL_ID, "skill_ref", "C_ASK", "C_TASK_CARD", "provider"]) {
      if (turn.uiProjection.includes(internal)) {
        failures.push(`${turn.id}: UI projection leaks internal marker ${internal}`);
      }
    }
  }

  const taskTurn = report.turns.find((turn) => turn.id === "you-decide-task-card");
  const goalTurn = report.turns.find((turn) => turn.id === "task-card-confirm");
  const taskProvenance = taskTurn ? packetProvenance(taskTurn.outputPacket) : undefined;
  const goalProvenance = goalTurn ? packetProvenance(goalTurn.outputPacket) : undefined;
  if (
    taskTurn?.outputPacket.code !== "C_TASK_CARD" ||
    taskProvenance?.clarify_transcript_verbatim !== report.transcriptVerbatim
  ) {
    failures.push("C_TASK_CARD must carry full simulation transcript verbatim");
  }
  if (
    goalTurn?.outputPacket.code !== "C_GOAL_CARD" ||
    goalProvenance?.clarify_transcript_verbatim !== report.transcriptVerbatim ||
    goalProvenance?.approved_ceo_task_card_verbatim !== report.approvedCeoTaskCardVerbatim
  ) {
    failures.push("C_GOAL_CARD must carry transcript plus approved CEO Task Card verbatim");
  }

  if (
    report.repairPacket.type !== "clarify_repair" ||
    !report.repairPacket.repair_instruction.includes("repair packet shape only") ||
    !report.repairPacket.repair_instruction.includes("do not reinterpret user intent") ||
    !report.repairPacket.repair_instruction.includes("do not fabricate transcript") ||
    !report.repairPacket.repair_instruction.includes("do not change approved CEO Task Card")
  ) {
    failures.push("repair packet must repair shape/provenance only without semantic changes");
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
