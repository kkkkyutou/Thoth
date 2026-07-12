import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { CheckCircle2, Clock3, ListTodo, Pause, Play, Square, XCircle } from "lucide-react-native";
import type { AgentSnapshotPayload, AgentStreamEventPayload } from "@thoth/protocol/messages";
import type {
  BackgroundTaskModel,
  BackgroundTaskAction,
  LoopGoalRecord,
  LoopPhaseKind,
  LoopPhaseRecord,
  LoopTaskModel,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
import type { AgentPermissionRequest, AgentProvider } from "@thoth/protocol/agent-types";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AgentStreamView, type AgentStreamViewHandle } from "@/agent-stream/view";
import { ResizeHandle } from "@/components/resize-handle";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { PendingPermission } from "@/types/shared";
import { hydrateStreamState, reduceStreamUpdate, type StreamItem } from "@/types/stream";
import { isWeb } from "@/constants/platform";
import {
  buildBackgroundTasksSurfaceKey,
  clampBackgroundTasksListWidth,
  useBackgroundTasksSurfaceStore,
} from "@/stores/background-tasks-surface-store";

const AGENT_CHAT_SCROLL_SELECTOR = '[data-testid="agent-chat-scroll"]';
const BACKGROUND_TASK_DETAIL_SCROLL_TEST_ID = "background-task-detail-scroll";

const ThemedListTodo = withUnistyles(ListTodo);
const ThemedCheckCircle = withUnistyles(CheckCircle2);
const ThemedXCircle = withUnistyles(XCircle);

const mutedColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});

const successColorMapping = (theme: { colors: { accentBright: string } }) => ({
  color: theme.colors.accentBright,
});

const dangerColorMapping = (theme: { colors: { destructive: string } }) => ({
  color: theme.colors.destructive,
});

function isRealTask(task: BackgroundTaskModel): boolean {
  return task.id !== "empty";
}

