import type {
  ThothRuntimeClarifyStrength,
  ThothRuntimeLoopStrength,
  ThothRuntimeMode,
} from "@thoth/protocol/thoth-runtime-contract";

export type ThothFixtureProviderStep =
  | {
      type: "assistant_text";
      marker: string;
    }
  | {
      type: "clarify_card";
      cardId: string;
      title: string;
    }
  | {
      type: "task_card";
      cardId: string;
      title: string;
    }
  | {
      type: "goals_card";
      cardId: string;
      title: string;
    }
  | {
      type: "planexec_result";
      goalId: string;
      round: number;
      marker: string;
    }
  | {
      type: "review_verdict";
      goalId: string;
      round: number;
      outcome: "pass" | "continue";
      marker: string;
    };

export type ThothFixtureUserAction =
  | { type: "send_prompt" }
  | {
      type: "answer_card";
      cardId: string;
      intent: "submit_choices" | "accept_quick" | "accept_loop";
    }
  | { type: "cancel_card"; cardId: string }
  | { type: "switch_workspace"; workspaceId: string }
  | { type: "reload_snapshot" }
  | { type: "send_continue" };

export interface ThothFlowFixtureContract {
  id: string;
  userPrompt: string;
  composer: {
    mode: ThothRuntimeMode;
    clarifyStrength: ThothRuntimeClarifyStrength;
    loopStrength: ThothRuntimeLoopStrength | null;
  };
  providerScript: readonly ThothFixtureProviderStep[];
  userActions: readonly ThothFixtureUserAction[];
  expected: {
    finalStatus: "done" | "foreground_done" | "paused";
    expectedFailedReviews?: number;
    expectedLoopBudget?: number;
  };
}

const unitPrompt = (id: string) =>
  `[UNIT TEST FLOW=${id}] Deterministic fixture input only. No real work is requested.`;

