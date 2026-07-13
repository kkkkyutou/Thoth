import type { AgentProvider } from "./agent-sdk-types.js";
import { PROVIDER_RUNTIME_SESSION_ADAPTERS } from "./providers/runtime-session-adapters.js";

export interface ProviderRuntimeSession {
  home: string | null;
  env: Record<string, string>;
}

export interface ProviderRuntimeSessionAdapter {
  readonly provider: AgentProvider;
  prepare(input: { thothHome: string; sessionId: string }): ProviderRuntimeSession;
  environment(sessionHome: string | null): Record<string, string>;
}

function findRuntimeSessionAdapter(provider: AgentProvider): ProviderRuntimeSessionAdapter | null {
  return PROVIDER_RUNTIME_SESSION_ADAPTERS.find((adapter) => adapter.provider === provider) ?? null;
}

/**
 * Provider-specific process setup belongs behind this boundary. Callers may persist `home` as
 * opaque resume metadata, but must not infer its format or use it as task authority.
 */
export function prepareProviderRuntimeSession(input: {
  provider: AgentProvider;
  thothHome: string;
  sessionId: string;
}): ProviderRuntimeSession {
  return findRuntimeSessionAdapter(input.provider)?.prepare(input) ?? { home: null, env: {} };
}

export function providerRuntimeSessionEnvironment(
  provider: AgentProvider,
  sessionHome: string | undefined,
): Record<string, string> {
  return findRuntimeSessionAdapter(provider)?.environment(sessionHome ?? null) ?? {};
}
