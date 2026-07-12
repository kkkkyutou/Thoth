import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  classifyDirectoryForProjectMembership,
  generateWorkspaceId,
} from "../../workspace-registry-model.js";
import {
  createPersistedProjectRecord,
  createPersistedWorkspaceRecord,
  type PersistedProjectRecord,
  type PersistedWorkspaceRecord,
  type ProjectRegistry,
  type WorkspaceRegistry,
} from "../../workspace-registry.js";
import type { WorkspaceGitService } from "../../workspace-git-service.js";
import type { CreateThothWorktreeWorkflowResult } from "../../worktree-session.js";

/**
 * Resolves which workspace and project records a directory belongs to, creating,
 * reclassifying, or unarchiving them as needed. Every path that needs a workspace
 * for a cwd — opening a project, importing an agent, creating an agent, restoring
 * an archived worktree — funnels through this one module, so the
 * classify → resolve-project → persist → unarchive sequence (and the
 * archived-reopen-at-a-different-path and reclassify-vs-unarchive special cases)
 * lives in a single place instead of being smeared across the session.
 *
 * Read-only path resolution (no create/persist) lives in resolve-workspace-id-for-path.ts;
 * this module owns the create-and-persist side.
 */
export interface ResolveOrCreateWorkspaceIdInput {
  createdWorktree: CreateThothWorktreeWorkflowResult | null;
  requestedWorkspaceId?: string;
  cwd: string;
  initialTitle: string | null;
}

