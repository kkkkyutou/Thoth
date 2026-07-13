import type { AgentMetadata } from "./agent-sdk-types.js";

export type ThothRuntimeToolScope =
  | "clarify"
  | "clarify_audit"
  | "contract_audit"
  | "loop_planexec"
  | "loop_review";

export interface ThothRuntimeToolsConfig {
  enabled: true;
  scope: ThothRuntimeToolScope;
  sessionHome?: string;
}

export interface ReadThothRuntimeToolsOptions {
  /**
   * Older Loop records stored one boolean for both phases. A live phase label
   * is the only safe source for selecting its semantic tool surface.
   */
  legacyLoopScope?: "loop_planexec" | "loop_review";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toRuntimeConfig(input: {
  scope?: unknown;
  sessionHome?: unknown;
}): ThothRuntimeToolsConfig | null {
  if (typeof input.scope !== "string") {
    return null;
  }
  const scopes: readonly ThothRuntimeToolScope[] = [
    "clarify",
    "clarify_audit",
    "contract_audit",
    "loop_planexec",
    "loop_review",
  ];
  if (!scopes.includes(input.scope as ThothRuntimeToolScope)) {
    return null;
  }
  const sessionHome = typeof input.sessionHome === "string" ? input.sessionHome.trim() : "";
  return {
    enabled: true,
    scope: input.scope as ThothRuntimeToolScope,
    ...(sessionHome ? { sessionHome } : {}),
  };
}

/**
 * Reads the provider-neutral runtime-tool contract. The nested Codex fields
 * are deliberately parse-only compatibility for persisted pre-migration
 * sessions; all new writes use `extra.thothRuntimeTools`.
 */
export function readThothRuntimeToolsConfig(
  config: { extra?: unknown | null },
  options: ReadThothRuntimeToolsOptions = {},
): ThothRuntimeToolsConfig | null {
  const extra = readRecord(config.extra);
  const runtime = readRecord(extra?.thothRuntimeTools);
  if (runtime) {
    return runtime.enabled === true ? toRuntimeConfig(runtime) : null;
  }
  const legacyCodex = readRecord(extra?.codex);
  if (!legacyCodex) {
    return null;
  }
  const sessionHome = legacyCodex.thothLoopSessionHome;
  if (legacyCodex.thothClarifyRuntimeTools === true) {
    return toRuntimeConfig({ scope: "clarify", sessionHome });
  }
  if (legacyCodex.thothClarifyAuditRuntimeTools === true) {
    return toRuntimeConfig({ scope: "clarify_audit", sessionHome });
  }
  if (legacyCodex.thothContractAuditRuntimeTools === true) {
    return toRuntimeConfig({ scope: "contract_audit", sessionHome });
  }
  if (legacyCodex.thothLoopRuntimeTools === true) {
    const phase = legacyCodex.thothLoopPhase;
    const scope =
      phase === "review"
        ? "loop_review"
        : phase === "planexec"
          ? "loop_planexec"
          : (options.legacyLoopScope ?? "loop_planexec");
    return toRuntimeConfig({ scope, sessionHome });
  }
  return null;
}

export function withThothRuntimeTools<T>(
  config: T & { extra?: AgentMetadata | null },
  runtime: ThothRuntimeToolsConfig,
): Omit<T, "extra"> & { extra: AgentMetadata } {
  const extra: AgentMetadata = {
    ...(config.extra ?? {}),
    thothRuntimeTools: {
      enabled: true,
      scope: runtime.scope,
      ...(runtime.sessionHome ? { sessionHome: runtime.sessionHome } : {}),
    },
  };
  return { ...config, extra };
}
