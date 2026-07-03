import { z } from "zod";

export const THOTH_BUILTIN_RUNTIME_SKILLS = ["thoth.clarify", "thoth.loop"] as const;

export const THOTH_RUNTIME_PACKET_FIELDS = [
  "type",
  "code",
  "session_id",
  "task_id",
  "content",
  "ui",
  "next",
  "errors",
] as const;

export const THOTH_CLARIFY_CODES = [
  "C_DIRECT",
  "C_ASK",
  "C_TASK_CARD",
  "C_GOAL_CARD",
  "C_REGISTER",
  "C_BLOCKED",
  "C_REPAIR",
] as const;

export const THOTH_LOOP_CODES = [
  "L_START",
  "L_WORK",
  "L_NEED_PERMISSION",
  "L_REVIEW",
  "L_RETRY",
  "L_GOAL_DONE",
  "L_TASK_DONE",
  "L_BLOCKED",
] as const;

export const THOTH_CLARIFY_UI_KINDS = [
  "message",
  "quick_receipt",
  "clarify_card",
  "task_registration_card",
  "goal_contract_card",
  "registered_card",
  "blocked_card",
  "packet_error",
] as const;

export const THOTH_LOOP_UI_KINDS = [
  "goal_started",
  "progress",
  "permission_card",
  "review_card",
  "retry_card",
  "goal_done",
  "task_done",
  "blocked_card",
  "packet_error",
] as const;

export const ThothRuntimeSkillIdSchema = z.enum(THOTH_BUILTIN_RUNTIME_SKILLS);
export const ClarifyRuntimeCodeSchema = z.enum(THOTH_CLARIFY_CODES);
export const LoopRuntimeCodeSchema = z.enum(THOTH_LOOP_CODES);
export const ClarifyRuntimeUiKindSchema = z.enum(THOTH_CLARIFY_UI_KINDS);
export const LoopRuntimeUiKindSchema = z.enum(THOTH_LOOP_UI_KINDS);

export const ThothRuntimeModeSchema = z.enum(["quick", "loop"]);
export const ThothRuntimeClarifyStrengthSchema = z.enum([
  "none",
  "auto",
  "light",
  "balanced",
  "deep",
]);
export const ThothRuntimeLoopStrengthSchema = z.enum([
  "auto",
  "one_plan_one_do",
  "light",
  "balanced",
  "run_until_stopped",
]);
export const ThothRuntimeSkillInjectionSchema = z.enum(["none", "state_refresh", "full"]);

const NonEmptyStringSchema = z.string().min(1);
const RuntimeContentSchema = z.record(z.string(), z.unknown());
const RuntimeUiSchema = z
  .object({
    kind: z.string().min(1),
    title: z.string().optional(),
    text: z.string().optional(),
  })
  .passthrough();

const RuntimePacketBaseSchema = z
  .object({
    type: z.enum(["clarify", "loop"]),
    code: z.string().min(1),
    session_id: NonEmptyStringSchema,
    task_id: z.string().min(1).nullable(),
    content: RuntimeContentSchema,
    ui: RuntimeUiSchema,
    next: z.string().min(1),
    errors: z.array(z.string()),
  })
  .strict();

export const LoopRuntimeCursorSchema = z
  .object({
    goal: z.number().int().positive(),
    goals: z.number().int().positive(),
    round: z.number().int().positive(),
    rounds: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((cursor, ctx) => {
    if (cursor.goal > cursor.goals) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "goal must be less than or equal to goals",
        path: ["goal"],
      });
    }
    if (cursor.rounds !== null && cursor.round > cursor.rounds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "round must be less than or equal to rounds",
        path: ["round"],
      });
    }
  });

export const ClarifyRuntimePacketSchema = RuntimePacketBaseSchema.extend({
  type: z.literal("clarify"),
  code: ClarifyRuntimeCodeSchema,
  ui: RuntimeUiSchema.extend({ kind: ClarifyRuntimeUiKindSchema }),
  next: ClarifyRuntimeCodeSchema,
});

