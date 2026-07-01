import type { AgentPermissionRequest } from "./agent/agent-sdk-types.js";

export function isVoicePermissionAllowed(_request: AgentPermissionRequest): boolean {
  return false;
}
