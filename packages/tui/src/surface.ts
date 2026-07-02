import type {
  ConnectionState,
  ThothAgent,
  ThothProviderSnapshotResult,
  ThothWorkspace,
} from "@thoth/client";

export type TuiRouteId =
  | "home"
  | "workspace"
  | "tasks"
  | "providers"
  | "connections"
  | "review"
  | "settings";

export type TuiBadgeTone = "ready" | "needs-action" | "preview" | "running" | "unavailable";

export interface TuiStatusChip {
  label: string;
  value: string;
  tone: TuiBadgeTone;
}

export interface TuiNavItem {
  id: TuiRouteId;
  label: string;
  description: string;
  tone: TuiBadgeTone;
  badge: string;
}

export interface TuiTaskSlot {
  id: "active-task" | "contract" | "evidence";
  title: string;
  value: string;
  tone: TuiBadgeTone;
}

export interface TuiLayout {
  mode: "compact" | "split";
  sidebarWidth: number;
  composerRows: number;
  showPreviewColumn: boolean;
}

export interface TuiSurfaceInput {
  connection: ConnectionState;
  workspaces?: readonly ThothWorkspace[];
  agents?: readonly ThothAgent[];
  providers?: ThothProviderSnapshotResult | null;
  selectedWorkspaceId?: string | null;
  cwd?: string | null;
  relayPaired?: boolean;
  terminalWidth?: number;
  terminalHeight?: number;
}

export interface TuiSurfaceModel {
  title: "One Thoth";
  renderer: "OpenTUI";
  activeRoute: TuiRouteId;
  activeWorkspace: {
    id: string | null;
    label: string;
    cwd: string | null;
    status: "ready" | "needs-workspace";
  };
  layout: TuiLayout;
  statusChips: TuiStatusChip[];
  navigation: TuiNavItem[];
  taskSlots: TuiTaskSlot[];
}

export function buildTuiSurfaceModel(input: TuiSurfaceInput): TuiSurfaceModel {
  const workspaces = input.workspaces ?? [];
  const agents = input.agents ?? [];
  const activeWorkspace = selectActiveWorkspace(workspaces, input.selectedWorkspaceId, input.cwd);
  const providerReady = hasReadyProvider(input.providers);
  const runningAgents = agents.filter((agent) => !agent.archivedAt && agent.status === "running");
  const attentionAgents = agents.filter((agent) => !agent.archivedAt && agent.requiresAttention);
  const connectionChip = buildConnectionChip(input.connection);
  const workspaceReady = Boolean(activeWorkspace);
  const layout = deriveTuiLayout(input.terminalWidth ?? 100, input.terminalHeight ?? 32);

  return {
    title: "One Thoth",
    renderer: "OpenTUI",
    activeRoute: workspaceReady ? "workspace" : "home",
    activeWorkspace: activeWorkspace
      ? {
          id: activeWorkspace.id,
          label: activeWorkspace.projectDisplayName || activeWorkspace.name,
          cwd: activeWorkspace.workspaceDirectory ?? activeWorkspace.projectRootPath,
          status: "ready",
        }
      : {
          id: null,
          label: "Needs a registered workspace",
          cwd: input.cwd ?? null,
          status: "needs-workspace",
        },
    layout,
    statusChips: [
      connectionChip,
      {
        label: "Workspace",
        value: activeWorkspace
          ? activeWorkspace.projectDisplayName || activeWorkspace.name
          : "Needs a registered workspace",
        tone: activeWorkspace ? "ready" : "needs-action",
      },
      {
        label: "Provider",
        value: providerReady ? "Provider available" : "Select model first",
        tone: providerReady ? "ready" : "needs-action",
      },
      {
        label: "Relay",
        value: input.relayPaired ? "Paired device" : "Fresh pairing supported",
        tone: input.relayPaired ? "ready" : "preview",
      },
      {
        label: "Review",
        value: "Preview surface",
        tone: "preview",
      },
    ],
    navigation: buildNavigation({
      workspaceReady,
      providerReady,
      connected: input.connection.status === "connected",
      relayPaired: input.relayPaired === true,
      activeTaskCount: runningAgents.length,
      attentionCount: attentionAgents.length,
    }),
    taskSlots: buildTaskSlots({ runningAgents, attentionAgents, providerReady }),
  };
}

export function deriveTuiLayout(width: number, height: number): TuiLayout {
  const compact = width < 88 || height < 24;
  return {
    mode: compact ? "compact" : "split",
    sidebarWidth: compact ? 0 : Math.min(28, Math.max(22, Math.floor(width * 0.22))),
    composerRows: height < 20 ? 3 : 5,
    showPreviewColumn: !compact && width >= 118,
  };
}

