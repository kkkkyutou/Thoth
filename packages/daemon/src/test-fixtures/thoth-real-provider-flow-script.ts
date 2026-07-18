import type {
  ThothLoopPlanExecResultInput,
  ThothLoopReviewIndependentAssessmentInput,
  ThothLoopReviewVerdictInput,
  ThothSubmitClarifyCardInput,
  ThothSubmitGoalsCardInput,
  ThothSubmitTaskCardInput,
} from "@thoth/protocol/thoth-runtime-contract";

export type ThothRealProviderFlowId =
  | "UT-01-quick-direct-passthrough"
  | "UT-02-quick-clarify-foreground-success"
  | "UT-03-quick-clarify-pause-recover-resume"
  | "UT-04-loop-linear-all-pass"
  | "UT-05-loop-retry-and-budget";

export interface ThothRealProviderFlowScript {
  id: ThothRealProviderFlowId;
  finalMarker: string;
  clarify: readonly ThothSubmitClarifyCardInput[];
  task: ThothSubmitTaskCardInput | null;
  goals: ThothSubmitGoalsCardInput | null;
  planExec: readonly ThothLoopPlanExecResultInput[];
  reviewIndependent: readonly ThothLoopReviewIndependentAssessmentInput[];
  review: readonly ThothLoopReviewVerdictInput[];
}

function clarifyCard(input: {
  title: string;
  marker: string;
  readyForTask: boolean;
}): ThothSubmitClarifyCardInput {
  return {
    title: input.title,
    why_now: "Collect the next fixed answer for this verification run.",
    public_badge_summary: `Fixed branch ${input.marker} is awaiting its prescribed answer.`,
    frontier_ledger: {
      clarify_strength: "light",
      grounded_user_decisions: ["This is a fixed transport verification run."],
      remaining_material_user_owned_assumptions: input.readyForTask
        ? []
        : ["The next fixed answer has not been submitted yet."],
      agent_owned_assumptions: ["No workspace change is required."],
      discoverable_assumptions: [],
      why_this_round: "Advance the fixed authority lifecycle without autonomous decisions.",
      convergence_state: input.readyForTask ? "ready_for_task" : "not_converged",
    },
    decision_delta: {
      affected_contract_fields: ["goal", "acceptance"],
      safe_if_unanswered: "The scripted run must stop at this authority card.",
      eliminated_routes: ["Unscripted provider improvisation"],
      irreversible_or_cost_impact: "No workspace mutation is allowed in this fixture.",
      downstream_refs: ["task_card.goal", "task_card.acceptance"],
    },
    questions: [
      {
        id: `${input.marker}-scope`,
        question: "Use the first fixed scope option?",
        behavior_tree_node: `${input.marker}_scope`,
        selection_mode: "single",
        choices: [
          {
            id: `${input.marker}-scope-yes`,
            label: "Use fixed scope",
            description: "Continue the scripted run",
          },
          {
            id: `${input.marker}-scope-no`,
            label: "Stop run",
            description: "Exercise the alternate branch",
          },
        ],
      },
      {
        id: `${input.marker}-evidence`,
        question: "Use the first fixed evidence option?",
        behavior_tree_node: `${input.marker}_evidence`,
        selection_mode: "single",
        choices: [
          {
            id: `${input.marker}-evidence-yes`,
            label: "Use evidence",
            description: "Record the scripted evidence",
          },
          {
            id: `${input.marker}-evidence-no`,
            label: "Reject evidence",
            description: "Exercise the alternate branch",
          },
        ],
      },
    ],
    allow_choice_notes: true,
    allow_note_only: true,
  };
}

function taskCard(marker: string): ThothSubmitTaskCardInput {
  return {
    task_card: {
      title: `Fixed task ${marker}`,
      goal: "Verify the prescribed foreground or background authority flow.",
      constraints: ["Do not change workspace files.", "Use only the supplied fixed values."],
      acceptance: ["Every prescribed marker is recorded in the correct phase."],
    },
    provenance: {
      clarify_transcript_verbatim: "Fixed answers were submitted through the authority cards.",
    },
    convergence_review: {
      frontier_ledger: {
        clarify_strength: "light",
        grounded_user_decisions: ["Both fixed answers have been submitted."],
        remaining_material_user_owned_assumptions: [],
        agent_owned_assumptions: ["No implementation decision remains."],
        discoverable_assumptions: [],
        why_this_round: "The scripted verification has collected every required answer.",
        convergence_state: "ready_for_task",
      },
      why_task_is_now_grounded: "The fixed script has no remaining user-owned branch.",
    },
  };
}

