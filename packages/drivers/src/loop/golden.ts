import type {
  ThothLoopPlanExecResultInput,
  ThothLoopReviewOutcome,
  ThothLoopReviewVerdictInput,
  ThothRuntimeLoopStrength,
} from "@thoth/protocol/thoth-runtime-contract";

export type LoopGoldenExpectedEvaluation = "pass" | "fail";

export interface LoopGoldenBudgetTransition {
  beforeUsedFailedReviews: number;
  afterUsedFailedReviews: number;
  maxFailedReviews: number;
  reviewOutcome?: ThothLoopReviewOutcome;
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

export interface LoopGoldenReviewProtocol {
  independentAssessmentBeforePlanExecAccount: boolean;
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
  reviewProtocol?: LoopGoldenReviewProtocol;
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
      plan_summary: "Implement only the approved API surface.",
      execution_summary: "Implemented the approved API and focused tests.",
      evidence: ["Focused unit tests pass.", "AgentTimeline includes edit and shell evidence."],
      validation_performed: ["Ran the focused unit tests."],
      remaining_risks: [],
      next_review_focus: "Verify the API matches the approved acceptance only.",
    },
    reviewProtocol: { independentAssessmentBeforePlanExecAccount: true },
    reviewVerdict: {
      outcome: "pass",
      summary: "The current goal satisfies the approved acceptance.",
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
      plan_summary: "Address the second approved goal only.",
      execution_summary: "Updated the implementation but left one acceptance unverified.",
      evidence: ["Edit evidence exists.", "No focused test evidence was produced."],
      validation_performed: [],
      remaining_risks: ["The acceptance proof may be incomplete."],
      next_review_focus: "Check whether the unverified acceptance has real evidence.",
    },
    reviewProtocol: { independentAssessmentBeforePlanExecAccount: true },
    reviewVerdict: {
      outcome: "continue",
      summary: "The implementation lacks evidence for one approved acceptance.",
      evidence_summary: "Review found code edits but no focused test evidence.",
      direction_memo: {
        conclusion: "The goal is not ready to pass.",
        reality: ["The required focused proof is absent."],
        diagnosis: "PlanExec changed code without demonstrating the approved behavior.",
        abandon: ["Stop treating implementation prose as proof."],
        reframe: "The next attempt must center the missing observable acceptance.",
        next_direction:
          "Create and pass focused proof for the exact acceptance before any cleanup.",
      },
    },
    budgetTransition: {
      beforeUsedFailedReviews: 0,
      afterUsedFailedReviews: 1,
      maxFailedReviews: 5,
      reviewOutcome: "continue",
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
    reviewProtocol: { independentAssessmentBeforePlanExecAccount: true },
    reviewVerdict: {
      outcome: "continue",
      summary: "The first goal failed and Single budget is exhausted.",
      evidence_summary: "Review found no sufficient evidence.",
      direction_memo: {
        conclusion: "The current goal remains unproven.",
        reality: ["No sufficient implementation evidence is available."],
        diagnosis: "The required behavior has not been established in the workspace.",
        abandon: ["Do not silently advance or repeat the same unsupported claim."],
        reframe: "Treat evidence creation as the immediate goal before further scope work.",
        next_direction:
          "Obtain direct proof of the missing behavior after an explicit budget decision.",
      },
    },
    budgetTransition: {
      beforeUsedFailedReviews: 0,
      afterUsedFailedReviews: 1,
      maxFailedReviews: 1,
      reviewOutcome: "continue",
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
    reviewProtocol: { independentAssessmentBeforePlanExecAccount: true },
    reviewVerdict: {
      outcome: "real_blocker",
      summary: "Review cannot validate because required external service is unavailable.",
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
    id: "review-permission-denied-does-not-consume-review-budget",
    title: "Review permission denial is a provider exit, not a semantic verdict",
    loopStrength: "balanced",
    goalCount: 8,
    currentGoalOrder: 3,
    currentRound: 1,
    providerFailure: {
      phase: "review",
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
    expectedBehavior: ["Review permission denial preserves failed-review budget"],
    forbiddenBehavior: ["invent a Review verdict", "consume failed-review budget"],
  },
  {
    id: "planexec-provider-crash-does-not-consume-review-budget",
    title: "PlanExec provider crash is an operational exit",
    loopStrength: "light",
    goalCount: 4,
    currentGoalOrder: 2,
    currentRound: 2,
    providerFailure: {
      phase: "planexec",
      exitStatus: "failed",
      modeledAsReviewFailure: false,
    },
    budgetTransition: {
      beforeUsedFailedReviews: 1,
      afterUsedFailedReviews: 1,
      maxFailedReviews: 5,
      providerExitStatus: "failed",
      expectedTaskStatus: "blocked",
    },
    expectedBehavior: ["provider crash preserves failed-review budget"],
    forbiddenBehavior: ["invent a Review verdict", "advance the goal"],
  },
  {
    id: "review-provider-crash-does-not-consume-review-budget",
    title: "Review provider crash does not become a failed Review",
    loopStrength: "light",
    goalCount: 4,
    currentGoalOrder: 2,
    currentRound: 2,
    providerFailure: {
      phase: "review",
      exitStatus: "failed",
      modeledAsReviewFailure: false,
    },
    budgetTransition: {
      beforeUsedFailedReviews: 1,
      afterUsedFailedReviews: 1,
      maxFailedReviews: 5,
      providerExitStatus: "failed",
      expectedTaskStatus: "blocked",
    },
    expectedBehavior: ["Review crash preserves failed-review budget and prior task truth"],
    forbiddenBehavior: ["fabricate continue", "consume failed-review budget"],
  },
  {
    id: "provider-timeout-is-runtime-blocker-not-review-continue",
    title: "Review timeout remains an operational exit without a semantic verdict",
    loopStrength: "balanced",
    goalCount: 8,
    currentGoalOrder: 4,
    currentRound: 1,
    providerFailure: {
      phase: "review",
      exitStatus: "timeout",
      modeledAsReviewFailure: false,
    },
    budgetTransition: {
      beforeUsedFailedReviews: 3,
      afterUsedFailedReviews: 3,
      maxFailedReviews: 10,
      providerExitStatus: "timeout",
      expectedTaskStatus: "blocked",
    },
    expectedBehavior: ["timeout preserves failed-review budget and awaits recovery"],
    forbiddenBehavior: ["convert timeout into continue", "consume failed-review budget"],
  },
  {
    id: "negative-provider-failure-modeled-as-review-continue",
    title: "negative fixture: provider failure cannot masquerade as Review continue",
    loopStrength: "light",
    goalCount: 4,
    currentGoalOrder: 2,
    currentRound: 1,
    expectedEvaluation: "fail",
    expectedFailures: [
      "Provider or permission failure must not consume failed-review budget",
      "Provider or permission failure is incorrectly modeled as Review failure",
    ],
    providerFailure: {
      phase: "review",
      exitStatus: "failed",
      modeledAsReviewFailure: true,
    },
    budgetTransition: {
      beforeUsedFailedReviews: 0,
      afterUsedFailedReviews: 1,
      maxFailedReviews: 5,
      reviewOutcome: "continue",
      providerExitStatus: "failed",
      expectedTaskStatus: "running",
    },
    expectedBehavior: ["deterministic eval rejects operational failure as Review continue"],
    forbiddenBehavior: ["consume failed-review budget", "invent a semantic verdict"],
  },
  {
    id: "all-goals-done-after-linear-pass",
    title: "task is done only after every linear goal has passed Review",
    loopStrength: "balanced",
    goalCount: 3,
    currentGoalOrder: 3,
    currentRound: 1,
    reviewProtocol: { independentAssessmentBeforePlanExecAccount: true },
    reviewVerdict: {
      outcome: "pass",
      summary: "The final goal satisfies its approved acceptance.",
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
    expectedFailures: ["Review pass evidence must bind its conclusion to concrete reality"],
    reviewProtocol: { independentAssessmentBeforePlanExecAccount: true },
    reviewVerdict: {
      outcome: "pass",
      summary: "Tests passed.",
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
    reviewProtocol: { independentAssessmentBeforePlanExecAccount: true },
    reviewVerdict: {
      outcome: "real_blocker",
      summary: "Review changed source while investigating.",
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
  {
    id: "negative-review-skips-independent-assessment",
    title: "negative fixture: Review must assess independently before PlanExec account is revealed",
    loopStrength: "balanced",
    goalCount: 2,
    currentGoalOrder: 1,
    currentRound: 1,
    expectedEvaluation: "fail",
    expectedFailures: ["independent assessment before reading PlanExec account"],
    reviewProtocol: { independentAssessmentBeforePlanExecAccount: false },
    reviewVerdict: {
      outcome: "pass",
      summary: "Review copied PlanExec's conclusion before conducting its own inspection.",
      evidence_summary:
        "The current workspace behavior was independently reproduced by the focused verification command.",
    },
    expectedBehavior: ["deterministic eval rejects Review order violations"],
    forbiddenBehavior: ["read PlanExec self-report before independent investigation"],
  },
  {
    id: "negative-review-shallow-direction-memo",
    title:
      "negative fixture: failed Review needs a diagnostic Direction Memo, not an incremental hint",
    loopStrength: "light",
    goalCount: 3,
    currentGoalOrder: 2,
    currentRound: 1,
    expectedEvaluation: "fail",
    expectedFailures: ["Review direction memo is shallow or incremental"],
    reviewProtocol: { independentAssessmentBeforePlanExecAccount: true },
    reviewVerdict: {
      outcome: "continue",
      summary: "The current approach should not pass.",
      evidence_summary: "A focused check exposed an unresolved behavior gap.",
      direction_memo: {
        conclusion: "Try again.",
        reality: ["Tests failed."],
        diagnosis: "Needs more work.",
        abandon: ["Keep trying."],
        reframe: "Fix it.",
        next_direction: "Run tests again.",
      },
    },
    expectedBehavior: ["deterministic eval rejects shallow Review correction"],
    forbiddenBehavior: ["give an incremental retry hint without a real diagnosis"],
  },
  {
    id: "negative-review-daemon-budget-judgment",
    title: "negative fixture: Review must not use daemon budget mechanics as its judgment",
    loopStrength: "light",
    goalCount: 3,
    currentGoalOrder: 1,
    currentRound: 2,
    expectedEvaluation: "fail",
    expectedFailures: ["Review direction memo treats daemon mechanics as judgment"],
    reviewProtocol: { independentAssessmentBeforePlanExecAccount: true },
    reviewVerdict: {
      outcome: "continue",
      summary: "The work needs another attempt.",
      evidence_summary: "The observable behavior remains inconsistent with the approved goal.",
      direction_memo: {
        conclusion: "Continue because the failed-review budget still has capacity.",
        reality: ["The focused reproduction still returns the old incorrect result."],
        diagnosis: "The daemon has four failed-review attempts remaining.",
        abandon: ["Do not treat remaining budget as implementation evidence."],
        reframe: "The next attempt should target the observed incorrect result.",
        next_direction: "Use the remaining budget to run another implementation pass.",
      },
    },
    expectedBehavior: ["deterministic eval rejects daemon accounting as Review reasoning"],
    forbiddenBehavior: ["judge the goal from loop strength or remaining budget"],
  },
  {
    id: "negative-review-pass-consumes-budget",
    title: "negative fixture: a passing Review must not consume failed-review budget",
    loopStrength: "one_plan_one_do",
    goalCount: 1,
    currentGoalOrder: 1,
    currentRound: 1,
    expectedEvaluation: "fail",
    expectedFailures: ["Review pass must not consume failed-review budget"],
    reviewProtocol: { independentAssessmentBeforePlanExecAccount: true },
    reviewVerdict: {
      outcome: "pass",
      summary: "The approved goal is complete.",
      evidence_summary:
        "Focused verification reproduced the approved behavior and found no remaining contract gap.",
    },
    budgetTransition: {
      beforeUsedFailedReviews: 0,
      afterUsedFailedReviews: 1,
      maxFailedReviews: 1,
      reviewOutcome: "pass",
      expectedTaskStatus: "done",
    },
    expectedBehavior: ["deterministic eval rejects a pass that consumes retry allowance"],
    forbiddenBehavior: ["consume failed-review budget after Review pass"],
  },
];
