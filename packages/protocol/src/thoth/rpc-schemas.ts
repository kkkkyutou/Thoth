import { z } from "zod";
import {
  ClarifyFrontierLedgerSchema,
  ClarifyDecisionDeltaSchema,
  ClarifyLinearGoalContractSchema,
  ClarifyQuestionCardSchema,
  ThothRuntimeClarifyStrengthSchema,
  ThothRuntimeLoopStrengthSchema,
  ThothRuntimeModeSchema,
} from "../thoth-runtime-contract.js";

const NonEmptyStringSchema = z.string().trim().min(1);
const StringListSchema = z.array(NonEmptyStringSchema).min(1);

export const ThothTurnControlSnapshotSchema = z
  .object({
    mode: ThothRuntimeModeSchema,
    clarifyStrength: ThothRuntimeClarifyStrengthSchema.exclude(["deep"]),
    loop: ThothRuntimeLoopStrengthSchema.nullable(),
  })
  .strict();

export const ThothClarifyCardModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    roundLabel: NonEmptyStringSchema,
    roundIndex: z.number().int().positive().optional(),
    title: NonEmptyStringSchema,
    whyNow: z.string(),
    continuesClarify: z.boolean(),
    publicBadgeSummary: NonEmptyStringSchema.optional(),
    frontierLedger: ClarifyFrontierLedgerSchema.optional(),
    frontierLedgerRef: NonEmptyStringSchema.optional(),
    decisionDelta: ClarifyDecisionDeltaSchema.optional(),
    card: ClarifyQuestionCardSchema,
    submitted: z.boolean(),
    submittedSummary: NonEmptyStringSchema.optional(),
    // Persist the actual user decisions so a later foreground execution handoff
    // receives the full Clarify context rather than only a submission count.
    submittedAnswers: z
      .array(
        z
          .object({
            questionId: NonEmptyStringSchema,
            choiceIds: z.array(NonEmptyStringSchema),
            choiceNotes: z.record(NonEmptyStringSchema, z.string()).default({}),
            note: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    submittedNote: z.string().optional(),
  })
  .strict();

export const ThothTaskCardModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    roundLabel: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    constraints: StringListSchema,
    acceptance: StringListSchema,
    provenanceSummary: NonEmptyStringSchema,
    // Frozen from the composer when the user sent the turn that produced this authority flow.
    // Current controls may hot-switch independently and apply only to a later user send.
    turnControls: ThothTurnControlSnapshotSchema.optional(),
    submitted: z.boolean(),
    submittedSummary: NonEmptyStringSchema.optional(),
  })
  .strict();

export const ThothPyramidPlanSubgoalSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    acceptance: StringListSchema,
  })
  .strict();

export const ThothPyramidPlanStageSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    acceptance: StringListSchema,
    subgoals: z.array(ThothPyramidPlanSubgoalSchema),
  })
  .strict();

export const ThothGoalCardModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    roundLabel: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    summary: NonEmptyStringSchema,
    pyramid: z.array(ThothPyramidPlanStageSchema).min(1),
    provenanceSummary: NonEmptyStringSchema,
    turnControls: ThothTurnControlSnapshotSchema.optional(),
    submitted: z.boolean(),
    submittedSummary: NonEmptyStringSchema.optional(),
  })
  .strict();

export const ThothGoalsCardModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    roundLabel: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    summary: NonEmptyStringSchema,
    goalsCountRationale: z.string().optional(),
    goals: z.array(ClarifyLinearGoalContractSchema).min(1),
    provenanceSummary: NonEmptyStringSchema,
    turnControls: ThothTurnControlSnapshotSchema.optional(),
    submitted: z.boolean(),
    submittedSummary: NonEmptyStringSchema.optional(),
  })
  .strict();

export const ThothApprovalGoalCardModelSchema = z.union([
  ThothGoalsCardModelSchema,
  ThothGoalCardModelSchema,
]);

export const RegisteredTaskStatusSchema = z.enum([
  "registered_pending",
  "queued",
  "running",
  "paused",
  "blocked",
  "done",
  "stopped",
  "interrupted",
]);

