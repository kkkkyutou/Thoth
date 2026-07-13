import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SqliteAgentTimelineStore } from "./sqlite-agent-timeline-store.js";

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "thoth-agent-timeline-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SqliteAgentTimelineStore", () => {
  it("reopens the complete timeline with its stable cursor epoch", async () => {
    const root = createRoot();
    const agentId = "f4a7ca73-c728-4c7d-ae93-6d0f8e7af6ef";
    const writer = new SqliteAgentTimelineStore(root);
    await writer.bulkInsert(agentId, [
      {
        seq: 1,
        timestamp: "2026-07-12T00:00:01.000Z",
        item: { type: "assistant_message", text: "Plan and execute started." },
      },
      {
        seq: 2,
        timestamp: "2026-07-12T00:00:02.000Z",
        item: {
          type: "tool_call",
          callId: "tool-1",
          name: "shell",
          status: "completed",
        },
      },
    ]);
    const initial = await writer.fetchCommitted(agentId, { direction: "tail", limit: 0 });
    writer.close();

    const reader = new SqliteAgentTimelineStore(root);
    const restored = await reader.fetchCommitted(agentId, { direction: "after", limit: 0 });
    expect(restored.epoch).toBe(initial.epoch);
    expect(restored.window).toEqual({ minSeq: 1, maxSeq: 2, nextSeq: 3 });
    expect(restored.rows).toEqual(initial.rows);
    reader.close();
  });
});
