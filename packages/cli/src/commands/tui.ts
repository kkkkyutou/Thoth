import type { Command } from "commander";
import {
  buildTuiSurfaceModel,
  buildTuiSurfaceLines,
  createNativeOpenTuiRenderer,
  getOpenTuiRendererRuntimeStatus,
  mountTuiSurface,
  type TuiInteractionState,
  type TuiPairingInput,
  type TuiSurfaceInput,
} from "@thoth/tui";
import { parseConnectionOfferFromUrl } from "@thoth/protocol/connection-offer";
import { connectToDaemon, getDaemonHost } from "../utils/client.js";
import type { ConnectOptions } from "../utils/client.js";

export interface TuiCommandOptions extends ConnectOptions {
  exitAfterRenderMs?: string;
  screen?: string;
  width?: string;
  height?: string;
  refreshAfterRenderMs?: string;
  registerWorkspaceAfterRenderMs?: string;
  providerSetupAfterRenderMs?: string;
  pairDeviceAfterRenderMs?: string;
  stressAfterRenderMs?: string;
  printFinalFrame?: boolean;
}

export function addTuiOptions(cmd: Command): Command {
  return cmd
    .description("Open the One Thoth terminal UI")
    .option("--screen <mode>", "OpenTUI screen mode: alternate or main", "alternate")
    .option("--width <columns>", "Fallback terminal width for non-TTY smoke runs")
    .option("--height <rows>", "Fallback terminal height for non-TTY smoke runs")
    .option(
      "--exit-after-render-ms <ms>",
      "Destroy the live OpenTUI renderer after a short delay for CLI smoke tests",
    )
    .option(
      "--refresh-after-render-ms <ms>",
      "Refresh the live daemon snapshot after a short delay for CLI smoke tests",
    )
    .option(
      "--register-workspace-after-render-ms <ms>",
      "Register the current pwd after a short delay for CLI smoke tests",
    )
    .option(
      "--provider-setup-after-render-ms <ms>",
      "Refresh provider readiness after a short delay for CLI smoke tests",
    )
    .option(
      "--pair-device-after-render-ms <ms>",
      "Create a safe daemon pairing offer after a short delay for CLI smoke tests",
    )
    .option(
      "--stress-after-render-ms <ms>",
      "Run route, composer, refresh, provider and pairing churn after a short delay for CLI smoke tests",
    )
    .option("--print-final-frame", "Print a plain-text final frame after renderer shutdown");
}

