import { z } from "zod";
import {
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

export const WorkspaceSecretaryCleanEventSchema = z
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

export const ThothClarifyCardModelSchema = z
  .object({
    id: NonEmptyStringSchema,
    roundLabel: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    whyNow: z.string(),
    continuesClarify: z.boolean(),
    card: ClarifyQuestionCardSchema,
    submitted: z.boolean(),
    submittedSummary: NonEmptyStringSchema.optional(),
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

export const RegisteredTaskStatusSchema = z.enum(["registered_pending"]);

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
    goalCard: ThothGoalCardModelSchema,
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
    card: ThothGoalCardModelSchema,
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
    liveEvents: z.array(WorkspaceSecretaryCleanEventSchema).optional(),
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
    status: z.enum(["empty", "registered_pending", "running", "blocked", "done"]),
    summary: NonEmptyStringSchema,
    workspaceName: NonEmptyStringSchema.optional(),
    sourceTopicId: NonEmptyStringSchema.optional(),
    detailLabel: NonEmptyStringSchema.optional(),
  })
  .strict();

export const BackgroundTasksModelSchema = z
  .object({
    tasks: z.array(BackgroundTaskModelSchema),
    selectedTaskId: NonEmptyStringSchema.nullable().optional(),
    detail: RegisteredTaskModelSchema.nullable().optional(),
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
  })
  .strict();

export const WorkspaceSecretarySendRequestSchema = z
  .object({
    type: z.literal("workspace_secretary.send.request"),
    requestId: NonEmptyStringSchema,
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
    cardId: NonEmptyStringSchema,
    uiAgentId: NonEmptyStringSchema.optional(),
    answer: WorkspaceSecretaryTurnActionPayloadSchema,
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

export const WorkspaceSecretaryTopicCreateResponseSchema = z
  .object({
    type: z.literal("workspace_secretary.topic.create.response"),
    payload: WorkspaceSecretaryResponsePayloadSchema,
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
export type WorkspaceSecretaryCleanEvent = z.infer<typeof WorkspaceSecretaryCleanEventSchema>;
export type ThothClarifyCardModel = z.infer<typeof ThothClarifyCardModelSchema>;
export type ThothTaskCardModel = z.infer<typeof ThothTaskCardModelSchema>;
export type ThothPyramidPlanSubgoal = z.infer<typeof ThothPyramidPlanSubgoalSchema>;
export type ThothPyramidPlanStage = z.infer<typeof ThothPyramidPlanStageSchema>;
export type ThothGoalCardModel = z.infer<typeof ThothGoalCardModelSchema>;
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
export type WorkspaceSecretaryTopicCreateRequest = z.infer<
  typeof WorkspaceSecretaryTopicCreateRequestSchema
>;
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
export type WorkspaceSecretaryTopicCreateResponse = z.infer<
  typeof WorkspaceSecretaryTopicCreateResponseSchema
>;
export type WorkspaceSecretaryModelUpdate = z.infer<typeof WorkspaceSecretaryModelUpdateSchema>;
