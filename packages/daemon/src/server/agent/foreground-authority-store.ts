import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "pino";
import {
  AgentThothLifecycleSchema,
  ThothApprovalGoalCardModelSchema,
  ThothCardAnswerPayloadSchema,
  ThothClarifyCardModelSchema,
  ThothTaskCardModelSchema,
  ThothTurnControlSnapshotSchema,
  type AgentThothLifecycle,
  type AgentThothState,
  type ThothApprovalGoalCardModel,
  type ThothCardAnswerPayload,
  type ThothClarifyCardModel,
  type ThothTaskCardModel,
  type ThothTurnControlSnapshot,
} from "@thoth/protocol/thoth/rpc-schemas";
import {
  ForegroundThothProjection,
  type ForegroundAgentAuthorityRow,
  type ForegroundCardRow,
  type ForegroundTurnRow,
} from "./foreground-thoth-projection.js";

export type ForegroundAuthorityUpdateReason =
  | "turn_started"
  | "card_opened"
  | "card_answered"
  | "quick_exec_started"
  | "background_handoff"
  | "turn_completed"
  | "turn_interrupted"
  | "turn_canceled";

export type ForegroundAuthorityCardKind = "clarify_card" | "task_card" | "goal_card";

export type ForegroundAuthorityCard =
  | { kind: "clarify_card"; card: ThothClarifyCardModel }
  | { kind: "task_card"; card: ThothTaskCardModel }
  | { kind: "goal_card"; card: ThothApprovalGoalCardModel };

export interface ForegroundAuthorityRuntimeBinding {
  provider: string;
  threadId: string;
  providerTurnId: string;
  callId: string;
  toolName: string;
  redactedRawInputHash: string;
}

export interface ForegroundTurnAuthorityRecord {
  id: string;
  agentId: string;
  generation: string;
  kind: "raw" | "thoth";
  lifecycle: AgentThothLifecycle;
  controls: ThothTurnControlSnapshot | null;
  sourceMessageId: string | null;
  workspaceId: string | null;
  workspacePath: string;
  userText: string;
  providerTurnId: string | null;
  backgroundTaskId: string | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
}

export interface ForegroundCardAuthorityRecord {
  id: string;
  turnId: string;
  agentId: string;
  kind: ForegroundAuthorityCardKind;
  status: "pending" | "answered" | "canceled" | "blocked";
  card: ForegroundAuthorityCard["card"];
  answer: ThothCardAnswerPayload | null;
  submittedSummary: string | null;
  runtime: ForegroundAuthorityRuntimeBinding;
  createdAt: string;
  updatedAt: string;
}

export interface StartForegroundTurnInput {
  agentId: string;
  kind: "raw" | "thoth";
  controls?: ThothTurnControlSnapshot;
  sourceMessageId?: string;
  workspaceId?: string;
  workspacePath: string;
  userText: string;
}

export interface StartForegroundTurnResult {
  turn: ForegroundTurnAuthorityRecord;
  state: AgentThothState;
  created: boolean;
}

export interface AnswerForegroundCardResult {
  accepted: boolean;
  conflict: boolean;
  duplicate: boolean;
  error: string | null;
  state: AgentThothState;
  card: ForegroundCardAuthorityRecord | null;
  turn: ForegroundTurnAuthorityRecord | null;
}

type ForegroundAuthoritySubscriber = (
  state: AgentThothState,
  reason: ForegroundAuthorityUpdateReason,
) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function cardPayload(card: ForegroundAuthorityCard): ForegroundAuthorityCard["card"] {
  return card.card;
}

function parseCard(
  kind: ForegroundAuthorityCardKind,
  value: unknown,
): ForegroundAuthorityCard["card"] {
  if (kind === "clarify_card") {
    return ThothClarifyCardModelSchema.parse(value);
  }
  if (kind === "task_card") {
    return ThothTaskCardModelSchema.parse(value);
  }
  return ThothApprovalGoalCardModelSchema.parse(value);
}

export class ForegroundAuthorityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForegroundAuthorityConflictError";
  }
}

export class ForegroundAuthorityStore {
  private readonly database: DatabaseSync;
  private readonly subscribers = new Set<ForegroundAuthoritySubscriber>();

