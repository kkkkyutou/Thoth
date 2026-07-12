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
import type { AgentAttachment } from "../messages.js";

export const WORKSPACE_SECRETARY_RELAY_ENDPOINT = "relay.test.thoth.seeles.ai" as const;
export const WORKSPACE_SECRETARY_RELAY_HEALTH_URL =
  "https://relay.test.thoth.seeles.ai/health" as const;

const NonEmptyStringSchema = z.string().trim().min(1);

export const ThothMainViewSchema = z.enum(["workspace-secretary", "background-tasks", "settings"]);

export const SecretaryTopicStatusSchema = z.enum(["current", "quiet", "clarifying"]);

const StringListSchema = z.array(NonEmptyStringSchema).min(1);
const WorkspaceSecretaryImageAttachmentSchema = z
  .object({
    data: z.string(),
    mimeType: z.string(),
  })
  .strict();
const WorkspaceSecretaryAgentAttachmentSchema = z.custom<AgentAttachment>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string",
);

export const SecretaryTopicModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    status: SecretaryTopicStatusSchema,
    updatedLabel: NonEmptyStringSchema,
  })
  .strict();

export const SecretaryRuntimeStatusKindSchema = z.enum([
  "ready",
  "loading",
  "recoverable_error",
  "host_unavailable",
  "provider_required",
  "provider_unsupported",
]);

export const SecretaryRuntimeStatusModelSchema = z
  .object({
    kind: SecretaryRuntimeStatusKindSchema,
    title: NonEmptyStringSchema,
    detail: NonEmptyStringSchema,
    actionLabel: NonEmptyStringSchema.optional(),
  })
  .strict();

export const ThothComposerModelSchema = z
  .object({
    mode: ThothRuntimeModeSchema,
    clarifyStrength: ThothRuntimeClarifyStrengthSchema.exclude(["deep"]),
    loop: ThothRuntimeLoopStrengthSchema.nullable(),
    authorityLabel: NonEmptyStringSchema,
    authorityReady: z.boolean(),
    disabledReason: NonEmptyStringSchema.optional(),
  })
  .strict();

export const WorkspaceSecretaryProviderBridgeSchema = z.enum([
  "native_output_schema",
  "runtime_tool",
  "unsupported",
]);

export const WorkspaceSecretaryProviderRuntimeStateSchema = z.enum([
  "not_configured",
  "checking",
  "ready",
  "running",
  "unsupported",
  "error",
]);

export const WorkspaceSecretaryProviderRuntimeModelSchema = z
  .object({
    configured: z.boolean(),
    ready: z.boolean(),
    state: WorkspaceSecretaryProviderRuntimeStateSchema,
    bridge: WorkspaceSecretaryProviderBridgeSchema.optional(),
    provider: NonEmptyStringSchema.optional(),
    model: z.string().optional(),
    mode: z.string().optional(),
    safeLabel: NonEmptyStringSchema,
    detail: NonEmptyStringSchema,
  })
  .strict();

export const WorkspaceSecretaryDeprecatedCleanEventSchema = z
  .object({
    id: NonEmptyStringSchema,
    kind: z.enum([
      "provider_turn_started",
      "provider_tool",
      "provider_question",
      "provider_permission",
      "provider_repair",
      "secretary_reply_delta",
      "provider_turn_completed",
      "provider_error",
    ]),
    title: NonEmptyStringSchema,
    detail: z.string().optional(),
    status: z.enum(["running", "completed", "blocked", "failed"]).optional(),
  })
  .strict();

/**
 * @deprecated Workspace Secretary realtime UI must use AgentTimeline / agent_stream.
 * This schema is accepted only for old payload compatibility.
 */
export const WorkspaceSecretaryCleanEventSchema = WorkspaceSecretaryDeprecatedCleanEventSchema;

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
    sourceTopicId: NonEmptyStringSchema,
    status: RegisteredTaskStatusSchema,
    summary: NonEmptyStringSchema,
    taskCard: ThothTaskCardModelSchema,
    goalCard: ThothApprovalGoalCardModelSchema,
    currentGoalTitle: NonEmptyStringSchema.optional(),
    currentRoundLabel: NonEmptyStringSchema.optional(),
  })
  .strict();

