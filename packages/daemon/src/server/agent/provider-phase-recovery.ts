import type {
  LoopGoalRecord,
  LoopPhaseRecord,
  LoopTaskModel,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";

import type { StoredAgentRecord } from "./agent-storage.js";
import type { AgentProvider } from "./agent-sdk-types.js";
import { PROVIDER_PHASE_RECOVERY_ADAPTERS } from "./providers/phase-recovery-adapters.js";

export interface ProviderPhaseRecoveryInput {
  provider: AgentProvider;
  thothHome: string;
  agentId: string;
  task: LoopTaskModel;
  goal: LoopGoalRecord;
  phase: LoopPhaseRecord;
}

export interface ProviderPhaseRecoveryAdapter {
  readonly provider: AgentProvider;
  recover(input: ProviderPhaseRecoveryInput): StoredAgentRecord | null;
}

/**
 * Provider fallback for legacy phase records absent from AgentStorage. The task state machine
 * only receives a normal persisted agent record and never interprets provider session files.
 */
export function recoverProviderPhaseRecord(
  input: ProviderPhaseRecoveryInput,
): StoredAgentRecord | null {
  return (
    PROVIDER_PHASE_RECOVERY_ADAPTERS.find(
      (adapter) => adapter.provider === input.provider,
    )?.recover(input) ?? null
  );
}