  constructor(input: { thothHome: string; logger: Logger }) {
    const root = path.join(input.thothHome, "foreground-thoth");
    mkdirSync(root, { recursive: true });
    this.database = new DatabaseSync(path.join(root, "authority.sqlite"), {
      enableForeignKeyConstraints: true,
    });
    this.database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS foreground_agents (
        agent_id TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL,
        active_turn_id TEXT,
        lifecycle TEXT NOT NULL,
        background_task_id TEXT,
        error TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS foreground_turns (
        turn_id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        generation TEXT NOT NULL,
        turn_kind TEXT NOT NULL,
        lifecycle TEXT NOT NULL,
        controls_json TEXT,
        source_message_id TEXT,
        workspace_id TEXT,
        workspace_path TEXT NOT NULL,
        user_text TEXT NOT NULL,
        provider_turn_id TEXT,
        background_task_id TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS foreground_turn_source_message
        ON foreground_turns(agent_id, source_message_id)
        WHERE source_message_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS foreground_turns_agent_started
        ON foreground_turns(agent_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS foreground_cards (
        card_id TEXT PRIMARY KEY NOT NULL,
        turn_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        card_kind TEXT NOT NULL,
        status TEXT NOT NULL,
        card_json TEXT NOT NULL,
        answer_json TEXT,
        submitted_summary TEXT,
        runtime_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (turn_id) REFERENCES foreground_turns(turn_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS foreground_cards_agent_created
        ON foreground_cards(agent_id, created_at ASC);
      CREATE TABLE IF NOT EXISTS foreground_commands (
        command_id TEXT PRIMARY KEY NOT NULL,
        agent_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS foreground_continuations (
        turn_id TEXT NOT NULL,
        continuation_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (turn_id, continuation_key),
        FOREIGN KEY (turn_id) REFERENCES foreground_turns(turn_id)
      ) STRICT;
    `);
    this.interruptRecoveredRuns(input.logger);
  }

  close(): void {
    this.database.close();
  }

  subscribe(subscriber: ForegroundAuthoritySubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  startTurn(input: StartForegroundTurnInput): StartForegroundTurnResult {
    const controls = input.controls
      ? ThothTurnControlSnapshotSchema.parse(input.controls)
      : undefined;
    if (input.kind === "thoth" && !controls) {
      throw new Error("A Thoth foreground turn requires frozen turn controls.");
    }
    if (input.kind === "raw" && controls) {
      throw new Error("A raw foreground turn cannot carry Thoth controls.");
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (input.sourceMessageId) {
        const existing = this.database
          .prepare(
            `SELECT * FROM foreground_turns
             WHERE agent_id = ? AND source_message_id = ?`,
          )
          .get(input.agentId, input.sourceMessageId) as Record<string, unknown> | undefined;
        if (existing) {
          const turn = this.toTurnRecord(existing);
          const state = this.getStateInTransaction(input.agentId);
          this.database.exec("COMMIT");
          return { turn, state, created: false };
        }
      }

      const current = this.getAuthorityRow(input.agentId);
      if (
        current &&
        (current.lifecycle === "running" ||
          current.lifecycle === "awaiting_card" ||
          current.lifecycle === "quick_exec")
      ) {
        throw new ForegroundAuthorityConflictError(
          `Agent ${input.agentId} already has an active foreground turn.`,
        );
      }

      const now = nowIso();
      const turnId = `foreground-turn-${randomUUID()}`;
      const generation = randomUUID();
      this.database
        .prepare(
          `INSERT INTO foreground_turns(
             turn_id, agent_id, generation, turn_kind, lifecycle, controls_json,
             source_message_id, workspace_id, workspace_path, user_text, provider_turn_id,
             background_task_id, error, started_at, updated_at
           ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          turnId,
          input.agentId,
          generation,
          input.kind,
          controls ? JSON.stringify(controls) : null,
          input.sourceMessageId ?? null,
          input.workspaceId ?? null,
          input.workspacePath,
          input.userText,
          now,
          now,
        );
      const nextRevision = (current?.revision ?? 0) + 1;
      this.database
        .prepare(
          `INSERT INTO foreground_agents(
             agent_id, revision, active_turn_id, lifecycle, background_task_id, error, updated_at
           ) VALUES (?, ?, ?, 'running', NULL, NULL, ?)
           ON CONFLICT(agent_id) DO UPDATE SET
             revision = excluded.revision,
             active_turn_id = excluded.active_turn_id,
             lifecycle = excluded.lifecycle,
             background_task_id = NULL,
             error = NULL,
             updated_at = excluded.updated_at`,
        )
        .run(input.agentId, nextRevision, turnId, now);
      const turn = this.getTurnByIdInTransaction(turnId)!;
      const state = this.getStateInTransaction(input.agentId);
      this.database.exec("COMMIT");
      this.emit(state, "turn_started");
      return { turn, state, created: true };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getState(agentId: string): AgentThothState {
    return this.getStateInTransaction(agentId);
  }

  getActiveTurn(agentId: string): ForegroundTurnAuthorityRecord | null {
    const authority = this.getAuthorityRow(agentId);
    return authority?.active_turn_id
      ? this.getTurnByIdInTransaction(authority.active_turn_id)
      : null;
  }

  getTurn(turnId: string): ForegroundTurnAuthorityRecord | null {
    return this.getTurnByIdInTransaction(turnId);
  }

  bindProviderTurn(input: {
    agentId: string;
    turnId: string;
    generation: string;
    providerTurnId: string;
  }): boolean {
    const result = this.database
      .prepare(
        `UPDATE foreground_turns SET provider_turn_id = ?, updated_at = ?
         WHERE turn_id = ? AND agent_id = ? AND generation = ?`,
      )
      .run(input.providerTurnId, nowIso(), input.turnId, input.agentId, input.generation);
    return result.changes === 1;
  }

  openCard(input: {
    agentId: string;
    turnId: string;
    generation: string;
    card: ForegroundAuthorityCard;
    runtime: ForegroundAuthorityRuntimeBinding;
  }): { record: ForegroundCardAuthorityRecord; state: AgentThothState; created: boolean } {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.getCardInTransaction(cardPayload(input.card).id);
      if (existing) {
        const state = this.getStateInTransaction(input.agentId);
        this.database.exec("COMMIT");
        return { record: existing, state, created: false };
      }
      const activeTurn = this.getActiveTurnInTransaction(input.agentId);
      if (
        !activeTurn ||
        activeTurn.id !== input.turnId ||
        activeTurn.generation !== input.generation ||
        activeTurn.kind !== "thoth"
      ) {
        throw new ForegroundAuthorityConflictError(
          "The authority card does not belong to the active foreground turn.",
        );
      }
      const now = nowIso();
      const payload = cardPayload(input.card);
      this.database
        .prepare(
          `INSERT INTO foreground_cards(
             card_id, turn_id, agent_id, card_kind, status, card_json, answer_json,
             submitted_summary, runtime_json, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, ?, ?)`,
        )
        .run(
          payload.id,
          input.turnId,
          input.agentId,
          input.card.kind,
          JSON.stringify(payload),
          JSON.stringify(input.runtime),
          now,
          now,
        );
      this.updateLifecycleInTransaction({
        agentId: input.agentId,
        turnId: input.turnId,
        lifecycle: "awaiting_card",
        now,
      });
      const record = this.getCardInTransaction(payload.id)!;
      const state = this.getStateInTransaction(input.agentId);
      this.database.exec("COMMIT");
      this.emit(state, "card_opened");
      return { record, state, created: true };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  answerCard(input: {
    agentId: string;
    cardId: string;
    answer: ThothCardAnswerPayload;
    submittedCard: ForegroundAuthorityCard["card"];
    submittedSummary: string;
    expectedRevision: number;
    commandId: string;
    nextLifecycle: AgentThothLifecycle;
  }): AnswerForegroundCardResult {
    const answer = ThothCardAnswerPayloadSchema.parse(input.answer);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const duplicate = this.database
        .prepare("SELECT response_json FROM foreground_commands WHERE command_id = ?")
        .get(input.commandId) as { response_json: string } | undefined;
      if (duplicate) {
        const stored = parseJson(duplicate.response_json) as {
          accepted: boolean;
          conflict: boolean;
          error: string | null;
        };
        const result: AnswerForegroundCardResult = {
          ...stored,
          duplicate: true,
          state: this.getStateInTransaction(input.agentId),
          card: this.getCardInTransaction(input.cardId),
          turn: this.getActiveTurnInTransaction(input.agentId),
        };
        this.database.exec("COMMIT");
        return result;
      }
      const authority = this.getAuthorityRow(input.agentId);
      if (!authority || authority.revision !== input.expectedRevision) {
        const response = {
          accepted: false,
          conflict: true,
          error: "The Agent Thoth state changed before this card answer was applied.",
        };
        this.rememberCommandInTransaction(input, response);
        const state = this.getStateInTransaction(input.agentId);
        this.database.exec("COMMIT");
        return {
          ...response,
          duplicate: false,
          state,
          card: this.getCard(input.cardId),
          turn: this.getActiveTurn(input.agentId),
        };
      }
      const card = this.getCardInTransaction(input.cardId);
      if (!card || card.agentId !== input.agentId || card.status !== "pending") {
        const response = {
          accepted: false,
          conflict: false,
          error: "This authority card is no longer pending for the Agent.",
        };
        this.rememberCommandInTransaction(input, response);
        const state = this.getStateInTransaction(input.agentId);
        this.database.exec("COMMIT");
        return {
          ...response,
          duplicate: false,
          state,
          card,
          turn: this.getActiveTurn(input.agentId),
        };
      }
      const turn = this.getTurnByIdInTransaction(card.turnId);
      if (!turn || authority.active_turn_id !== turn.id) {
        throw new ForegroundAuthorityConflictError(
          "This authority card no longer belongs to the active Agent turn.",
        );
      }
      const now = nowIso();
      this.database
        .prepare(
          `UPDATE foreground_cards SET
             status = 'answered', card_json = ?, answer_json = ?, submitted_summary = ?, updated_at = ?
           WHERE card_id = ?`,
        )
        .run(
          JSON.stringify(input.submittedCard),
          JSON.stringify(answer),
          input.submittedSummary,
          now,
          input.cardId,
        );
      this.updateLifecycleInTransaction({
        agentId: input.agentId,
        turnId: turn.id,
        lifecycle: input.nextLifecycle,
        now,
      });
      const response = { accepted: true, conflict: false, error: null };
      this.rememberCommandInTransaction(input, response);
      const state = this.getStateInTransaction(input.agentId);
      const answeredCard = this.getCardInTransaction(input.cardId);
      const nextTurn = this.getTurnByIdInTransaction(turn.id);
      this.database.exec("COMMIT");
      this.emit(state, "card_answered");
      return {
        ...response,
        duplicate: false,
        state,
        card: answeredCard,
        turn: nextTurn,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  markLifecycle(input: {
    agentId: string;
    turnId: string;
    generation: string;
    lifecycle: AgentThothLifecycle;
    reason: ForegroundAuthorityUpdateReason;
    error?: string | null;
    backgroundTaskId?: string | null;
  }): AgentThothState | null {
    AgentThothLifecycleSchema.parse(input.lifecycle);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const turn = this.getTurnByIdInTransaction(input.turnId);
      const authority = this.getAuthorityRow(input.agentId);
      if (
        !turn ||
        turn.agentId !== input.agentId ||
        turn.generation !== input.generation ||
        authority?.active_turn_id !== input.turnId
      ) {
        this.database.exec("COMMIT");
        return null;
      }
      const now = nowIso();
      this.updateLifecycleInTransaction({
        agentId: input.agentId,
        turnId: input.turnId,
        lifecycle: input.lifecycle,
        now,
        error: input.error,
        backgroundTaskId: input.backgroundTaskId,
      });
      const state = this.getStateInTransaction(input.agentId);
      this.database.exec("COMMIT");
      this.emit(state, input.reason);
      return state;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  cancelActiveTurn(input: { agentId: string; submittedSummary: string }): {
    state: AgentThothState;
    pendingCards: ForegroundCardAuthorityRecord[];
  } {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const turn = this.getActiveTurnInTransaction(input.agentId);
      if (!turn) {
        const state = this.getStateInTransaction(input.agentId);
        this.database.exec("COMMIT");
        return { state, pendingCards: [] };
      }
      const pendingCards = this.listCardsForTurnInTransaction(turn.id).filter(
        (card) => card.status === "pending",
      );
      const now = nowIso();
      for (const card of pendingCards) {
        const submittedCard = {
          ...card.card,
          submitted: true,
          submittedSummary: input.submittedSummary,
        };
        this.database
          .prepare(
            `UPDATE foreground_cards SET
               status = 'canceled', card_json = ?, submitted_summary = ?, updated_at = ?
             WHERE card_id = ?`,
          )
          .run(JSON.stringify(submittedCard), input.submittedSummary, now, card.id);
      }
      this.updateLifecycleInTransaction({
        agentId: input.agentId,
        turnId: turn.id,
        lifecycle: "canceled",
        now,
        error: null,
      });
      const state = this.getStateInTransaction(input.agentId);
      this.database.exec("COMMIT");
      this.emit(state, "turn_canceled");
      return { state, pendingCards };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getCard(cardId: string): ForegroundCardAuthorityRecord | null {
    return this.getCardInTransaction(cardId);
  }

  listCardsForTurn(turnId: string): ForegroundCardAuthorityRecord[] {
    return this.listCardsForTurnInTransaction(turnId);
  }

  listCardsForAgent(agentId: string): ForegroundCardAuthorityRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM foreground_cards WHERE agent_id = ? ORDER BY created_at ASC")
      .all(agentId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toCardRecord(row));
  }

  listAllCards(): ForegroundCardAuthorityRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM foreground_cards ORDER BY created_at ASC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.toCardRecord(row));
  }

  claimContinuation(input: { turnId: string; generation: string; key: string }): boolean {
    const turn = this.getTurnByIdInTransaction(input.turnId);
    if (!turn || turn.generation !== input.generation) {
      return false;
    }
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO foreground_continuations(turn_id, continuation_key, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(input.turnId, input.key, nowIso());
    return result.changes === 1;
  }

  private emit(state: AgentThothState, reason: ForegroundAuthorityUpdateReason): void {
    for (const subscriber of this.subscribers) {
      subscriber(state, reason);
    }
  }

  private interruptRecoveredRuns(logger: Logger): void {
    const rows = this.database
      .prepare(
        `SELECT agent_id, active_turn_id FROM foreground_agents
         WHERE lifecycle IN ('running', 'quick_exec') AND active_turn_id IS NOT NULL`,
      )
      .all() as Array<{ agent_id: string; active_turn_id: string }>;
    for (const row of rows) {
      const now = nowIso();
      const error = "The daemon restarted before the provider turn completed.";
      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.updateLifecycleInTransaction({
          agentId: row.agent_id,
          turnId: row.active_turn_id,
          lifecycle: "interrupted",
          now,
          error,
        });
        this.database.exec("COMMIT");
      } catch (cause) {
        this.database.exec("ROLLBACK");
        logger.warn({ err: cause, agentId: row.agent_id }, "foreground authority recovery failed");
      }
    }
  }

  private getStateInTransaction(agentId: string): AgentThothState {
    const authority = this.getAuthorityRow(agentId);
    if (!authority) {
      return ForegroundThothProjection.empty(agentId);
    }
    const turnRow = authority.active_turn_id
      ? (this.database
          .prepare("SELECT * FROM foreground_turns WHERE turn_id = ?")
          .get(authority.active_turn_id) as ForegroundTurnRow | undefined)
      : undefined;
    const pendingCardRow = authority.active_turn_id
      ? (this.database
          .prepare(
            `SELECT card_id, card_kind, card_json, created_at
             FROM foreground_cards
             WHERE turn_id = ? AND status = 'pending'
             ORDER BY created_at DESC LIMIT 1`,
          )
          .get(authority.active_turn_id) as ForegroundCardRow | undefined)
      : undefined;
    return ForegroundThothProjection.build({
      authority,
      turn: turnRow ?? null,
      pendingCard: pendingCardRow ?? null,
      agentId,
    });
  }

  private getAuthorityRow(agentId: string): ForegroundAgentAuthorityRow | null {
    const row = this.database
      .prepare("SELECT * FROM foreground_agents WHERE agent_id = ?")
      .get(agentId) as ForegroundAgentAuthorityRow | undefined;
    if (!row) {
      return null;
    }
    return { ...row, lifecycle: AgentThothLifecycleSchema.parse(row.lifecycle) };
  }

  private getActiveTurnInTransaction(agentId: string): ForegroundTurnAuthorityRecord | null {
    const authority = this.getAuthorityRow(agentId);
    return authority?.active_turn_id
      ? this.getTurnByIdInTransaction(authority.active_turn_id)
      : null;
  }

  private getTurnByIdInTransaction(turnId: string): ForegroundTurnAuthorityRecord | null {
    const row = this.database
      .prepare("SELECT * FROM foreground_turns WHERE turn_id = ?")
      .get(turnId) as Record<string, unknown> | undefined;
    return row ? this.toTurnRecord(row) : null;
  }

  private getCardInTransaction(cardId: string): ForegroundCardAuthorityRecord | null {
    const row = this.database
      .prepare("SELECT * FROM foreground_cards WHERE card_id = ?")
      .get(cardId) as Record<string, unknown> | undefined;
    return row ? this.toCardRecord(row) : null;
  }

  private listCardsForTurnInTransaction(turnId: string): ForegroundCardAuthorityRecord[] {
    const rows = this.database
      .prepare("SELECT * FROM foreground_cards WHERE turn_id = ? ORDER BY created_at ASC")
      .all(turnId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toCardRecord(row));
  }

  private toTurnRecord(row: Record<string, unknown>): ForegroundTurnAuthorityRecord {
    const controlsJson = typeof row.controls_json === "string" ? row.controls_json : null;
    return {
      id: String(row.turn_id),
      agentId: String(row.agent_id),
      generation: String(row.generation),
      kind: row.turn_kind === "thoth" ? "thoth" : "raw",
      lifecycle: AgentThothLifecycleSchema.parse(row.lifecycle),
      controls: controlsJson ? ThothTurnControlSnapshotSchema.parse(parseJson(controlsJson)) : null,
      sourceMessageId: typeof row.source_message_id === "string" ? row.source_message_id : null,
      workspaceId: typeof row.workspace_id === "string" ? row.workspace_id : null,
      workspacePath: String(row.workspace_path),
      userText: String(row.user_text),
      providerTurnId: typeof row.provider_turn_id === "string" ? row.provider_turn_id : null,
      backgroundTaskId: typeof row.background_task_id === "string" ? row.background_task_id : null,
      error: typeof row.error === "string" ? row.error : null,
      startedAt: String(row.started_at),
      updatedAt: String(row.updated_at),
    };
  }

  private toCardRecord(row: Record<string, unknown>): ForegroundCardAuthorityRecord {
    const kind = String(row.card_kind) as ForegroundAuthorityCardKind;
    const status = String(row.status) as ForegroundCardAuthorityRecord["status"];
    return {
      id: String(row.card_id),
      turnId: String(row.turn_id),
      agentId: String(row.agent_id),
      kind,
      status,
      card: parseCard(kind, parseJson(String(row.card_json))),
      answer:
        typeof row.answer_json === "string"
          ? ThothCardAnswerPayloadSchema.parse(parseJson(row.answer_json))
          : null,
      submittedSummary: typeof row.submitted_summary === "string" ? row.submitted_summary : null,
      runtime: parseJson(String(row.runtime_json)) as ForegroundAuthorityRuntimeBinding,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private updateLifecycleInTransaction(input: {
    agentId: string;
    turnId: string;
    lifecycle: AgentThothLifecycle;
    now: string;
    error?: string | null;
    backgroundTaskId?: string | null;
  }): void {
    const authority = this.getAuthorityRow(input.agentId);
    if (!authority || authority.active_turn_id !== input.turnId) {
      throw new ForegroundAuthorityConflictError("The Agent foreground turn changed.");
    }
    const error = input.error === undefined ? authority.error : input.error;
    const backgroundTaskId =
      input.backgroundTaskId === undefined ? authority.background_task_id : input.backgroundTaskId;
    this.database
      .prepare(
        `UPDATE foreground_turns SET
           lifecycle = ?, background_task_id = ?, error = ?, updated_at = ?
         WHERE turn_id = ?`,
      )
      .run(input.lifecycle, backgroundTaskId, error, input.now, input.turnId);
    this.database
      .prepare(
        `UPDATE foreground_agents SET
           revision = revision + 1, lifecycle = ?, background_task_id = ?, error = ?, updated_at = ?
         WHERE agent_id = ?`,
      )
      .run(input.lifecycle, backgroundTaskId, error, input.now, input.agentId);
  }

  private rememberCommandInTransaction(
    input: { commandId: string; agentId: string; cardId: string },
    response: { accepted: boolean; conflict: boolean; error: string | null },
  ): void {
    this.database
      .prepare(
        `INSERT INTO foreground_commands(command_id, agent_id, card_id, response_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.commandId, input.agentId, input.cardId, JSON.stringify(response), nowIso());
  }
}