export const SecretaryMessageTurnSchema = z
  .object({
    id: NonEmptyStringSchema,
    kind: z.literal("message"),
    speaker: z.enum(["user", "secretary"]),
    text: NonEmptyStringSchema,
  })
  .strict();

export const SecretaryClarifyCardTurnSchema = z
  .object({
    id: NonEmptyStringSchema,
    kind: z.literal("clarify_card"),
    card: ThothClarifyCardModelSchema,
  })
  .strict();

export const SecretaryTaskCardTurnSchema = z
  .object({
    id: NonEmptyStringSchema,
    kind: z.literal("task_card"),
    card: ThothTaskCardModelSchema,
  })
  .strict();

export const SecretaryGoalCardTurnSchema = z
  .object({
    id: NonEmptyStringSchema,
    kind: z.literal("goal_card"),
    card: ThothApprovalGoalCardModelSchema,
  })
  .strict();

export const SecretaryRegisteredTaskTurnSchema = z
  .object({
    id: NonEmptyStringSchema,
    kind: z.literal("registered_task"),
    task: RegisteredTaskModelSchema,
  })
  .strict();

export const SecretaryTurnSchema = z.discriminatedUnion("kind", [
  SecretaryMessageTurnSchema,
  SecretaryClarifyCardTurnSchema,
  SecretaryTaskCardTurnSchema,
  SecretaryGoalCardTurnSchema,
  SecretaryRegisteredTaskTurnSchema,
]);

export const WorkspaceSecretaryModelSchema = z
  .object({
    workspaceName: NonEmptyStringSchema,
    workspacePath: NonEmptyStringSchema,
    topics: z.array(SecretaryTopicModelSchema).min(1),
    activeTopicId: NonEmptyStringSchema,
    status: SecretaryRuntimeStatusModelSchema,
    turns: z.array(SecretaryTurnSchema),
    composer: ThothComposerModelSchema,
    provider: WorkspaceSecretaryProviderRuntimeModelSchema.optional(),
    deprecatedLiveEvents: z.array(WorkspaceSecretaryDeprecatedCleanEventSchema).optional(),
    /**
     * @deprecated Accepted for old clients only. Do not use as a realtime UI source.
     */
    liveEvents: z.array(WorkspaceSecretaryDeprecatedCleanEventSchema).optional(),
  })
  .strict();

export const RelayServiceStatusSchema = z.enum(["checking", "healthy", "unavailable"]);

export const RelayServiceModelSchema = z
  .object({
    endpoint: z.literal(WORKSPACE_SECRETARY_RELAY_ENDPOINT),
    healthUrl: z.literal(WORKSPACE_SECRETARY_RELAY_HEALTH_URL),
    status: RelayServiceStatusSchema,
    safeSummary: NonEmptyStringSchema,
    checkedAtLabel: NonEmptyStringSchema,
  })
  .strict();

export const SettingsCapabilityModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    value: NonEmptyStringSchema,
    locked: z.boolean().optional(),
  })
  .strict();

export const ThothSettingsModelSchema = z
  .object({
    runtime: z.array(SettingsCapabilityModelSchema),
    relay: RelayServiceModelSchema,
    requiredRuntime: z.array(SettingsCapabilityModelSchema),
    workspaceSecretaryProvider: WorkspaceSecretaryProviderRuntimeModelSchema.optional(),
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
      "paused",
      "budget_wait",
      "evidence_invalid",
      "workspace_changed_concurrently",
      "blocked",
      "done",
      "stopped",
      "interrupted",
    ]),
    summary: NonEmptyStringSchema,
    workspaceName: NonEmptyStringSchema.optional(),
    sourceTopicId: NonEmptyStringSchema.optional(),
    detailLabel: NonEmptyStringSchema.optional(),
  })
  .strict();

