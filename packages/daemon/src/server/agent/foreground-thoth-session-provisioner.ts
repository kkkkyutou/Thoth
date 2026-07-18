import type { AgentProvider, AgentSessionConfig } from "./agent-sdk-types.js";
import { prepareProviderRuntimeSession } from "./provider-runtime-session.js";
import { withThothRuntimeTools } from "./thoth-runtime-tools-config.js";
import { loadRuntimeSkillArtifact, mountRuntimeSkillForSession } from "@thoth/drivers/clarify";

export interface ForegroundThothSessionProvisionInput {
  agentId: string;
  config: AgentSessionConfig;
}

export type ForegroundThothSessionProvisioner = (
  input: ForegroundThothSessionProvisionInput,
) => Promise<AgentSessionConfig> | AgentSessionConfig;

export function provisionForegroundThothSession(input: {
  agentId: string;
  config: AgentSessionConfig;
  thothHome: string;
  supportsNativeThothTools: boolean;
  runtimeSessionProvider?: AgentProvider;
}): AgentSessionConfig {
  if (input.config.internal === true || !input.supportsNativeThothTools) {
    return input.config;
  }

  const sessionId = input.agentId;
  const runtimeSession = prepareProviderRuntimeSession({
    provider: input.runtimeSessionProvider ?? input.config.provider,
    thothHome: input.thothHome,
    sessionId,
  });
  mountRuntimeSkillForSession({
    artifact: loadRuntimeSkillArtifact("thoth.clarify"),
    thothSessionHome: input.thothHome,
    sessionId,
  });

  return withThothRuntimeTools(input.config, {
    enabled: true,
    scope: "clarify",
    ...(runtimeSession.home ? { sessionHome: runtimeSession.home } : {}),
  });
}
