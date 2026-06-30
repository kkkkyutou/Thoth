import { join } from "node:path";

import { getThothWorktreesRoot, isThothOwnedWorktreeCwd } from "../../utils/worktree.js";
import {
  archiveByScope,
  resolveWorkspaceIdAtPath,
  type ArchiveDependencies,
  type ArchiveScope,
} from "../workspace-archive-service.js";
import type {
  CreateThothWorktreeInput,
  CreateThothWorktreeResult,
} from "../thoth-worktree-service.js";
import { toWorktreeWireError, type WorktreeWireError } from "../worktree-errors.js";
import type { WorkspaceGitService, WorkspaceGitWorktreeInfo } from "../workspace-git-service.js";

export interface ListThothWorktreesCommandDependencies {
  workspaceGitService: Pick<WorkspaceGitService, "listWorktrees">;
}

export interface ListThothWorktreesCommandInput {
  cwd: string;
  reason?: string;
}

export async function listThothWorktreesCommand(
  dependencies: ListThothWorktreesCommandDependencies,
  input: ListThothWorktreesCommandInput,
): Promise<WorkspaceGitWorktreeInfo[]> {
  if (input.reason) {
    return dependencies.workspaceGitService.listWorktrees(input.cwd, { reason: input.reason });
  }
  return dependencies.workspaceGitService.listWorktrees(input.cwd);
}

type CreateThothWorktreeWorkflow<Result extends CreateThothWorktreeResult> = (
  input: CreateThothWorktreeInput,
) => Promise<Result>;

export interface CreateThothWorktreeCommandDependencies<
  Result extends CreateThothWorktreeResult = CreateThothWorktreeResult,
> {
  thothHome?: string;
  worktreesRoot?: string;
  createThothWorktreeWorkflow?: CreateThothWorktreeWorkflow<Result>;
}

export type CreateThothWorktreeCommandInput = Omit<
  CreateThothWorktreeInput,
  "thothHome" | "runSetup"
> & {
  thothHome?: string;
  worktreesRoot?: string;
};

export type CreateThothWorktreeCommandResult<Result extends CreateThothWorktreeResult> =
  | {
      ok: true;
      createdWorktree: Result;
    }
  | {
      ok: false;
      error: WorktreeWireError;
      cause: unknown;
    };

export async function createThothWorktreeCommand<Result extends CreateThothWorktreeResult>(
  dependencies: CreateThothWorktreeCommandDependencies<Result>,
  input: CreateThothWorktreeCommandInput,
): Promise<CreateThothWorktreeCommandResult<Result>> {
  try {
    if (!dependencies.createThothWorktreeWorkflow) {
      throw new Error("Thoth worktree service is not configured");
    }

    const createdWorktree = await dependencies.createThothWorktreeWorkflow({
      ...input,
      runSetup: false,
      thothHome: input.thothHome ?? dependencies.thothHome,
      worktreesRoot: input.worktreesRoot ?? dependencies.worktreesRoot,
    });
    return { ok: true, createdWorktree };
  } catch (error) {
    return {
      ok: false,
      error: toWorktreeWireError(error),
      cause: error,
    };
  }
}

export interface ArchiveCommandDependencies extends Omit<
  ArchiveDependencies,
  "workspaceGitService"
> {
  workspaceGitService: Pick<WorkspaceGitService, "getSnapshot" | "listWorktrees">;
}

export interface ArchiveCommandInput {
  requestId: string;
  repoRoot?: string | null;
  worktreePath?: string;
  worktreeSlug?: string;
  branchName?: string;
  workspaceId?: string;
  scope?: ArchiveScope["kind"];
}

export type ArchiveCommandResult =
  | {
      ok: true;
      removedAgents: string[];
    }
  | {
      ok: false;
      code: "NOT_ALLOWED";
      message: string;
      removedAgents: [];
    };

export async function archiveCommand(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<ArchiveCommandResult> {
  const resolvedTarget = await resolveArchiveTarget(dependencies, input);
  const scope = input.scope ?? "workspace";

  if (scope === "worktree") {
    const ownership = await isThothOwnedWorktreeCwd(resolvedTarget.targetPath, {
      thothHome: dependencies.thothHome,
      worktreesRoot: dependencies.thothWorktreesBaseRoot,
    });

    if (!ownership.allowed) {
      return {
        ok: false,
        code: "NOT_ALLOWED",
        message: "Worktree is not a Thoth-owned worktree",
        removedAgents: [],
      };
    }

    const result = await archiveByScope(dependencies, {
      scope: { kind: "worktree", targetPath: resolvedTarget.targetPath },
      repoRoot: ownership.repoRoot ?? resolvedTarget.repoRoot ?? null,
      repoWorktreesRoot: ownership.worktreeRoot,
      thothWorktreesBaseRoot: dependencies.thothWorktreesBaseRoot,
      requestId: input.requestId,
    });

    return {
      ok: true,
      removedAgents: result.archivedAgentIds,
    };
  }

  const workspaceId =
    input.workspaceId ?? (await resolveWorkspaceIdAtPath(dependencies, resolvedTarget.targetPath));

  if (!workspaceId) {
    dependencies.sessionLogger?.warn(
      { targetPath: resolvedTarget.targetPath },
      "Could not resolve workspace for archive; skipping",
    );
    return {
      ok: true,
      removedAgents: [],
    };
  }

  const result = await archiveByScope(dependencies, {
    scope: { kind: "workspace", workspaceId },
    repoRoot: resolvedTarget.repoRoot,
    thothWorktreesBaseRoot: dependencies.thothWorktreesBaseRoot,
    requestId: input.requestId,
  });

  return {
    ok: true,
    removedAgents: result.archivedAgentIds,
  };
}

interface ResolvedArchiveTarget {
  targetPath: string;
  repoRoot: string | null;
}

async function resolveArchiveTarget(
  dependencies: ArchiveCommandDependencies,
  input: ArchiveCommandInput,
): Promise<ResolvedArchiveTarget> {
  const repoRoot = input.repoRoot ?? null;
  if (input.worktreePath) {
    return { targetPath: input.worktreePath, repoRoot };
  }

  if (input.worktreeSlug) {
    if (!repoRoot) {
      throw new Error("repoRoot is required when worktreeSlug is supplied");
    }
    return {
      targetPath: await resolveWorktreeSlugPath(dependencies, repoRoot, input.worktreeSlug),
      repoRoot,
    };
  }

  if (repoRoot && input.branchName) {
    const worktrees = await dependencies.workspaceGitService.listWorktrees(repoRoot);
    const match = worktrees.find((entry) => entry.branchName === input.branchName);
    if (!match) {
      throw new Error(`Thoth worktree not found for branch ${input.branchName}`);
    }
    return { targetPath: match.path, repoRoot };
  }

  throw new Error("worktreePath, worktreeSlug, or repoRoot+branchName is required");
}

async function resolveWorktreeSlugPath(
  dependencies: ArchiveCommandDependencies,
  repoRoot: string,
  worktreeSlug: string,
): Promise<string> {
  const worktreesRoot = await getThothWorktreesRoot(
    repoRoot,
    dependencies.thothHome,
    dependencies.thothWorktreesBaseRoot,
  );
  return join(worktreesRoot, worktreeSlug);
}
