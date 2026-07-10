export function shouldSeedEmptyWorkspaceDraft(input: {
  isRouteFocused: boolean;
  hasPersistenceKey: boolean;
  hasWorkspaceDirectory: boolean;
  hasHydratedWorkspaceLayoutStore: boolean;
  hasHydratedAgents: boolean;
  hasCheckedHistoricalAgents: boolean;
  hasLoadedTerminals: boolean;
  activeAgentCount: number;
  restorableAgentCount: number;
  terminalCount: number;
  tabCount: number;
}): boolean {
  if (
    !input.isRouteFocused ||
    !input.hasPersistenceKey ||
    !input.hasWorkspaceDirectory ||
    !input.hasHydratedWorkspaceLayoutStore ||
    !input.hasHydratedAgents ||
    !input.hasCheckedHistoricalAgents ||
    !input.hasLoadedTerminals
  ) {
    return false;
  }

  return (
    input.activeAgentCount === 0 &&
    input.restorableAgentCount === 0 &&
    input.terminalCount === 0 &&
    input.tabCount === 0
  );
}