export const RegisteredTaskModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    workspaceName: NonEmptyStringSchema,
    workspacePath: NonEmptyStringSchema,
    sourceAgentId: NonEmptyStringSchema,
    status: RegisteredTaskStatusSchema,
    summary: NonEmptyStringSchema,
    taskCard: ThothTaskCardModelSchema,
    goalCard: ThothApprovalGoalCardModelSchema,
    currentGoalTitle: NonEmptyStringSchema.optional(),
    currentRoundLabel: NonEmptyStringSchema.optional(),
  })
  .strict();

export const LoopUserDecisionSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    question: NonEmptyStringSchema,
    options: z
      .array(
        z
          .object({
            id: NonEmptyStringSchema,
            label: NonEmptyStringSchema,
            description: z.string().optional(),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    notePlaceholder: z.string().optional(),
    status: z.enum(["pending", "submitted", "canceled"]),
    createdAt: NonEmptyStringSchema,
    submittedAt: NonEmptyStringSchema.optional(),
    answer: z.string().optional(),
  })
  .strict();

export const BackgroundTaskModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    status: z.enum([
      "empty",
      "registered_pending",
      "queued",
      "running",
      "awaiting_provider",
      "awaiting_user_decision",
      "paused",
      "budget_wait",
      "evidence_capture_failed",
      "evidence_invalid",
      "workspace_changed_concurrently",
      "blocked",
      "done",
      "stopped",
      "interrupted",
    ]),
    summary: NonEmptyStringSchema,
    workspaceName: NonEmptyStringSchema.optional(),
    workspacePath: NonEmptyStringSchema.optional(),
    sourceAgentId: NonEmptyStringSchema.optional(),
    detailLabel: NonEmptyStringSchema.optional(),
  })
  .strict();

export const LoopPhaseKindSchema = z.enum(["planexec", "review"]);
export const LoopTaskStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_provider",
  "awaiting_user_decision",
  "paused",
  "budget_wait",
  "evidence_capture_failed",
  "evidence_invalid",
  "workspace_changed_concurrently",
  "blocked",
  "done",
  "stopped",
  "interrupted",
]);
export const LoopGoalStatusSchema = z.enum([
  "queued",
  "running_planexec",
  "running_review",
  "awaiting_user_decision",
  "passed",
  "blocked",
  "paused",
  "stopped",
  "interrupted",
]);
export const LoopPhaseStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_provider",
  "completed",
  "failed",
  "blocked",
  "canceled",
  "interrupted",
]);

export const LoopBudgetSchema = z
  .object({
    loopStrength: ThothRuntimeLoopStrengthSchema,
    maxFailedReviews: z.number().int().positive(),
    usedFailedReviews: z.number().int().min(0),
  })
  .strict();

export const LoopBudgetEnvelopeSchema = z
  .object({
    maxActiveDurationMs: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    maxToolCalls: z.number().int().positive(),
    maxChangedFiles: z.number().int().positive(),
    maxChangedLines: z.number().int().positive(),
    maxReplans: z.number().int().nonnegative(),
    maxConsecutiveSameRootCause: z.number().int().positive(),
  })
  .strict();

export const LoopBudgetUsageSchema = z
  .object({
    activeDurationMs: z.number().int().nonnegative().default(0),
    tokens: z.number().int().nonnegative().default(0),
    toolCalls: z.number().int().nonnegative().default(0),
    changedFiles: z.number().int().nonnegative().default(0),
    changedLines: z.number().int().nonnegative().default(0),
    replans: z.number().int().nonnegative().default(0),
    consecutiveSameRootCause: z.number().int().nonnegative().default(0),
    tokenMetered: z.boolean().default(false),
  })
  .strict();

export const LoopBudgetWaitSchema = z
  .object({
    reason: NonEmptyStringSchema,
    exhaustedDimensions: z.array(NonEmptyStringSchema).min(1),
    enteredAt: NonEmptyStringSchema,
  })
  .strict();

export const LoopEvidenceRefSchema = z
  .object({
    id: NonEmptyStringSchema,
    manifestPath: NonEmptyStringSchema,
    sha256: NonEmptyStringSchema,
    kind: z.enum([
      "task_baseline",
      "planexec_start",
      "planexec_result",
      "review_start",
      "review_result",
    ]),
    createdAt: NonEmptyStringSchema,
    coverage: z.enum(["complete", "bounded"]).optional(),
    scannedEntries: z.number().int().nonnegative().optional(),
  })
  .strict();