export interface WorkspaceProvisioningService {
  findOrCreateWorkspaceForDirectory(
    cwd: string,
    title?: string | null,
  ): Promise<PersistedWorkspaceRecord>;
  resolveOrCreateWorkspaceIdForCreateAgent(input: ResolveOrCreateWorkspaceIdInput): Promise<string>;
  createWorkspaceForDirectory(
    cwd: string,
    title?: string | null,
  ): Promise<PersistedWorkspaceRecord>;
  findOrCreateProjectForDirectory(cwd: string): Promise<PersistedProjectRecord>;
  ensureWorkspaceRecordUnarchived(
    workspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord>;
}

export function createWorkspaceProvisioningService(deps: {
  workspaceRegistry: WorkspaceRegistry;
  projectRegistry: ProjectRegistry;
  workspaceGitService: Pick<WorkspaceGitService, "getCheckout" | "peekSnapshot">;
}): WorkspaceProvisioningService {
  const { workspaceRegistry, projectRegistry, workspaceGitService } = deps;

  async function normalizeIdentityPath(cwd: string): Promise<string> {
    const resolved = resolve(cwd);
    try {
      return resolve(await realpath(resolved));
    } catch {
      return resolved;
    }
  }

  async function resolveWorkspaceDirectory(
    cwd: string,
    options?: { refreshGit?: boolean },
  ): Promise<string> {
    const normalizedCwd = await normalizeIdentityPath(cwd);
    if (options?.refreshGit === false) {
      const snapshot = workspaceGitService.peekSnapshot(normalizedCwd);
      return normalizeIdentityPath(snapshot?.git.repoRoot ?? normalizedCwd);
    }

    const checkout = await workspaceGitService.getCheckout(normalizedCwd);
    return normalizeIdentityPath(checkout.worktreeRoot ?? normalizedCwd);
  }

  async function findExactWorkspaceByDirectory(
    cwd: string,
    options?: { refreshGit?: boolean },
  ): Promise<PersistedWorkspaceRecord | null> {
    const normalizedCwd = await resolveWorkspaceDirectory(cwd, options);
    const workspaces = await workspaceRegistry.list();
    const matches = await Promise.all(
      workspaces.map(async (workspace) => ({
        workspace,
        normalizedWorkspaceCwd: await normalizeIdentityPath(workspace.cwd),
      })),
    );
    return (
      matches
        .filter((entry) => entry.normalizedWorkspaceCwd === normalizedCwd)
        .sort((left, right) => {
          const created =
            Date.parse(left.workspace.createdAt) - Date.parse(right.workspace.createdAt);
          if (created !== 0) {
            return created;
          }
          return left.workspace.workspaceId.localeCompare(right.workspace.workspaceId);
        })[0]?.workspace ?? null
    );
  }

  async function resolveProjectRecordForPlacement(input: {
    membership: ReturnType<typeof classifyDirectoryForProjectMembership>;
    timestamp: string;
  }): Promise<PersistedProjectRecord> {
    const rootPath = input.membership.projectRootPath;
    const kind = input.membership.projectKind;
    const projects = await projectRegistry.list();
    const existingProject =
      projects.find((project) => !project.archivedAt && project.rootPath === rootPath) ??
      projects.find((project) => project.rootPath === rootPath) ??
      null;

    if (!existingProject) {
      return createPersistedProjectRecord({
        projectId: input.membership.projectKey,
        rootPath,
        kind,
        displayName: input.membership.projectName,
        createdAt: input.timestamp,
        updatedAt: input.timestamp,
      });
    }

    return {
      ...existingProject,
      rootPath,
      kind,
      archivedAt: null,
      updatedAt: input.timestamp,
    };
  }

  async function reclassifyOrUnarchiveWorkspaceForDirectory(input: {
    workspace: PersistedWorkspaceRecord;
    project: PersistedProjectRecord | null;
    cwd: string;
  }): Promise<PersistedWorkspaceRecord> {
    const checkout = await workspaceGitService.getCheckout(input.cwd);
    const membership = classifyDirectoryForProjectMembership({ cwd: input.cwd, checkout });
    const timestamp = new Date().toISOString();
    const projectRecord = await resolveProjectRecordForPlacement({
      membership,
      timestamp,
    });
    const projectId = projectRecord.projectId;
    const kind = membership.workspaceKind;
    const displayName = membership.workspaceDisplayName;

    if (
      input.workspace.projectId === projectId &&
      input.workspace.kind === kind &&
      input.workspace.displayName === displayName
    ) {
      if (!input.project) {
        await projectRegistry.upsert(projectRecord);
      }
      return ensureWorkspaceRecordUnarchived(input.workspace);
    }

    await projectRegistry.upsert(projectRecord);

    const nextWorkspace = {
      ...input.workspace,
      projectId,
      cwd: input.cwd,
      kind,
      displayName,
      archivedAt: null,
      updatedAt: timestamp,
    };
    await workspaceRegistry.upsert(nextWorkspace);
    return nextWorkspace;
  }

  async function findOrCreateWorkspaceForDirectory(
    cwd: string,
    title?: string | null,
  ): Promise<PersistedWorkspaceRecord> {
    const normalizedCwd = await resolveWorkspaceDirectory(cwd);
    const existingWorkspace = await findExactWorkspaceByDirectory(normalizedCwd, {
      refreshGit: false,
    });
    if (existingWorkspace) {
      return reclassifyOrUnarchiveWorkspaceForDirectory({
        workspace: existingWorkspace,
        project: await projectRegistry.get(existingWorkspace.projectId),
        cwd: normalizedCwd,
      });
    }

    return createNewWorkspaceForDirectory(normalizedCwd, title);
  }

  async function resolveOrCreateWorkspaceIdForCreateAgent(
    input: ResolveOrCreateWorkspaceIdInput,
  ): Promise<string> {
    if (input.createdWorktree) {
      return input.createdWorktree.workspace.workspaceId;
    }

    if (input.requestedWorkspaceId) {
      return input.requestedWorkspaceId;
    }

    return (await findOrCreateWorkspaceForDirectory(input.cwd, input.initialTitle)).workspaceId;
  }

  async function createWorkspaceForDirectory(
    cwd: string,
    title?: string | null,
  ): Promise<PersistedWorkspaceRecord> {
    return findOrCreateWorkspaceForDirectory(cwd, title);
  }

  async function createNewWorkspaceForDirectory(
    cwd: string,
    title?: string | null,
  ): Promise<PersistedWorkspaceRecord> {
    const checkout = await workspaceGitService.getCheckout(cwd);
    const membership = classifyDirectoryForProjectMembership({ cwd, checkout });
    const timestamp = new Date().toISOString();

    const projectRecord = await resolveProjectRecordForPlacement({
      membership,
      timestamp,
    });
    await projectRegistry.upsert(projectRecord);

    const workspaceRecord = createPersistedWorkspaceRecord({
      workspaceId: generateWorkspaceId(),
      projectId: projectRecord.projectId,
      cwd,
      kind: membership.workspaceKind,
      displayName: membership.workspaceDisplayName,
      branch: resolvePersistedBranch(checkout.currentBranch),
      title: title ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await workspaceRegistry.upsert(workspaceRecord);
    return workspaceRecord;
  }

  async function findOrCreateProjectForDirectory(cwd: string): Promise<PersistedProjectRecord> {
    const normalizedCwd = resolve(cwd);
    const checkout = await workspaceGitService.getCheckout(normalizedCwd);
    const membership = classifyDirectoryForProjectMembership({ cwd: normalizedCwd, checkout });
    const projectRecord = await resolveProjectRecordForPlacement({
      membership,
      timestamp: new Date().toISOString(),
    });
    await projectRegistry.upsert(projectRecord);
    return projectRecord;
  }

  async function ensureWorkspaceRecordUnarchived(
    workspace: PersistedWorkspaceRecord,
  ): Promise<PersistedWorkspaceRecord> {
    const project = await projectRegistry.get(workspace.projectId);
    if (!workspace.archivedAt && (!project || !project.archivedAt)) {
      return workspace;
    }

    const timestamp = new Date().toISOString();
    let unarchivedWorkspace = workspace;
    if (workspace.archivedAt) {
      unarchivedWorkspace = { ...workspace, archivedAt: null, updatedAt: timestamp };
      await workspaceRegistry.upsert(unarchivedWorkspace);
    }
    if (project?.archivedAt) {
      await projectRegistry.upsert({
        ...project,
        archivedAt: null,
        updatedAt: timestamp,
      });
    }
    return unarchivedWorkspace;
  }

  return {
    findOrCreateWorkspaceForDirectory,
    resolveOrCreateWorkspaceIdForCreateAgent,
    createWorkspaceForDirectory,
    findOrCreateProjectForDirectory,
    ensureWorkspaceRecordUnarchived,
  };
}

function resolvePersistedBranch(currentBranch: string | null | undefined): string | null {
  const branch = currentBranch?.trim() ?? null;
  return branch && branch.toUpperCase() !== "HEAD" ? branch : null;
}
