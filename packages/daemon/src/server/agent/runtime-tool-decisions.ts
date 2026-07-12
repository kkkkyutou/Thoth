import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ClarifyConvergenceReview,
  ClarifyDecisionDelta,
  ClarifyFrontierLedger,
} from "@thoth/protocol/thoth-runtime-contract";
import type {
  RegisteredTaskModel,
  ThothClarifyCardModel,
  ThothApprovalGoalCardModel,
  ThothTaskCardModel,
  WorkspaceSecretaryTurnActionPayload,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";

export type RuntimeAuthorityCardKind =
  | "clarify_card"
  | "task_card"
  | "goals_card"
  | "pyramid_plan_card"
  | "blocked_card";

export type RuntimeAuthorityDecisionStatus =
  | "pending"
  | "answered"
  | "rejected"
  | "expired"
  | "blocked";

export type RuntimeAuthorityCard =
  | { kind: "clarify_card"; card: ThothClarifyCardModel }
  | { kind: "task_card"; card: ThothTaskCardModel }
  | { kind: "goals_card"; card: ThothApprovalGoalCardModel }
  | { kind: "pyramid_plan_card"; card: ThothApprovalGoalCardModel }
  | { kind: "blocked_card"; title: string; reason: string };

export interface RuntimeAuthorityDecisionRecord {
  id: string;
  provider: string;
  agentId: string;
  topicId: string | null;
  threadId: string;
  turnId: string;
  callId: string;
  toolName: string;
  phase: string | null;
  cardKind: RuntimeAuthorityCardKind;
  cardId: string;
  status: RuntimeAuthorityDecisionStatus;
  createdAt: string;
  updatedAt: string;
  redactedRawInputHash: string;
  authorityCard: RuntimeAuthorityCard;
  publicBadgeSummary?: string;
  frontierLedger?: ClarifyFrontierLedger;
  decisionDelta?: ClarifyDecisionDelta;
  convergenceReview?: ClarifyConvergenceReview;
}

interface PendingRuntimeAuthorityDecision {
  record: RuntimeAuthorityDecisionRecord;
  resolve: (result: RuntimeAuthorityDecisionAnswerResult) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface RuntimeAuthorityDecisionAnswerResult {
  answer: WorkspaceSecretaryTurnActionPayload;
  submittedSummary: string;
  registeredTask?: RegisteredTaskModel;
}

const DEFAULT_PENDING_DECISION_TIMEOUT_MS = 30 * 60 * 1000;

const pendingByDecisionId = new Map<string, PendingRuntimeAuthorityDecision>();
const pendingByCardId = new Map<string, PendingRuntimeAuthorityDecision>();
const recordsByDecisionId = new Map<string, RuntimeAuthorityDecisionRecord>();
const latestTaskCardByAgent = new Map<string, ThothTaskCardModel>();
const latestGoalCardByAgent = new Map<string, ThothApprovalGoalCardModel>();
let persistenceFilePath: string | null = null;
let loadedPersistenceFilePath: string | null = null;

function persistDecisionRecords(): void {
  if (!persistenceFilePath) {
    return;
  }
  try {
    mkdirSync(dirname(persistenceFilePath), { recursive: true });
    writeFileSync(
      persistenceFilePath,
      `${JSON.stringify(
        {
          version: 1,
          records: Array.from(recordsByDecisionId.values()),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch {
    // Persistence is best-effort evidence. The in-memory pending promise remains authority
    // for the active provider tool call, so a filesystem write failure must not auto-answer.
  }
}

function loadPersistedDecisionRecords(filePath: string): void {
  if (loadedPersistenceFilePath === filePath) {
    return;
  }
  loadedPersistenceFilePath = filePath;
  if (!existsSync(filePath)) {
    return;
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
      records?: RuntimeAuthorityDecisionRecord[];
    };
    for (const record of parsed.records ?? []) {
      if (!record?.id || recordsByDecisionId.has(record.id)) {
        continue;
      }
      recordsByDecisionId.set(record.id, {
        ...record,
        status: record.status === "pending" ? "blocked" : record.status,
        updatedAt: record.status === "pending" ? new Date().toISOString() : record.updatedAt,
      });
    }
    persistDecisionRecords();
  } catch {
    // Corrupt persistence must not create fake decisions or default answers.
  }
}

export function configureRuntimeAuthorityDecisionPersistence(input: {
  filePath: string | null;
}): void {
  persistenceFilePath = input.filePath;
  if (input.filePath) {
    loadPersistedDecisionRecords(input.filePath);
  }
}

function touchRecord(
  record: RuntimeAuthorityDecisionRecord,
  status: RuntimeAuthorityDecisionStatus,
): RuntimeAuthorityDecisionRecord {
  const next = {
    ...record,
    status,
    updatedAt: new Date().toISOString(),
  };
  recordsByDecisionId.set(record.id, next);
  persistDecisionRecords();
  return next;
}

export function createRuntimeAuthorityDecision(input: {
  provider: string;
  agentId: string;
  topicId?: string | null;
  threadId: string;
  turnId: string;
  callId: string;
  toolName: string;
  phase?: string | null;
  card: RuntimeAuthorityCard;
  redactedRawInputHash: string;
  publicBadgeSummary?: string;
  frontierLedger?: ClarifyFrontierLedger;
  decisionDelta?: ClarifyDecisionDelta;
  convergenceReview?: ClarifyConvergenceReview;
  timeoutMs?: number;
}): {
  record: RuntimeAuthorityDecisionRecord;
  waitForAnswer: Promise<RuntimeAuthorityDecisionAnswerResult>;
} {
  const now = new Date().toISOString();
  const cardId =
    input.card.kind === "clarify_card" ||
    input.card.kind === "task_card" ||
    input.card.kind === "goals_card" ||
    input.card.kind === "pyramid_plan_card"
      ? input.card.card.id
      : `blocked-${randomUUID()}`;
  const record: RuntimeAuthorityDecisionRecord = {
    id: `runtime-decision-${randomUUID()}`,
    provider: input.provider,
    agentId: input.agentId,
    topicId: input.topicId ?? null,
    threadId: input.threadId,
    turnId: input.turnId,
    callId: input.callId,
    toolName: input.toolName,
    phase: input.phase ?? null,
    cardKind: input.card.kind,
    cardId,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    redactedRawInputHash: input.redactedRawInputHash,
    authorityCard: input.card,
    ...(input.publicBadgeSummary ? { publicBadgeSummary: input.publicBadgeSummary } : {}),
    ...(input.frontierLedger ? { frontierLedger: input.frontierLedger } : {}),
    ...(input.decisionDelta ? { decisionDelta: input.decisionDelta } : {}),
    ...(input.convergenceReview ? { convergenceReview: input.convergenceReview } : {}),
  };

  recordsByDecisionId.set(record.id, record);
  persistDecisionRecords();

  const waitForAnswer = new Promise<RuntimeAuthorityDecisionAnswerResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const pending = pendingByDecisionId.get(record.id);
      if (!pending) {
        return;
      }
      pendingByDecisionId.delete(record.id);
      pendingByCardId.delete(record.cardId);
      pending.reject(new Error("Thoth runtime authority decision expired before user answer"));
      touchRecord(record, "expired");
    }, input.timeoutMs ?? DEFAULT_PENDING_DECISION_TIMEOUT_MS);
    timeout.unref?.();
    const pending = { record, resolve, reject, timeout };
    pendingByDecisionId.set(record.id, pending);
    pendingByCardId.set(record.cardId, pending);
  });

  if (input.card.kind === "task_card") {
    latestTaskCardByAgent.set(input.agentId, input.card.card);
  }
  if (input.card.kind === "goals_card" || input.card.kind === "pyramid_plan_card") {
    latestGoalCardByAgent.set(input.agentId, input.card.card);
  }

  return { record, waitForAnswer };
}

export function getPendingRuntimeAuthorityDecisionByCardId(
  cardId: string,
): RuntimeAuthorityDecisionRecord | null {
  return pendingByCardId.get(cardId)?.record ?? null;
}

export function getRuntimeAuthorityDecisionRecord(
  decisionId: string,
): RuntimeAuthorityDecisionRecord | null {
  return recordsByDecisionId.get(decisionId) ?? null;
}

export function listPendingRuntimeAuthorityDecisions(): RuntimeAuthorityDecisionRecord[] {
  return Array.from(pendingByDecisionId.values()).map((pending) => pending.record);
}

export function listRuntimeAuthorityDecisionRecords(): RuntimeAuthorityDecisionRecord[] {
  return Array.from(recordsByDecisionId.values());
}

export function answerRuntimeAuthorityDecision(input: {
  cardId: string;
  answer: WorkspaceSecretaryTurnActionPayload;
  submittedSummary: string;
  registeredTask?: RegisteredTaskModel;
}): RuntimeAuthorityDecisionRecord | null {
  const pending = pendingByCardId.get(input.cardId);
  if (!pending) {
    return null;
  }
  clearTimeout(pending.timeout);
  pendingByDecisionId.delete(pending.record.id);
  pendingByCardId.delete(input.cardId);
  const answered = touchRecord(pending.record, "answered");
  pending.resolve({
    answer: input.answer,
    submittedSummary: input.submittedSummary,
    ...(input.registeredTask ? { registeredTask: input.registeredTask } : {}),
  });
  return answered;
}

export function rejectRuntimeAuthorityDecision(input: {
  cardId: string;
  message: string;
  status?: Exclude<RuntimeAuthorityDecisionStatus, "pending" | "answered">;
}): RuntimeAuthorityDecisionRecord | null {
  const pending = pendingByCardId.get(input.cardId);
  if (!pending) {
    return null;
  }
  clearTimeout(pending.timeout);
  pendingByDecisionId.delete(pending.record.id);
  pendingByCardId.delete(input.cardId);
  const rejected = touchRecord(pending.record, input.status ?? "rejected");
  pending.reject(new Error(input.message));
  return rejected;
}

export function getLatestRuntimeTaskCardForAgent(agentId: string): ThothTaskCardModel | null {
  return latestTaskCardByAgent.get(agentId) ?? null;
}

export function getLatestRuntimePyramidPlanForAgent(
  agentId: string,
): ThothApprovalGoalCardModel | null {
  return latestGoalCardByAgent.get(agentId) ?? null;
}

export function resetRuntimeAuthorityDecisionsForTest(): void {
  for (const pending of pendingByDecisionId.values()) {
    clearTimeout(pending.timeout);
  }
  pendingByDecisionId.clear();
  pendingByCardId.clear();
  recordsByDecisionId.clear();
  latestTaskCardByAgent.clear();
  latestGoalCardByAgent.clear();
  persistenceFilePath = null;
  loadedPersistenceFilePath = null;
}