export const TaskMemoryKindSchema = z.enum([
  "clarify_transcript",
  "task_card",
  "goals_card",
  "baseline_evidence",
  "planexec_result",
  "review_verdict",
  "workspace_fact",
  "execution_note",
]);

export const TaskMemoryNodeRefSchema = z
  .object({
    id: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    kind: TaskMemoryKindSchema,
    revision: z.number().int().nonnegative(),
    contentSha256: NonEmptyStringSchema,
    createdAt: NonEmptyStringSchema,
  })
  .strict();

export const LoopTaskEventSchema = z
  .object({
    eventId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    revision: z.number().int().positive(),
    kind: NonEmptyStringSchema,
    goalId: NonEmptyStringSchema.optional(),
    phaseRunId: NonEmptyStringSchema.optional(),
    causationId: NonEmptyStringSchema,
    correlationId: NonEmptyStringSchema,
    occurredAt: NonEmptyStringSchema,
    payloadSha256: NonEmptyStringSchema,
  })
  .strict();

export const LoopWorktreeLeaseSchema = z
  .object({
    workspacePath: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    phase: LoopPhaseKindSchema.nullable(),
    phaseAgentId: NonEmptyStringSchema.optional(),
    createdAt: NonEmptyStringSchema,
    heartbeatAt: NonEmptyStringSchema,
    expiresAt: NonEmptyStringSchema,
  })
  .strict();

export const LoopReplanRecordSchema = z
  .object({
    id: NonEmptyStringSchema,
    baseGoalsRevision: z.number().int().nonnegative(),
    appliedGoalsRevision: z.number().int().positive(),
    status: z.enum(["proposed", "auditing", "applied", "rejected"]),
    rationale: NonEmptyStringSchema,
    expectedBenefit: NonEmptyStringSchema,
    affectedGoalIds: z.array(NonEmptyStringSchema).min(1),
    auditSummary: z.string().optional(),
    createdAt: NonEmptyStringSchema,
  })
  .strict();

export const LoopReviewAcceptanceMatrixEntrySchema = z
  .object({
    acceptance: NonEmptyStringSchema,
    status: z.enum(["met", "not_met", "unclear"]),
    evidence: z.string().optional(),
  })
  .strict();

