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
import invariant from "tiny-invariant";
import type { AgentSnapshotPayload, AgentStreamEventPayload } from "@thoth/protocol/messages";
import type {
  BackgroundTaskModel,
  LoopGoalRecord,
  LoopPhaseKind,
  LoopPhaseRecord,
  LoopTaskModel,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
import type { AgentPermissionRequest, AgentProvider } from "@thoth/protocol/agent-types";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AgentStreamView, type AgentStreamViewHandle } from "@/agent-stream/view";
import type { AgentScreenAgent } from "@/hooks/use-agent-screen-state-machine";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { usePaneContext } from "@/panels/pane-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { PendingPermission } from "@/types/shared";
import { hydrateStreamState, reduceStreamUpdate, type StreamItem } from "@/types/stream";
import { isWeb } from "@/constants/platform";

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

function useBackgroundTasksPanelDescriptor(
  target: { kind: "background_tasks"; workspaceId: string },
  _context: { serverId: string; workspaceId: string },
): PanelDescriptor {
  return {
    label: "Background tasks",
    subtitle: target.workspaceId,
    titleState: "ready",
    icon: Clock3,
    statusBucket: null,
  };
}

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

function BackgroundTasksPanel() {
  const { serverId, target } = usePaneContext();
  invariant(
    target.kind === "background_tasks",
    "BackgroundTasksPanel requires background_tasks target",
  );
  const client = useHostRuntimeClient(serverId);
  const [tasks, setTasks] = useState<BackgroundTaskModel[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<LoopTaskModel | null>(null);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<LoopPhaseKind>("planexec");
  const [phaseAgent, setPhaseAgent] = useState<AgentScreenAgent | null>(null);
  const [phaseItems, setPhaseItems] = useState<StreamItem[]>([]);
  const phaseStreamRef = useRef<AgentStreamViewHandle | null>(null);
  const timelineShellRef = useRef<View | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, PendingPermission>>(
    () => new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    if (!client) {
      return;
    }
    const response = await client.listBackgroundTasks({ workspaceId: target.workspaceId });
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
  }, [client, target.workspaceId]);

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
      if (summary.workspaceName && target.workspaceId && message.payload.task.workspacePath) {
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
  }, [client, refreshList, target.workspaceId]);

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
      return;
    }
    let active = true;
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
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
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
    async (action: "pause" | "resume" | "stop") => {
      if (!client || !selectedTask) {
        return;
      }
      const response = await client.actOnBackgroundTask({ taskId: selectedTask.id, action });
      if (response.error) {
        setError(response.error);
      }
      if (response.task) {
        setSelectedTask(response.task);
        void refreshList();
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

  return (
    <View style={styles.root} testID="background-tasks-panel">
      <View style={styles.sidebar}>
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
      <View style={styles.detail}>
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
                {selectedTask.status === "paused" || selectedTask.status === "interrupted" ? (
                  <ActionButton
                    label="Resume"
                    icon={<Play size={14} />}
                    onPress={() => void handleTaskAction("resume")}
                  />
                ) : (
                  <ActionButton
                    label="Pause"
                    icon={<Pause size={14} />}
                    onPress={() => void handleTaskAction("pause")}
                  />
                )}
                <ActionButton
                  label="Stop"
                  icon={<Square size={14} />}
                  onPress={() => void handleTaskAction("stop")}
                />
              </View>
            </View>
            <Text style={styles.detailSummary}>{selectedTask.summary}</Text>

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
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

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
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.actionButton}>
      {icon}
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

export const backgroundTasksPanelRegistration: PanelRegistration<"background_tasks"> = {
  kind: "background_tasks",
  component: BackgroundTasksPanel,
  useDescriptor: useBackgroundTasksPanelDescriptor,
};

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: theme.colors.surface0,
  },
  sidebar: {
    width: 300,
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