export async function runTuiCommand(options: TuiCommandOptions): Promise<void> {
  const runtimeStatus = getOpenTuiRendererRuntimeStatus();
  if (!runtimeStatus.available) {
    console.error(runtimeStatus.detail);
    console.error(runtimeStatus.recommendedAction);
    process.exitCode = 1;
    return;
  }

  const cwd = process.cwd();
  const terminalWidth = parseOptionalPositiveInteger(options.width, "--width");
  const terminalHeight = parseOptionalPositiveInteger(options.height, "--height");
  const surfaceInput = await loadTuiSurfaceInput(options, cwd, { terminalWidth, terminalHeight });
  const model = buildTuiSurfaceModel(surfaceInput);
  const exitAfterRenderMs = parseOptionalNonNegativeInteger(
    options.exitAfterRenderMs,
    "--exit-after-render-ms",
  );
  const refreshAfterRenderMs = parseOptionalNonNegativeInteger(
    options.refreshAfterRenderMs,
    "--refresh-after-render-ms",
  );
  const registerWorkspaceAfterRenderMs = parseOptionalNonNegativeInteger(
    options.registerWorkspaceAfterRenderMs,
    "--register-workspace-after-render-ms",
  );
  const providerSetupAfterRenderMs = parseOptionalNonNegativeInteger(
    options.providerSetupAfterRenderMs,
    "--provider-setup-after-render-ms",
  );
  const pairDeviceAfterRenderMs = parseOptionalNonNegativeInteger(
    options.pairDeviceAfterRenderMs,
    "--pair-device-after-render-ms",
  );
  const stressAfterRenderMs = parseOptionalNonNegativeInteger(
    options.stressAfterRenderMs,
    "--stress-after-render-ms",
  );

  let resolveExit!: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const renderer = await createNativeOpenTuiRenderer({
    screenMode: normalizeScreenMode(options.screen),
    width: terminalWidth,
    height: terminalHeight,
    consoleMode: "disabled",
    useMouse: false,
    onDestroy: resolveExit,
  });

  const mount = mountTuiSurface(renderer, model);
  let refreshInFlight = false;
  let workspaceRegistrationInFlight = false;
  let providerSetupInFlight = false;
  let devicePairingInFlight = false;

  async function refreshSurface(): Promise<void> {
    if (refreshInFlight) {
      mount.update({
        ...mount.getInteraction(),
        notice: "Refresh already running",
      });
      return;
    }
    refreshInFlight = true;
    mount.update({
      ...mount.getInteraction(),
      notice: "Refreshing daemon snapshot...",
    });
    try {
      const nextInput = await loadTuiSurfaceInput(options, cwd, { terminalWidth, terminalHeight });
      const nextModel = buildTuiSurfaceModel(nextInput);
      mount.updateModel(nextModel, {
        ...mount.getInteraction(),
        notice:
          nextInput.connection.status === "connected"
            ? "Refreshed daemon snapshot"
            : "Refresh failed; recovery state shown",
      });
    } finally {
      refreshInFlight = false;
    }
  }

  async function registerCurrentWorkspace(): Promise<void> {
    if (workspaceRegistrationInFlight) {
      mount.update({
        ...mount.getInteraction(),
        notice: "Workspace registration already running",
      });
      return;
    }
    if (mount.getModel().activeWorkspace.status === "ready") {
      mount.update({
        ...mount.getInteraction(),
        notice: "Current workspace is already registered",
      });
      return;
    }
    if (!cwd) {
      mount.update({
        ...mount.getInteraction(),
        notice: "Open Thoth TUI from a workspace directory first",
      });
      return;
    }

    workspaceRegistrationInFlight = true;
    mount.update({
      ...mount.getInteraction(),
      notice: "Registering current pwd as a Thoth workspace...",
    });
    let client: Awaited<ReturnType<typeof connectToDaemon>> | null = null;
    try {
      client = await connectToDaemon({ host: options.host, timeout: options.timeout ?? 5000 });
      const created = await client.createWorkspace({
        source: { kind: "directory", path: cwd },
      });
      if (!created.workspace || created.error) {
        mount.update({
          ...mount.getInteraction(),
          notice: `Workspace registration failed: ${created.error ?? "daemon returned no workspace"}`,
        });
        return;
      }

      const nextInput = await loadTuiSurfaceInput(options, cwd, { terminalWidth, terminalHeight });
      const nextModel = buildTuiSurfaceModel(nextInput);
      const label =
        created.workspace.projectDisplayName || created.workspace.name || created.workspace.id;
      mount.updateModel(nextModel, {
        ...mount.getInteraction(),
        activeRoute: "workspace",
        focus: { kind: "nav", route: "workspace" },
        notice: `Registered workspace ${label}`,
      });
    } catch (error) {
      const message = redactTuiConnectionMessage(
        error instanceof Error ? error.message : String(error),
      );
      mount.update({
        ...mount.getInteraction(),
        notice: `Workspace registration failed: ${message}`,
      });
    } finally {
      workspaceRegistrationInFlight = false;
      await client?.close().catch(() => {});
    }
  }

  function openProvidersInteraction(notice: string): TuiInteractionState {
    const interaction = mount.getInteraction();
    return {
      ...interaction,
      activeRoute: "providers",
      focus: { kind: "nav", route: "providers" },
      routeHistory:
        interaction.activeRoute === "providers"
          ? interaction.routeHistory
          : [...interaction.routeHistory, interaction.activeRoute],
      notice,
    };
  }

  async function refreshProviderReadiness(): Promise<void> {
    if (providerSetupInFlight) {
      mount.update(openProvidersInteraction("Provider readiness check already running"));
      return;
    }
    providerSetupInFlight = true;
    mount.update(openProvidersInteraction("Checking provider readiness from daemon..."));
    let client: Awaited<ReturnType<typeof connectToDaemon>> | null = null;
    try {
      client = await connectToDaemon({ host: options.host, timeout: options.timeout ?? 5000 });
      await client.refreshProvidersSnapshot({ cwd });
      const nextInput = await loadTuiSurfaceInput(options, cwd, { terminalWidth, terminalHeight });
      const nextModel = buildTuiSurfaceModel(nextInput);
      const providerChip = nextModel.statusChips.find((chip) => chip.label === "Provider");
      mount.updateModel(
        nextModel,
        openProvidersInteraction(
          providerChip?.tone === "ready"
            ? "Provider readiness refreshed from daemon"
            : "Provider snapshot refreshed; select a model before task loops",
        ),
      );
    } catch (error) {
      const message = redactTuiConnectionMessage(
        error instanceof Error ? error.message : String(error),
      );
      mount.update(openProvidersInteraction(`Provider readiness check failed: ${message}`));
    } finally {
      providerSetupInFlight = false;
      await client?.close().catch(() => {});
    }
  }

  function openConnectionsInteraction(notice: string): TuiInteractionState {
    const interaction = mount.getInteraction();
    return {
      ...interaction,
      activeRoute: "connections",
      focus: { kind: "nav", route: "connections" },
      routeHistory:
        interaction.activeRoute === "connections"
          ? interaction.routeHistory
          : [...interaction.routeHistory, interaction.activeRoute],
      notice,
    };
  }

  async function createDevicePairingOffer(): Promise<void> {
    if (devicePairingInFlight) {
      mount.update(openConnectionsInteraction("Device pairing offer already running"));
      return;
    }
    devicePairingInFlight = true;
    mount.update(openConnectionsInteraction("Creating safe daemon pairing offer..."));
    let client: Awaited<ReturnType<typeof connectToDaemon>> | null = null;
    try {
      client = await connectToDaemon({ host: options.host, timeout: options.timeout ?? 5000 });
      const offer = await client.getDaemonPairingOffer({ timeout: 5000 });
      const pairing = buildSafePairingInputFromOffer(offer);
      const nextInput = {
        ...(await loadTuiSurfaceInput(options, cwd, { terminalWidth, terminalHeight })),
        pairing,
      };
      const nextModel = buildTuiSurfaceModel(nextInput);
      mount.updateModel(
        nextModel,
        openConnectionsInteraction(
          pairing.status === "offer-ready"
            ? `Pairing offer ready for ${pairing.endpoint ?? "relay"}; credential hidden`
            : `Pairing offer failed: ${pairing.error ?? "unknown error"}`,
        ),
      );
    } catch (error) {
      const message = redactTuiConnectionMessage(
        error instanceof Error ? error.message : String(error),
      );
      const nextInput = {
        ...(await loadTuiSurfaceInput(options, cwd, { terminalWidth, terminalHeight })),
        pairing: { status: "failed", error: message } satisfies TuiPairingInput,
      };
      mount.updateModel(
        buildTuiSurfaceModel(nextInput),
        openConnectionsInteraction(`Pairing offer failed: ${message}`),
      );
    } finally {
      devicePairingInFlight = false;
      await client?.close().catch(() => {});
    }
  }

  async function handleMountResult(result: ReturnType<typeof mount.handleKey>): Promise<void> {
    if (result === "exit") {
      renderer.destroy();
    }
    if (result === "refresh") {
      await refreshSurface();
    }
    if (result === "registerWorkspace") {
      await registerCurrentWorkspace();
    }
    if (result === "providerSetup") {
      await refreshProviderReadiness();
    }
    if (result === "devicePairing") {
      await createDevicePairingOffer();
    }
  }

  function handleTuiKey(key: { name?: string; ctrl?: boolean; shift?: boolean }): void {
    const result = mount.handleKey(key);
    void handleMountResult(result);
  }

  async function runStressSequence(): Promise<void> {
    const keySequence: Array<{ name: string; ctrl?: boolean; shift?: boolean }> = [
      { name: "m" },
      { name: "c" },
      { name: "c" },
      { name: "l" },
      { name: "l" },
      { name: "tab" },
      { name: "return" },
      { name: "tab" },
      { name: "return" },
      { name: "tab" },
      { name: "return" },
      { name: "tab" },
      { name: "return" },
      { name: "tab" },
      { name: "return" },
      { name: "escape" },
      { name: "escape" },
      { name: "tab", shift: true },
      { name: "tab" },
    ];

    for (const key of keySequence) {
      await handleMountResult(mount.handleKey(key));
      await pause(20);
    }

    await refreshSurface();
    await refreshProviderReadiness();
    await createDevicePairingOffer();
    mount.update({
      ...mount.getInteraction(),
      activeRoute: "connections",
      focus: { kind: "nav", route: "connections" },
      notice: "Stress completed: route/focus/composer/provider/device churn",
    });
  }

  renderer.keyInput.on("keypress", handleTuiKey);

  renderer.start();
  renderer.requestRender();

  if (exitAfterRenderMs !== undefined) {
    setTimeout(() => {
      renderer.destroy();
    }, exitAfterRenderMs).unref();
  }
  if (refreshAfterRenderMs !== undefined) {
    setTimeout(() => {
      void refreshSurface();
    }, refreshAfterRenderMs).unref();
  }
  if (registerWorkspaceAfterRenderMs !== undefined) {
    setTimeout(() => {
      void registerCurrentWorkspace();
    }, registerWorkspaceAfterRenderMs).unref();
  }
  if (providerSetupAfterRenderMs !== undefined) {
    setTimeout(() => {
      void refreshProviderReadiness();
    }, providerSetupAfterRenderMs).unref();
  }
  if (pairDeviceAfterRenderMs !== undefined) {
    setTimeout(() => {
      void createDevicePairingOffer();
    }, pairDeviceAfterRenderMs).unref();
  }
  if (stressAfterRenderMs !== undefined) {
    setTimeout(() => {
      void runStressSequence();
    }, stressAfterRenderMs).unref();
  }

  await exited;

  if (options.printFinalFrame) {
    console.log(
      buildTuiSurfaceLines(mount.getModel(), { interaction: mount.getInteraction() })
        .map((line) => line.text)
        .join("\n"),
    );
  }
}