export const LoopDeferredGoalReplanProposalSchema = z
  .object({
    baseGoalsRevision: z.number().int().nonnegative(),
    rationale: NonEmptyStringSchema,
    expectedBenefit: NonEmptyStringSchema,
    affectedGoalIds: z.array(NonEmptyStringSchema).min(1),
    goals: z
      .array(
        z
          .object({
            id: NonEmptyStringSchema,
            order: z.number().int().positive(),
            title: NonEmptyStringSchema,
            goal: NonEmptyStringSchema,
            constraints: StringListSchema,
            acceptance: StringListSchema,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const LoopReviewVerdictSchema = z
  .object({
    outcome: z.enum([
      "pass",
      "continue",
      "reframe_current_goal",
      "replan_unstarted_goals",
      "return_to_user_decision",
      "real_blocker",
      "fail",
      "blocked",
    ]),
    round: z.number().int().positive(),
    summary: NonEmptyStringSchema,
    acceptanceMatrix: z.array(LoopReviewAcceptanceMatrixEntrySchema).default([]),
    failedAcceptance: z.array(NonEmptyStringSchema).default([]),
    failureRootCause: z.string().optional(),
    nextRoundGuidance: z.string().optional(),
    antiRepeatStrategy: z.array(NonEmptyStringSchema).default([]),
    evidenceSummary: z.string().default(""),
    directionMemo: z
      .object({
        conclusion: NonEmptyStringSchema,
        reality: z.array(NonEmptyStringSchema).min(1),
        diagnosis: NonEmptyStringSchema,
        abandon: z.array(NonEmptyStringSchema).default([]),
        reframe: NonEmptyStringSchema,
        nextDirection: NonEmptyStringSchema,
      })
      .strict()
      .optional(),
    evidenceRef: LoopEvidenceRefSchema.optional(),
    deferredGoalReplanProposal: LoopDeferredGoalReplanProposalSchema.optional(),
    createdAt: NonEmptyStringSchema,
  })
  .strict();

export const LoopPlanExecResultSchema = z
  .object({
    goalId: NonEmptyStringSchema,
    round: z.number().int().positive(),
    phaseRunId: z.string().optional(),
    resultToolCallId: z.string().optional(),
    planSummary: NonEmptyStringSchema,
    executionSummary: NonEmptyStringSchema,
    evidence: z.array(NonEmptyStringSchema).min(1),
    validationPerformed: z.array(NonEmptyStringSchema).default([]),
    remainingRisks: z.array(NonEmptyStringSchema).default([]),
    nextReviewFocus: NonEmptyStringSchema,
    evidenceRef: LoopEvidenceRefSchema.optional(),
    createdAt: NonEmptyStringSchema,
  })
  .strict();

export const LoopPhaseRecordSchema = z
  .object({
    phase: LoopPhaseKindSchema,
    status: LoopPhaseStatusSchema,
    round: z.number().int().positive(),
    agentId: NonEmptyStringSchema.optional(),
    phaseRunId: NonEmptyStringSchema.optional(),
    attemptId: NonEmptyStringSchema.optional(),
    executionGeneration: z.number().int().positive().optional(),
    protocolRepairAttempted: z.boolean().optional(),
    startedAt: NonEmptyStringSchema.optional(),
    attemptStartedAt: NonEmptyStringSchema.optional(),
    completedAt: NonEmptyStringSchema.optional(),
    lastActivityAt: NonEmptyStringSchema.optional(),
    interruptedReason: z.string().optional(),
    canceledReason: z.string().optional(),
    providerExitStatus: z
      .enum(["completed", "failed", "canceled", "timeout", "blocked"])
      .optional(),
    resultToolCallId: z.string().optional(),
    summary: z.string().optional(),
    evidenceRef: LoopEvidenceRefSchema.optional(),
  })
  .strict();

export const LoopGoalRecordSchema = z
  .object({
    id: NonEmptyStringSchema,
    order: z.number().int().positive(),
    title: NonEmptyStringSchema,
    goal: NonEmptyStringSchema,
    constraints: StringListSchema,
    acceptance: StringListSchema,
    status: LoopGoalStatusSchema,
    round: z.number().int().positive(),
    latestPlanExecSummary: z.string().optional(),
    latestPlanExecResult: LoopPlanExecResultSchema.optional(),
    latestReview: LoopReviewVerdictSchema.optional(),
    phases: z.array(LoopPhaseRecordSchema),
  })
  .strict();

export const LoopTaskModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    workspaceName: NonEmptyStringSchema,
    workspacePath: NonEmptyStringSchema,
    sourceAgentId: NonEmptyStringSchema,
    sourceGoalsCardId: NonEmptyStringSchema.optional(),
    status: LoopTaskStatusSchema,
    summary: NonEmptyStringSchema,
    loopStrength: ThothRuntimeLoopStrengthSchema,
    budget: LoopBudgetSchema,
    budgetEnvelope: LoopBudgetEnvelopeSchema.optional(),
    budgetUsage: LoopBudgetUsageSchema.optional(),
    budgetWait: LoopBudgetWaitSchema.optional(),
    authorityRevision: z.number().int().nonnegative().optional(),
    currentLease: LoopWorktreeLeaseSchema.optional(),
    recentEvents: z.array(LoopTaskEventSchema).default([]),
    taskMemoryRefs: z.array(TaskMemoryNodeRefSchema).default([]),
    goalsRevision: z.number().int().nonnegative().optional(),
    baselineEvidence: LoopEvidenceRefSchema.optional(),
    replanHistory: z.array(LoopReplanRecordSchema).default([]),
    currentGoalId: NonEmptyStringSchema.nullable(),
    currentPhase: LoopPhaseKindSchema.nullable(),
    pendingUserDecision: LoopUserDecisionSchema.optional(),
    /**
     * Durable scheduler intent. `pause_after_phase` never cancels a provider
     * run; it becomes `paused` only once the active PlanExec or Review settles.
     */
    controlIntent: z.enum(["run", "pause_after_phase", "stopped"]).optional(),
    pauseRequestedAt: NonEmptyStringSchema.optional(),
    stoppedAt: NonEmptyStringSchema.optional(),
    resumeKind: z.enum(["paused_continuation", "stopped_recovery"]).optional(),
    goalRound: z.number().int().positive(),
    globalFailureCount: z.number().int().min(0),
    goals: z.array(LoopGoalRecordSchema).min(1),
    taskCard: ThothTaskCardModelSchema,
    goalsCard: ThothGoalsCardModelSchema,
    clarifyTranscript: z.string().optional(),
    providerBinding: z
      .object({
        provider: NonEmptyStringSchema,
        model: z.string().optional(),
        modeId: z.string().optional(),
        thinkingOptionId: z.string().optional(),
        featureValues: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    latestVerdictSummary: z.string().optional(),
    createdAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict();

export const BackgroundTaskActionSchema = z.enum([
  "pause",
  "resume",
  "stop",
  "budget_continue",
  "review_only",
]);

export const BackgroundTasksModelSchema = z
  .object({
    tasks: z.array(BackgroundTaskModelSchema),
    selectedTaskId: NonEmptyStringSchema.nullable().optional(),
    detail: z.union([RegisteredTaskModelSchema, LoopTaskModelSchema]).nullable().optional(),
  })
  .strict();

export const ClarifyAnswerIntentSchema = z.enum([
  "submit_choices",
  "note_only",
  "recommend",
  "decide",
  "stop",
]);

export const ApprovalActionIntentSchema = z.enum([
  "accept_quick",
  "accept_loop",
  "annotate",
  "cancel",
]);

export const ThothClarifyCardAnswerPayloadSchema = z
  .object({
    intent: ClarifyAnswerIntentSchema,
    question_card_id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    answers: z.array(
      z
        .object({
          question_id: NonEmptyStringSchema,
          choice_ids: z.array(NonEmptyStringSchema),
          choice_notes: z.record(NonEmptyStringSchema, z.string()).default({}),
          note: z.string().optional(),
        })
        .strict(),
    ),
    note: z.string().optional(),
    raw_answer: NonEmptyStringSchema,
  })
  .strict();

export const ThothApprovalCardAnswerPayloadSchema = z
  .object({
    intent: ApprovalActionIntentSchema,
    card_id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    note: z.string().optional(),
    raw_answer: NonEmptyStringSchema,
  })
  .strict();

export const ThothCardAnswerPayloadSchema = z.union([
  ThothClarifyCardAnswerPayloadSchema,
  ThothApprovalCardAnswerPayloadSchema,
]);

export const AgentThothLifecycleSchema = z.enum([
  "idle",
  "running",
  "awaiting_card",
  "quick_exec",
  "background_handoff",
  "interrupted",
  "done",
  "canceled",
  "unsupported",
]);

export const AgentThothTurnSchema = z
  .object({
    id: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
    kind: z.enum(["raw", "thoth"]),
    lifecycle: AgentThothLifecycleSchema,
    controls: ThothTurnControlSnapshotSchema.optional(),
    sourceMessageId: NonEmptyStringSchema.optional(),
    backgroundTaskId: NonEmptyStringSchema.optional(),
    error: z.string().optional(),
    startedAt: NonEmptyStringSchema,
    updatedAt: NonEmptyStringSchema,
  })
  .strict();

export const AgentThothPendingCardSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("clarify_card"),
      card: ThothClarifyCardModelSchema,
      createdAt: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("task_card"),
      card: ThothTaskCardModelSchema,
      createdAt: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("goal_card"),
      card: ThothApprovalGoalCardModelSchema,
      createdAt: NonEmptyStringSchema,
    })
    .strict(),
]);

export const AgentThothStateSchema = z
  .object({
    agentId: NonEmptyStringSchema,
    revision: z.number().int().nonnegative(),
    lifecycle: AgentThothLifecycleSchema,
    turn: AgentThothTurnSchema.nullable(),
    pendingCard: AgentThothPendingCardSchema.nullable(),
    backgroundTaskId: NonEmptyStringSchema.nullable(),
    error: z.string().nullable(),
  })
  .strict();

export const AgentThothStateRequestSchema = z
  .object({
    type: z.literal("agent.thoth.state.request"),
    requestId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
  })
  .strict();

export const AgentThothCardAnswerRequestSchema = z
  .object({
    type: z.literal("agent.thoth.card.answer.request"),
    requestId: NonEmptyStringSchema,
    agentId: NonEmptyStringSchema,
    cardId: NonEmptyStringSchema,
    answer: ThothCardAnswerPayloadSchema,
    expectedRevision: z.number().int().nonnegative(),
    commandId: NonEmptyStringSchema,
  })
  .strict();

export const BackgroundTaskListRequestSchema = z
  .object({
    type: z.literal("background_task.list.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema.optional(),
    workspacePath: NonEmptyStringSchema.optional(),
  })
  .strict();

export const BackgroundTaskInspectRequestSchema = z
  .object({
    type: z.literal("background_task.inspect.request"),
    requestId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema.optional(),
    workspacePath: NonEmptyStringSchema.optional(),
  })
  .strict();

export const BackgroundTaskActionRequestSchema = z
  .object({
    type: z.literal("background_task.action.request"),
    requestId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    action: BackgroundTaskActionSchema,
    workspaceId: NonEmptyStringSchema.optional(),
    workspacePath: NonEmptyStringSchema.optional(),
    expectedAuthorityRevision: z.number().int().nonnegative().optional(),
    commandId: NonEmptyStringSchema.optional(),
  })
  .strict();

export const BackgroundTaskDecisionRequestSchema = z
  .object({
    type: z.literal("background_task.decision.request"),
    requestId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    decisionId: NonEmptyStringSchema,
    choiceId: NonEmptyStringSchema,
    note: z.string().optional(),
    workspaceId: NonEmptyStringSchema.optional(),
    workspacePath: NonEmptyStringSchema.optional(),
    expectedAuthorityRevision: z.number().int().nonnegative().optional(),
    commandId: NonEmptyStringSchema.optional(),
  })
  .strict();

export const AgentThothStateResponseSchema = z
  .object({
    type: z.literal("agent.thoth.state.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        state: AgentThothStateSchema,
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const AgentThothCardAnswerResponseSchema = z
  .object({
    type: z.literal("agent.thoth.card.answer.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        accepted: z.boolean(),
        conflict: z.boolean(),
        state: AgentThothStateSchema,
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const BackgroundTaskListResponseSchema = z
  .object({
    type: z.literal("background_task.list.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        tasks: z.array(BackgroundTaskModelSchema),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const BackgroundTaskInspectResponseSchema = z
  .object({
    type: z.literal("background_task.inspect.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        task: LoopTaskModelSchema.nullable(),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const BackgroundTaskActionResponseSchema = z
  .object({
    type: z.literal("background_task.action.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        task: LoopTaskModelSchema.nullable(),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const BackgroundTaskDecisionResponseSchema = z
  .object({
    type: z.literal("background_task.decision.response"),
    payload: z
      .object({
        requestId: NonEmptyStringSchema,
        task: LoopTaskModelSchema.nullable(),
        error: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export const AgentThothStateUpdateSchema = z
  .object({
    type: z.literal("agent.thoth.state.update"),
    payload: z
      .object({
        state: AgentThothStateSchema,
        reason: z
          .enum([
            "turn_started",
            "card_opened",
            "card_answered",
            "quick_exec_started",
            "background_handoff",
            "turn_completed",
            "turn_interrupted",
            "turn_canceled",
          ])
          .optional(),
      })
      .strict(),
  })
  .strict();

export const BackgroundTaskUpdateSchema = z
  .object({
    type: z.literal("background_task.update"),
    payload: z
      .object({
        task: LoopTaskModelSchema,
        summary: BackgroundTaskModelSchema,
      })
      .strict(),
  })
  .strict();

export type ThothTurnControlSnapshot = z.infer<typeof ThothTurnControlSnapshotSchema>;
export type ThothClarifyCardModel = z.infer<typeof ThothClarifyCardModelSchema>;
export type ThothTaskCardModel = z.infer<typeof ThothTaskCardModelSchema>;
export type ThothPyramidPlanSubgoal = z.infer<typeof ThothPyramidPlanSubgoalSchema>;
export type ThothPyramidPlanStage = z.infer<typeof ThothPyramidPlanStageSchema>;
export type ThothGoalCardModel = z.infer<typeof ThothGoalCardModelSchema>;
export type ThothGoalsCardModel = z.infer<typeof ThothGoalsCardModelSchema>;
export type ThothApprovalGoalCardModel = z.infer<typeof ThothApprovalGoalCardModelSchema>;
export type RegisteredTaskStatus = z.infer<typeof RegisteredTaskStatusSchema>;
export type RegisteredTaskModel = z.infer<typeof RegisteredTaskModelSchema>;
export type BackgroundTaskModel = z.infer<typeof BackgroundTaskModelSchema>;
export type BackgroundTasksModel = z.infer<typeof BackgroundTasksModelSchema>;
export type LoopPhaseKind = z.infer<typeof LoopPhaseKindSchema>;
export type LoopTaskStatus = z.infer<typeof LoopTaskStatusSchema>;
export type LoopGoalStatus = z.infer<typeof LoopGoalStatusSchema>;
export type LoopPhaseStatus = z.infer<typeof LoopPhaseStatusSchema>;
export type LoopUserDecision = z.infer<typeof LoopUserDecisionSchema>;
export type LoopBudget = z.infer<typeof LoopBudgetSchema>;
export type LoopDeferredGoalReplanProposal = z.infer<typeof LoopDeferredGoalReplanProposalSchema>;
export type LoopBudgetEnvelope = z.infer<typeof LoopBudgetEnvelopeSchema>;
export type LoopBudgetUsage = z.infer<typeof LoopBudgetUsageSchema>;
export type LoopBudgetWait = z.infer<typeof LoopBudgetWaitSchema>;
export type LoopEvidenceRef = z.infer<typeof LoopEvidenceRefSchema>;
export type TaskMemoryKind = z.infer<typeof TaskMemoryKindSchema>;
export type TaskMemoryNodeRef = z.infer<typeof TaskMemoryNodeRefSchema>;
export type LoopTaskEvent = z.infer<typeof LoopTaskEventSchema>;
export type LoopWorktreeLease = z.infer<typeof LoopWorktreeLeaseSchema>;
export type LoopReplanRecord = z.infer<typeof LoopReplanRecordSchema>;
export type LoopReviewVerdict = z.infer<typeof LoopReviewVerdictSchema>;
export type LoopPlanExecResult = z.infer<typeof LoopPlanExecResultSchema>;
export type LoopPhaseRecord = z.infer<typeof LoopPhaseRecordSchema>;
export type LoopGoalRecord = z.infer<typeof LoopGoalRecordSchema>;
export type LoopTaskModel = z.infer<typeof LoopTaskModelSchema>;
export type BackgroundTaskAction = z.infer<typeof BackgroundTaskActionSchema>;
export type ClarifyAnswerIntent = z.infer<typeof ClarifyAnswerIntentSchema>;
export type ApprovalActionIntent = z.infer<typeof ApprovalActionIntentSchema>;
export type ThothClarifyCardAnswerPayload = z.infer<typeof ThothClarifyCardAnswerPayloadSchema>;
export type ThothApprovalCardAnswerPayload = z.infer<typeof ThothApprovalCardAnswerPayloadSchema>;
export type ThothCardAnswerPayload = z.infer<typeof ThothCardAnswerPayloadSchema>;
export type AgentThothLifecycle = z.infer<typeof AgentThothLifecycleSchema>;
export type AgentThothTurn = z.infer<typeof AgentThothTurnSchema>;
export type AgentThothPendingCard = z.infer<typeof AgentThothPendingCardSchema>;
export type AgentThothState = z.infer<typeof AgentThothStateSchema>;
export type AgentThothStateRequest = z.infer<typeof AgentThothStateRequestSchema>;
export type AgentThothCardAnswerRequest = z.infer<typeof AgentThothCardAnswerRequestSchema>;
export type BackgroundTaskListRequest = z.infer<typeof BackgroundTaskListRequestSchema>;
export type BackgroundTaskInspectRequest = z.infer<typeof BackgroundTaskInspectRequestSchema>;
export type BackgroundTaskActionRequest = z.infer<typeof BackgroundTaskActionRequestSchema>;
export type BackgroundTaskDecisionRequest = z.infer<typeof BackgroundTaskDecisionRequestSchema>;
export type AgentThothStateResponse = z.infer<typeof AgentThothStateResponseSchema>;
export type AgentThothCardAnswerResponse = z.infer<typeof AgentThothCardAnswerResponseSchema>;
export type AgentThothStateUpdate = z.infer<typeof AgentThothStateUpdateSchema>;
export type BackgroundTaskListResponse = z.infer<typeof BackgroundTaskListResponseSchema>;
export type BackgroundTaskInspectResponse = z.infer<typeof BackgroundTaskInspectResponseSchema>;
export type BackgroundTaskActionResponse = z.infer<typeof BackgroundTaskActionResponseSchema>;
export type BackgroundTaskDecisionResponse = z.infer<typeof BackgroundTaskDecisionResponseSchema>;
export type BackgroundTaskUpdate = z.infer<typeof BackgroundTaskUpdateSchema>;