function buildConnectionChip(connection: ConnectionState): TuiStatusChip {
  switch (connection.status) {
    case "connected":
      return { label: "Host", value: "Connected", tone: "ready" };
    case "connecting":
      return { label: "Host", value: `Connecting ${connection.attempt}`, tone: "running" };
    case "disconnected":
      return { label: "Host", value: connection.reason ?? "Disconnected", tone: "unavailable" };
    case "disposed":
      return { label: "Host", value: "Closed", tone: "unavailable" };
    case "idle":
      return { label: "Host", value: "Needs host", tone: "needs-action" };
  }
}

function buildNavigation(input: {
  workspaceReady: boolean;
  providerReady: boolean;
  connected: boolean;
  relayPaired: boolean;
  activeTaskCount: number;
  attentionCount: number;
}): TuiNavItem[] {
  return [
    {
      id: "home",
      label: "Home",
      description: "One Thoth overview",
      tone: input.connected ? "ready" : "needs-action",
      badge: input.connected ? "Ready" : "Needs host",
    },
    {
      id: "workspace",
      label: "Workspace",
      description: "Current workspace control surface",
      tone: input.workspaceReady ? "ready" : "needs-action",
      badge: input.workspaceReady ? "Ready" : "Needs workspace",
    },
    {
      id: "tasks",
      label: "Task / Loop",
      description: "Formal task loop slots",
      tone: input.activeTaskCount > 0 ? "running" : "preview",
      badge: input.activeTaskCount > 0 ? `${input.activeTaskCount} running` : "Preview",
    },
    {
      id: "providers",
      label: "Providers",
      description: "Configured provider session readiness",
      tone: input.providerReady ? "ready" : "needs-action",
      badge: input.providerReady ? "Available" : "Select model",
    },
    {
      id: "connections",
      label: "Connections",
      description: "Direct daemon, relay and device pairing",
      tone: input.relayPaired ? "ready" : "preview",
      badge: input.relayPaired ? "Paired" : "Pairing ready",
    },
    {
      id: "review",
      label: "Evidence / Review",
      description: "Receipts and review outcomes",
      tone: input.attentionCount > 0 ? "needs-action" : "preview",
      badge: input.attentionCount > 0 ? `${input.attentionCount} needs review` : "Preview",
    },
    {
      id: "settings",
      label: "Settings / About",
      description: "Preferences and product identity",
      tone: "preview",
      badge: "Preview",
    },
  ];
}

function buildTaskSlots(input: {
  runningAgents: readonly ThothAgent[];
  attentionAgents: readonly ThothAgent[];
  providerReady: boolean;
}): TuiTaskSlot[] {
  const activeAgent = input.runningAgents[0];
  const attentionAgent = input.attentionAgents[0];
  return [
    {
      id: "active-task",
      title: "Active task",
      value: activeAgent
        ? activeAgent.title || `${activeAgent.provider} session running`
        : "No frozen task yet",
      tone: activeAgent ? "running" : "preview",
    },
    {
      id: "contract",
      title: "Contract",
      value: input.providerReady ? "Needs Clarify session" : "Needs provider",
      tone: input.providerReady ? "preview" : "needs-action",
    },
    {
      id: "evidence",
      title: "Evidence",
      value: attentionAgent ? "Review needed" : "Review receipts will land here",
      tone: attentionAgent ? "needs-action" : "preview",
    },
  ];
}

function selectActiveWorkspace(
  workspaces: readonly ThothWorkspace[],
  selectedWorkspaceId: string | null | undefined,
  cwd: string | null | undefined,
): ThothWorkspace | null {
  if (selectedWorkspaceId) {
    const selected = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
    if (selected) {
      return selected;
    }
  }
  if (cwd) {
    const byCwd = workspaces.find((workspace) => {
      const directory = workspace.workspaceDirectory ?? workspace.projectRootPath;
      return directory === cwd || workspace.projectRootPath === cwd;
    });
    if (byCwd) {
      return byCwd;
    }
  }
  return workspaces[0] ?? null;
}

function hasReadyProvider(snapshot: ThothProviderSnapshotResult | null | undefined): boolean {
  return (
    snapshot?.entries.some(
      (entry) => entry.enabled && entry.status === "ready" && (entry.models?.length ?? 0) > 0,
    ) ?? false
  );
}