function buildSafePairingInputFromOffer(offer: {
  relayEnabled: boolean;
  url: string;
}): TuiPairingInput {
  if (!offer.relayEnabled || !offer.url) {
    return {
      status: "failed",
      error: "Relay pairing is disabled for this daemon",
    };
  }

  try {
    const parsed = parseConnectionOfferFromUrl(offer.url);
    if (!parsed) {
      return {
        status: "failed",
        error: "Daemon returned no pairing offer payload",
      };
    }
    return {
      status: "offer-ready",
      endpoint: parsed.relay.endpoint,
      expiresAt: parsed.pairingExpiresAt,
    };
  } catch (error) {
    return {
      status: "failed",
      error: redactTuiConnectionMessage(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function loadTuiSurfaceInput(
  options: Pick<TuiCommandOptions, "host" | "timeout">,
  cwd: string,
  terminal: { terminalWidth?: number; terminalHeight?: number } = {},
): Promise<TuiSurfaceInput> {
  const host = getDaemonHost({ host: options.host });
  const updatedAt = new Date().toISOString();
  let client: Awaited<ReturnType<typeof connectToDaemon>> | null = null;
  try {
    client = await connectToDaemon({ host: options.host, timeout: options.timeout ?? 5000 });
    const [workspaces, agents, providers] = await Promise.allSettled([
      client.fetchWorkspaces({ page: { limit: 100 } }),
      client.fetchAgents({ scope: "active", page: { limit: 100 } }),
      client.getProvidersSnapshot({ cwd }),
    ]);

    return {
      connection: { status: "connected" },
      workspaces: workspaces.status === "fulfilled" ? workspaces.value.entries : [],
      agents: agents.status === "fulfilled" ? agents.value.entries.map((entry) => entry.agent) : [],
      providers: providers.status === "fulfilled" ? providers.value : null,
      cwd,
      terminalWidth: terminal.terminalWidth ?? parseTerminalDimension(process.stdout.columns),
      terminalHeight: terminal.terminalHeight ?? parseTerminalDimension(process.stdout.rows),
      refresh: { status: "loaded", updatedAt },
    };
  } catch (error) {
    const message = redactTuiConnectionMessage(
      error instanceof Error ? error.message : String(error),
    );
    return {
      connection: {
        status: "disconnected",
        reason: `Cannot connect to ${describeHostForTui(host)}: ${message}`,
      },
      cwd,
      terminalWidth: terminal.terminalWidth ?? parseTerminalDimension(process.stdout.columns),
      terminalHeight: terminal.terminalHeight ?? parseTerminalDimension(process.stdout.rows),
      refresh: { status: "failed", updatedAt, error: message },
    };
  } finally {
    await client?.close().catch(() => {});
  }
}

function describeHostForTui(host: string): string {
  try {
    const offer = parseConnectionOfferFromUrl(host);
    if (offer) {
      return `relay pairing offer for ${offer.relay.endpoint}`;
    }
  } catch {
    // Not a relay offer URL.
  }
  try {
    const url = new URL(host);
    if (url.searchParams.has("password")) {
      url.searchParams.set("password", "<redacted>");
    }
    return url.toString();
  } catch {
    return host.replace(/password=[^&\s]+/gi, "password=<redacted>");
  }
}

function redactTuiConnectionMessage(message: string): string {
  return message
    .replace(/[#?&]?offer=[^&\s]+/gi, "offer <redacted>")
    .replace(/password=[^&\s]+/gi, "password=<redacted>")
    .replace(/pairingToken(?:[:=][^\s,]+)?/gi, "pairing token <redacted>")
    .replace(/thoth-relay-v3-client\.[^\s,]+/gi, "relay client token <redacted>")
    .replace(/thoth\.relay\.token\.[^\s,]+/gi, "relay token <redacted>");
}

function normalizeScreenMode(value: string | undefined): "alternate-screen" | "main-screen" {
  switch (value) {
    case undefined:
    case "alternate":
    case "alternate-screen":
      return "alternate-screen";
    case "main":
    case "main-screen":
      return "main-screen";
    default:
      throw new Error("--screen must be alternate or main");
  }
}

function parseTerminalDimension(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseOptionalPositiveInteger(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalNonNegativeInteger(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