function goalsCard(marker: string): ThothSubmitGoalsCardInput {
  return {
    goals_card: {
      title: `Fixed goals ${marker}`,
      summary: "Two linear checkpoints verify phase handoff and completion.",
      goals_count_rationale:
        "This short transport verification intentionally uses two atomic linear checkpoints.",
      goals: [
        {
          id: `${marker}-goal-1`,
          order: 1,
          title: "Fixed checkpoint one",
          goal: "Record the first prescribed phase marker.",
          constraints: ["Do not change workspace files."],
          acceptance: ["The first Review receives the first prescribed marker."],
          provenance: "Fixed verification task.",
        },
        {
          id: `${marker}-goal-2`,
          order: 2,
          title: "Fixed checkpoint two",
          goal: "Record the second prescribed phase marker after checkpoint one passes.",
          constraints: ["Do not change workspace files."],
          acceptance: ["The second Review receives the second prescribed marker."],
          provenance: "Fixed verification task.",
        },
      ],
    },
    provenance: {
      clarify_transcript_verbatim: "Fixed authority answers were supplied.",
      approved_ceo_task_card_verbatim: "The fixed task card was approved.",
    },
  };
}

function planExec(input: { marker: string }): ThothLoopPlanExecResultInput {
  return {
    plan_summary: `Prescribed plan ${input.marker}.`,
    execution_summary: `Prescribed execution ${input.marker}.`,
    evidence: [`Prescribed evidence ${input.marker}.`],
    validation_performed: [`Prescribed validation ${input.marker}.`],
    remaining_risks: [],
    next_review_focus: `Validate prescribed marker ${input.marker}.`,
  };
}

function reviewIndependent(marker: string): ThothLoopReviewIndependentAssessmentInput {
  return {
    observations: [`Independent prescribed observation ${marker}.`],
    working_theory: `Independent prescribed theory ${marker}.`,
    inspection_focus: [`Independent prescribed focus ${marker}.`],
  };
}

function reviewPass(input: { marker: string }): ThothLoopReviewVerdictInput {
  return {
    outcome: "pass",
    summary: `Prescribed Review pass ${input.marker}.`,
    evidence_summary: `Prescribed evidence summary ${input.marker}.`,
  };
}

function reviewFail(input: { marker: string }): ThothLoopReviewVerdictInput {
  return {
    outcome: "continue",
    summary: `Prescribed Review failure ${input.marker}.`,
    evidence_summary: `Prescribed failure evidence ${input.marker}.`,
    direction_memo: {
      conclusion: `Prescribed retry conclusion ${input.marker}.`,
      reality: [`Prescribed reality ${input.marker}.`],
      diagnosis: `FIXTURE_R5_ROOT_CAUSE_${input.marker}`,
      abandon: [`FIXTURE_R5_ABANDON_${input.marker}`],
      reframe: `FIXTURE_R5_REFRAME_${input.marker}`,
      next_direction: `FIXTURE_R5_GUIDANCE_${input.marker}`,
    },
  };
}

const u2ClarifyOne = clarifyCard({
  title: "Fixture foreground branch one",
  marker: "UT02_C1",
  readyForTask: false,
});
const u2ClarifyTwo = clarifyCard({
  title: "Fixture foreground branch two",
  marker: "UT02_C2",
  readyForTask: true,
});
const u3ClarifyOne = clarifyCard({
  title: "Fixture recovery branch one",
  marker: "UT03_C1",
  readyForTask: false,
});
const u3ClarifyTwo = clarifyCard({
  title: "Fixture recovery branch two",
  marker: "UT03_C2",
  readyForTask: true,
});
const u4Clarify = clarifyCard({
  title: "Fixture loop pass branch",
  marker: "UT04_C1",
  readyForTask: true,
});
const u5Clarify = clarifyCard({
  title: "Fixture loop retry branch",
  marker: "UT05_C1",
  readyForTask: true,
});