function taskStatusLabel(status: BackgroundTaskModel["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "budget_wait":
      return "Budget wait";
    case "evidence_invalid":
      return "Evidence needs attention";
    case "workspace_changed_concurrently":
      return "Workspace changed";
    case "blocked":
      return "Blocked";
    case "done":
      return "Done";
    case "stopped":
      return "Stopped";
    case "interrupted":
      return "Interrupted";
    case "registered_pending":
      return "Legacy pending";
    case "empty":
      return "Empty";
  }
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function formatLimit(value: number, suffix = ""): string {
  return `${value.toLocaleString()}${suffix}`;
}

function evidenceLabel(ref: { id: string; kind: string; createdAt: string }): string {
  const createdAt = new Date(ref.createdAt);
  const timestamp = Number.isNaN(createdAt.valueOf()) ? ref.createdAt : createdAt.toLocaleString();
  return `${ref.kind.replaceAll("_", " ")} · ${timestamp} · ${ref.id}`;
}

function phaseLabel(phase: LoopPhaseKind): string {
  return phase === "planexec" ? "PlanExec" : "Review";
}

function latestPhase(goal: LoopGoalRecord, phase: LoopPhaseKind): LoopPhaseRecord | null {
  return (
    goal.phases
      .filter((entry) => entry.phase === phase)
      .sort((left, right) => right.round - left.round)[0] ?? null
  );
}

function activeGoal(task: LoopTaskModel | null): LoopGoalRecord | null {
  if (!task) {
    return null;
  }
  if (task.currentGoalId) {
    return task.goals.find((goal) => goal.id === task.currentGoalId) ?? null;
  }
  return task.goals.find((goal) => goal.status !== "passed") ?? task.goals[0] ?? null;
}

function formatElapsed(startedAt: string | undefined, nowMs: number): string | null {
  if (!startedAt) {
    return null;
  }
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function useNowTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) {
      return () => {};
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

type ScrollMetrics = {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

const SCROLL_EDGE_EPSILON = 1;

function canScrollWithDelta(metrics: ScrollMetrics | null, deltaY: number): boolean {
  if (!metrics || deltaY === 0) {
    return false;
  }
  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  if (maxScrollTop <= SCROLL_EDGE_EPSILON) {
    return false;
  }
  if (deltaY > 0) {
    return metrics.scrollTop < maxScrollTop - SCROLL_EDGE_EPSILON;
  }
  return metrics.scrollTop > SCROLL_EDGE_EPSILON;
}

export function shouldForwardLoopPhaseTimelineWheel(input: {
  deltaY: number;
  inner: ScrollMetrics | null;
  outer: ScrollMetrics | null;
}): boolean {
  if (input.deltaY === 0) {
    return false;
  }
  if (canScrollWithDelta(input.inner, input.deltaY)) {
    return false;
  }
  return canScrollWithDelta(input.outer, input.deltaY);
}

function metricsFromElement(element: HTMLElement | null): ScrollMetrics | null {
  if (!element) {
    return null;
  }
  return {
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  };
}

function normalizeWheelDeltaY(event: WheelEvent, outer: HTMLElement): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * 16;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * Math.max(1, outer.clientHeight);
  }
  return event.deltaY;
}

function clampScrollTop(element: HTMLElement, scrollTop: number): number {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
  return Math.max(0, Math.min(maxScrollTop, scrollTop));
}

function useLoopPhaseTimelineWheelBridge(input: {
  attachmentKey: string | null;
  enabled: boolean;
  timelineShellRef: RefObject<View | null>;
}): void {
  const { attachmentKey, enabled, timelineShellRef } = input;
  useEffect(() => {
    if (!enabled || !isWeb) {
      return () => {};
    }
    const rawRef: unknown = timelineShellRef.current;
    if (!(rawRef instanceof HTMLElement)) {
      return () => {};
    }
    const shellNode = rawRef;
    const handleWheel = (event: WheelEvent) => {
      const outerNode = shellNode.closest<HTMLElement>(
        `[data-testid="${BACKGROUND_TASK_DETAIL_SCROLL_TEST_ID}"]`,
      );
      if (!outerNode) {
        return;
      }
      const deltaY = normalizeWheelDeltaY(event, outerNode);
      const innerNode = shellNode.querySelector<HTMLElement>(AGENT_CHAT_SCROLL_SELECTOR);
      if (
        !shouldForwardLoopPhaseTimelineWheel({
          deltaY,
          inner: metricsFromElement(innerNode),
          outer: metricsFromElement(outerNode),
        })
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      outerNode.scrollTop = clampScrollTop(outerNode, outerNode.scrollTop + deltaY);
    };
    shellNode.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => {
      shellNode.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, [attachmentKey, enabled, timelineShellRef]);
}

function agentSnapshotToScreenAgent(
  serverId: string,
  snapshot: AgentSnapshotPayload,
): AgentScreenAgent {
  return {
    serverId,
    id: snapshot.id,
    provider: snapshot.provider,
    status: snapshot.status,
    cwd: snapshot.cwd,
    ...(snapshot.workspaceId ? { workspaceId: snapshot.workspaceId } : {}),
    capabilities: snapshot.capabilities,
    currentModeId: snapshot.currentModeId,
    model: snapshot.model,
    thinkingOptionId: snapshot.thinkingOptionId ?? null,
    runtimeInfo: snapshot.runtimeInfo ?? null,
    features: snapshot.features ?? [],
    lastError: snapshot.lastError ?? null,
  };
}

function permissionMapFromSnapshot(
  agentId: string,
  requests: AgentPermissionRequest[],
): Map<string, PendingPermission> {
  const next = new Map<string, PendingPermission>();
  for (const request of requests) {
    next.set(`${agentId}:${request.id}`, {
      key: `${agentId}:${request.id}`,
      agentId,
      request,
    });
  }
  return next;
}

function hydrateProjectedEntries(
  entries: Array<{
    provider: AgentProvider;
    item: Extract<AgentStreamEventPayload, { type: "timeline" }>["item"];
    timestamp: string;
  }>,
): StreamItem[] {
  return hydrateStreamState(
    entries.map((entry) => ({
      event: {
        type: "timeline",
        provider: entry.provider,
        item: entry.item,
      },
      timestamp: new Date(entry.timestamp),
    })),
    { source: "canonical" },
  );
}

export function BackgroundTasksSurface({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}) {
  const client = useHostRuntimeClient(serverId);
  const surfaceKey = buildBackgroundTasksSurfaceKey({ serverId, workspaceId });
  const persistedSurface = useBackgroundTasksSurfaceStore(
    (state) => state.byWorkspaceKey[surfaceKey],
  );
  const updateSurface = useBackgroundTasksSurfaceStore((state) => state.updateSurface);
  const restoredSelectionRef = useRef(false);
  const [tasks, setTasks] = useState<BackgroundTaskModel[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(
    () => persistedSurface?.selectedTaskId ?? null,
  );
  const [selectedTask, setSelectedTask] = useState<LoopTaskModel | null>(null);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(
    () => persistedSurface?.selectedGoalId ?? null,
  );
  const [selectedPhase, setSelectedPhase] = useState<LoopPhaseKind>(
    () => persistedSurface?.selectedPhaseId ?? "planexec",
  );
  const [phaseAgent, setPhaseAgent] = useState<AgentScreenAgent | null>(null);
  const [phaseItems, setPhaseItems] = useState<StreamItem[]>([]);
  const [phaseTimelineLoading, setPhaseTimelineLoading] = useState(false);
  const [phaseTimelineError, setPhaseTimelineError] = useState<string | null>(null);
  const phaseStreamRef = useRef<AgentStreamViewHandle | null>(null);
  const timelineShellRef = useRef<View | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, PendingPermission>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<BackgroundTaskAction | null>(null);
  const [surfaceWidth, setSurfaceWidth] = useState(0);
  const nowTick = useNowTick(Boolean(selectedTask?.status === "running"));
  const resumeEnabled =
    selectedTask?.status === "paused" ||
    selectedTask?.status === "stopped" ||
    selectedTask?.status === "interrupted" ||
    selectedTask?.status === "evidence_invalid" ||
    selectedTask?.status === "workspace_changed_concurrently";
  const pauseEnabled =
    selectedTask?.status === "running" && selectedTask.controlIntent !== "pause_after_phase";
  const stopEnabled =
    selectedTask?.status === "queued" ||
    selectedTask?.status === "running" ||
    selectedTask?.status === "paused" ||
    selectedTask?.status === "interrupted" ||
    selectedTask?.status === "budget_wait" ||
    selectedTask?.status === "evidence_invalid" ||
    selectedTask?.status === "workspace_changed_concurrently";

  const taskListWidth = useMemo(
    () => clampBackgroundTasksListWidth(persistedSurface?.taskListWidth, surfaceWidth),
    [persistedSurface?.taskListWidth, surfaceWidth],
  );
  const taskListResizeSizes = useMemo(() => {
    if (surfaceWidth <= 0) {
      return [0.36, 0.64];
    }
    const left = Math.min(0.8, Math.max(0.1, taskListWidth / surfaceWidth));
    return [left, 1 - left];
  }, [surfaceWidth, taskListWidth]);
  const handleSurfaceLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      setSurfaceWidth(event.nativeEvent.layout.width);
    },
    [],
  );
  const handleResizeTaskList = useCallback(
    (_groupId: string, sizes: number[]) => {
      if (surfaceWidth <= 0) {
        return;
      }
      updateSurface({
        serverId,
        workspaceId,
        taskListWidth: clampBackgroundTasksListWidth(
          surfaceWidth * (sizes[0] ?? taskListResizeSizes[0] ?? 0),
          surfaceWidth,
        ),
      });
    },
    [serverId, surfaceWidth, taskListResizeSizes, updateSurface, workspaceId],
  );

  useEffect(() => {
    if (restoredSelectionRef.current || !persistedSurface) {
      return;
    }
    restoredSelectionRef.current = true;
    if (persistedSurface.selectedTaskId) {
      setSelectedTaskId(persistedSurface.selectedTaskId);
    }
    if (persistedSurface.selectedGoalId) {
      setSelectedGoalId(persistedSurface.selectedGoalId);
    }
    if (persistedSurface.selectedPhaseId) {
      setSelectedPhase(persistedSurface.selectedPhaseId);
    }
  }, [persistedSurface]);

  useEffect(() => {
    updateSurface({
      serverId,
      workspaceId,
      selectedTaskId,
      selectedGoalId,
      selectedPhaseId: selectedPhase,
    });
  }, [selectedGoalId, selectedPhase, selectedTaskId, serverId, updateSurface, workspaceId]);

  const refreshList = useCallback(async () => {
    if (!client) {
      return;
    }
    const response = await client.listBackgroundTasks({ workspaceId });
    if (response.error) {
      setError(response.error);
    } else {
      setError(null);
    }
    setTasks(response.tasks);
    setSelectedTaskId((current) => {
      if (current && response.tasks.some((task) => task.id === current)) {
        return current;
      }
      return response.tasks.find(isRealTask)?.id ?? null;
    });
  }, [client, workspaceId]);

  useEffect(() => {
    if (!client) {
      return;
    }
    let active = true;
    void refreshList().catch((nextError) => {
      if (active) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    });
    const unsubscribe = client.on("background_task.update", (message) => {
      if (message.type !== "background_task.update") {
        return;
      }
      const summary = message.payload.summary;
      if (summary.workspaceName && workspaceId && message.payload.task.workspacePath) {
        // The daemon already filters list requests by workspace; live updates are global.
        // Refreshing keeps the panel scoped without duplicating workspace-id inference here.
        void refreshList();
      }
      setTasks((current) => {
        const index = current.findIndex((task) => task.id === summary.id);
        if (index < 0) {
          return current.some((task) => task.id === "empty") ? [summary] : [summary, ...current];
        }
        const next = [...current];
        next[index] = summary;
        return next;
      });
      setSelectedTask((current) =>
        current?.id === message.payload.task.id ? message.payload.task : current,
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client, refreshList, workspaceId]);

  useEffect(() => {
    if (!client || !selectedTaskId || selectedTaskId === "empty") {
      setSelectedTask(null);
      return;
    }
    let active = true;
    void client
      .inspectBackgroundTask({ taskId: selectedTaskId })
      .then((response) => {
        if (!active) {
          return;
        }
        if (response.error) {
          setError(response.error);
          setSelectedTask(null);
          return;
        }
        setError(null);
        setSelectedTask(response.task);
        const nextGoal = activeGoal(response.task);
        setSelectedGoalId((current) =>
          current && response.task?.goals.some((goal) => goal.id === current)
            ? current
            : (nextGoal?.id ?? null),
        );
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      });
    return () => {
      active = false;
    };
  }, [client, selectedTaskId]);

  const selectedGoal = useMemo(() => {
    if (!selectedTask) {
      return null;
    }
    return (
      selectedTask.goals.find((goal) => goal.id === selectedGoalId) ??
      activeGoal(selectedTask) ??
      null
    );
  }, [selectedGoalId, selectedTask]);

  const selectedPhaseRecord = useMemo(
    () => (selectedGoal ? latestPhase(selectedGoal, selectedPhase) : null),
    [selectedGoal, selectedPhase],
  );
  const selectedPhaseAgentId = selectedPhaseRecord?.agentId ?? null;
  const selectedPhaseElapsed = formatElapsed(
    selectedPhaseRecord?.attemptStartedAt ?? selectedPhaseRecord?.startedAt,
    nowTick,
  );

  useLoopPhaseTimelineWheelBridge({
    attachmentKey: selectedPhaseAgentId ?? selectedGoal?.id ?? selectedTask?.id ?? null,
    enabled: Boolean(selectedTask && selectedGoal),
    timelineShellRef,
  });

  useEffect(() => {
    if (
      selectedTask?.currentPhase &&
      selectedGoal?.id &&
      selectedTask.currentGoalId === selectedGoal.id
    ) {
      setSelectedPhase(selectedTask.currentPhase);
    }
  }, [selectedGoal?.id, selectedTask?.currentGoalId, selectedTask?.currentPhase, selectedTask?.id]);

  useEffect(() => {
    if (!client || !selectedPhaseAgentId) {
      setPhaseAgent(null);
      setPhaseItems([]);
      setPendingPermissions(new Map());
      setPhaseTimelineLoading(false);
      setPhaseTimelineError(null);
      return;
    }
    let active = true;
    setPhaseTimelineLoading(true);
    setPhaseTimelineError(null);
    void client
      .fetchAgentTimeline(selectedPhaseAgentId, {
        direction: "tail",
        limit: 200,
        projection: "projected",
      })
      .then((payload) => {
        if (!active) {
          return;
        }
        if (payload.agent) {
          setPhaseAgent(agentSnapshotToScreenAgent(serverId, payload.agent));
          setPendingPermissions(
            permissionMapFromSnapshot(selectedPhaseAgentId, payload.agent.pendingPermissions),
          );
        }
        setPhaseItems(hydrateProjectedEntries(payload.entries));
        setPhaseTimelineLoading(false);
        if (!payload.agent) {
          setPhaseTimelineError("The provider session metadata could not be restored.");
        }
      })
      .catch((nextError) => {
        if (active) {
          setPhaseAgent(null);
          setPhaseItems([]);
          setPhaseTimelineLoading(false);
          setPhaseTimelineError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      });

    const unsubscribeStream = client.on("agent_stream", (message) => {
      if (message.type !== "agent_stream" || message.payload.agentId !== selectedPhaseAgentId) {
        return;
      }
      setPhaseItems((current) =>
        reduceStreamUpdate(current, message.payload.event, new Date(message.payload.timestamp)),
      );
    });
    const unsubscribePermissionRequest = client.on("agent_permission_request", (message) => {
      if (
        message.type !== "agent_permission_request" ||
        message.payload.agentId !== selectedPhaseAgentId
      ) {
        return;
      }
      setPendingPermissions((current) => {
        const next = new Map(current);
        const key = `${message.payload.agentId}:${message.payload.request.id}`;
        next.set(key, {
          key,
          agentId: message.payload.agentId,
          request: message.payload.request,
        });
        return next;
      });
    });
    const unsubscribePermissionResolved = client.on("agent_permission_resolved", (message) => {
      if (
        message.type !== "agent_permission_resolved" ||
        message.payload.agentId !== selectedPhaseAgentId
      ) {
        return;
      }
      setPendingPermissions((current) => {
        const next = new Map(current);
        next.delete(`${message.payload.agentId}:${message.payload.requestId}`);
        return next;
      });
    });
    return () => {
      active = false;
      unsubscribeStream();
      unsubscribePermissionRequest();
      unsubscribePermissionResolved();
    };
  }, [client, selectedPhaseAgentId, serverId]);

  useEffect(() => {
    if (!selectedPhaseAgentId || phaseItems.length === 0) {
      return;
    }
    const handle = setTimeout(() => {
      phaseStreamRef.current?.scrollToBottom("jump-to-bottom");
    }, 50);
    return () => {
      clearTimeout(handle);
    };
  }, [phaseItems.length, selectedPhaseAgentId]);

  const handleTaskAction = useCallback(
    async (action: BackgroundTaskAction) => {
      if (!client || !selectedTask) {
        return;
      }
      setPendingAction(action);
      try {
        const response = await client.actOnBackgroundTask({ taskId: selectedTask.id, action });
        if (response.error) {
          setError(response.error);
        }
        if (response.task) {
          setSelectedTask(response.task);
          void refreshList();
        }
      } finally {
        setPendingAction(null);
      }
    },
    [client, refreshList, selectedTask],
  );

  if (!client) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>Background tasks unavailable</Text>
        <Text style={styles.emptyText}>Connect the Thoth host to inspect Loop tasks.</Text>
      </View>
    );
  }

  const visibleTasks = tasks.filter(isRealTask);
  const selectedTaskReplanHistory = selectedTask?.replanHistory ?? [];

  return (
    <View style={styles.root} onLayout={handleSurfaceLayout} testID="background-tasks-panel">
      <View style={[styles.sidebar, { width: taskListWidth }]} testID="background-task-list-pane">
        <Text style={styles.sidebarTitle}>Background tasks</Text>
        {visibleTasks.length === 0 ? (
          <View style={styles.emptyList}>
            <Text style={styles.emptyText}>No Loop tasks yet.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.taskList}>
            {visibleTasks.map((task) => {
              const selected = task.id === selectedTask?.id;
              return (
                <Pressable
                  key={task.id}
                  onPress={() => setSelectedTaskId(task.id)}
                  style={[styles.taskRow, selected && styles.taskRowSelected]}
                  testID={`background-task-row-${task.id}`}
                >
                  <Text style={styles.taskRowTitle}>{task.title}</Text>
                  <Text style={styles.taskRowMeta}>
                    {taskStatusLabel(task.status)}
                    {task.detailLabel ? ` · ${task.detailLabel}` : ""}
                  </Text>
                  <Text style={styles.taskRowSummary} numberOfLines={2}>
                    {task.summary}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
      {isWeb ? (
        <ResizeHandle
          direction="horizontal"
          groupId={`background-task-list-${surfaceKey}`}
          index={0}
          sizes={taskListResizeSizes}
          onResizeSplit={handleResizeTaskList}
        />
      ) : null}
      <View style={styles.detail} testID="background-task-detail-pane">
        {selectedTask ? (
          <ScrollView
            contentContainerStyle={styles.detailContent}
            testID={BACKGROUND_TASK_DETAIL_SCROLL_TEST_ID}
          >
            <View style={styles.detailHeader}>
              <View style={styles.detailTitleBlock}>
                <Text style={styles.detailTitle}>{selectedTask.title}</Text>
                <Text style={styles.detailStatus}>
                  {taskStatusLabel(selectedTask.status)} · failed reviews{" "}
                  {selectedTask.budget.usedFailedReviews}/{selectedTask.budget.maxFailedReviews}
                </Text>
              </View>
              <View style={styles.headerActions}>
                <ActionButton
                  testID="background-task-resume"
                  label={
                    selectedTask.status === "evidence_invalid" ||
                    selectedTask.status === "workspace_changed_concurrently"
                      ? "Re-baseline & resume"
                      : "Resume"
                  }
                  icon={
                    pendingAction === "resume" ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Play size={14} />
                    )
                  }
                  disabled={pendingAction !== null || !resumeEnabled}
                  onPress={() => void handleTaskAction("resume")}
                />
                <ActionButton
                  testID="background-task-pause"
                  label={selectedTask.controlIntent === "pause_after_phase" ? "Pausing" : "Pause"}
                  icon={
                    pendingAction === "pause" ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Pause size={14} />
                    )
                  }
                  disabled={pendingAction !== null || !pauseEnabled}
                  onPress={() => void handleTaskAction("pause")}
                />
                <ActionButton
                  testID="background-task-stop"
                  label="Stop"
                  icon={
                    pendingAction === "stop" ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Square size={14} />
                    )
                  }
                  disabled={pendingAction !== null || !stopEnabled}
                  onPress={() => void handleTaskAction("stop")}
                />
              </View>
            </View>
            <Text style={styles.detailSummary}>{selectedTask.summary}</Text>

            {selectedTask.budgetEnvelope && selectedTask.budgetUsage ? (
              <View style={styles.budgetPanel} testID="loop-budget-envelope">
                <View style={styles.budgetHeader}>
                  <Clock3 size={15} />
                  <Text style={styles.sectionTitle}>Loop budget</Text>
                </View>
                <Text style={styles.sectionMuted}>
                  Active {formatDuration(selectedTask.budgetUsage.activeDurationMs)} /{" "}
                  {formatDuration(selectedTask.budgetEnvelope.maxActiveDurationMs)} · tokens{" "}
                  {selectedTask.budgetUsage.tokenMetered
                    ? `${formatLimit(selectedTask.budgetUsage.tokens)} / ${formatLimit(selectedTask.budgetEnvelope.maxTokens)}`
                    : "unmetered"}
                </Text>
                <Text style={styles.sectionMuted}>
                  Tools {formatLimit(selectedTask.budgetUsage.toolCalls)} /{" "}
                  {formatLimit(selectedTask.budgetEnvelope.maxToolCalls)} · files{" "}
                  {formatLimit(selectedTask.budgetUsage.changedFiles)} /{" "}
                  {formatLimit(selectedTask.budgetEnvelope.maxChangedFiles)} · lines{" "}
                  {formatLimit(selectedTask.budgetUsage.changedLines)} /{" "}
                  {formatLimit(selectedTask.budgetEnvelope.maxChangedLines)}
                </Text>
                <Text style={styles.sectionMuted}>
                  Replans {formatLimit(selectedTask.budgetUsage.replans)} /{" "}
                  {formatLimit(selectedTask.budgetEnvelope.maxReplans)} · same root cause{" "}
                  {formatLimit(selectedTask.budgetUsage.consecutiveSameRootCause)} /{" "}
                  {formatLimit(selectedTask.budgetEnvelope.maxConsecutiveSameRootCause)}
                </Text>
              </View>
            ) : null}

            {selectedTask.status === "budget_wait" && selectedTask.budgetWait ? (
              <View style={styles.budgetWaitPanel} testID="loop-budget-wait">
                <Text style={styles.sectionTitle}>Budget decision needed</Text>
                <Text style={styles.sectionBody}>{selectedTask.budgetWait.reason}</Text>
                <Text style={styles.sectionMuted}>
                  Reached: {selectedTask.budgetWait.exhaustedDimensions.join(" · ")}
                </Text>
                <View style={styles.budgetActions}>
                  <ActionButton
                    testID="background-task-budget-continue"
                    label="Raise strength"
                    icon={
                      pendingAction === "budget_continue" ? (
                        <ActivityIndicator size="small" />
                      ) : (
                        <Play size={14} />
                      )
                    }
                    disabled={pendingAction !== null}
                    onPress={() => void handleTaskAction("budget_continue")}
                  />
                  <ActionButton
                    testID="background-task-review-only"
                    label="Review evidence"
                    icon={
                      pendingAction === "review_only" ? (
                        <ActivityIndicator size="small" />
                      ) : (
                        <CheckCircle2 size={14} />
                      )
                    }
                    disabled={pendingAction !== null || !selectedGoal?.latestPlanExecResult}
                    onPress={() => void handleTaskAction("review_only")}
                  />
                </View>
              </View>
            ) : null}

            {selectedTask.status === "evidence_invalid" ||
            selectedTask.status === "workspace_changed_concurrently" ? (
              <View style={styles.evidenceWarningPanel} testID="loop-evidence-warning">
                <Text style={styles.sectionTitle}>Evidence held</Text>
                <Text style={styles.sectionBody}>{selectedTask.summary}</Text>
                <Text style={styles.sectionMuted}>
                  The task preserved its receipts and did not revert workspace changes. Re-establish
                  the workspace baseline before resuming this task.
                </Text>
              </View>
            ) : null}

            <View style={styles.goalRail}>
              {selectedTask.goals.map((goal) => {
                const current = goal.id === selectedTask.currentGoalId;
                const selected = goal.id === selectedGoal?.id;
                return (
                  <Pressable
                    key={goal.id}
                    onPress={() => setSelectedGoalId(goal.id)}
                    style={[
                      styles.goalRow,
                      selected && styles.goalRowSelected,
                      !current && goal.status !== "passed" && styles.goalRowMuted,
                    ]}
                    testID={`loop-goal-row-${goal.id}`}
                  >
                    <View style={styles.goalStatusIcon}>
                      {current && selectedTask.status === "running" ? (
                        <ActivityIndicator size="small" />
                      ) : goal.status === "passed" ? (
                        <ThemedCheckCircle size={16} uniProps={successColorMapping} />
                      ) : goal.status === "blocked" ? (
                        <ThemedXCircle size={16} uniProps={dangerColorMapping} />
                      ) : (
                        <ThemedListTodo size={16} uniProps={mutedColorMapping} />
                      )}
                    </View>
                    <View style={styles.goalTextBlock}>
                      <Text style={styles.goalTitle}>
                        Goal {goal.order}: {goal.title}
                      </Text>
                      <Text style={styles.goalMeta}>
                        {goal.status} · loop round {goal.round}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {selectedGoal ? (
              <View style={styles.goalDetail}>
                <Text style={styles.sectionTitle}>Current goal</Text>
                <Text style={styles.sectionBody}>{selectedGoal.goal}</Text>
                <Text style={styles.sectionTitle}>Acceptance</Text>
                <Text style={styles.sectionBody}>{selectedGoal.acceptance.join("；")}</Text>
                <View style={styles.phaseTabs}>
                  {(["planexec", "review"] as const).map((phase) => {
                    const record = latestPhase(selectedGoal, phase);
                    const active =
                      selectedTask.currentGoalId === selectedGoal.id &&
                      selectedTask.currentPhase === phase &&
                      selectedTask.status === "running";
                    return (
                      <Pressable
                        key={phase}
                        onPress={() => setSelectedPhase(phase)}
                        style={[
                          styles.phaseTab,
                          selectedPhase === phase && styles.phaseTabSelected,
                        ]}
                        testID={`loop-phase-${phase}`}
                      >
                        {active ? <ActivityIndicator size="small" /> : null}
                        <Text style={styles.phaseTitle}>{phaseLabel(phase)}</Text>
                        <Text style={styles.phaseMeta}>
                          round {record?.round ?? selectedGoal.round} · {record?.status ?? "queued"}
                          {active && selectedPhaseElapsed ? ` · ${selectedPhaseElapsed}` : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {selectedGoal.latestPlanExecResult ? (
                  <View style={styles.phaseResultBox} testID="loop-planexec-result-summary">
                    <Text style={styles.sectionTitle}>Latest PlanExec evidence</Text>
                    <Text style={styles.sectionBody}>
                      {selectedGoal.latestPlanExecResult.executionSummary}
                    </Text>
                    <Text style={styles.sectionMuted}>
                      Evidence: {selectedGoal.latestPlanExecResult.evidence.join("；")}
                    </Text>
                    <Text style={styles.sectionMuted}>
                      Review focus: {selectedGoal.latestPlanExecResult.nextReviewFocus}
                    </Text>
                    {selectedGoal.latestPlanExecResult.evidenceRef ? (
                      <Text style={styles.sectionMuted} testID="loop-planexec-evidence-ref">
                        Evidence receipt:{" "}
                        {evidenceLabel(selectedGoal.latestPlanExecResult.evidenceRef)}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {selectedGoal.latestReview ? (
                  <View style={styles.phaseResultBox} testID="loop-review-verdict-summary">
                    <Text style={styles.sectionTitle}>Latest Review verdict</Text>
                    <Text style={styles.sectionBody}>{selectedGoal.latestReview.summary}</Text>
                    <Text style={styles.sectionMuted}>
                      {selectedGoal.latestReview.acceptanceMatrix
                        .map((entry) => `${entry.status}: ${entry.acceptance}`)
                        .join("；")}
                    </Text>
                    {selectedGoal.latestReview.evidenceRef ? (
                      <Text style={styles.sectionMuted} testID="loop-review-evidence-ref">
                        Evidence receipt: {evidenceLabel(selectedGoal.latestReview.evidenceRef)}
                      </Text>
                    ) : null}
                  </View>
                ) : null}

                {selectedTask.baselineEvidence || selectedTaskReplanHistory.length > 0 ? (
                  <View style={styles.phaseResultBox} testID="loop-authority-history">
                    {selectedTask.baselineEvidence ? (
                      <>
                        <Text style={styles.sectionTitle}>Task baseline evidence</Text>
                        <Text style={styles.sectionMuted}>
                          {evidenceLabel(selectedTask.baselineEvidence)}
                        </Text>
                      </>
                    ) : null}
                    {selectedTaskReplanHistory.length > 0 ? (
                      <>
                        <Text style={styles.sectionTitle}>Deferred goal replans</Text>
                        {selectedTaskReplanHistory.map((replan) => (
                          <Text key={replan.id} style={styles.sectionMuted}>
                            {replan.status}: {replan.rationale}
                            {replan.auditSummary ? ` · ${replan.auditSummary}` : ""}
                          </Text>
                        ))}
                      </>
                    ) : null}
                  </View>
                ) : null}

                <View
                  ref={timelineShellRef}
                  style={styles.timelineShell}
                  testID="loop-phase-timeline"
                >
                  <Text style={styles.sectionTitle}>{phaseLabel(selectedPhase)} timeline</Text>
                  {phaseAgent && selectedPhaseAgentId ? (
                    <AgentStreamView
                      ref={phaseStreamRef}
                      agentId={selectedPhaseAgentId}
                      serverId={serverId}
                      agent={phaseAgent}
                      streamItems={phaseItems}
                      pendingPermissions={pendingPermissions}
                      isAuthoritativeHistoryReady
                    />
                  ) : phaseTimelineLoading && selectedPhaseAgentId ? (
                    <View style={styles.emptyTimeline}>
                      <ActivityIndicator size="small" />
                      <Text style={styles.emptyText}>Loading phase timeline...</Text>
                    </View>
                  ) : phaseTimelineError && selectedPhaseAgentId ? (
                    <View style={styles.emptyTimeline}>
                      <ThemedXCircle size={18} uniProps={dangerColorMapping} />
                      <Text style={styles.errorText}>{phaseTimelineError}</Text>
                    </View>
                  ) : selectedPhaseRecord?.summary ? (
                    <View style={styles.emptyTimeline}>
                      <ThemedXCircle size={18} uniProps={dangerColorMapping} />
                      <Text style={styles.errorText}>{selectedPhaseRecord.summary}</Text>
                    </View>
                  ) : selectedPhaseRecord && selectedPhaseRecord.status !== "queued" ? (
                    <View style={styles.emptyTimeline}>
                      <ThemedXCircle size={18} uniProps={dangerColorMapping} />
                      <Text style={styles.errorText}>
                        This phase is missing its provider session reference.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.emptyTimeline}>
                      <Text style={styles.emptyText}>
                        This phase has not created a provider session yet.
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <View style={styles.emptyState}>
            <ThemedListTodo size={20} uniProps={mutedColorMapping} />
            <Text style={styles.emptyTitle}>No task selected</Text>
            <Text style={styles.emptyText}>
              Loop tasks will appear here after Goals Card approval.
            </Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        )}
      </View>
    </View>
  );
}

function ActionButton({
  testID,
  label,
  icon,
  disabled,
  onPress,
}: {
  testID: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[styles.actionButton, disabled && styles.actionButtonDisabled]}
    >
      {icon}
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: theme.colors.surface0,
  },
  sidebar: {
    flexShrink: 0,
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  sidebarTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  taskList: {
    gap: theme.spacing[2],
  },
  taskRow: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    gap: theme.spacing[1],
  },
  taskRowSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  taskRowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  taskRowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  taskRowSummary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  detail: {
    flex: 1,
    minWidth: 0,
    padding: theme.spacing[4],
  },
  detailContent: {
    gap: theme.spacing[4],
  },
  detailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  detailTitleBlock: {
    flex: 1,
    gap: theme.spacing[1],
  },
  detailTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.semibold,
  },
  detailStatus: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  detailSummary: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
  },
  actionButtonDisabled: {
    opacity: 0.6,
  },
  actionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
  },
  goalRail: {
    gap: theme.spacing[2],
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
  },
  goalRowSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  goalRowMuted: {
    opacity: 0.62,
  },
  goalStatusIcon: {
    width: 22,
    alignItems: "center",
  },
  goalTextBlock: {
    flex: 1,
    gap: theme.spacing[1],
  },
  goalTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  goalMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  goalDetail: {
    gap: theme.spacing[3],
  },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
  },
  sectionBody: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  sectionMuted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  phaseResultBox: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  budgetPanel: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
    gap: theme.spacing[1],
  },
  budgetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  budgetWaitPanel: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  evidenceWarningPanel: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.destructive,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  budgetActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  phaseTabs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  phaseTab: {
    minWidth: 180,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
  },
  phaseTabSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  phaseTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  phaseMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  timelineShell: {
    minHeight: 360,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  emptyTimeline: {
    minHeight: 180,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyList: {
    paddingTop: theme.spacing[2],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
