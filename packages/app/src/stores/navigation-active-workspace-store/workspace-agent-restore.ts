import type {
  DaemonClient,
  FetchAgentHistoryEntry,
  FetchAgentHistoryOptions,
} from "@thoth/client/internal/daemon-client";
import { buildAgentDirectoryState } from "@/utils/agent-directory-sync";
import {
  normalizeWorkspaceOpaqueId,
  resolveWorkspaceMapKeyByIdentity,
} from "@/utils/workspace-identity";
import { type Agent, useSessionStore } from "@/stores/session-store";
import {
  buildWorkspaceTabPersistenceKey,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

const WORKSPACE_AGENT_HISTORY_PAGE_LIMIT = 200;
const WORKSPACE_AGENT_HISTORY_SORT: NonNullable<FetchAgentHistoryOptions["sort"]> = [
  { key: "updated_at", direction: "desc" },
];

const historyRestoreInFlight = new Map<string, Promise<boolean>>();
const historyRestoreAttempted = new Set<string>();

function restoreKey(serverId: string, workspaceId: string): string {
  return `${serverId}:${workspaceId}`;
}

function resolveWorkspaceIdForSession(input: {
  serverId: string;
  workspaceId: string;
}): string | null {
  const session = useSessionStore.getState().sessions[input.serverId];
  return (
    resolveWorkspaceMapKeyByIdentity({
      workspaces: session?.workspaces,
      workspaceId: input.workspaceId,
    }) ?? normalizeWorkspaceOpaqueId(input.workspaceId)
  );
}

function workspaceIdsMatch(
  agentWorkspaceId: string | null | undefined,
  workspaceId: string,
): boolean {
  return normalizeWorkspaceOpaqueId(agentWorkspaceId) === workspaceId;
}

function compareAgentActivityDescending(a: Agent, b: Agent): number {
  return b.lastActivityAt.getTime() - a.lastActivityAt.getTime();
}

function selectLatestAgentForWorkspace(input: {
  serverId: string;
  workspaceId: string;
}): Agent | null {
  const session = useSessionStore.getState().sessions[input.serverId];
  if (!session) {
    return null;
  }

  const candidates = new Map<string, Agent>();
  for (const agent of session.agents.values()) {
    if (workspaceIdsMatch(agent.workspaceId, input.workspaceId)) {
      candidates.set(agent.id, agent);
    }
  }
  for (const agent of session.agentDetails.values()) {
    if (workspaceIdsMatch(agent.workspaceId, input.workspaceId)) {
      candidates.set(agent.id, agent);
    }
  }

  return Array.from(candidates.values()).sort(compareAgentActivityDescending)[0] ?? null;
}

function focusWorkspaceAgentTab(input: {
  serverId: string;
  workspaceId: string;
  agentId: string;
}): boolean {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) {
    return false;
  }

  const layoutStore = useWorkspaceLayoutStore.getState();
  layoutStore.retainRestoredAgent(workspaceKey, input.agentId);
  return (
    layoutStore.openTabFocused(workspaceKey, {
      kind: "agent",
      agentId: input.agentId,
    }) !== null
  );
}

function upsertHistoryEntriesIntoAgentDetails(input: {
  serverId: string;
  entries: FetchAgentHistoryEntry[];
}): Agent[] {
  if (input.entries.length === 0) {
    return [];
  }

  const { agents, pendingPermissions } = buildAgentDirectoryState({
    serverId: input.serverId,
    entries: input.entries,
  });
  const store = useSessionStore.getState();

  store.setAgentDetails(input.serverId, (previous) => {
    const next = new Map(previous);
    for (const agent of agents.values()) {
      next.set(agent.id, agent);
    }
    return next;
  });
  store.setAgentLastActivityBatch((previous) => {
    const next = new Map(previous);
    for (const agent of agents.values()) {
      const current = next.get(agent.id);
      if (!current || current.getTime() < agent.lastActivityAt.getTime()) {
        next.set(agent.id, agent.lastActivityAt);
      }
    }
    return next;
  });
  store.setPendingPermissions(input.serverId, (previous) => {
    if (pendingPermissions.size === 0) {
      return previous;
    }
    const next = new Map(previous);
    for (const [key, pending] of pendingPermissions.entries()) {
      next.set(key, pending);
    }
    return next;
  });

  return Array.from(agents.values());
}

async function fetchWorkspaceHistoryAgent(input: {
  serverId: string;
  workspaceId: string;
  client: Pick<DaemonClient, "fetchAgentHistory">;
}): Promise<Agent | null> {
  const payload = await input.client.fetchAgentHistory({
    sort: WORKSPACE_AGENT_HISTORY_SORT,
    page: { limit: WORKSPACE_AGENT_HISTORY_PAGE_LIMIT },
  });
  const matchingEntries = payload.entries.filter((entry) =>
    workspaceIdsMatch(entry.agent.workspaceId, input.workspaceId),
  );
  const restoredAgents = upsertHistoryEntriesIntoAgentDetails({
    serverId: input.serverId,
    entries: matchingEntries,
  });
  return restoredAgents.sort(compareAgentActivityDescending)[0] ?? null;
}

export async function restoreWorkspaceAgentTabFromHistory(input: {
  serverId: string;
  workspaceId: string;
  client?: Pick<DaemonClient, "fetchAgentHistory"> | null;
  force?: boolean;
}): Promise<boolean> {
  const resolvedWorkspaceId = resolveWorkspaceIdForSession({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!resolvedWorkspaceId) {
    return false;
  }

  const key = restoreKey(input.serverId, resolvedWorkspaceId);
  const knownAgent = selectLatestAgentForWorkspace({
    serverId: input.serverId,
    workspaceId: resolvedWorkspaceId,
  });
  if (knownAgent) {
    historyRestoreAttempted.add(key);
    return focusWorkspaceAgentTab({
      serverId: input.serverId,
      workspaceId: resolvedWorkspaceId,
      agentId: knownAgent.id,
    });
  }

  if (!input.client) {
    return false;
  }
  if (!input.force && historyRestoreAttempted.has(key)) {
    return false;
  }

  const existing = historyRestoreInFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    historyRestoreAttempted.add(key);
    const historyAgent = await fetchWorkspaceHistoryAgent({
      serverId: input.serverId,
      workspaceId: resolvedWorkspaceId,
      client: input.client!,
    });
    if (!historyAgent) {
      return false;
    }
    return focusWorkspaceAgentTab({
      serverId: input.serverId,
      workspaceId: resolvedWorkspaceId,
      agentId: historyAgent.id,
    });
  })().finally(() => {
    historyRestoreInFlight.delete(key);
  });

  historyRestoreInFlight.set(key, promise);
  return promise;
}

export function resetWorkspaceAgentHistoryRestoreForTests(): void {
  historyRestoreInFlight.clear();
  historyRestoreAttempted.clear();
}
