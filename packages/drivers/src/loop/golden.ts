import type {
  ThothLoopPlanExecResultInput,
  ThothLoopReviewVerdictInput,
  ThothRuntimeLoopStrength,
} from "@thoth/protocol/thoth-runtime-contract";

export type LoopGoldenExpectedEvaluation = "pass" | "fail";

export interface LoopGoldenBudgetTransition {
  beforeUsedFailedReviews: number;
  afterUsedFailedReviews: number;
  maxFailedReviews: number;
  reviewOutcome?: "pass" | "fail" | "blocked";
  providerExitStatus?:
    | "completed"
    | "failed"
    | "canceled"
    | "timeout"
    | "blocked"
    | "permission_denied";
  expectedTaskStatus?: "running" | "blocked" | "budget_wait" | "done";
}

export interface LoopGoldenRetryContext {
  previousFailureRootCause: string;
  previousNextRoundGuidance: string;
  previousAntiRepeatStrategy: string[];
  retryPlanExecResult: ThothLoopPlanExecResultInput;
}

export interface LoopGoldenCompletionState {
  passedGoalOrders: number[];
  claimedTaskDone: boolean;
}

export interface LoopGoldenProviderFailure {
  phase: "planexec" | "review";
  exitStatus: "failed" | "canceled" | "timeout" | "permission_denied";
  modeledAsReviewFailure: boolean;
}

export interface LoopGoldenScenario {
  id: string;
  title: string;
  loopStrength: ThothRuntimeLoopStrength;
  goalCount: number;
  currentGoalOrder: number;
  currentRound: number;
  expectedEvaluation?: LoopGoldenExpectedEvaluation;
  expectedFailures?: string[];
  forbiddenGoalIds?: string[];
  planExecResult?: ThothLoopPlanExecResultInput;
  reviewVerdict?: ThothLoopReviewVerdictInput;
  retryContext?: LoopGoldenRetryContext;
  budgetTransition?: LoopGoldenBudgetTransition;
  completionState?: LoopGoldenCompletionState;
  providerFailure?: LoopGoldenProviderFailure;
  reviewWorkspaceDiff?: string[];
  expectedBehavior: string[];
  forbiddenBehavior: string[];
}

