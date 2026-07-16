import type { ThothToolExecutionContext } from "./types.js";

export type WorkspaceSecretaryTurnPolicyKind = "raw_provider" | "thoth_clarify";

interface WorkspaceSecretaryTurnPolicyRecord {
  generation: string;
  kind: WorkspaceSecretaryTurnPolicyKind;
  providerTurnId: string | null;
}

/**
 * A topic keeps one provider thread even when Thoth is turned off for a turn.
 * Dynamic tool registration is session-scoped for some providers, so this
 * registry fences authority calls at the per-turn boundary instead.
 */
const policies = new Map<string, WorkspaceSecretaryTurnPolicyRecord>();

export function beginWorkspaceSecretaryTurnPolicy(input: {
  agentId: string;
  generation: string;
  kind: WorkspaceSecretaryTurnPolicyKind;
}): void {
  policies.set(input.agentId, {
    generation: input.generation,
    kind: input.kind,
    providerTurnId: null,
  });
}

export function bindWorkspaceSecretaryProviderTurn(input: {
  agentId: string;
  generation: string;
  providerTurnId: string;
}): void {
  const current = policies.get(input.agentId);
  if (!current || current.generation !== input.generation) {
    return;
  }
  policies.set(input.agentId, { ...current, providerTurnId: input.providerTurnId });
}

export function endWorkspaceSecretaryTurnPolicy(input: {
  agentId: string;
  generation: string;
}): void {
  if (policies.get(input.agentId)?.generation === input.generation) {
    policies.delete(input.agentId);
  }
}

export function assertWorkspaceSecretaryAuthorityTurn(input: {
  agentId: string;
  context: ThothToolExecutionContext;
}): void {
  const policy = policies.get(input.agentId);
  if (!policy) {
    throw new Error("No active Workspace Secretary authority turn owns this tool call");
  }
  if (policy.kind === "raw_provider") {
    throw new Error("Thoth authority tools are disabled for this raw provider turn");
  }
  const providerTurnId = input.context.providerToolCall?.turnId;
  if (
    policy.providerTurnId !== null &&
    providerTurnId !== undefined &&
    providerTurnId !== policy.providerTurnId
  ) {
    throw new Error("Stale Workspace Secretary provider turn cannot submit authority");
  }
}

export function resetWorkspaceSecretaryTurnPoliciesForTest(): void {
  policies.clear();
}
