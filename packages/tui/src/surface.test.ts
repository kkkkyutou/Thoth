import { describe, expect, test } from "vitest";
import type {
  ConnectionState,
  ThothAgent,
  ThothProviderSnapshotResult,
  ThothWorkspace,
} from "@thoth/client";
import { buildTuiSurfaceModel, deriveTuiLayout } from "./surface.js";

const connected: ConnectionState = { status: "connected" };

function workspace(input: Partial<ThothWorkspace> = {}): ThothWorkspace {
  return {
    id: "workspace_1",
    projectId: "project_1",
    projectDisplayName: "Thoth Repo",
    projectRootPath: "/repo/thoth",
    workspaceDirectory: "/repo/thoth",
    projectKind: "git",
    workspaceKind: "directory",
    name: "thoth",
    archivingAt: null,
    status: "done",
    statusEnteredAt: null,
    activityAt: "2026-07-02T00:00:00.000Z",
    scripts: [],
    gitRuntime: null,
    githubRuntime: null,
    ...input,
  };
}

function providerSnapshot(
  input: Partial<ThothProviderSnapshotResult> = {},
): ThothProviderSnapshotResult {
  return {
    entries: [
      {
        provider: "codex",
        status: "ready",
        enabled: true,
        label: "Codex",
        models: [{ provider: "codex", id: "gpt-5", label: "GPT-5" }],
      },
    ],
    generatedAt: "2026-07-02T00:00:00.000Z",
    requestId: "providers_1",
    ...input,
  };
}

function agent(input: Partial<ThothAgent> = {}): ThothAgent {
  return {
    id: "agent_1",
    provider: "codex",
    cwd: "/repo/thoth",
    workspaceId: "workspace_1",
    model: "gpt-5",
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    lastUserMessageAt: null,
    status: "running",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: false,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsRewindBoth: false,
      supportsRewindConversation: false,
      supportsRewindFiles: false,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
    archivedAt: null,
    ...input,
  };
}