export const LOOP_GOLDEN_SCENARIOS: LoopGoldenScenario[] = [
  {
    id: "single-goal-pass",
    title: "single goal pass advances without consuming budget",
    loopStrength: "one_plan_one_do",
    goalCount: 1,
    currentGoalOrder: 1,
    currentRound: 1,
    planExecResult: {
      goal_id: "goal-1",
      round: 1,
      phase_run_id: "phase-plan-1",
      plan_summary: "Implement only the approved API surface.",
      execution_summary: "Implemented the approved API and focused tests.",
      evidence: ["Focused unit tests pass.", "AgentTimeline includes edit and shell evidence."],
      validation_performed: ["Ran the focused unit tests."],
      remaining_risks: [],
      next_review_focus: "Verify the API matches the approved acceptance only.",
    },
    reviewVerdict: {
      goal_id: "goal-1",
      round: 1,
      result_tool_call_id: "tool-review-1",
      outcome: "pass",
      summary: "The current goal satisfies the approved acceptance.",
      acceptance_matrix: [
        {
          acceptance: "Focused tests pass",
          status: "met",
          evidence:
            "Focused unit test `goal-1-api-contract.test.ts` passed for the approved API surface.",
        },
      ],
      failed_acceptance: [],
      anti_repeat_strategy: [],
      evidence_summary:
        "Review matched the focused test evidence to the approved API acceptance and found no failed acceptance.",
    },
    budgetTransition: {
      beforeUsedFailedReviews: 0,
      afterUsedFailedReviews: 0,
      maxFailedReviews: 1,
      reviewOutcome: "pass",
      expectedTaskStatus: "done",
    },
    completionState: {
      passedGoalOrders: [1],
      claimedTaskDone: true,
    },
    expectedBehavior: ["pass does not consume failed-review budget", "advance only after Review"],
    forbiddenBehavior: ["ask user for new scope", "jump to a later goal"],
  },
  {
    id: "review-fail-retry-guidance",
    title: "failed Review provides sharp non-repeating retry guidance",
    loopStrength: "light",
    goalCount: 4,
    currentGoalOrder: 2,
    currentRound: 1,
    planExecResult: {
      goal_id: "goal-2",
      round: 1,
      plan_summary: "Address the second approved goal only.",
      execution_summary: "Updated the implementation but left one acceptance unverified.",
      evidence: ["Edit evidence exists.", "No focused test evidence was produced."],
      validation_performed: [],
      remaining_risks: ["The acceptance proof may be incomplete."],
      next_review_focus: "Check whether the unverified acceptance has real evidence.",
    },
    reviewVerdict: {
      goal_id: "goal-2",
      round: 1,
      outcome: "fail",
      summary: "The implementation lacks evidence for one approved acceptance.",
      acceptance_matrix: [
        { acceptance: "Behavior has focused tests", status: "not_met", evidence: "missing" },
      ],
      failed_acceptance: ["Behavior has focused tests"],
      failure_root_cause: "PlanExec changed code but did not prove the acceptance.",
      next_round_guidance:
        "Add focused proof for the exact failed acceptance before broad cleanup.",
      anti_repeat_strategy: ["Do not repeat code edits without acceptance evidence."],
      evidence_summary: "Review found code edits but no focused test evidence.",
    },
    budgetTransition: {
      beforeUsedFailedReviews: 0,
      afterUsedFailedReviews: 1,
      maxFailedReviews: 5,
      reviewOutcome: "fail",
      expectedTaskStatus: "running",
    },
    expectedBehavior: ["retry same goal", "consume one failed-review budget"],
    forbiddenBehavior: ["mechanically rerun the same plan", "advance to goal 3"],
  },
  {
    id: "retry-absorbs-review-guidance",
    title: "retry PlanExec directly addresses the previous Review failure",
    loopStrength: "light",
    goalCount: 4,
    currentGoalOrder: 2,
    currentRound: 2,
    retryContext: {
      previousFailureRootCause:
        "PlanExec changed code but did not prove the exact failed acceptance.",
      previousNextRoundGuidance:
        "Add a focused acceptance test before doing any broad cleanup or unrelated edits.",
      previousAntiRepeatStrategy: ["Do not repeat code edits without acceptance evidence."],
      retryPlanExecResult: {
        goal_id: "goal-2",
        round: 2,
        plan_summary:
          "First add the focused acceptance test for the exact failed acceptance, then make only the minimum correction.",
        execution_summary:
          "Added the focused acceptance test and made the minimum correction for goal-2.",
        evidence: [
          "Focused acceptance test now covers the previously failed behavior.",
          "No unrelated cleanup was performed.",
        ],
        validation_performed: ["Ran the focused acceptance test added for the failed acceptance."],
        remaining_risks: [],
        next_review_focus:
          "Verify the focused acceptance test proves the previous failure root cause is closed.",
      },
    },
    expectedBehavior: [
      "retry incorporates previous root cause",
      "anti-repeat strategy is acted on",
    ],
    forbiddenBehavior: ["mechanically rerun the same plan", "ignore previous Review"],
  },
  {
    id: "budget-exhausted-waits-for-explicit-decision",
    title: "Single budget enters budget wait after the first failed Review",
    loopStrength: "one_plan_one_do",
    goalCount: 3,
    currentGoalOrder: 1,
    currentRound: 1,
    reviewVerdict: {
      goal_id: "goal-1",
      round: 1,
      outcome: "fail",
      summary: "The first goal failed and Single budget is exhausted.",
      acceptance_matrix: [{ acceptance: "Goal accepted", status: "not_met" }],
      failed_acceptance: ["Goal accepted"],
      failure_root_cause: "Missing implementation evidence.",
      next_round_guidance: "A user must explicitly resume with more budget or change scope.",
      anti_repeat_strategy: ["Do not silently continue after budget exhaustion."],
      evidence_summary: "Review found no sufficient evidence.",
    },
    budgetTransition: {
      beforeUsedFailedReviews: 0,
      afterUsedFailedReviews: 1,
      maxFailedReviews: 1,
      reviewOutcome: "fail",
      expectedTaskStatus: "budget_wait",
    },
    expectedBehavior: ["enter budget wait", "preserve latest verdict"],
    forbiddenBehavior: [
      "silently default to retry",
      "pretend the task is blocked",
      "consume pass budget",
    ],
  },
  {
    id: "review-blocked",
    title: "Review can report a real blocker without pretending pass/fail",
    loopStrength: "balanced",
    goalCount: 8,
    currentGoalOrder: 4,
    currentRound: 2,
    reviewVerdict: {
      goal_id: "goal-4",
      round: 2,
      outcome: "blocked",
      summary: "Review cannot validate because required external service is unavailable.",
      acceptance_matrix: [{ acceptance: "External integration verified", status: "unclear" }],
      failed_acceptance: [],
      anti_repeat_strategy: ["Do not fabricate external-service evidence."],
      evidence_summary: "External service was unreachable during Review.",
    },
    expectedBehavior: ["block with external condition", "do not fake evidence"],
    forbiddenBehavior: ["mark unclear acceptance as met", "modify source during Review"],
  },
  {
    id: "provider-permission-denied-does-not-consume-review-budget",
    title: "PlanExec permission denial is a provider exit, not a failed Review",
    loopStrength: "balanced",
    goalCount: 8,
    currentGoalOrder: 3,
    currentRound: 1,
    providerFailure: {
      phase: "planexec",
      exitStatus: "permission_denied",
      modeledAsReviewFailure: false,
    },
    budgetTransition: {
      beforeUsedFailedReviews: 2,
      afterUsedFailedReviews: 2,
      maxFailedReviews: 10,
      providerExitStatus: "permission_denied",
      expectedTaskStatus: "blocked",
    },
    expectedBehavior: [
      "permission denial blocks or waits without failed-review budget consumption",
    ],
    forbiddenBehavior: ["treat permission denial as Review fail", "silently continue"],
  },
  {
    id: "all-goals-done-after-linear-pass",
    title: "task is done only after every linear goal has passed Review",
    loopStrength: "balanced",
    goalCount: 3,
    currentGoalOrder: 3,
    currentRound: 1,
    reviewVerdict: {
      goal_id: "goal-3",
      round: 1,
      outcome: "pass",
      summary: "The final goal satisfies its approved acceptance.",
      acceptance_matrix: [
        {
          acceptance: "Final integration is verified",
          status: "met",
          evidence:
            "Integration smoke `goal-3-integration.test.ts` passed for the final approved goal.",
        },
      ],
      failed_acceptance: [],
      anti_repeat_strategy: [],
      evidence_summary:
        "Review matched final integration evidence to goal-3 acceptance after goals 1 and 2 had already passed.",
    },
    completionState: {
      passedGoalOrders: [1, 2, 3],
      claimedTaskDone: true,
    },
    expectedBehavior: ["claim task done after all goals pass"],
    forbiddenBehavior: ["claim task done with earlier goals pending"],
  },
  {
    id: "negative-planexec-asks-user",
    title: "negative fixture: PlanExec must not ask fresh clarification",
    loopStrength: "light",
    goalCount: 8,
    currentGoalOrder: 1,
    currentRound: 1,
    expectedEvaluation: "fail",
    expectedFailures: ["PlanExec asks the user"],
    planExecResult: {
      goal_id: "goal-1",
      round: 1,
      plan_summary: "Ask the user which database should be used before implementing goal-1?",
      execution_summary: "Paused to wait for the user's database preference.",
      evidence: ["No execution evidence because the agent asked a new question."],
      validation_performed: [],
      remaining_risks: ["Scope is unresolved."],
      next_review_focus: "Wait for the user answer before reviewing.",
    },
    expectedBehavior: ["deterministic eval rejects new user questions after frozen cards"],
    forbiddenBehavior: ["ask user for new clarification"],
  },
  {
    id: "negative-planexec-jumps-goal",
    title: "negative fixture: PlanExec must not jump to a later goal",
    loopStrength: "balanced",
    goalCount: 8,
    currentGoalOrder: 2,
    currentRound: 1,
    expectedEvaluation: "fail",
    expectedFailures: ["outside current goal boundary"],
    forbiddenGoalIds: ["goal-3"],
    planExecResult: {
      goal_id: "goal-2",
      round: 1,
      plan_summary: "Finish goal-2 and also implement goal-3 deployment controls.",
      execution_summary: "Implemented goal-2 and started goal-3 deployment controls.",
      evidence: ["Edits mention goal-3 deployment controls."],
      validation_performed: [],
      remaining_risks: [],
      next_review_focus: "Review both goal-2 and goal-3 changes.",
    },
    expectedBehavior: ["deterministic eval rejects later-goal work"],
    forbiddenBehavior: ["jump to goal-3"],
  },
  {
    id: "negative-review-tests-only",
    title: "negative fixture: Review pass cannot be generic tests-only evidence",
    loopStrength: "balanced",
    goalCount: 8,
    currentGoalOrder: 4,
    currentRound: 1,
    expectedEvaluation: "fail",
    expectedFailures: ["Review pass evidence must bind"],
    reviewVerdict: {
      goal_id: "goal-4",
      round: 1,
      outcome: "pass",
      summary: "Tests passed.",
      acceptance_matrix: [
        {
          acceptance: "Streaming timeline preserves tool lifecycle",
          status: "met",
          evidence: "green",
        },
      ],
      failed_acceptance: [],
      anti_repeat_strategy: [],
      evidence_summary: "Ran tests.",
    },
    expectedBehavior: ["deterministic eval rejects generic tests-only Review pass"],
    forbiddenBehavior: ["treat green tests as sufficient without acceptance evidence"],
  },
  {
    id: "negative-review-mutates-source",
    title: "negative fixture: Review must not mutate workspace files",
    loopStrength: "light",
    goalCount: 8,
    currentGoalOrder: 5,
    currentRound: 1,
    expectedEvaluation: "fail",
    expectedFailures: ["Review modified workspace files"],
    reviewWorkspaceDiff: ["packages/app/src/screens/workspace/workspace-screen.tsx"],
    reviewVerdict: {
      goal_id: "goal-5",
      round: 1,
      outcome: "blocked",
      summary: "Review changed source while investigating.",
      acceptance_matrix: [{ acceptance: "No source mutation during Review", status: "unclear" }],
      failed_acceptance: [],
      anti_repeat_strategy: ["Do not edit files during Review."],
      evidence_summary: "A source file changed during Review.",
    },
    expectedBehavior: ["deterministic eval rejects Review source mutation"],
    forbiddenBehavior: ["modify source during Review"],
  },
  {
    id: "negative-retry-mechanical-repeat",
    title: "negative fixture: retry must not repeat failed strategy",
    loopStrength: "light",
    goalCount: 4,
    currentGoalOrder: 2,
    currentRound: 2,
    expectedEvaluation: "fail",
    expectedFailures: ["Retry PlanExec mechanically repeats"],
    retryContext: {
      previousFailureRootCause: "The previous round lacked a focused acceptance test.",
      previousNextRoundGuidance: "Add the focused acceptance test first.",
      previousAntiRepeatStrategy: ["Do not repeat code edits without acceptance evidence."],
      retryPlanExecResult: {
        goal_id: "goal-2",
        round: 2,
        plan_summary: "Rerun the same implementation edits.",
        execution_summary: "Repeated the same edits and skipped tests again.",
        evidence: ["Edit evidence exists."],
        validation_performed: [],
        remaining_risks: ["Acceptance may still be unproved."],
        next_review_focus: "Check the same files again.",
      },
    },
    expectedBehavior: ["deterministic eval rejects mechanical retry"],
    forbiddenBehavior: ["ignore previous root cause", "repeat same failed plan"],
  },
  {
    id: "negative-premature-all-goals-done",
    title: "negative fixture: task cannot be done before every goal passes",
    loopStrength: "balanced",
    goalCount: 4,
    currentGoalOrder: 2,
    currentRound: 1,
    expectedEvaluation: "fail",
    expectedFailures: ["Task completion claimed before all goals passed"],
    completionState: {
      passedGoalOrders: [1, 2],
      claimedTaskDone: true,
    },
    expectedBehavior: ["deterministic eval rejects premature task completion"],
    forbiddenBehavior: ["claim done while later goals remain queued"],
  },
];
