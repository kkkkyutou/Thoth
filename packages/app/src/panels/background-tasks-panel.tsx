import { useCallback, useEffect, useMemo, useState } from "react";
import { ListTodo, Clock3 } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import invariant from "tiny-invariant";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { usePaneContext } from "@/panels/pane-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type {
  RegisteredTaskModel,
  ThothCleanUiModel,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

const ThemedListTodo = withUnistyles(ListTodo);
const mutedColorMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
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

function resolveRegisteredTasks(model: ThothCleanUiModel | null): RegisteredTaskModel[] {
  const tasks = model?.backgroundTasks.tasks ?? [];
  const detail = model?.backgroundTasks.detail ?? null;
  if (!detail) {
    return [];
  }
  const ids = new Set(tasks.map((task) => task.id));
  return ids.has(detail.id) ? [detail] : [];
}

function BackgroundTasksPanel() {
  const { serverId, target } = usePaneContext();
  invariant(
    target.kind === "background_tasks",
    "BackgroundTasksPanel requires background_tasks target",
  );
  const client = useHostRuntimeClient(serverId);
  const [model, setModel] = useState<ThothCleanUiModel | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!client) {
      return;
    }
    let active = true;
    void client.fetchWorkspaceSecretarySnapshot().then((payload) => {
      if (!active) {
        return;
      }
      setModel(payload.model);
      setSelectedTaskId(payload.model?.backgroundTasks.selectedTaskId ?? null);
    });
    const unsubscribe = client.subscribeWorkspaceSecretaryModelUpdates((payload) => {
      if (!active) {
        return;
      }
      setModel(payload.model);
      setSelectedTaskId(
        (current) => current ?? payload.model.backgroundTasks.selectedTaskId ?? null,
      );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  const registeredTasks = useMemo(() => {
    const tasks = model?.backgroundTasks.detail
      ? [model.backgroundTasks.detail]
      : resolveRegisteredTasks(model);
    return tasks.filter((task) => task.status === "registered_pending");
  }, [model]);

  const selectedTask =
    registeredTasks.find((task) => task.id === selectedTaskId) ?? registeredTasks[0] ?? null;

  const handleSelectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
  }, []);

  if (!client) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>Background tasks unavailable</Text>
        <Text style={styles.emptyText}>Connect the Thoth host to inspect registered tasks.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="background-tasks-panel">
      <View style={styles.sidebar}>
        <Text style={styles.sidebarTitle}>Background tasks</Text>
        {registeredTasks.length === 0 ? (
          <View style={styles.emptyList}>
            <Text style={styles.emptyText}>No registered tasks yet.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.taskList}>
            {registeredTasks.map((task) => {
              const selected = task.id === selectedTask?.id;
              return (
                <Pressable
                  key={task.id}
                  onPress={() => handleSelectTask(task.id)}
                  style={[styles.taskRow, selected && styles.taskRowSelected]}
                  testID={`background-task-row-${task.id}`}
                >
                  <Text style={styles.taskRowTitle}>{task.title}</Text>
                  <Text style={styles.taskRowMeta}>{task.status}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>
      <View style={styles.detail}>
        {selectedTask ? (
          <ScrollView contentContainerStyle={styles.detailContent}>
            <Text style={styles.detailTitle}>{selectedTask.title}</Text>
            <Text style={styles.detailStatus}>registered_pending</Text>
            <Text style={styles.detailSummary}>{selectedTask.summary}</Text>
            <Section title="Goal">{selectedTask.taskCard.goal}</Section>
            <Section title="Constraints">{selectedTask.taskCard.constraints.join("；")}</Section>
            <Section title="Acceptance">{selectedTask.taskCard.acceptance.join("；")}</Section>
            <Section title="Pyramid Plan">
              {selectedTask.goalCard.pyramid.map((stage) => stage.title).join(" / ")}
            </Section>
            <Section title="Source topic">{selectedTask.sourceTopicId}</Section>
          </ScrollView>
        ) : (
          <View style={styles.emptyState}>
            <ThemedListTodo size={20} uniProps={mutedColorMapping} />
            <Text style={styles.emptyTitle}>No task selected</Text>
            <Text style={styles.emptyText}>
              Registered tasks will appear here after Loop approval.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
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
    width: 280,
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
  },
  taskRowSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  taskRowTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  taskRowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  detail: {
    flex: 1,
    padding: theme.spacing[4],
  },
  detailContent: {
    gap: theme.spacing[3],
  },
  detailTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
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
  section: {
    gap: theme.spacing[1],
  },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  sectionBody: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
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
}));