describe("buildTuiSurfaceModel", () => {
  test("shows honest setup states without inventing task authority", () => {
    const model = buildTuiSurfaceModel({
      connection: { status: "idle" },
      terminalWidth: 72,
      terminalHeight: 20,
    });

    expect(model.activeRoute).toBe("home");
    expect(model.activeWorkspace).toMatchObject({
      id: null,
      label: "Needs a registered workspace",
      status: "needs-workspace",
    });
    expect(model.statusChips).toEqual(
      expect.arrayContaining([
        { label: "Host", value: "Needs host", tone: "needs-action" },
        { label: "Snapshot", value: "Startup snapshot", tone: "preview" },
        { label: "Provider", value: "Select model first", tone: "needs-action" },
        { label: "Review", value: "Preview surface", tone: "preview" },
      ]),
    );
    expect(model.taskSlots).toEqual(
      expect.arrayContaining([
        { id: "active-task", title: "Active task", value: "No frozen task yet", tone: "preview" },
        { id: "contract", title: "Contract", value: "Needs provider", tone: "needs-action" },
      ]),
    );
    expect(model.nextActions).toEqual(
      expect.arrayContaining([
        {
          key: "W",
          label: "Register workspace",
          value: "Open TUI from a workspace directory",
          tone: "preview",
        },
        {
          key: "P",
          label: "Provider setup",
          value: "Refresh provider readiness from daemon",
          tone: "needs-action",
        },
      ]),
    );
  });

  test("exposes refresh state without hiding disconnected recovery", () => {
    const model = buildTuiSurfaceModel({
      connection: { status: "disconnected", reason: "Cannot connect to relay pairing offer" },
      cwd: "/repo/thoth",
      refresh: {
        status: "failed",
        updatedAt: "2026-07-02T12:00:00.000Z",
        error: "WebSocket closed before daemon snapshot loaded",
      },
    });

    expect(model.refresh).toEqual({
      value: "Refresh failed 2026-07-02T12:00:00.000Z",
      tone: "needs-action",
      error: "WebSocket closed before daemon snapshot loaded",
    });
    expect(model.statusChips).toEqual(
      expect.arrayContaining([
        {
          label: "Snapshot",
          value: "Refresh failed 2026-07-02T12:00:00.000Z",
          tone: "needs-action",
        },
      ]),
    );
    expect(model.nextActions).toEqual([
      {
        key: "R",
        label: "Retry snapshot",
        value: "Reconnect to direct daemon or fresh relay offer",
        tone: "needs-action",
      },
      {
        key: "Host",
        label: "Start daemon",
        value: "Use Thoth daemon on 127.0.0.1:6688",
        tone: "needs-action",
      },
    ]);
  });

  test("selects workspace and provider readiness from shared daemon/client shapes", () => {
    const model = buildTuiSurfaceModel({
      connection: connected,
      workspaces: [workspace()],
      providers: providerSnapshot(),
      selectedWorkspaceId: "workspace_1",
      relayPaired: true,
      terminalWidth: 144,
      terminalHeight: 40,
    });

    expect(model.activeRoute).toBe("workspace");
    expect(model.activeWorkspace).toMatchObject({
      id: "workspace_1",
      label: "Thoth Repo",
      cwd: "/repo/thoth",
      status: "ready",
    });
    expect(model.navigation.find((item) => item.id === "providers")).toMatchObject({
      tone: "ready",
      badge: "Available",
    });
    expect(model.navigation.find((item) => item.id === "connections")).toMatchObject({
      tone: "ready",
      badge: "Paired",
    });
  });

  test("selects the registered workspace when cwd is a descendant", () => {
    const model = buildTuiSurfaceModel({
      connection: connected,
      workspaces: [workspace()],
      cwd: "/repo/thoth/packages/tui",
    });

    expect(model.activeRoute).toBe("workspace");
    expect(model.activeWorkspace).toMatchObject({
      id: "workspace_1",
      label: "Thoth Repo",
      cwd: "/repo/thoth",
      status: "ready",
    });
  });

  test("prefers the most specific registered workspace for descendant cwd", () => {
    const model = buildTuiSurfaceModel({
      connection: connected,
      workspaces: [
        workspace({
          id: "workspace_parent",
          projectDisplayName: "YZY",
          name: "yzy",
          projectRootPath: "/repo",
          workspaceDirectory: "/repo",
        }),
        workspace({
          id: "workspace_child",
          projectDisplayName: "Thoth Repo",
          name: "thoth",
          projectRootPath: "/repo/thoth",
          workspaceDirectory: "/repo/thoth",
        }),
      ],
      cwd: "/repo/thoth/packages/tui",
    });

    expect(model.activeWorkspace).toMatchObject({
      id: "workspace_child",
      label: "Thoth Repo",
      cwd: "/repo/thoth",
      status: "ready",
    });
  });

  test("does not fall back to an unrelated workspace when cwd is unregistered", () => {
    const model = buildTuiSurfaceModel({
      connection: connected,
      workspaces: [workspace()],
      cwd: "/tmp/unregistered-thoth-workspace",
    });

    expect(model.activeRoute).toBe("home");
    expect(model.activeWorkspace).toMatchObject({
      id: null,
      label: "Needs a registered workspace",
      cwd: "/tmp/unregistered-thoth-workspace",
      status: "needs-workspace",
    });
    expect(model.nextActions).toEqual(
      expect.arrayContaining([
        {
          key: "W",
          label: "Register workspace",
          value: "Create daemon workspace for current pwd",
          tone: "needs-action",
        },
      ]),
    );
  });

  test("treats provider sessions as runtime evidence without claiming frozen tasks", () => {
    const model = buildTuiSurfaceModel({
      connection: connected,
      workspaces: [workspace()],
      providers: providerSnapshot(),
      agents: [agent({ title: "Check workspace state" })],
    });

    expect(model.navigation.find((item) => item.id === "tasks")).toMatchObject({
      tone: "running",
      badge: "1 running",
    });
    expect(model.taskSlots.find((slot) => slot.id === "active-task")).toMatchObject({
      value: "Check workspace state",
      tone: "running",
    });
    expect(model.taskSlots.find((slot) => slot.id === "contract")).toMatchObject({
      value: "Needs Clarify session",
      tone: "preview",
    });
  });

  test("builds route detail panels from real surface inputs", () => {
    const model = buildTuiSurfaceModel({
      connection: connected,
      workspaces: [workspace()],
      providers: providerSnapshot({
        entries: [
          {
            provider: "codex",
            status: "ready",
            enabled: true,
            label: "Codex",
            models: [
              {
                provider: "codex",
                id: "gpt-5",
                label: "GPT-5",
                thinkingOptions: [{ id: "high", label: "High" }],
              },
            ],
          },
          {
            provider: "claude",
            status: "error",
            enabled: true,
            label: "Claude",
            error: "Not logged in",
          },
        ],
      }),
      agents: [
        agent({
          title: "Review permission",
          requiresAttention: true,
          attentionReason: "permission",
        }),
      ],
      relayPaired: false,
      refresh: { status: "loaded", updatedAt: "2026-07-02T12:00:00.000Z" },
    });

    expect(model.routeDetails.providers).toMatchObject({
      title: "Providers",
      summary: "Provider session source available",
      tone: "ready",
    });
    expect(model.routeDetails.providers.lines).toEqual(
      expect.arrayContaining([
        { label: "Codex", value: "ready, 1 models, first GPT-5", tone: "ready" },
        { label: "Claude", value: "error", tone: "needs-action" },
      ]),
    );
    expect(model.routeDetails.connections.lines).toEqual(
      expect.arrayContaining([
        { label: "Direct daemon", value: "Connected", tone: "ready" },
        { label: "Relay", value: "Fresh pairing supported", tone: "preview" },
      ]),
    );
    expect(model.routeDetails.review.lines).toEqual(
      expect.arrayContaining([
        { label: "Attention", value: "Review permission", tone: "needs-action" },
        {
          label: "Validation",
          value: "Independent Review backend unavailable",
          tone: "unavailable",
        },
      ]),
    );
    expect(model.routeDetails.settings.lines).toEqual(
      expect.arrayContaining([
        { label: "Product", value: "One Thoth task control plane", tone: "ready" },
        {
          label: "Runtime boundary",
          value: "No Textual, no old plugin TUI, no hidden LLM API",
          tone: "ready",
        },
      ]),
    );
    expect(model.nextActions).toEqual(
      expect.arrayContaining([
        {
          key: "D",
          label: "Pair device",
          value: "Create safe daemon pairing offer",
          tone: "preview",
        },
        {
          key: "R",
          label: "Refresh",
          value: "Reload daemon snapshot",
          tone: "preview",
        },
      ]),
    );
    expect(model.nextActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "W",
        }),
      ]),
    );
  });

  test("surfaces safe pairing offer details without credential material", () => {
    const model = buildTuiSurfaceModel({
      connection: connected,
      workspaces: [workspace()],
      pairing: {
        status: "offer-ready",
        endpoint: "relay.test.thoth.seeles.ai:443",
        expiresAt: "2026-07-02T13:00:00.000Z",
      },
      refresh: { status: "loaded", updatedAt: "2026-07-02T12:00:00.000Z" },
    });
    const renderedModelText = JSON.stringify(model);

    expect(model.statusChips).toEqual(
      expect.arrayContaining([{ label: "Relay", value: "Pairing offer ready", tone: "ready" }]),
    );
    expect(model.navigation.find((item) => item.id === "connections")).toMatchObject({
      tone: "ready",
      badge: "Offer ready",
    });
    expect(model.routeDetails.connections).toMatchObject({
      title: "Connections / Devices",
      summary: "Pairing offer ready",
      tone: "ready",
    });
    expect(model.routeDetails.connections.lines).toEqual(
      expect.arrayContaining([
        { label: "Pairing endpoint", value: "relay.test.thoth.seeles.ai:443", tone: "ready" },
        { label: "Pairing expiry", value: "2026-07-02T13:00:00.000Z", tone: "ready" },
        {
          label: "Credential safety",
          value: "Offer URL, QR and tokens are kept out of the TUI frame",
          tone: "ready",
        },
      ]),
    );
    expect(model.nextActions).toEqual(
      expect.arrayContaining([
        {
          key: "D",
          label: "Pair device",
          value: "Refresh safe daemon pairing offer",
          tone: "ready",
        },
      ]),
    );
    expect(renderedModelText).not.toMatch(/offer=|#offer=|pairingToken|thoth-relay-v3-client\./);
  });
});

describe("deriveTuiLayout", () => {
  test("uses a compact layout for narrow terminals", () => {
    expect(deriveTuiLayout(72, 24)).toMatchObject({
      mode: "compact",
      sidebarWidth: 0,
      showPreviewColumn: false,
    });
  });

  test("uses split layout and a preview column for wide terminals", () => {
    expect(deriveTuiLayout(144, 40)).toMatchObject({
      mode: "split",
      sidebarWidth: 28,
      showPreviewColumn: true,
    });
  });
});
