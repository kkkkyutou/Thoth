import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { LoopPhaseRecord } from "@thoth/protocol/thoth/rpc-schemas";

import type { StoredAgentRecord } from "../agent-storage.js";
import type {
  ProviderPhaseRecoveryAdapter,
  ProviderPhaseRecoveryInput,
} from "../provider-phase-recovery.js";
import { withThothRuntimeTools } from "../thoth-runtime-tools-config.js";

function listJsonlFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsonlFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(entryPath);
    }
  }
  return files;
}

function readLatestCodexSessionMeta(sessionHome: string): {
  sessionId: string;
  timestamp: string;
} | null {
  const candidates: Array<{ sessionId: string; timestamp: string }> = [];
  for (const filePath of listJsonlFiles(path.join(sessionHome, "sessions"))) {
    for (const line of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line) as {
          payload?: { id?: unknown; timestamp?: unknown };
          timestamp?: unknown;
        };
        if (typeof entry.payload?.id !== "string" || !entry.payload.id.trim()) {
          continue;
        }
        const timestamp =
          typeof entry.payload.timestamp === "string"
            ? entry.payload.timestamp
            : typeof entry.timestamp === "string"
              ? entry.timestamp
              : new Date(0).toISOString();
        candidates.push({ sessionId: entry.payload.id, timestamp });
        break;
      } catch {
        continue;
      }
    }
  }
  return candidates.sort((left, right) => right.timestamp.localeCompare(left.timestamp))[0] ?? null;
}

function phaseTitle(phase: LoopPhaseRecord["phase"]): string {
  return phase === "review" ? "Review" : "PlanExec";
}

function recoverCodexPhaseRecord(input: ProviderPhaseRecoveryInput): StoredAgentRecord | null {
  const loopSessionId =
    input.phase.phase === "planexec"
      ? `loop-${input.task.id}-${input.goal.id}-planexec`
      : `loop-${input.task.id}-${input.goal.id}-review-${input.phase.round}`;
  const sessionHome = path.join(input.thothHome, "provider-sessions", loopSessionId);
  const meta = readLatestCodexSessionMeta(sessionHome);
  if (!meta) {
    return null;
  }
  const title = `${phaseTitle(input.phase.phase)}: ${input.goal.title}`;
  const modeId =
    input.phase.phase === "review" ? "auto" : (input.task.providerBinding.modeId ?? "auto");
  const createdAt = input.phase.startedAt ?? meta.timestamp;
  const updatedAt = input.phase.completedAt ?? input.task.updatedAt;
  const config = withThothRuntimeTools(
    {
      modeId,
      model: input.task.providerBinding.model,
      thinkingOptionId: input.task.providerBinding.thinkingOptionId,
      featureValues: {
        ...(input.task.providerBinding.featureValues ?? {}),
        ...(input.phase.phase === "planexec" ? { plan_mode: true } : {}),
      },
    },
    {
      enabled: true,
      scope: input.phase.phase === "review" ? "loop_review" : "loop_planexec",
      sessionHome,
    },
  );
  return {
    id: input.agentId,
    provider: "codex",
    cwd: input.task.workspacePath,
    createdAt,
    updatedAt,
    lastActivityAt: updatedAt,
    lastUserMessageAt: null,
    title,
    labels: {
      surface: "thoth-loop",
      loopTaskId: input.task.id,
      loopGoalId: input.goal.id,
      loopPhase: input.phase.phase,
      ...(input.phase.phase === "review" ? { loopRound: String(input.phase.round) } : {}),
    },
    lastStatus: "closed",
    lastModeId: modeId,
    config,
    runtimeInfo: {
      provider: "codex",
      sessionId: meta.sessionId,
      model: input.task.providerBinding.model ?? null,
      thinkingOptionId: input.task.providerBinding.thinkingOptionId ?? null,
      modeId,
    },
    persistence: {
      provider: "codex",
      sessionId: meta.sessionId,
      nativeHandle: meta.sessionId,
      metadata: { cwd: input.task.workspacePath, title },
    },
    internal: true,
    archivedAt: null,
  };
}

export const codexPhaseRecoveryAdapter: ProviderPhaseRecoveryAdapter = {
  provider: "codex",
  recover: recoverCodexPhaseRecord,
};
