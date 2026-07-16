import { describe, expect, it } from "vitest";
import { MutableDaemonConfigPatchSchema } from "./messages.js";

describe("mutable daemon config patch", () => {
  it("accepts the explicit Thoth mode switch", () => {
    expect(
      MutableDaemonConfigPatchSchema.parse({
        workspaceSecretary: { enabled: false },
      }),
    ).toEqual({
      workspaceSecretary: { enabled: false },
    });
  });

  it("accepts Workspace Secretary loop strength", () => {
    expect(
      MutableDaemonConfigPatchSchema.parse({
        workspaceSecretary: {
          mode: "loop",
          loopStrength: "one_plan_one_do",
        },
      }),
    ).toEqual({
      workspaceSecretary: {
        mode: "loop",
        loopStrength: "one_plan_one_do",
      },
    });
  });

  it("accepts persisted per-topic runtime status", () => {
    expect(
      MutableDaemonConfigPatchSchema.parse({
        workspaceSecretary: {
          topicSnapshots: [
            {
              workspacePath: "/workspace/thoth",
              workspaceName: "Thoth",
              activeTopicId: "topic-running",
              topics: [
                {
                  id: "topic-running",
                  title: "Running topic",
                  status: "current",
                  updatedLabel: "刚刚",
                },
              ],
              turns: [],
              topicStates: [
                {
                  topicId: "topic-running",
                  turns: [],
                  currentClarifyState: "C_DIRECT",
                  activeTurnPhase: "clarify",
                  foregroundTurnState: "background_handoff",
                  status: {
                    kind: "loading",
                    title: "正在处理",
                    detail: "provider turn 正在运行。",
                  },
                },
              ],
              nextTopicIndex: 2,
              currentClarifyState: "C_DIRECT",
              activeTurnPhase: "clarify",
            },
          ],
        },
      }).workspaceSecretary?.topicSnapshots?.[0]?.topicStates?.[0],
    ).toMatchObject({
      foregroundTurnState: "background_handoff",
      status: {
        kind: "loading",
        title: "正在处理",
        detail: "provider turn 正在运行。",
      },
    });
  });

  it("accepts persisted Workspace Secretary topic provider agent mappings", () => {
    expect(
      MutableDaemonConfigPatchSchema.parse({
        workspaceSecretary: {
          topicSnapshots: [
            {
              workspacePath: "/workspace/thoth",
              workspaceName: "Thoth",
              activeTopicId: "topic-running",
              topics: [
                {
                  id: "topic-running",
                  title: "Running topic",
                  status: "current",
                  updatedLabel: "刚刚",
                },
              ],
              turns: [],
              topicAgents: [
                {
                  agentKey: "topic-running:structured:codex:gpt-5.6",
                  agentId: "secretary-agent-1",
                },
              ],
              topicStates: [
                {
                  topicId: "topic-running",
                  turns: [],
                  currentClarifyState: "C_DIRECT",
                  activeTurnPhase: "clarify",
                  timelineAgentId: "secretary-agent-1",
                },
              ],
              nextTopicIndex: 2,
              currentClarifyState: "C_DIRECT",
              activeTurnPhase: "clarify",
            },
          ],
        },
      }).workspaceSecretary?.topicSnapshots?.[0]?.topicAgents,
    ).toEqual([
      {
        agentKey: "topic-running:structured:codex:gpt-5.6",
        agentId: "secretary-agent-1",
      },
    ]);
  });
});