export const LoopRuntimePacketSchema = RuntimePacketBaseSchema.extend({
  type: z.literal("loop"),
  code: LoopRuntimeCodeSchema,
  ui: RuntimeUiSchema.extend({ kind: LoopRuntimeUiKindSchema }),
  next: LoopRuntimeCodeSchema,
}).superRefine((packet, ctx) => {
  if (packet.code === "L_TASK_DONE") {
    return;
  }
  const parsedCursor = LoopRuntimeCursorSchema.safeParse(packet.content.cursor);
  if (!parsedCursor.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "loop packets except L_TASK_DONE must include a valid content.cursor",
      path: ["content", "cursor"],
    });
  }
});

export const ThothRuntimePacketSchema = z.discriminatedUnion("type", [
  ClarifyRuntimePacketSchema,
  LoopRuntimePacketSchema,
]);

export const ThothRuntimeControlsSchema = z
  .object({
    mode: ThothRuntimeModeSchema,
    clarify: ThothRuntimeClarifyStrengthSchema,
    loop: ThothRuntimeLoopStrengthSchema.nullable(),
  })
  .strict();

export const ThothProviderInputEnvelopeSchema = z
  .object({
    type: z.literal("provider_input"),
    skill: ThothRuntimeSkillIdSchema,
    session_id: NonEmptyStringSchema,
    task_id: z.string().min(1).nullable(),
    code: z.union([ClarifyRuntimeCodeSchema, LoopRuntimeCodeSchema]),
    controls: ThothRuntimeControlsSchema,
    input: z.string(),
    inject: ThothRuntimeSkillInjectionSchema,
    expect: z.enum(["clarify", "loop"]),
  })
  .strict()
  .superRefine((envelope, ctx) => {
    if (envelope.skill === "thoth.clarify") {
      if (envelope.expect !== "clarify") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "thoth.clarify envelopes must expect clarify packets",
          path: ["expect"],
        });
      }
      if (!ClarifyRuntimeCodeSchema.safeParse(envelope.code).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "thoth.clarify envelopes must use clarify state codes",
          path: ["code"],
        });
      }
    }

    if (envelope.skill === "thoth.loop") {
      if (envelope.expect !== "loop") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "thoth.loop envelopes must expect loop packets",
          path: ["expect"],
        });
      }
      if (!LoopRuntimeCodeSchema.safeParse(envelope.code).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "thoth.loop envelopes must use loop state codes",
          path: ["code"],
        });
      }
    }
  });

export type ThothRuntimeSkillId = z.infer<typeof ThothRuntimeSkillIdSchema>;
export type ClarifyRuntimeCode = z.infer<typeof ClarifyRuntimeCodeSchema>;
export type LoopRuntimeCode = z.infer<typeof LoopRuntimeCodeSchema>;
export type ClarifyRuntimeUiKind = z.infer<typeof ClarifyRuntimeUiKindSchema>;
export type LoopRuntimeUiKind = z.infer<typeof LoopRuntimeUiKindSchema>;
export type ThothRuntimeMode = z.infer<typeof ThothRuntimeModeSchema>;
export type ThothRuntimeClarifyStrength = z.infer<typeof ThothRuntimeClarifyStrengthSchema>;
export type ThothRuntimeLoopStrength = z.infer<typeof ThothRuntimeLoopStrengthSchema>;
export type ThothRuntimeSkillInjection = z.infer<typeof ThothRuntimeSkillInjectionSchema>;
export type LoopRuntimeCursor = z.infer<typeof LoopRuntimeCursorSchema>;
export type ClarifyRuntimePacket = z.infer<typeof ClarifyRuntimePacketSchema>;
export type LoopRuntimePacket = z.infer<typeof LoopRuntimePacketSchema>;
export type ThothRuntimePacket = z.infer<typeof ThothRuntimePacketSchema>;
export type ThothRuntimeControls = z.infer<typeof ThothRuntimeControlsSchema>;
export type ThothProviderInputEnvelope = z.infer<typeof ThothProviderInputEnvelopeSchema>;
