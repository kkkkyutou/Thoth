import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema } from "../messages.js";
import {
  AgentThothCardAnswerRequestSchema,
  AgentThothStateSchema,
  AgentThothStateUpdateSchema,
  ThothCardAnswerPayloadSchema,
} from "./rpc-schemas.js";

describe("agent-scoped Thoth protocol", () => {
  it("parses an authority state with a durable open card", () => {
    const state = AgentThothStateSchema.parse({
      agentId: "agent-1",
      revision: 3,
      lifecycle: "awaiting_card",
      turn: {
        id: "turn-1",
        agentId: "agent-1",
        kind: "thoth",
        lifecycle: "awaiting_card",
        controls: { mode: "loop", clarifyStrength: "light", loop: "light" },
        sourceMessageId: "message-1",
        startedAt: "2026-07-18T00:00:00.000Z",
        updatedAt: "2026-07-18T00:00:01.000Z",
      },
      pendingCard: {
        kind: "task_card",
        createdAt: "2026-07-18T00:00:01.000Z",
        card: {
          id: "card-1",
          roundLabel: "Task Card",
          title: "Ship the flow",
          goal: "Make the installed product path work",
          constraints: ["Use the visible agent session"],
          acceptance: ["The AppImage creates a real card"],
          provenanceSummary: "Grounded in the current user request",
          submitted: false,
        },
      },
      backgroundTaskId: null,
      error: null,
    });

    expect(state.pendingCard?.kind).toBe("task_card");
    expect(
      AgentThothStateUpdateSchema.parse({
        type: "agent.thoth.state.update",
        payload: { state, reason: "card_opened" },
      }).payload.state.revision,
    ).toBe(3);
  });

  it("requires CAS and command idempotency fields for card answers", () => {
    const answer = ThothCardAnswerPayloadSchema.parse({
      intent: "accept_loop",
      card_id: "card-1",
      title: "Goals Card",
      raw_answer: "Register in the background",
    });
    const request = AgentThothCardAnswerRequestSchema.parse({
      type: "agent.thoth.card.answer.request",
      requestId: "request-1",
      agentId: "agent-1",
      cardId: "card-1",
      answer,
      expectedRevision: 7,
      commandId: "command-1",
    });

    expect(request.expectedRevision).toBe(7);
    expect(request.commandId).toBe("command-1");
  });

  it("rejects every removed Workspace Secretary RPC", () => {
    for (const type of [
      "workspace_secretary.send.request",
      "workspace_secretary.cancel.request",
      "workspace_secretary.topic.create.request",
      "workspace_secretary.snapshot.request",
      "workspace_secretary.answer.request",
    ]) {
      expect(SessionInboundMessageSchema.safeParse({ type, requestId: "request-1" }).success).toBe(
        false,
      );
    }
  });
});
