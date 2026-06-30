import { z } from "zod";

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const ThothLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const ThothScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const ThothWorktreeConfigRawSchema = z
  .object({
    setup: ThothLifecycleCommandRawSchema.optional(),
    teardown: ThothLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
  })
  .passthrough();

export const ThothMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const ThothMetadataGenerationSchema = z
  .object({
    title: ThothMetadataGenerationEntrySchema.optional(),
    branchName: ThothMetadataGenerationEntrySchema.optional(),
    commitMessage: ThothMetadataGenerationEntrySchema.optional(),
    pullRequest: ThothMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy thoth.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const ThothConfigRawSchema = z
  .object({
    worktree: ThothWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), ThothScriptEntryRawSchema).optional(),
    metadataGeneration: ThothMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = ThothWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = ThothScriptEntryRawSchema.catch({});

export const ThothConfigSchema = ThothConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: ThothMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const ThothConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: ThothConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type ThothScriptEntryRaw = z.infer<typeof ThothScriptEntryRawSchema>;
export type ThothMetadataGenerationEntry = z.infer<typeof ThothMetadataGenerationEntrySchema>;
export type ThothMetadataGeneration = z.infer<typeof ThothMetadataGenerationSchema>;
export type ThothConfigRaw = z.infer<typeof ThothConfigRawSchema>;
export type ThothConfig = z.infer<typeof ThothConfigSchema>;
export type ThothConfigRevision = z.infer<typeof ThothConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
