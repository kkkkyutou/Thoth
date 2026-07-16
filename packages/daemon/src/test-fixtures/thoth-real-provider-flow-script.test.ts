import { describe, expect, test } from "vitest";
import {
  ThothLoopPlanExecResultInputSchema,
  ThothLoopReviewIndependentAssessmentInputSchema,
  ThothLoopReviewVerdictInputSchema,
  ThothSubmitClarifyCardInputSchema,
  ThothSubmitGoalsCardInputSchema,
  ThothSubmitTaskCardInputSchema,
} from "@thoth/protocol/thoth-runtime-contract";

import {
  buildRealProviderFixturePrompt,
  THOTH_REAL_PROVIDER_FLOW_SCRIPTS,
} from "./thoth-real-provider-flow-script.js";

describe("scripted real-provider flow contract", () => {
  test.each(Object.values(THOTH_REAL_PROVIDER_FLOW_SCRIPTS))(
    "$id has schema-valid literal provider calls",
    (script) => {
      for (const input of script.clarify) {
        expect(ThothSubmitClarifyCardInputSchema.parse(input)).toEqual(input);
      }
      if (script.task) {
        expect(ThothSubmitTaskCardInputSchema.parse(script.task)).toEqual(script.task);
      }
      if (script.goals) {
        expect(ThothSubmitGoalsCardInputSchema.parse(script.goals)).toEqual(script.goals);
      }
      for (const input of script.planExec) {
        expect(ThothLoopPlanExecResultInputSchema.parse(input)).toEqual(input);
      }
      for (const input of script.reviewIndependent) {
        expect(ThothLoopReviewIndependentAssessmentInputSchema.parse(input)).toEqual(input);
      }
      for (const input of script.review) {
        expect(ThothLoopReviewVerdictInputSchema.parse(input)).toEqual(input);
      }

      const prompt = buildRealProviderFixturePrompt({ script });
      expect(prompt).toContain(`[THOTH REAL FLOW FIXTURE ${script.id}]`);
      expect(prompt).toContain("Do not inspect files, write files");
      if (script.clarify.length === 0) {
        expect(prompt).toContain(script.finalMarker);
      } else {
        expect(prompt).toContain("thoth_submit_clarify_card");
        expect(prompt).toContain("thoth_submit_task_card");
        expect(prompt).toContain("thoth_submit_goals_card");
      }
      if (script.reviewIndependent.length > 0) {
        expect(prompt).toContain("thoth_loop_submit_review_independent_assessment");
      }
    },
  );
});