export const LoopPhaseKindSchema = z.enum(["planexec", "review"]);
export const LoopTaskStatusSchema = z.enum([
  "queued",
  "running",
  "paused",
  "budget_wait",
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
  "passed",
  "blocked",
  "paused",
  "stopped",
  "interrupted",
]);
export const LoopPhaseStatusSchema = z.enum([
  "queued",
  "running",
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
    outcome: z.enum(["pass", "fail", "blocked"]),
    round: z.number().int().positive(),
    summary: NonEmptyStringSchema,
    acceptanceMatrix: z.array(LoopReviewAcceptanceMatrixEntrySchema).min(1),
    failedAcceptance: z.array(NonEmptyStringSchema).default([]),
    failureRootCause: z.string().optional(),
    nextRoundGuidance: z.string().optional(),
    antiRepeatStrategy: z.array(NonEmptyStringSchema).default([]),
    evidenceSummary: NonEmptyStringSchema,
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
    startedAt: NonEmptyStringSchema.optional(),
    attemptStartedAt: NonEmptyStringSchema.optional(),
    completedAt: NonEmptyStringSchema.optional(),
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
    sourceTopicId: NonEmptyStringSchema,
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
    providerSession: z
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

export const ThothCleanUiAuthorityModelSchema = z
  .object({
    source: z.enum(["daemon_clean_ui_model", "provider_backed_clean_ui_model"]),
    schemaVerified: z.literal(true),
    label: NonEmptyStringSchema,
  })
  .strict();

export const ThothCleanUiModelSchema = z
  .object({
    authority: ThothCleanUiAuthorityModelSchema,
    activeView: ThothMainViewSchema,
    secretary: WorkspaceSecretaryModelSchema,
    settings: ThothSettingsModelSchema,
    backgroundTasks: BackgroundTasksModelSchema,
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

export const SecretaryClarifyAnswerPayloadSchema = z
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

export const SecretaryApprovalActionPayloadSchema = z
  .object({
    intent: ApprovalActionIntentSchema,
    card_id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    note: z.string().optional(),
    raw_answer: NonEmptyStringSchema,
  })
  .strict();

export const WorkspaceSecretaryTurnActionPayloadSchema = z.union([
  SecretaryClarifyAnswerPayloadSchema,
  SecretaryApprovalActionPayloadSchema,
]);

export const WorkspaceSecretarySnapshotRequestSchema = z
  .object({
    type: z.literal("workspace_secretary.snapshot.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema.optional(),
    workspacePath: NonEmptyStringSchema.optional(),
    workspaceName: NonEmptyStringSchema.optional(),
    topicId: NonEmptyStringSchema.optional(),
  })
  .strict();

export const WorkspaceSecretarySendRequestSchema = z
  .object({
    type: z.literal("workspace_secretary.send.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema.optional(),
    workspacePath: NonEmptyStringSchema.optional(),
    topicId: NonEmptyStringSchema.optional(),
    text: NonEmptyStringSchema,
    uiAgentId: NonEmptyStringSchema.optional(),
    messageId: NonEmptyStringSchema.optional(),
    images: z.array(WorkspaceSecretaryImageAttachmentSchema).optional(),
    attachments: z.array(WorkspaceSecretaryAgentAttachmentSchema).optional(),
    composer: ThothComposerModelSchema,
  })
  .strict();

export const WorkspaceSecretaryAnswerRequestSchema = z
  .object({
    type: z.literal("workspace_secretary.answer.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema.optional(),
    workspacePath: NonEmptyStringSchema.optional(),
    topicId: NonEmptyStringSchema.optional(),
    cardId: NonEmptyStringSchema,
    uiAgentId: NonEmptyStringSchema.optional(),
    answer: WorkspaceSecretaryTurnActionPayloadSchema,
  })
  .strict();

export const WorkspaceSecretaryCancelRequestSchema = z
  .object({
    type: z.literal("workspace_secretary.cancel.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema.optional(),
    workspacePath: NonEmptyStringSchema.optional(),
    uiAgentId: NonEmptyStringSchema.optional(),
    topicId: NonEmptyStringSchema.optional(),
  })
  .strict();

export const WorkspaceSecretaryTopicCreateRequestSchema = z
  .object({
    type: z.literal("workspace_secretary.topic.create.request"),
    requestId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema.optional(),
    workspacePath: NonEmptyStringSchema.optional(),
    workspaceName: NonEmptyStringSchema.optional(),
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
  })
  .strict();

export const BackgroundTaskActionRequestSchema = z
  .object({
    type: z.literal("background_task.action.request"),
    requestId: NonEmptyStringSchema,
    taskId: NonEmptyStringSchema,
    action: BackgroundTaskActionSchema,
  })
  .strict();

export const WorkspaceSecretaryResponsePayloadSchema = z
  .object({
    requestId: NonEmptyStringSchema,
    model: ThothCleanUiModelSchema.nullable(),
    error: z.string().nullable(),
  })
  .strict();

export const WorkspaceSecretarySnapshotResponseSchema = z
  .object({
    type: z.literal("workspace_secretary.snapshot.response"),
    payload: WorkspaceSecretaryResponsePayloadSchema,
  })
  .strict();

export const WorkspaceSecretarySendResponseSchema = z
  .object({
    type: z.literal("workspace_secretary.send.response"),
    payload: WorkspaceSecretaryResponsePayloadSchema,
  })
  .strict();

export const WorkspaceSecretaryAnswerResponseSchema = z
  .object({
    type: z.literal("workspace_secretary.answer.response"),
    payload: WorkspaceSecretaryResponsePayloadSchema,
  })
  .strict();

export const WorkspaceSecretaryCancelResponseSchema = z
  .object({
    type: z.literal("workspace_secretary.cancel.response"),
    payload: WorkspaceSecretaryResponsePayloadSchema,
  })
  .strict();

export const WorkspaceSecretaryTopicCreateResponseSchema = z
  .object({
    type: z.literal("workspace_secretary.topic.create.response"),
    payload: WorkspaceSecretaryResponsePayloadSchema,
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

export const WorkspaceSecretaryModelUpdateSchema = z
  .object({
    type: z.literal("workspace_secretary.model.update"),
    payload: z
      .object({
        model: ThothCleanUiModelSchema,
        reason: z
          .enum([
            "provider_turn_started",
            "provider_progress",
            "provider_reply_delta",
            "provider_turn_completed",
            "provider_blocked",
            "provider_error",
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

export type ThothMainView = z.infer<typeof ThothMainViewSchema>;
export type SecretaryTopicStatus = z.infer<typeof SecretaryTopicStatusSchema>;
export type SecretaryTopicModel = z.infer<typeof SecretaryTopicModelSchema>;
export type SecretaryRuntimeStatusKind = z.infer<typeof SecretaryRuntimeStatusKindSchema>;
export type SecretaryRuntimeStatusModel = z.infer<typeof SecretaryRuntimeStatusModelSchema>;
export type ThothComposerModel = z.infer<typeof ThothComposerModelSchema>;
export type WorkspaceSecretaryProviderBridge = z.infer<
  typeof WorkspaceSecretaryProviderBridgeSchema
>;
export type WorkspaceSecretaryProviderRuntimeState = z.infer<
  typeof WorkspaceSecretaryProviderRuntimeStateSchema
>;
export type WorkspaceSecretaryProviderRuntimeModel = z.infer<
  typeof WorkspaceSecretaryProviderRuntimeModelSchema
>;
export type WorkspaceSecretaryDeprecatedCleanEvent = z.infer<
  typeof WorkspaceSecretaryDeprecatedCleanEventSchema
>;
/** @deprecated Use AgentTimeline / agent_stream; this type is legacy compatibility only. */
export type WorkspaceSecretaryCleanEvent = WorkspaceSecretaryDeprecatedCleanEvent;
export type ThothClarifyCardModel = z.infer<typeof ThothClarifyCardModelSchema>;
export type ThothTaskCardModel = z.infer<typeof ThothTaskCardModelSchema>;
export type ThothPyramidPlanSubgoal = z.infer<typeof ThothPyramidPlanSubgoalSchema>;
export type ThothPyramidPlanStage = z.infer<typeof ThothPyramidPlanStageSchema>;
export type ThothGoalCardModel = z.infer<typeof ThothGoalCardModelSchema>;
export type ThothGoalsCardModel = z.infer<typeof ThothGoalsCardModelSchema>;
export type ThothApprovalGoalCardModel = z.infer<typeof ThothApprovalGoalCardModelSchema>;
export type RegisteredTaskStatus = z.infer<typeof RegisteredTaskStatusSchema>;
export type RegisteredTaskModel = z.infer<typeof RegisteredTaskModelSchema>;
export type SecretaryTurn = z.infer<typeof SecretaryTurnSchema>;
export type WorkspaceSecretaryModel = z.infer<typeof WorkspaceSecretaryModelSchema>;
export type RelayServiceStatus = z.infer<typeof RelayServiceStatusSchema>;
export type RelayServiceModel = z.infer<typeof RelayServiceModelSchema>;
export type SettingsCapabilityModel = z.infer<typeof SettingsCapabilityModelSchema>;
export type ThothSettingsModel = z.infer<typeof ThothSettingsModelSchema>;
export type BackgroundTaskModel = z.infer<typeof BackgroundTaskModelSchema>;
export type BackgroundTasksModel = z.infer<typeof BackgroundTasksModelSchema>;
export type LoopPhaseKind = z.infer<typeof LoopPhaseKindSchema>;
export type LoopTaskStatus = z.infer<typeof LoopTaskStatusSchema>;
export type LoopGoalStatus = z.infer<typeof LoopGoalStatusSchema>;
export type LoopPhaseStatus = z.infer<typeof LoopPhaseStatusSchema>;
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
export type ThothCleanUiAuthorityModel = z.infer<typeof ThothCleanUiAuthorityModelSchema>;
export type ThothCleanUiModel = z.infer<typeof ThothCleanUiModelSchema>;
export type ClarifyAnswerIntent = z.infer<typeof ClarifyAnswerIntentSchema>;
export type ApprovalActionIntent = z.infer<typeof ApprovalActionIntentSchema>;
export type SecretaryClarifyAnswerPayload = z.infer<typeof SecretaryClarifyAnswerPayloadSchema>;
export type SecretaryApprovalActionPayload = z.infer<typeof SecretaryApprovalActionPayloadSchema>;
export type WorkspaceSecretaryTurnActionPayload = z.infer<
  typeof WorkspaceSecretaryTurnActionPayloadSchema
>;
export type WorkspaceSecretarySnapshotRequest = z.infer<
  typeof WorkspaceSecretarySnapshotRequestSchema
>;
export type WorkspaceSecretarySendRequest = z.infer<typeof WorkspaceSecretarySendRequestSchema>;
export type WorkspaceSecretaryAnswerRequest = z.infer<typeof WorkspaceSecretaryAnswerRequestSchema>;
export type WorkspaceSecretaryCancelRequest = z.infer<typeof WorkspaceSecretaryCancelRequestSchema>;
export type WorkspaceSecretaryTopicCreateRequest = z.infer<
  typeof WorkspaceSecretaryTopicCreateRequestSchema
>;
export type BackgroundTaskListRequest = z.infer<typeof BackgroundTaskListRequestSchema>;
export type BackgroundTaskInspectRequest = z.infer<typeof BackgroundTaskInspectRequestSchema>;
export type BackgroundTaskActionRequest = z.infer<typeof BackgroundTaskActionRequestSchema>;
export type WorkspaceSecretaryResponsePayload = z.infer<
  typeof WorkspaceSecretaryResponsePayloadSchema
>;
export type WorkspaceSecretarySnapshotResponse = z.infer<
  typeof WorkspaceSecretarySnapshotResponseSchema
>;
export type WorkspaceSecretarySendResponse = z.infer<typeof WorkspaceSecretarySendResponseSchema>;
export type WorkspaceSecretaryAnswerResponse = z.infer<
  typeof WorkspaceSecretaryAnswerResponseSchema
>;
export type WorkspaceSecretaryCancelResponse = z.infer<
  typeof WorkspaceSecretaryCancelResponseSchema
>;
export type WorkspaceSecretaryTopicCreateResponse = z.infer<
  typeof WorkspaceSecretaryTopicCreateResponseSchema
>;
export type WorkspaceSecretaryModelUpdate = z.infer<typeof WorkspaceSecretaryModelUpdateSchema>;
export type BackgroundTaskListResponse = z.infer<typeof BackgroundTaskListResponseSchema>;
export type BackgroundTaskInspectResponse = z.infer<typeof BackgroundTaskInspectResponseSchema>;
export type BackgroundTaskActionResponse = z.infer<typeof BackgroundTaskActionResponseSchema>;
export type BackgroundTaskUpdate = z.infer<typeof BackgroundTaskUpdateSchema>;
