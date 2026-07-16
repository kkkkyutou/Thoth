/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BackgroundTaskModel,
  LoopTaskModel,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
import {
  BackgroundTasksSurface,
  shouldForwardLoopPhaseTimelineWheel,
} from "./background-tasks-panel";

const { clientMock, listeners, scrollToBottomMock, theme } = vi.hoisted(() => ({
  listeners: new Map<string, Set<(message: any) => void>>(),
  scrollToBottomMock: vi.fn(),
  clientMock: {
    listBackgroundTasks: vi.fn(),
    inspectBackgroundTask: vi.fn(),
    actOnBackgroundTask: vi.fn(),
    answerBackgroundTaskDecision: vi.fn(),
    fetchAgentTimeline: vi.fn(),
    on: vi.fn((type: string, listener: (message: any) => void) => {
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
      return () => bucket.delete(listener);
    }),
  },
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    borderRadius: { md: 8, lg: 12 },
    borderWidth: { 1: 1 },
    fontSize: { xs: 11, sm: 13, base: 15, lg: 18 },
    fontWeight: { medium: "500", semibold: "600", bold: "700" },
    lineHeight: { sm: 18 },
    opacity: { 55: 0.55 },
    colors: {
      accentBright: "#3ddc97",
      border: "#2a2f38",
      borderAccent: "#66d9ef",
      destructive: "#ff6b6b",
      foreground: "#f7f7f7",
      foregroundMuted: "#9aa4b2",
      surface0: "#080a0f",
      surface1: "#10151f",
      surface2: "#18202d",
      surface3: "#202a3a",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  withUnistyles: (Component: React.ComponentType<any>) =>
    function ThemedIcon(props: Record<string, unknown>) {
      const { uniProps: _uniProps, ...rest } = props;
      return React.createElement(Component, rest);
    },
  useUnistyles: () => ({ theme, rt: { breakpoint: "lg" } }),
}));

vi.mock("lucide-react-native", () => ({
  CheckCircle2: (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": "CheckCircle2" }),
  Clock3: (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": "Clock3" }),
  ListTodo: (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": "ListTodo" }),
  Pause: (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": "Pause" }),
  Play: (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": "Play" }),
  Square: (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": "Square" }),
  XCircle: (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": "XCircle" }),
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => clientMock,
}));

vi.mock("@/agent-stream/view", () => ({
  AgentStreamView: React.forwardRef(
    (props: { agentId: string; streamItems: unknown[] }, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({
        scrollToBottom: scrollToBottomMock,
        prepareForViewportChange: vi.fn(),
      }));
      return React.createElement(
        "div",
        { "data-testid": "agent-chat-scroll" },
        React.createElement(
          "div",
          { "data-testid": `agent-stream-${props.agentId}` },
          `timeline:${props.streamItems.length}`,
        ),
      );
    },
  ),
}));

function setScrollMetrics(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
): void {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  element.scrollTop = metrics.scrollTop;
}

function emit(type: string, message: any): void {
  for (const listener of listeners.get(type) ?? []) {
    listener(message);
  }
}

function summary(status: BackgroundTaskModel["status"] = "running"): BackgroundTaskModel {
  return {
    id: "loop-task-1",
    title: "Sortable library",
    status,
    summary: "Building a verified sortable library.",
    workspaceName: "Loop Workspace",
    sourceTopicId: "topic-loop",
    detailLabel: status === "running" ? "PlanExec in progress" : status,
  };
}

function loopTask(status: LoopTaskModel["status"] = "running"): LoopTaskModel {
  return {
    id: "loop-task-1",
    title: "Sortable library",
    workspaceName: "Loop Workspace",
    workspacePath: "/tmp/thoth-loop-workspace",
    sourceTopicId: "topic-loop",
    status,
    summary: "Building a verified sortable library.",
    loopStrength: "balanced",
    budget: {
      loopStrength: "balanced",
      maxFailedReviews: 10,
      usedFailedReviews: 1,
    },
    recentEvents: [],
    taskMemoryRefs: [],
    replanHistory: [],
    currentGoalId: "goal-2",
    currentPhase: "review",
    goalRound: 2,
    globalFailureCount: 1,
    taskCard: {
      id: "task-card-1",
      roundLabel: "Task",
      title: "Sortable library",
      goal: "Ship a verified sortable library.",
      constraints: ["Keep the API small."],
      acceptance: ["Core behavior is tested."],
      provenanceSummary: "Approved by user.",
      submitted: true,
    },
    goalsCard: {
      id: "goals-card-1",
      roundLabel: "Goals",
      title: "Linear goals",
      summary: "Two reviewable milestones.",
      provenanceSummary: "Approved by user.",
      submitted: true,
      goals: [
        {
          id: "goal-1",
          order: 1,
          title: "Core API",
          goal: "Implement the core sorting API.",
          constraints: ["No CLI yet."],
          acceptance: ["Unit coverage exists."],
        },
        {
          id: "goal-2",
          order: 2,
          title: "Documentation",
          goal: "Document the public sorting API.",
          constraints: ["Keep docs concise."],
          acceptance: ["Usage example exists."],
        },
      ],
    },
    goals: [
      {
        id: "goal-1",
        order: 1,
        title: "Core API",
        goal: "Implement the core sorting API.",
        constraints: ["No CLI yet."],
        acceptance: ["Unit coverage exists."],
        status: "passed",
        round: 1,
        phases: [
          {
            phase: "planexec",
            status: "completed",
            round: 1,
            agentId: "agent-plan-1",
            summary: "Implemented API.",
          },
          {
            phase: "review",
            status: "completed",
            round: 1,
            agentId: "agent-review-1",
            summary: "Review passed.",
          },
        ],
        latestPlanExecResult: {
          goalId: "goal-1",
          round: 1,
          planSummary: "Plan core API.",
          executionSummary: "Implemented API.",
          evidence: ["Unit test evidence."],
          validationPerformed: ["Ran unit tests."],
          remainingRisks: [],
          nextReviewFocus: "Confirm API behavior.",
          createdAt: "2026-07-09T00:00:02.000Z",
        },
      },
      {
        id: "goal-2",
        order: 2,
        title: "Documentation",
        goal: "Document the public sorting API.",
        constraints: ["Keep docs concise."],
        acceptance: ["Usage example exists."],
        status: status === "running" ? "running_review" : "paused",
        round: 2,
        phases: [
          {
            phase: "planexec",
            status: "completed",
            round: 2,
            agentId: "agent-plan-2",
            summary: "Updated docs.",
          },
          {
            phase: "review",
            status: status === "running" ? "running" : "canceled",
            round: 2,
            agentId: "agent-review-2",
          },
        ],
        latestPlanExecResult: {
          goalId: "goal-2",
          round: 2,
          phaseRunId: "phase-plan-2",
          resultToolCallId: "tool-plan-2",
          planSummary: "Plan docs.",
          executionSummary: "Updated docs.",
          evidence: ["Docs include usage example."],
          validationPerformed: ["Read rendered docs."],
          remainingRisks: [],
          nextReviewFocus: "Check example clarity.",
          createdAt: "2026-07-09T00:00:03.000Z",
        },
      },
    ],
    clarifyTranscript: "Approved context.",
    providerSession: { provider: "codex" },
    latestVerdictSummary: "Previous review failed once.",
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:01.000Z",
  };
}

function setupClient(task = loopTask()): void {
  clientMock.listBackgroundTasks.mockResolvedValue({
    requestId: "list-1",
    tasks: [summary(task.status)],
  });
  clientMock.inspectBackgroundTask.mockResolvedValue({
    requestId: "inspect-1",
    task,
  });
  clientMock.actOnBackgroundTask.mockResolvedValue({
    requestId: "action-1",
    task: loopTask("paused"),
  });
  clientMock.answerBackgroundTaskDecision.mockResolvedValue({
    requestId: "decision-1",
    task: loopTask("running"),
  });
  clientMock.fetchAgentTimeline.mockResolvedValue({
    requestId: "timeline-1",
    agent: {
      id: "agent-review-2",
      provider: "codex",
      status: "running",
      cwd: "/tmp/thoth-loop-workspace",
      capabilities: {},
      pendingPermissions: [],
      features: [],
    },
    entries: [
      {
        provider: "codex",
        timestamp: "2026-07-09T00:00:02.000Z",
        item: { type: "assistant_message", text: "Reviewing goal evidence." },
      },
    ],
  });
}

function renderSurface() {
  return render(<BackgroundTasksSurface serverId="server-1" workspaceId="workspace-1" />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listeners.clear();
});

describe("BackgroundTasksSurface", () => {
  it("detects when nested phase timeline wheel input should chain to the outer detail scroll", () => {
    expect(
      shouldForwardLoopPhaseTimelineWheel({
        deltaY: 48,
        inner: { clientHeight: 200, scrollHeight: 600, scrollTop: 120 },
        outer: { clientHeight: 300, scrollHeight: 900, scrollTop: 100 },
      }),
    ).toBe(false);
    expect(
      shouldForwardLoopPhaseTimelineWheel({
        deltaY: 48,
        inner: { clientHeight: 200, scrollHeight: 600, scrollTop: 400 },
        outer: { clientHeight: 300, scrollHeight: 900, scrollTop: 100 },
      }),
    ).toBe(true);
    expect(
      shouldForwardLoopPhaseTimelineWheel({
        deltaY: -48,
        inner: { clientHeight: 200, scrollHeight: 600, scrollTop: 0 },
        outer: { clientHeight: 300, scrollHeight: 900, scrollTop: 100 },
      }),
    ).toBe(true);
    expect(
      shouldForwardLoopPhaseTimelineWheel({
        deltaY: 48,
        inner: { clientHeight: 200, scrollHeight: 600, scrollTop: 400 },
        outer: { clientHeight: 300, scrollHeight: 900, scrollTop: 600 },
      }),
    ).toBe(false);
  });

  it("lists Loop tasks, opens detail, shows linear goals, and embeds the selected phase timeline", async () => {
    setupClient();

    renderSurface();

    await waitFor(() => expect(screen.getByText("Sortable library")).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/failed reviews 1\/10/)).toBeTruthy());
    expect(screen.getByText("Goal 1: Core API")).toBeTruthy();
    expect(screen.getByText("Goal 2: Documentation")).toBeTruthy();
    expect(screen.getByText("running_review · loop round 2")).toBeTruthy();
    expect(screen.getByText("Latest PlanExec evidence")).toBeTruthy();
    expect(screen.getAllByText("Updated docs.").length).toBeGreaterThan(0);
    expect(screen.getByText(/Docs include usage example/)).toBeTruthy();
    expect(screen.getByTestId("loop-phase-review")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("agent-stream-agent-review-2")).toBeTruthy());
    expect(clientMock.fetchAgentTimeline).toHaveBeenCalledWith("agent-review-2", {
      direction: "tail",
      limit: 200,
      projection: "projected",
    });
    await waitFor(() => expect(scrollToBottomMock).toHaveBeenCalledWith("jump-to-bottom"));
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("shows a real phase loading error instead of claiming a completed phase has no session", async () => {
    setupClient();
    clientMock.fetchAgentTimeline.mockRejectedValueOnce(new Error("Phase agent record not found"));

    renderSurface();

    await waitFor(() => expect(screen.getByText("Phase agent record not found")).toBeTruthy());
    expect(screen.queryByText("This phase has not created a provider session yet.")).toBeNull();
  });

  it("shows a durable Loop user decision and submits it with workspace revision context", async () => {
    const task: LoopTaskModel = {
      ...loopTask("awaiting_user_decision"),
      authorityRevision: 12,
      currentPhase: null,
      pendingUserDecision: {
        id: "decision-1",
        title: "Choose delivery policy",
        question: "Which policy should continue this goal?",
        options: [
          { id: "conservative", label: "Conservative", description: "Keep the current boundary." },
          { id: "aggressive", label: "Aggressive", description: "Use the broader approach." },
        ],
        status: "pending",
        createdAt: "2026-07-14T00:00:00.000Z",
      },
      goals: loopTask("awaiting_user_decision").goals.map((goal) =>
        goal.id === "goal-2" ? { ...goal, status: "awaiting_user_decision" } : goal,
      ),
    };
    setupClient(task);

    renderSurface();

    await waitFor(() => expect(screen.getByTestId("loop-user-decision-card")).toBeTruthy());
    fireEvent.click(screen.getByTestId("loop-user-decision-option-conservative"));
    fireEvent.click(screen.getByTestId("loop-user-decision-submit"));
    await waitFor(() =>
      expect(clientMock.answerBackgroundTaskDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "loop-task-1",
          decisionId: "decision-1",
          choiceId: "conservative",
          workspaceId: "workspace-1",
          expectedAuthorityRevision: 12,
          commandId: "loop-task-1:12:decision:decision-1:conservative",
        }),
      ),
    );
  });

  it("chains mouse wheel from the phase timeline to the outer detail scroll at timeline edges", async () => {
    setupClient();

    renderSurface();

    await waitFor(() => expect(screen.getByTestId("agent-chat-scroll")).toBeTruthy());
    const detailScroll = screen.getByTestId("background-task-detail-scroll");
    const timelineScroll = screen.getByTestId("agent-chat-scroll");
    setScrollMetrics(detailScroll, { clientHeight: 300, scrollHeight: 900, scrollTop: 120 });
    setScrollMetrics(timelineScroll, { clientHeight: 200, scrollHeight: 600, scrollTop: 400 });

    timelineScroll.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 64 }),
    );

    expect(detailScroll.scrollTop).toBe(184);
  });

  it("keeps wheel input inside the phase timeline while that timeline can still scroll", async () => {
    setupClient();

    renderSurface();

    await waitFor(() => expect(screen.getByTestId("agent-chat-scroll")).toBeTruthy());
    const detailScroll = screen.getByTestId("background-task-detail-scroll");
    const timelineScroll = screen.getByTestId("agent-chat-scroll");
    setScrollMetrics(detailScroll, { clientHeight: 300, scrollHeight: 900, scrollTop: 120 });
    setScrollMetrics(timelineScroll, { clientHeight: 200, scrollHeight: 600, scrollTop: 120 });

    timelineScroll.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 64 }),
    );

    expect(detailScroll.scrollTop).toBe(120);
  });

  it("allows phase switching and refreshes detail from background task updates", async () => {
    setupClient();

    renderSurface();
    await waitFor(() => expect(screen.getByTestId("loop-phase-planexec")).toBeTruthy());

    fireEvent.click(screen.getByTestId("loop-phase-planexec"));
    await waitFor(() => expect(screen.getByTestId("agent-stream-agent-plan-2")).toBeTruthy());
    expect(clientMock.fetchAgentTimeline).toHaveBeenLastCalledWith("agent-plan-2", {
      direction: "tail",
      limit: 200,
      projection: "projected",
    });

    emit("background_task.update", {
      type: "background_task.update",
      payload: {
        task: loopTask("paused"),
        summary: summary("paused"),
      },
    });

    await waitFor(() => expect(screen.getByText(/Paused · failed reviews 1\/10/)).toBeTruthy());
  });

  it("routes Pause/Resume/Stop actions through the daemon client", async () => {
    setupClient();

    renderSurface();
    await waitFor(() => expect(screen.getByText("Pause")).toBeTruthy());

    fireEvent.click(screen.getByText("Pause"));
    await waitFor(() =>
      expect(clientMock.actOnBackgroundTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "loop-task-1",
          action: "pause",
          workspaceId: "workspace-1",
          commandId: "loop-task-1:legacy:pause",
        }),
      ),
    );
  });

  it("shows the durable budget envelope and sends only explicit budget decisions", async () => {
    const task: LoopTaskModel = {
      ...loopTask("budget_wait"),
      budgetEnvelope: {
        maxActiveDurationMs: 7_200_000,
        maxTokens: 1_000_000,
        maxToolCalls: 300,
        maxChangedFiles: 75,
        maxChangedLines: 25_000,
        maxReplans: 1,
        maxConsecutiveSameRootCause: 1,
      },
      budgetUsage: {
        activeDurationMs: 245_000,
        tokens: 0,
        toolCalls: 12,
        changedFiles: 2,
        changedLines: 40,
        replans: 0,
        consecutiveSameRootCause: 0,
        tokenMetered: false,
      },
      budgetWait: {
        reason: "Changed-file limit reached.",
        exhaustedDimensions: ["changed files"],
        enteredAt: "2026-07-10T00:00:00.000Z",
      },
    };
    setupClient(task);
    clientMock.actOnBackgroundTask.mockResolvedValue({ requestId: "action-budget", task });

    renderSurface();

    await waitFor(() => expect(screen.getByTestId("loop-budget-envelope")).toBeTruthy());
    expect(screen.getByText(/Active 4m \/ 2h 0m/)).toBeTruthy();
    expect(screen.getByText(/tokens unmetered/)).toBeTruthy();
    expect(screen.getByTestId("loop-budget-wait")).toBeTruthy();
    expect(screen.getByText("Changed-file limit reached.")).toBeTruthy();

    fireEvent.click(screen.getByTestId("background-task-budget-continue"));
    await waitFor(() =>
      expect(clientMock.actOnBackgroundTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "loop-task-1",
          action: "budget_continue",
          workspaceId: "workspace-1",
          commandId: "loop-task-1:legacy:budget_continue",
        }),
      ),
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("background-task-review-only").getAttribute("aria-disabled"),
      ).not.toBe("true"),
    );
    fireEvent.click(screen.getByTestId("background-task-review-only"));
    await waitFor(() =>
      expect(clientMock.actOnBackgroundTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "loop-task-1",
          action: "review_only",
          workspaceId: "workspace-1",
          commandId: "loop-task-1:legacy:review_only",
        }),
      ),
    );
  });

  it("keeps evidence-invalid and concurrent-workspace authority states visible", async () => {
    setupClient(loopTask("evidence_invalid"));

    renderSurface();

    await waitFor(() =>
      expect(screen.getByText(/Evidence needs attention · failed reviews/)).toBeTruthy(),
    );
    expect(screen.getByTestId("loop-evidence-warning")).toBeTruthy();
    expect(screen.getByText("Evidence held")).toBeTruthy();

    emit("background_task.update", {
      type: "background_task.update",
      payload: {
        task: loopTask("workspace_changed_concurrently"),
        summary: summary("workspace_changed_concurrently"),
      },
    });

    await waitFor(() =>
      expect(screen.getByText(/Workspace changed · failed reviews/)).toBeTruthy(),
    );
  });

  it("offers a baseline retry for evidence capture failure without treating it as a generic block", async () => {
    setupClient(loopTask("evidence_capture_failed"));

    renderSurface();

    await waitFor(() =>
      expect(screen.getByText(/Evidence capture failed · failed reviews/)).toBeTruthy(),
    );
    expect(screen.getByTestId("loop-evidence-warning")).toBeTruthy();
    expect(screen.getByText("Evidence capture needs retry")).toBeTruthy();
    expect(screen.getByTestId("background-task-resume").getAttribute("aria-disabled")).not.toBe(
      "true",
    );
    expect(screen.getByTestId("background-task-resume").textContent).toContain(
      "Retry baseline & resume",
    );
  });

  it("allows an explicitly blocked phase to be resumed after its prerequisite is repaired", async () => {
    setupClient(loopTask("blocked"));

    renderSurface();

    await waitFor(() => expect(screen.getByText(/Blocked · failed reviews/)).toBeTruthy());
    expect(screen.getByTestId("background-task-resume").getAttribute("aria-disabled")).not.toBe(
      "true",
    );
    fireEvent.click(screen.getByTestId("background-task-resume"));
    await waitFor(() =>
      expect(clientMock.actOnBackgroundTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "loop-task-1",
          action: "resume",
          workspaceId: "workspace-1",
          commandId: "loop-task-1:legacy:resume",
        }),
      ),
    );
  });

  it("keeps Resume left of Pause and enables it only after the task has stopped", async () => {
    setupClient();

    renderSurface();
    await waitFor(() => expect(screen.getByTestId("background-task-resume")).toBeTruthy());
    const resume = screen.getByTestId("background-task-resume");
    const pause = screen.getByTestId("background-task-pause");
    const stop = screen.getByTestId("background-task-stop");
    expect(resume.compareDocumentPosition(pause) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    emit("background_task.update", {
      type: "background_task.update",
      payload: {
        task: loopTask("stopped"),
        summary: summary("stopped"),
      },
    });
    await waitFor(() => expect(screen.getByText(/Stopped · failed reviews/)).toBeTruthy());

    fireEvent.click(screen.getByTestId("background-task-resume"));
    await waitFor(() =>
      expect(clientMock.actOnBackgroundTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "loop-task-1",
          action: "resume",
          workspaceId: "workspace-1",
          commandId: "loop-task-1:legacy:resume",
        }),
      ),
    );
    expect(stop).toBeTruthy();
  });
});
