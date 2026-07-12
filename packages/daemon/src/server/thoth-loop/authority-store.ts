import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "pino";
import {
  LoopTaskModelSchema,
  type LoopTaskEvent,
  type LoopTaskModel,
  type LoopWorktreeLease as ProtocolLoopWorktreeLease,
  type TaskMemoryKind as ProtocolTaskMemoryKind,
  type TaskMemoryNodeRef,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";

interface LegacyTaskFile {
  version?: unknown;
  tasks?: unknown;
}

interface LegacyLockFile {
  version?: unknown;
  locks?: Array<{
    workspacePath?: unknown;
    taskId?: unknown;
    phase?: unknown;
    phaseAgentId?: unknown;
    createdAt?: unknown;
    heartbeatAt?: unknown;
  }>;
}

export interface LoopAuthorityEvent extends LoopTaskEvent {
  projection: LoopTaskModel;
}

export type LoopWorktreeLease = ProtocolLoopWorktreeLease;

export interface AppendTaskEventInput {
  eventId?: string;
  kind: string;
  goalId?: string;
  phaseRunId?: string;
  causationId?: string;
  correlationId?: string;
  payload?: Record<string, unknown>;
}

export type TaskMemoryKind = ProtocolTaskMemoryKind;

export interface TaskMemoryNode extends TaskMemoryNodeRef {}

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

/**
 * Durable Loop authority store. The projection table is a query cache; every
 * state mutation also appends its complete projection to task_events, which
 * makes recovery and late-event audits deterministic without trusting process
 * memory or the former JSON snapshots.
 */
export class LoopAuthorityStore {
  private readonly dbPath: string;
  private readonly database: DatabaseSync;

  constructor(input: { thothHome: string; logger: Logger }) {
    const root = path.join(input.thothHome, "thoth-loop");
    mkdirSync(root, { recursive: true });
    this.dbPath = path.join(root, "authority.sqlite");
    this.database = new DatabaseSync(this.dbPath, { enableForeignKeyConstraints: true });
    this.database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS loop_schema_migrations (
        name TEXT PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS loop_task_projections (
        task_id TEXT PRIMARY KEY NOT NULL,
        revision INTEGER NOT NULL,
        projection_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS loop_task_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        kind TEXT NOT NULL,
        goal_id TEXT,
        phase_run_id TEXT,
        causation_id TEXT,
        correlation_id TEXT,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        projection_json TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES loop_task_projections(task_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS loop_task_events_task_revision
        ON loop_task_events(task_id, revision);
      CREATE TABLE IF NOT EXISTS loop_worktree_leases (
        workspace_path TEXT PRIMARY KEY NOT NULL,
        lease_json TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS loop_task_memory_nodes (
        node_id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        revision INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        content_sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES loop_task_projections(task_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS loop_task_memory_nodes_task_kind
        ON loop_task_memory_nodes(task_id, kind, revision DESC);
    `);
    this.importLegacySnapshots(input.thothHome, input.logger);
  }

  listTasks(): LoopTaskModel[] {
    const rows = this.database
      .prepare(
        "SELECT projection_json, revision FROM loop_task_projections ORDER BY updated_at DESC",
      )
      .all() as Array<{ projection_json: string; revision: number }>;
    const tasks: LoopTaskModel[] = [];
    for (const row of rows) {
      const parsed = LoopTaskModelSchema.safeParse(parseJson(row.projection_json));
      if (!parsed.success) {
        continue;
      }
      tasks.push({ ...parsed.data, authorityRevision: row.revision });
    }
    return tasks;
  }

  readEvents(taskId: string): LoopAuthorityEvent[] {
    const rows = this.database
      .prepare(
        `SELECT event_id, task_id, revision, kind, goal_id, phase_run_id, causation_id,
                correlation_id, occurred_at, payload_sha256, projection_json
         FROM loop_task_events WHERE task_id = ? ORDER BY revision ASC`,
      )
      .all(taskId) as Array<{
      event_id: string;
      task_id: string;
      revision: number;
      kind: string;
      goal_id: string | null;
      phase_run_id: string | null;
      causation_id: string | null;
      correlation_id: string | null;
      occurred_at: string;
      payload_sha256: string;
      projection_json: string;
    }>;
    return rows.flatMap((row) => {
      const parsed = LoopTaskModelSchema.safeParse(parseJson(row.projection_json));
      if (!parsed.success) {
        return [];
      }
      return [
        {
          eventId: row.event_id,
          taskId: row.task_id,
          revision: row.revision,
          kind: row.kind,
          ...(row.goal_id ? { goalId: row.goal_id } : {}),
          ...(row.phase_run_id ? { phaseRunId: row.phase_run_id } : {}),
          causationId: row.causation_id ?? row.event_id,
          correlationId: row.correlation_id ?? row.task_id,
          occurredAt: row.occurred_at,
          payloadSha256: row.payload_sha256,
          projection: { ...parsed.data, authorityRevision: row.revision },
        },
      ];
    });
  }

  appendMemory(
    taskId: string,
    kind: TaskMemoryKind,
    content: unknown,
    revision: number,
  ): TaskMemoryNode {
    const serialized = JSON.stringify(content);
    const node: TaskMemoryNode = {
      id: `task-memory-${randomUUID()}`,
      taskId,
      kind,
      revision,
      contentSha256: sha256(serialized),
      createdAt: nowIso(),
    };
    this.database
      .prepare(
        `INSERT INTO loop_task_memory_nodes(
           node_id, task_id, kind, revision, content_json, content_sha256, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(node.id, taskId, kind, revision, serialized, node.contentSha256, node.createdAt);
    return node;
  }

  latestMemory(taskId: string, kind: TaskMemoryKind): TaskMemoryNode | null {
    const row = this.database
      .prepare(
        `SELECT node_id, task_id, kind, revision, content_sha256, created_at
         FROM loop_task_memory_nodes WHERE task_id = ? AND kind = ?
         ORDER BY revision DESC LIMIT 1`,
      )
      .get(taskId, kind) as
      | {
          node_id: string;
          task_id: string;
          kind: TaskMemoryKind;
          revision: number;
          content_sha256: string;
          created_at: string;
        }
      | undefined;
    return row
      ? {
          id: row.node_id,
          taskId: row.task_id,
          kind: row.kind,
          revision: row.revision,
          contentSha256: row.content_sha256,
          createdAt: row.created_at,
        }
      : null;
  }

  listMemoryRefs(taskId: string): TaskMemoryNode[] {
    const rows = this.database
      .prepare(
        `SELECT node_id, task_id, kind, revision, content_sha256, created_at
         FROM loop_task_memory_nodes WHERE task_id = ?
         ORDER BY revision ASC, created_at ASC`,
      )
      .all(taskId) as Array<{
      node_id: string;
      task_id: string;
      kind: TaskMemoryKind;
      revision: number;
      content_sha256: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.node_id,
      taskId: row.task_id,
      kind: row.kind,
      revision: row.revision,
      contentSha256: row.content_sha256,
      createdAt: row.created_at,
    }));
  }

  append(task: LoopTaskModel, input: AppendTaskEventInput): LoopTaskModel {
    const eventId = input.eventId ?? randomUUID();
    const duplicate = this.database
      .prepare("SELECT revision, projection_json FROM loop_task_events WHERE event_id = ?")
      .get(eventId) as { revision: number; projection_json: string } | undefined;
    if (duplicate) {
      const parsed = LoopTaskModelSchema.safeParse(parseJson(duplicate.projection_json));
      if (!parsed.success) {
        throw new Error(`Loop authority duplicate event ${eventId} has an invalid projection.`);
      }
      return { ...parsed.data, authorityRevision: duplicate.revision };
    }
    const now = nowIso();
    const current = this.database
      .prepare("SELECT revision FROM loop_task_projections WHERE task_id = ?")
      .get(task.id) as { revision: number } | undefined;
    const expectedRevision = task.authorityRevision ?? 0;
    if (current && current.revision !== expectedRevision) {
      throw new Error(
        `Loop authority revision conflict for ${task.id}: expected ${expectedRevision}, found ${current.revision}.`,
      );
    }
    if (!current && expectedRevision !== 0) {
      throw new Error(`Loop authority projection is missing for ${task.id}.`);
    }
    const revision = (current?.revision ?? 0) + 1;
    const next = LoopTaskModelSchema.parse({
      ...task,
      authorityRevision: revision,
      updatedAt: now,
    });
    const projectionJson = JSON.stringify(next);
    const payloadJson = JSON.stringify(input.payload ?? {});
    const causationId = input.causationId ?? eventId;
    const correlationId = input.correlationId ?? task.id;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (current) {
        const result = this.database
          .prepare(
            `UPDATE loop_task_projections
             SET revision = ?, projection_json = ?, updated_at = ?
             WHERE task_id = ? AND revision = ?`,
          )
          .run(revision, projectionJson, now, task.id, expectedRevision);
        if (result.changes !== 1) {
          throw new Error(`Loop authority CAS lost for ${task.id}.`);
        }
      } else {
        this.database
          .prepare(
            `INSERT INTO loop_task_projections(task_id, revision, projection_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(task.id, revision, projectionJson, task.createdAt, now);
      }
      this.database
        .prepare(
          `INSERT INTO loop_task_events(
             event_id, task_id, revision, kind, goal_id, phase_run_id, causation_id,
             correlation_id, occurred_at, payload_json, payload_sha256, projection_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          eventId,
          task.id,
          revision,
          input.kind,
          input.goalId ?? null,
          input.phaseRunId ?? null,
          causationId,
          correlationId,
          now,
          payloadJson,
          sha256(payloadJson),
          projectionJson,
        );
      this.database.exec("COMMIT");
      return next;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  acquireLease(input: LoopWorktreeLease): boolean {
    const existing = this.getLease(input.workspacePath);
    if (
      existing &&
      Date.parse(existing.expiresAt) > Date.now() &&
      existing.taskId !== input.taskId
    ) {
      return false;
    }
    this.database
      .prepare(
        `INSERT INTO loop_worktree_leases(workspace_path, lease_json, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(workspace_path) DO UPDATE SET lease_json = excluded.lease_json, expires_at = excluded.expires_at`,
      )
      .run(input.workspacePath, JSON.stringify(input), input.expiresAt);
    return true;
  }

  getLease(workspacePath: string): LoopWorktreeLease | null {
    const row = this.database
      .prepare("SELECT lease_json FROM loop_worktree_leases WHERE workspace_path = ?")
      .get(workspacePath) as { lease_json: string } | undefined;
    if (!row) {
      return null;
    }
    try {
      const value = parseJson(row.lease_json);
      if (!value || typeof value !== "object") {
        return null;
      }
      const lease = value as LoopWorktreeLease;
      return lease.workspacePath && lease.taskId && lease.expiresAt ? lease : null;
    } catch {
      return null;
    }
  }

  listLeases(): LoopWorktreeLease[] {
    const rows = this.database
      .prepare("SELECT lease_json FROM loop_worktree_leases")
      .all() as Array<{ lease_json: string }>;
    return rows.flatMap((row) => {
      try {
        const lease = parseJson(row.lease_json) as LoopWorktreeLease;
        return lease.workspacePath && lease.taskId && lease.expiresAt ? [lease] : [];
      } catch {
        return [];
      }
    });
  }

  releaseLease(workspacePath: string, taskId: string): void {
    this.database
      .prepare(
        "DELETE FROM loop_worktree_leases WHERE workspace_path = ? AND json_extract(lease_json, '$.taskId') = ?",
      )
      .run(workspacePath, taskId);
  }

  private importLegacySnapshots(thothHome: string, logger: Logger): void {
    const marker = this.database
      .prepare("SELECT name FROM loop_schema_migrations WHERE name = 'legacy-json-v1'")
      .get() as { name: string } | undefined;
    if (marker) {
      return;
    }
    const legacyPath = path.join(thothHome, "thoth-loop", "tasks.json");
    if (existsSync(legacyPath)) {
      try {
        const raw = parseJson(readFileSync(legacyPath, "utf8")) as LegacyTaskFile;
        for (const candidate of Array.isArray(raw.tasks) ? raw.tasks : []) {
          const parsed = LoopTaskModelSchema.safeParse(candidate);
          if (!parsed.success) {
            continue;
          }
          const task = parsed.data;
          if (task.status === "running") {
            task.status = "interrupted";
            task.summary = "daemon 重启后检测到旧 Loop 阶段中断；Resume 会从当前阶段继续。";
            const active = task.currentGoalId
              ? task.goals.find((goal) => goal.id === task.currentGoalId)
              : undefined;
            if (active?.status === "running_planexec" || active?.status === "running_review") {
              active.status = "interrupted";
            }
          }
          this.append(task, { kind: "legacy_json_import", payload: { legacyPath } });
        }
      } catch (error) {
        logger.warn({ err: error, legacyPath }, "Failed to import legacy Thoth Loop tasks");
      }
    }
    const lockPath = path.join(thothHome, "thoth-loop", "worktree-locks.json");
    if (existsSync(lockPath)) {
      try {
        const raw = parseJson(readFileSync(lockPath, "utf8")) as LegacyLockFile;
        for (const lock of raw.locks ?? []) {
          if (typeof lock.taskId !== "string") {
            continue;
          }
          const task = this.listTasks().find((candidate) => candidate.id === lock.taskId);
          if (
            !task ||
            task.status === "done" ||
            task.status === "stopped" ||
            task.status === "blocked"
          ) {
            continue;
          }
          task.status = "interrupted";
          task.summary = "daemon 重启后检测到旧 worktree lock；Resume 会从当前阶段继续。";
          this.append(task, { kind: "legacy_lock_interrupted", payload: { lockPath } });
        }
      } catch (error) {
        logger.warn({ err: error, lockPath }, "Failed to import legacy Thoth Loop locks");
      }
    }
    this.database
      .prepare("INSERT INTO loop_schema_migrations(name, applied_at) VALUES (?, ?)")
      .run("legacy-json-v1", nowIso());
  }
}
