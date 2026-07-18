import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { ForegroundAuthorityStore } from "./foreground-authority-store.js";

const homes: string[] = [];
const logger = pino({ enabled: false });

async function createStore(): Promise<{ home: string; store: ForegroundAuthorityStore }> {
  const home = await mkdtemp(path.join(tmpdir(), "thoth-foreground-authority-"));
  homes.push(home);
  return { home, store: new ForegroundAuthorityStore({ thothHome: home, logger }) };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

function runtimeBinding() {
  return {
    provider: "fixture",
    threadId: "thread-1",
    providerTurnId: "provider-turn-1",
    callId: "call-1",
    toolName: "semantic-card",
    redactedRawInputHash: "hash",
  };
}

function taskCard() {
  return {
    id: "task-card-1",
    roundLabel: "Task Card",
    title: "Installed product flow",
    goal: "Run Thoth through the visible Agent",
    constraints: ["No hidden Agent"],
    acceptance: ["A packaged AppImage opens this card"],
    provenanceSummary: "The user approved the foreground product path",
    submitted: false,
  };
}

describe("ForegroundAuthorityStore", () => {
  it("deduplicates a user send by Agent and source message", async () => {
    const { store } = await createStore();
    const input = {
      agentId: "agent-1",
      kind: "thoth" as const,
      controls: { mode: "quick" as const, clarifyStrength: "light" as const, loop: null },
      sourceMessageId: "message-1",
      workspacePath: "/tmp/workspace",
      userText: "Build the flow",
    };

    const first = store.startTurn(input);
    const replay = store.startTurn(input);

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.turn.id).toBe(first.turn.id);
    expect(replay.state.revision).toBe(first.state.revision);
    store.close();
  });

  it("uses revision CAS and command idempotency for card answers", async () => {
    const { store } = await createStore();
    const started = store.startTurn({
      agentId: "agent-1",
      kind: "thoth",
      controls: { mode: "loop", clarifyStrength: "light", loop: "light" },
      sourceMessageId: "message-1",
      workspacePath: "/tmp/workspace",
      userText: "Build the flow",
    });
    const opened = store.openCard({
      agentId: "agent-1",
      turnId: started.turn.id,
      generation: started.turn.generation,
      card: { kind: "task_card", card: taskCard() },
      runtime: runtimeBinding(),
    });
    const answer = {
      intent: "accept_loop" as const,
      card_id: "task-card-1",
      title: "Installed product flow",
      raw_answer: "Approve",
    };
    const stale = store.answerCard({
      agentId: "agent-1",
      cardId: "task-card-1",
      answer,
      submittedCard: { ...taskCard(), submitted: true, submittedSummary: "Approved" },
      submittedSummary: "Approved",
      expectedRevision: opened.state.revision - 1,
      commandId: "command-stale",
      nextLifecycle: "running",
    });

    expect(stale.accepted).toBe(false);
    expect(stale.conflict).toBe(true);

    const accepted = store.answerCard({
      agentId: "agent-1",
      cardId: "task-card-1",
      answer,
      submittedCard: { ...taskCard(), submitted: true, submittedSummary: "Approved" },
      submittedSummary: "Approved",
      expectedRevision: opened.state.revision,
      commandId: "command-accepted",
      nextLifecycle: "running",
    });
    const duplicate = store.answerCard({
      agentId: "agent-1",
      cardId: "task-card-1",
      answer,
      submittedCard: { ...taskCard(), submitted: true, submittedSummary: "Approved" },
      submittedSummary: "Approved",
      expectedRevision: opened.state.revision,
      commandId: "command-accepted",
      nextLifecycle: "running",
    });

    expect(accepted.accepted).toBe(true);
    expect(accepted.state.pendingCard).toBeNull();
    expect(duplicate.accepted).toBe(true);
    expect(duplicate.duplicate).toBe(true);
    store.close();
  });

  it("keeps an open card actionable across daemon restart", async () => {
    const { home, store } = await createStore();
    const started = store.startTurn({
      agentId: "agent-1",
      kind: "thoth",
      controls: { mode: "quick", clarifyStrength: "light", loop: null },
      workspacePath: "/tmp/workspace",
      userText: "Build the flow",
    });
    store.openCard({
      agentId: "agent-1",
      turnId: started.turn.id,
      generation: started.turn.generation,
      card: { kind: "task_card", card: taskCard() },
      runtime: runtimeBinding(),
    });
    store.close();

    const recovered = new ForegroundAuthorityStore({ thothHome: home, logger });
    const state = recovered.getState("agent-1");

    expect(state.lifecycle).toBe("awaiting_card");
    expect(state.pendingCard?.card.id).toBe("task-card-1");
    recovered.close();
  });
});
