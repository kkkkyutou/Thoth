import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ThothConfigRawSchema,
  type ThothConfigRaw,
  type ThothConfigRevision,
  type ProjectConfigRpcError,
} from "@thoth/protocol/thoth-config-schema";
export {
  ThothConfigRevisionSchema,
  ProjectConfigRpcErrorSchema,
  type ThothConfigRevision,
  type ProjectConfigRpcError,
} from "@thoth/protocol/thoth-config-schema";

export const THOTH_CONFIG_FILE_NAME = "thoth.json";

export type ReadThothConfigForEditResult =
  | { ok: true; config: ThothConfigRaw | null; revision: ThothConfigRevision | null }
  | { ok: false; error: ProjectConfigRpcError };

export type WriteThothConfigForEditResult =
  | { ok: true; config: ThothConfigRaw; revision: ThothConfigRevision }
  | { ok: false; error: ProjectConfigRpcError };

export interface WriteThothConfigForEditInput {
  repoRoot: string;
  config: ThothConfigRaw;
  expectedRevision: ThothConfigRevision | null;
}

export function resolveThothConfigPath(repoRoot: string): string {
  return join(repoRoot, THOTH_CONFIG_FILE_NAME);
}

export function statThothConfigPath(repoRoot: string): ThothConfigRevision | null {
  const configPath = resolveThothConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  const stats = statSync(configPath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function readThothConfigJson(repoRoot: string): unknown {
  const configPath = resolveThothConfigPath(repoRoot);
  if (!existsSync(configPath)) {
    return null;
  }
  return JSON.parse(readFileSync(configPath, "utf8"));
}

export function readThothConfigForEdit(repoRoot: string): ReadThothConfigForEditResult {
  try {
    const json = readThothConfigJson(repoRoot);
    if (json === null) {
      return { ok: true, config: null, revision: null };
    }
    return {
      ok: true,
      config: ThothConfigRawSchema.parse(json),
      revision: statThothConfigPath(repoRoot),
    };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_project_config" },
    };
  }
}

export function writeThothConfigForEdit(
  input: WriteThothConfigForEditInput,
): WriteThothConfigForEditResult {
  const parsed = ThothConfigRawSchema.safeParse(input.config);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_project_config" } };
  }

  const configPath = resolveThothConfigPath(input.repoRoot);
  const tempPath = join(
    input.repoRoot,
    `.${THOTH_CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
    const currentRevision = statThothConfigPath(input.repoRoot);
    if (!thothConfigRevisionsEqual(currentRevision, input.expectedRevision)) {
      removeTempThothConfig(tempPath);
      return {
        ok: false,
        error: { code: "stale_project_config", currentRevision },
      };
    }

    renameSync(tempPath, configPath);
    const revision = statThothConfigPath(input.repoRoot);
    if (!revision) {
      return { ok: false, error: { code: "write_failed" } };
    }
    return { ok: true, config: parsed.data, revision };
  } catch {
    removeTempThothConfig(tempPath);
    return { ok: false, error: { code: "write_failed" } };
  }
}

function thothConfigRevisionsEqual(
  left: ThothConfigRevision | null,
  right: ThothConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTempThothConfig(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