export const THOTH_REAL_PROVIDER_FLOW_SCRIPTS = {
  quickDirect: {
    id: "UT-01-quick-direct-passthrough",
    finalMarker: "DIRECT_DONE",
    clarify: [],
    task: null,
    goals: null,
    planExec: [],
    reviewIndependent: [],
    review: [],
  },
  quickClarifyForeground: {
    id: "UT-02-quick-clarify-foreground-success",
    finalMarker: "FOREGROUND_EXEC_DONE",
    clarify: [u2ClarifyOne, u2ClarifyTwo],
    task: taskCard("UT02"),
    goals: goalsCard("UT02"),
    planExec: [],
    reviewIndependent: [],
    review: [],
  },
  quickClarifyRecovery: {
    id: "UT-03-quick-clarify-pause-recover-resume",
    finalMarker: "RESUMED_FOREGROUND_DONE",
    clarify: [u3ClarifyOne, u3ClarifyTwo],
    task: taskCard("UT03"),
    goals: goalsCard("UT03"),
    planExec: [],
    reviewIndependent: [],
    review: [],
  },
  loopLinearPass: {
    id: "UT-04-loop-linear-all-pass",
    finalMarker: "LOOP_LINEAR_DONE",
    clarify: [u4Clarify],
    task: taskCard("UT04"),
    goals: goalsCard("UT04"),
    planExec: [planExec({ marker: "UT04_G1_R1" }), planExec({ marker: "UT04_G2_R1" })],
    reviewIndependent: [reviewIndependent("UT04_G1_R1"), reviewIndependent("UT04_G2_R1")],
    review: [reviewPass({ marker: "UT04_G1_R1" }), reviewPass({ marker: "UT04_G2_R1" })],
  },
  loopRetryAndBudget: {
    id: "UT-05-loop-retry-and-budget",
    finalMarker: "LOOP_RETRY_DONE",
    clarify: [u5Clarify],
    task: taskCard("UT05"),
    goals: goalsCard("UT05"),
    planExec: [
      planExec({ marker: "UT05_G1_R1" }),
      planExec({ marker: "UT05_G1_R2" }),
      planExec({ marker: "UT05_G2_R1" }),
    ],
    reviewIndependent: [
      reviewIndependent("UT05_G1_R1"),
      reviewIndependent("UT05_G1_R2"),
      reviewIndependent("UT05_G2_R1"),
    ],
    review: [
      reviewFail({ marker: "UT05_G1_R1" }),
      reviewPass({ marker: "UT05_G1_R2" }),
      reviewPass({ marker: "UT05_G2_R1" }),
    ],
  },
} as const satisfies Record<string, ThothRealProviderFlowScript>;

function literalCall(name: string, input: unknown): string {
  return `Call ${name} exactly once with this JSON argument:\n${JSON.stringify(input)}`;
}

function backgroundPhaseScript(script: ThothRealProviderFlowScript): string {
  if (script.planExec.length === 0) {
    return "";
  }
  return [
    "BACKGROUND PHASE ACTORS:",
    "A PlanExec agent must locate the entry matching its current goal title and round, then make exactly that call. It must not inspect, write, or otherwise change the workspace. Thoth binds goal and attempt identity itself.",
    ...script.planExec.map((input) => literalCall("thoth_loop_submit_planexec_result", input)),
    "A Review agent must locate the entries matching its current goal title and semantic retry context. It must first submit the matching independent assessment, wait for the tool result, then submit the matching final verdict. It must not inspect, write, or otherwise change the workspace.",
    "For the initial attempt of a goal, the Prior Review Direction Memo block is none, so use that goal's R1 entries. For the scripted retry in UT-05, that block contains FIXTURE_R5_GUIDANCE_UT05_G1_R1; use the literal UT05_G1_R2 entries. This is fixture routing only: do not infer or submit a phase number.",
    ...script.reviewIndependent.map((input) =>
      literalCall("thoth_loop_submit_review_independent_assessment", input),
    ),
    ...script.review.map((input) => literalCall("thoth_loop_submit_review_verdict", input)),
  ].join("\n\n");
}

export function buildRealProviderFixturePrompt(input: {
  script: ThothRealProviderFlowScript;
  startAtClarifyIndex?: number;
}): string {
  const startAt = input.startAtClarifyIndex ?? 0;
  if (input.script.clarify.length === 0) {
    return [
      `[THOTH REAL FLOW FIXTURE ${input.script.id}]`,
      "This is a deterministic provider transport test, not an implementation request.",
      "Do not inspect files, write files, call shell commands, fetch network data, or make independent decisions.",
      `Reply with exactly this text and nothing else: ${input.script.finalMarker}`,
    ].join("\n\n");
  }

  const clarifySteps = input.script.clarify.slice(startAt);
  const lines = [
    `[THOTH REAL FLOW FIXTURE ${input.script.id}]`,
    "This is a deterministic provider transport test, not an implementation request.",
    "Act only as the prescribed fixture actor. Do not inspect files, write files, call shell commands, fetch network data, or make independent decisions.",
    "Preserve every literal JSON argument exactly. Do not add fields and do not substitute values.",
    "For the visible Agent Clarify turn, make one call, wait for its user result, then perform the next numbered call.",
    ...clarifySteps.map(
      (payload, index) => `${index + 1}. ${literalCall("thoth_submit_clarify_card", payload)}`,
    ),
  ];
  if (input.script.task && input.script.goals) {
    lines.push(
      `${clarifySteps.length + 1}. ${literalCall("thoth_submit_task_card", input.script.task)}`,
      `${clarifySteps.length + 2}. ${literalCall("thoth_submit_goals_card", input.script.goals)}`,
    );
  }
  if (input.script.planExec.length === 0) {
    lines.push(
      `After the Goals Card is accepted for Quick, reply with exactly: ${input.script.finalMarker}`,
    );
  } else {
    lines.push(
      "After the Goals Card is accepted for Loop, stop the visible foreground turn. The independent background phase actors below will continue.",
      backgroundPhaseScript(input.script),
    );
  }
  return lines.join("\n\n");
}
