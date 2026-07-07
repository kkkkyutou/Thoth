import type { AgentFeature } from "@thoth/protocol/agent-types";
import type { MutableDaemonConfigPatch } from "@thoth/protocol/messages";

export interface WorkspaceSecretaryProviderSessionInput {
  provider: string | null | undefined;
  model?: string | null | undefined;
  modeId?: string | null | undefined;
  thinkingOptionId?: string | null | undefined;
  features?: AgentFeature[] | undefined;
  featureValues?: Record<string, unknown> | undefined;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function readAgentFeatureValues(
  features: AgentFeature[] | undefined,
): Record<string, unknown> | undefined {
  if (!features || features.length === 0) {
    return undefined;
  }

  const values = Object.fromEntries(features.map((feature) => [feature.id, feature.value]));
  return Object.keys(values).length > 0 ? values : undefined;
}

export function buildWorkspaceSecretaryProviderSessionPatch(
  input: WorkspaceSecretaryProviderSessionInput,
): MutableDaemonConfigPatch | null {
  const provider = nonEmpty(input.provider);
  if (!provider) {
    return null;
  }

  const model = nonEmpty(input.model);
  const modeId = nonEmpty(input.modeId);
  const thinkingOptionId = nonEmpty(input.thinkingOptionId);
  const featureValues = input.featureValues ?? readAgentFeatureValues(input.features);

  return {
    workspaceSecretary: {
      providerSession: {
        provider,
        ...(model ? { model } : {}),
        ...(modeId ? { modeId } : {}),
        ...(thinkingOptionId ? { thinkingOptionId } : {}),
        ...(featureValues ? { featureValues } : {}),
      },
    },
  };
}
