import {
  AgentThothStateSchema,
  ThothApprovalGoalCardModelSchema,
  ThothClarifyCardModelSchema,
  ThothTaskCardModelSchema,
  ThothTurnControlSnapshotSchema,
  type AgentThothLifecycle,
  type AgentThothPendingCard,
  type AgentThothState,
  type AgentThothTurn,
} from "@thoth/protocol/thoth/rpc-schemas";

export interface ForegroundAgentAuthorityRow {
  agent_id: string;
  revision: number;
  active_turn_id: string | null;
  lifecycle: AgentThothLifecycle;
  background_task_id: string | null;
  error: string | null;
}

export interface ForegroundTurnRow {
  turn_id: string;
  agent_id: string;
  turn_kind: "raw" | "thoth";
  lifecycle: AgentThothLifecycle;
  controls_json: string | null;
  source_message_id: string | null;
  background_task_id: string | null;
  error: string | null;
  started_at: string;
  updated_at: string;
}

export interface ForegroundCardRow {
  card_id: string;
  card_kind: "clarify_card" | "task_card" | "goal_card";
  card_json: string;
  created_at: string;
}

function parseTurn(row: ForegroundTurnRow | null): AgentThothTurn | null {
  if (!row) {
    return null;
  }
  const controls = row.controls_json
    ? ThothTurnControlSnapshotSchema.parse(JSON.parse(row.controls_json) as unknown)
    : undefined;
  return {
    id: row.turn_id,
    agentId: row.agent_id,
    kind: row.turn_kind,
    lifecycle: row.lifecycle,
    ...(controls ? { controls } : {}),
    ...(row.source_message_id ? { sourceMessageId: row.source_message_id } : {}),
    ...(row.background_task_id ? { backgroundTaskId: row.background_task_id } : {}),
    ...(row.error ? { error: row.error } : {}),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}

function parsePendingCard(row: ForegroundCardRow | null): AgentThothPendingCard | null {
  if (!row) {
    return null;
  }
  const raw = JSON.parse(row.card_json) as unknown;
  if (row.card_kind === "clarify_card") {
    return {
      kind: row.card_kind,
      card: ThothClarifyCardModelSchema.parse(raw),
      createdAt: row.created_at,
    };
  }
  if (row.card_kind === "task_card") {
    return {
      kind: row.card_kind,
      card: ThothTaskCardModelSchema.parse(raw),
      createdAt: row.created_at,
    };
  }
  return {
    kind: row.card_kind,
    card: ThothApprovalGoalCardModelSchema.parse(raw),
    createdAt: row.created_at,
  };
}

export class ForegroundThothProjection {
  static empty(agentId: string): AgentThothState {
    return {
      agentId,
      revision: 0,
      lifecycle: "idle",
      turn: null,
      pendingCard: null,
      backgroundTaskId: null,
      error: null,
    };
  }

  static build(input: {
    authority: ForegroundAgentAuthorityRow | null;
    turn: ForegroundTurnRow | null;
    pendingCard: ForegroundCardRow | null;
    agentId: string;
  }): AgentThothState {
    if (!input.authority) {
      return this.empty(input.agentId);
    }
    return AgentThothStateSchema.parse({
      agentId: input.authority.agent_id,
      revision: input.authority.revision,
      lifecycle: input.authority.lifecycle,
      turn: parseTurn(input.turn),
      pendingCard: parsePendingCard(input.pendingCard),
      backgroundTaskId: input.authority.background_task_id,
      error: input.authority.error,
    });
  }
}
