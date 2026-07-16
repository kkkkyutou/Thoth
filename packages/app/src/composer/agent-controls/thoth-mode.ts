import type {
  ThothRuntimeClarifyStrength,
  ThothRuntimeLoopStrength,
  ThothRuntimeMode,
} from "@thoth/protocol/thoth-runtime-contract";
import type { ThothComposerModel } from "@thoth/protocol/workspace-secretary/rpc-schemas";

type ThothModeConfig = {
  enabled?: boolean;
  mode?: string;
  clarifyStrength?: string;
  loopStrength?: string;
};

export type ThothClarifyStrength = Exclude<ThothRuntimeClarifyStrength, "auto" | "deep" | "none">;

const STRUCTURED_CLARIFY_STRENGTHS: readonly ThothClarifyStrength[] = ["light", "balanced", "dive"];

export function isThothModeEnabled(config: ThothModeConfig | null | undefined): boolean {
  if (config?.enabled !== undefined) {
    return config.enabled;
  }

  // Configs written before the explicit switch existed already represent a deliberate
  // Thoth choice when they carry a structured Clarify or Loop value. Empty legacy
  // config is the new product default: raw provider conversation.
  return (
    config?.mode === "loop" ||
    config?.clarifyStrength === "auto" ||
    config?.clarifyStrength === "light" ||
    config?.clarifyStrength === "balanced" ||
    config?.clarifyStrength === "dive"
  );
}

export function resolveThothClarifyStrength(value: unknown): ThothClarifyStrength {
  return STRUCTURED_CLARIFY_STRENGTHS.includes(value as ThothClarifyStrength)
    ? (value as ThothClarifyStrength)
    : "light";
}

export function resolveThothLoopStrength(value: unknown): ThothRuntimeLoopStrength {
  return value === "one_plan_one_do" ||
    value === "light" ||
    value === "balanced" ||
    value === "run_until_stopped"
    ? value
    : "one_plan_one_do";
}

export function buildWorkspaceSecretaryComposerModel(
  config: ThothModeConfig | null | undefined,
): ThothComposerModel {
  if (!isThothModeEnabled(config)) {
    return {
      mode: "quick",
      clarifyStrength: "none",
      loop: null,
      authorityLabel: "真实 provider",
      authorityReady: true,
    };
  }

  const mode: ThothRuntimeMode = config?.mode === "loop" ? "loop" : "quick";
  const loopStrength = resolveThothLoopStrength(config?.loopStrength);
  return {
    mode,
    clarifyStrength: resolveThothClarifyStrength(config?.clarifyStrength),
    loop: mode === "loop" ? loopStrength : null,
    authorityLabel: "真实 provider",
    authorityReady: true,
  };
}
