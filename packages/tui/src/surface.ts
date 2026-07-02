import type {
  ConnectionState,
  ThothAgent,
  ThothProviderSnapshotResult,
  ThothWorkspace,
} from "@thoth/client";
import path from "node:path";

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

export interface TuiDetailLine {
  label: string;
  value: string;
  tone: TuiBadgeTone;
}

export interface TuiDetailSection {
  title: string;
  summary: string;
  tone: TuiBadgeTone;
  lines: TuiDetailLine[];
}

export interface TuiRefreshInput {
  status: "loaded" | "failed";
  updatedAt?: string | null;
  error?: string | null;
}

export interface TuiRefreshState {
  value: string;
  tone: TuiBadgeTone;
  error: string | null;
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
  refresh?: TuiRefreshInput;
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
  refresh: TuiRefreshState;
  statusChips: TuiStatusChip[];
  navigation: TuiNavItem[];
  taskSlots: TuiTaskSlot[];
  routeDetails: Record<TuiRouteId, TuiDetailSection>;
}

export function buildTuiSurfaceModel(input: TuiSurfaceInput): TuiSurfaceModel {
  const workspaces = input.workspaces ?? [];
  const agents = input.agents ?? [];
  const activeWorkspace = selectActiveWorkspace(workspaces, input.selectedWorkspaceId, input.cwd);
  const providerReady = hasReadyProvider(input.providers);
  const runningAgents = agents.filter((agent) => !agent.archivedAt && agent.status === "running");
  const attentionAgents = agents.filter((agent) => !agent.archivedAt && agent.requiresAttention);
  const openAgents = agents.filter((agent) => !agent.archivedAt);
  const connectionChip = buildConnectionChip(input.connection);
  const workspaceReady = Boolean(activeWorkspace);
  const layout = deriveTuiLayout(input.terminalWidth ?? 100, input.terminalHeight ?? 32);
  const refresh = buildRefreshState(input.refresh);

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
    refresh,
    statusChips: [
      connectionChip,
      {
        label: "Snapshot",
        value: refresh.value,
        tone: refresh.tone,
      },
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
    routeDetails: buildRouteDetails({
      connectionChip,
      activeWorkspace,
      workspaceReady,
      workspaces,
      providers: input.providers,
      providerReady,
      openAgents,
      runningAgents,
      attentionAgents,
      relayPaired: input.relayPaired === true,
      refresh,
      cwd: input.cwd ?? null,
    }),
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

function buildRefreshState(refresh: TuiRefreshInput | undefined): TuiRefreshState {
  if (!refresh) {
    return {
      value: "Startup snapshot",
      tone: "preview",
      error: null,
    };
  }
  if (refresh.status === "failed") {
    return {
      value: refresh.updatedAt ? `Refresh failed ${refresh.updatedAt}` : "Refresh failed",
      tone: "needs-action",
      error: refresh.error ?? "Unable to refresh daemon state",
    };
  }
  return {
    value: refresh.updatedAt ? `Updated ${refresh.updatedAt}` : "Updated",
    tone: "ready",
    error: null,
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

function buildRouteDetails(input: {
  connectionChip: TuiStatusChip;
  activeWorkspace: ThothWorkspace | null;
  workspaceReady: boolean;
  workspaces: readonly ThothWorkspace[];
  providers: ThothProviderSnapshotResult | null | undefined;
  providerReady: boolean;
  openAgents: readonly ThothAgent[];
  runningAgents: readonly ThothAgent[];
  attentionAgents: readonly ThothAgent[];
  relayPaired: boolean;
  refresh: TuiRefreshState;
  cwd: string | null;
}): Record<TuiRouteId, TuiDetailSection> {
  const providerEntries = input.providers?.entries ?? [];
  const providerLines = providerEntries.slice(0, 4).map((entry): TuiDetailLine => {
    const modelCount = entry.models?.length ?? 0;
    const defaultModel = entry.models?.[0]?.label ?? entry.models?.[0]?.id;
    return {
      label: entry.label ?? entry.provider,
      value: entry.enabled
        ? `${entry.status}${modelCount > 0 ? `, ${modelCount} models` : ""}${
            defaultModel ? `, first ${defaultModel}` : ""
          }`
        : "Disabled",
      tone: entry.enabled && entry.status === "ready" && modelCount > 0 ? "ready" : "needs-action",
    };
  });
  const activeAgent = input.runningAgents[0] ?? input.openAgents[0] ?? null;
  const attentionAgent = input.attentionAgents[0] ?? null;

  return {
    home: {
      title: "One Thoth Home",
      summary: input.connectionChip.tone === "ready" ? "Connected control plane" : "Needs host",
      tone: input.connectionChip.tone === "ready" ? "ready" : "needs-action",
      lines: [
        { label: "Host", value: input.connectionChip.value, tone: input.connectionChip.tone },
        {
          label: "Workspaces",
          value:
            input.workspaces.length > 0
              ? `${input.workspaces.length} registered`
              : "Needs a registered workspace",
          tone: input.workspaces.length > 0 ? "ready" : "needs-action",
        },
        {
          label: "Provider",
          value: input.providerReady ? "Ready for provider sessions" : "Select model first",
          tone: input.providerReady ? "ready" : "needs-action",
        },
        {
          label: "Next step",
          value: input.workspaceReady
            ? "Open Workspace and choose Quick or Loop"
            : "Register/connect this workspace before task loops",
          tone: input.workspaceReady ? "preview" : "needs-action",
        },
      ],
    },
    workspace: {
      title: "Workspace Control",
      summary: input.workspaceReady
        ? "Current workspace selected from daemon state"
        : "Needs workspace",
      tone: input.workspaceReady ? "ready" : "needs-action",
      lines: [
        {
          label: "Identity",
          value: input.activeWorkspace
            ? input.activeWorkspace.projectDisplayName || input.activeWorkspace.name
            : "Needs a registered workspace",
          tone: input.workspaceReady ? "ready" : "needs-action",
        },
        {
          label: "Path",
          value:
            input.activeWorkspace?.workspaceDirectory ??
            input.activeWorkspace?.projectRootPath ??
            input.cwd ??
            "No cwd",
          tone: input.workspaceReady ? "ready" : "needs-action",
        },
        {
          label: "Provider readiness",
          value: input.providerReady ? "Provider available" : "Select model first",
          tone: input.providerReady ? "ready" : "needs-action",
        },
        {
          label: "Context/files",
          value: input.workspaceReady
            ? "Workspace context preview; attachments stay <10MB"
            : "Register workspace to unlock context",
          tone: input.workspaceReady ? "preview" : "needs-action",
        },
      ],
    },
    tasks: {
      title: "Task / Loop",
      summary:
        input.runningAgents.length > 0 ? "Provider session running" : "Formal task runtime preview",
      tone: input.runningAgents.length > 0 ? "running" : "preview",
      lines: [
        {
          label: "Active task",
          value: activeAgent
            ? activeAgent.title || `${activeAgent.provider} ${activeAgent.status}`
            : "No frozen task yet",
          tone: activeAgent?.status === "running" ? "running" : "preview",
        },
        {
          label: "Contract",
          value: input.providerReady ? "Needs Clarify session" : "Needs provider",
          tone: input.providerReady ? "preview" : "needs-action",
        },
        {
          label: "Loop backend",
          value: "Preview only; no fake task authority",
          tone: "preview",
        },
        {
          label: "Permission",
          value: activeAgent?.pendingPermissions.length
            ? `${activeAgent.pendingPermissions.length} pending`
            : "No pending permission",
          tone: activeAgent?.pendingPermissions.length ? "needs-action" : "preview",
        },
      ],
    },
    providers: {
      title: "Providers",
      summary: input.providerReady ? "Provider session source available" : "Needs provider/model",
      tone: input.providerReady ? "ready" : "needs-action",
      lines:
        providerLines.length > 0
          ? providerLines
          : [
              {
                label: "Provider setup",
                value: "Select model first",
                tone: "needs-action",
              },
              {
                label: "Authority",
                value: "Thoth uses configured provider sessions only",
                tone: "preview",
              },
            ],
    },
    connections: {
      title: "Connections / Devices",
      summary: input.connectionChip.tone === "ready" ? "Direct daemon connected" : "Needs host",
      tone: input.connectionChip.tone === "ready" ? "ready" : "needs-action",
      lines: [
        {
          label: "Direct daemon",
          value: input.connectionChip.value,
          tone: input.connectionChip.tone,
        },
        {
          label: "Relay",
          value: input.relayPaired ? "Paired device" : "Fresh pairing supported",
          tone: input.relayPaired ? "ready" : "preview",
        },
        {
          label: "Snapshot",
          value: input.refresh.value,
          tone: input.refresh.tone,
        },
        {
          label: "Recovery",
          value: "Use 127.0.0.1:6688 or pair a fresh relay offer",
          tone: input.connectionChip.tone === "ready" ? "preview" : "needs-action",
        },
      ],
    },
    review: {
      title: "Evidence / Review",
      summary: input.attentionAgents.length > 0 ? "Needs review attention" : "Receipts preview",
      tone: input.attentionAgents.length > 0 ? "needs-action" : "preview",
      lines: [
        {
          label: "Attention",
          value: attentionAgent
            ? attentionAgent.title || `${attentionAgent.provider} needs review`
            : "No review receipt yet",
          tone: attentionAgent ? "needs-action" : "preview",
        },
        {
          label: "Evidence",
          value: "Review receipts will land here",
          tone: "preview",
        },
        {
          label: "Validation",
          value: "Independent Review backend unavailable",
          tone: "unavailable",
        },
        {
          label: "Authority",
          value: "No completion claim without evidence",
          tone: "preview",
        },
      ],
    },
    settings: {
      title: "Settings / About",
      summary: "One Thoth identity and runtime guard",
      tone: "preview",
      lines: [
        {
          label: "Product",
          value: "One Thoth task control plane",
          tone: "ready",
        },
        {
          label: "Renderer",
          value: "OpenTUI native via Node 26.3+ FFI guard",
          tone: "preview",
        },
        {
          label: "Runtime boundary",
          value: "No Textual, no old plugin TUI, no hidden LLM API",
          tone: "ready",
        },
        {
          label: "Status",
          value: "Settings editing backend preview",
          tone: "preview",
        },
      ],
    },
  };
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
    const byCwd = workspaces
      .filter((workspace) => {
        const directory = workspace.workspaceDirectory ?? workspace.projectRootPath;
        return (
          isSameOrDescendantPath(cwd, directory) ||
          isSameOrDescendantPath(cwd, workspace.projectRootPath)
        );
      })
      .sort((left, right) => workspaceRootLength(right) - workspaceRootLength(left))[0];
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

function workspaceRootLength(workspace: ThothWorkspace): number {
  return path.resolve(workspace.workspaceDirectory ?? workspace.projectRootPath).length;
}

function isSameOrDescendantPath(candidate: string, root: string | null | undefined): boolean {
  if (!root) {
    return false;
  }
  const normalizedCandidate = path.resolve(candidate);
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
