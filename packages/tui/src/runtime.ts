const MINIMUM_NODE_MAJOR = 26;
const MINIMUM_NODE_MINOR = 3;
const MINIMUM_NODE_VERSION = "26.3.0";

export interface OpenTuiRendererRuntimeInput {
  runtimeName?: string;
  nodeVersion?: string | null;
  bunVersion?: string | null;
  execArgv?: readonly string[];
}

export type OpenTuiRendererRuntimeStatus =
  | {
      available: true;
      runtime: "bun" | "node";
      detail: string;
    }
  | {
      available: false;
      runtime: "node" | "unknown";
      reason: "node_version_too_old" | "node_ffi_flag_missing" | "unsupported_runtime";
      currentVersion: string | null;
      minimumNodeVersion: string;
      detail: string;
      recommendedAction: string;
    };

export function getOpenTuiRendererRuntimeStatus(
  input: OpenTuiRendererRuntimeInput = {},
): OpenTuiRendererRuntimeStatus {
  const runtimeName = input.runtimeName ?? process.release?.name ?? "unknown";
  const nodeVersion = input.nodeVersion ?? process.versions?.node ?? null;
  const bunVersion = input.bunVersion ?? readBunVersion();
  const execArgv = input.execArgv ?? process.execArgv ?? [];

  if (bunVersion) {
    return {
      available: true,
      runtime: "bun",
      detail: `OpenTUI native renderer can run under Bun ${bunVersion}.`,
    };
  }

  if (runtimeName !== "node") {
    return {
      available: false,
      runtime: "unknown",
      reason: "unsupported_runtime",
      currentVersion: nodeVersion,
      minimumNodeVersion: MINIMUM_NODE_VERSION,
      detail:
        "OpenTUI native renderer requires Bun or Node with experimental FFI enabled; this runtime is unsupported.",
      recommendedAction:
        "Run the first TUI spike before locking a non-Node runtime for packages/tui.",
    };
  }

  if (!nodeVersionAtLeast(nodeVersion, MINIMUM_NODE_MAJOR, MINIMUM_NODE_MINOR)) {
    return {
      available: false,
      runtime: "node",
      reason: "node_version_too_old",
      currentVersion: nodeVersion,
      minimumNodeVersion: MINIMUM_NODE_VERSION,
      detail: `OpenTUI native renderer is disabled for Node ${nodeVersion ?? "unknown"}; renderer creation needs Node ${MINIMUM_NODE_VERSION}+ with experimental FFI.`,
      recommendedAction:
        "Keep packages/tui in non-rendering mode on the locked Node 24 toolchain, or run the TUI spike to choose Bun versus a Node 26.3+ path.",
    };
  }

  if (!execArgv.includes("--experimental-ffi")) {
    return {
      available: false,
      runtime: "node",
      reason: "node_ffi_flag_missing",
      currentVersion: nodeVersion,
      minimumNodeVersion: MINIMUM_NODE_VERSION,
      detail:
        "OpenTUI native renderer is disabled because this Node process was not started with --experimental-ffi.",
      recommendedAction:
        "Start Node with --experimental-ffi after the TUI runtime decision is explicitly locked.",
    };
  }

  return {
    available: true,
    runtime: "node",
    detail: `OpenTUI native renderer can run under Node ${nodeVersion} with experimental FFI.`,
  };
}

function readBunVersion(): string | null {
  const runtimeGlobal = globalThis as { Bun?: { version?: string } };
  return runtimeGlobal.Bun?.version ?? null;
}

function nodeVersionAtLeast(
  value: string | null,
  minimumMajor: number,
  minimumMinor: number,
): boolean {
  if (!value) {
    return false;
  }
  const [majorText, minorText] = value.split(".");
  const major = Number.parseInt(majorText ?? "", 10);
  const minor = Number.parseInt(minorText ?? "", 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return false;
  }
  return major > minimumMajor || (major === minimumMajor && minor >= minimumMinor);
}
