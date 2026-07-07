import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ThothClarifyCardModel } from "@thoth/protocol/workspace-secretary/rpc-schemas";
import {
  configureRuntimeAuthorityDecisionPersistence,
  createRuntimeAuthorityDecision,
  listPendingRuntimeAuthorityDecisions,
  listRuntimeAuthorityDecisionRecords,
  resetRuntimeAuthorityDecisionsForTest,
} from "./runtime-tool-decisions.js";

function clarifyCard(): ThothClarifyCardModel {
  return {
    id: "clarify-card-persist",
    roundLabel: "Clarify",
    title: "确认目标边界",
    whyNow: "这些选择会改变任务路线。",
    continuesClarify: true,
    submitted: false,
    card: {
      question_id: "question-card-persist",
      title: "确认目标边界",
      behavior_tree_node: "boundary",
      why_now: "先确认用户拥有的关键选择。",
      allow_choice_notes: true,
      allow_note_only: true,
      questions: [
        {
          id: "language",
          question: "用什么语言实现？",
          behavior_tree_node: "language",
          choices: [
            { id: "cpp", label: "C++", description: "贴近系统性能" },
            { id: "rust", label: "Rust", description: "安全且高性能" },
          ],
        },
        {
          id: "shape",
          question: "交付成什么形态？",
          behavior_tree_node: "shape",
          choices: [
            { id: "library", label: "库函数", description: "最小复用接口" },
            { id: "cli", label: "命令行", description: "可传参运行" },
          ],
        },
      ],
    },
  };
}

afterEach(() => {
  resetRuntimeAuthorityDecisionsForTest();
});

describe("runtime authority decision persistence", () => {
  it("persists pending records and reloads them as blocked after process loss", () => {
    const dir = mkdtempSync(join(tmpdir(), "thoth-runtime-decisions-"));
    const filePath = join(dir, "runtime-authority-decisions.json");
    try {
      configureRuntimeAuthorityDecisionPersistence({ filePath });
      const { record } = createRuntimeAuthorityDecision({
        provider: "codex",
        agentId: "agent-1",
        topicId: "topic-main",
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        toolName: "thoth_submit_clarify_card",
        phase: "clarify",
        card: { kind: "clarify_card", card: clarifyCard() },
        redactedRawInputHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        timeoutMs: 60_000,
      });

      const persisted = JSON.parse(readFileSync(filePath, "utf8")) as {
        records: Array<{ id: string; status: string }>;
      };
      expect(persisted.records).toContainEqual(
        expect.objectContaining({ id: record.id, status: "pending" }),
      );

      resetRuntimeAuthorityDecisionsForTest();
      configureRuntimeAuthorityDecisionPersistence({ filePath });

      expect(listPendingRuntimeAuthorityDecisions()).toEqual([]);
      expect(listRuntimeAuthorityDecisionRecords()).toContainEqual(
        expect.objectContaining({ id: record.id, status: "blocked" }),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