export const THOTH_FLOW_FIXTURES = {
  quickDirect: {
    id: "UT-01-quick-direct-passthrough",
    userPrompt: unitPrompt("UT-01"),
    composer: { mode: "quick", clarifyStrength: "none", loopStrength: null },
    providerScript: [{ type: "assistant_text", marker: "DIRECT_DONE" }],
    userActions: [{ type: "send_prompt" }],
    expected: { finalStatus: "foreground_done" },
  },
  quickClarifyForeground: {
    id: "UT-02-quick-clarify-foreground-success",
    userPrompt: unitPrompt("UT-02"),
    composer: { mode: "quick", clarifyStrength: "light", loopStrength: null },
    providerScript: [
      { type: "clarify_card", cardId: "c1", title: "Fixture clarification 1" },
      { type: "clarify_card", cardId: "c2", title: "Fixture clarification 2" },
      { type: "task_card", cardId: "task-1", title: "Fixture foreground task" },
      { type: "goals_card", cardId: "goals-1", title: "Fixture foreground goals" },
      { type: "assistant_text", marker: "FOREGROUND_EXEC_DONE" },
    ],
    userActions: [
      { type: "send_prompt" },
      { type: "answer_card", cardId: "c1", intent: "submit_choices" },
      { type: "answer_card", cardId: "c2", intent: "submit_choices" },
      { type: "answer_card", cardId: "task-1", intent: "accept_quick" },
      { type: "answer_card", cardId: "goals-1", intent: "accept_quick" },
    ],
    expected: { finalStatus: "foreground_done" },
  },
  quickClarifyRecovery: {
    id: "UT-03-quick-clarify-pause-recover-resume",
    userPrompt: unitPrompt("UT-03"),
    composer: { mode: "quick", clarifyStrength: "balanced", loopStrength: null },
    providerScript: [
      { type: "clarify_card", cardId: "c1", title: "Fixture pending clarification" },
      { type: "clarify_card", cardId: "c2", title: "Fixture resumed clarification" },
      { type: "task_card", cardId: "task-1", title: "Fixture resumed task" },
      { type: "goals_card", cardId: "goals-1", title: "Fixture resumed goals" },
      { type: "assistant_text", marker: "RESUMED_FOREGROUND_DONE" },
    ],
    userActions: [
      { type: "send_prompt" },
      { type: "switch_workspace", workspaceId: "workspace-2" },
      { type: "reload_snapshot" },
      { type: "cancel_card", cardId: "c1" },
      { type: "send_continue" },
      { type: "answer_card", cardId: "c2", intent: "submit_choices" },
      { type: "answer_card", cardId: "task-1", intent: "accept_quick" },
      { type: "answer_card", cardId: "goals-1", intent: "accept_quick" },
    ],
    expected: { finalStatus: "foreground_done" },
  },
  loopLinearPass: {
    id: "UT-04-loop-linear-all-pass",
    userPrompt: unitPrompt("UT-04"),
    composer: { mode: "loop", clarifyStrength: "light", loopStrength: "one_plan_one_do" },
    providerScript: [
      { type: "clarify_card", cardId: "c1", title: "Fixture loop boundary" },
      { type: "task_card", cardId: "task-1", title: "Fixture loop task" },
      { type: "goals_card", cardId: "goals-1", title: "Fixture loop goals" },
      { type: "planexec_result", goalId: "goal-1", round: 1, marker: "GOAL_1_EXEC_DONE" },
      {
        type: "review_verdict",
        goalId: "goal-1",
        round: 1,
        outcome: "pass",
        marker: "GOAL_1_PASS",
      },
      { type: "planexec_result", goalId: "goal-2", round: 1, marker: "GOAL_2_EXEC_DONE" },
      {
        type: "review_verdict",
        goalId: "goal-2",
        round: 1,
        outcome: "pass",
        marker: "GOAL_2_PASS",
      },
    ],
    userActions: [
      { type: "send_prompt" },
      { type: "answer_card", cardId: "c1", intent: "submit_choices" },
      { type: "answer_card", cardId: "task-1", intent: "accept_loop" },
      { type: "answer_card", cardId: "goals-1", intent: "accept_loop" },
    ],
    expected: { finalStatus: "done", expectedFailedReviews: 0, expectedLoopBudget: 1 },
  },
  loopRetryAndBudget: {
    id: "UT-05-loop-retry-and-budget",
    userPrompt: unitPrompt("UT-05"),
    composer: { mode: "loop", clarifyStrength: "light", loopStrength: "light" },
    providerScript: [
      { type: "clarify_card", cardId: "c1", title: "Fixture retry boundary" },
      { type: "task_card", cardId: "task-1", title: "Fixture retry task" },
      { type: "goals_card", cardId: "goals-1", title: "Fixture retry goals" },
      { type: "planexec_result", goalId: "goal-1", round: 1, marker: "INITIAL_ATTEMPT" },
      {
        type: "review_verdict",
        goalId: "goal-1",
        round: 1,
        outcome: "continue",
        marker: "REQUIRED_FIX_MARKER_MISSING",
      },
      { type: "planexec_result", goalId: "goal-1", round: 2, marker: "APPLY_REQUIRED_FIX_MARKER" },
      {
        type: "review_verdict",
        goalId: "goal-1",
        round: 2,
        outcome: "pass",
        marker: "GOAL_1_PASS",
      },
      { type: "planexec_result", goalId: "goal-2", round: 1, marker: "GOAL_2_EXEC_DONE" },
      {
        type: "review_verdict",
        goalId: "goal-2",
        round: 1,
        outcome: "pass",
        marker: "GOAL_2_PASS",
      },
    ],
    userActions: [
      { type: "send_prompt" },
      { type: "answer_card", cardId: "c1", intent: "submit_choices" },
      { type: "answer_card", cardId: "task-1", intent: "accept_loop" },
      { type: "answer_card", cardId: "goals-1", intent: "accept_loop" },
    ],
    expected: { finalStatus: "done", expectedFailedReviews: 1, expectedLoopBudget: 5 },
  },
} as const satisfies Record<string, ThothFlowFixtureContract>;
