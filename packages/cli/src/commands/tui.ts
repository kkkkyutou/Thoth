import type { Command } from "commander";
import {
  buildTuiSurfaceModel,
  buildTuiSurfaceLines,
  createNativeOpenTuiRenderer,
  getOpenTuiRendererRuntimeStatus,
  mountTuiSurface,
  type TuiSurfaceInput,
} from "@thoth/tui";
import { connectToDaemon, getDaemonHost } from "../utils/client.js";
import type { ConnectOptions } from "../utils/client.js";

export interface TuiCommandOptions extends ConnectOptions {
  exitAfterRenderMs?: string;
  screen?: string;
  width?: string;
  height?: string;
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
  const surfaceInput = await loadTuiSurfaceInput(options, cwd);
  const model = buildTuiSurfaceModel(surfaceInput);
  const exitAfterRenderMs = parseOptionalNonNegativeInteger(
    options.exitAfterRenderMs,
    "--exit-after-render-ms",
  );

  let resolveExit!: () => void;
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  const renderer = await createNativeOpenTuiRenderer({
    screenMode: normalizeScreenMode(options.screen),
    width: parseOptionalPositiveInteger(options.width, "--width"),
    height: parseOptionalPositiveInteger(options.height, "--height"),
    consoleMode: "disabled",
    useMouse: false,
    onDestroy: resolveExit,
  });

  const mount = mountTuiSurface(renderer, model);
  renderer.keyInput.on("keypress", (key: { name?: string; ctrl?: boolean; shift?: boolean }) => {
    const result = mount.handleKey(key);
    if (result === "exit") {
      renderer.destroy();
    }
  });

  renderer.start();
  renderer.requestRender();

  if (exitAfterRenderMs !== undefined) {
    setTimeout(() => {
      renderer.destroy();
    }, exitAfterRenderMs).unref();
  }

  await exited;

  if (options.printFinalFrame) {
    console.log(
      buildTuiSurfaceLines(model, { interaction: mount.getInteraction() })
        .map((line) => line.text)
        .join("\n"),
    );
  }
}

async function loadTuiSurfaceInput(
  options: Pick<TuiCommandOptions, "host" | "timeout">,
  cwd: string,
): Promise<TuiSurfaceInput> {
  const host = getDaemonHost({ host: options.host });
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
      terminalWidth: parseTerminalDimension(process.stdout.columns),
      terminalHeight: parseTerminalDimension(process.stdout.rows),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      connection: {
        status: "disconnected",
        reason: `Cannot connect to ${host}: ${message}`,
      },
      cwd,
      terminalWidth: parseTerminalDimension(process.stdout.columns),
      terminalHeight: parseTerminalDimension(process.stdout.rows),
    };
  } finally {
    await client?.close().catch(() => {});
  }
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
