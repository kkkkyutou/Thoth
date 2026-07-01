export interface UseIsDictationReadyInput {
  serverId: string;
  isConnected: boolean;
  agentDirectoryStatus: unknown;
}

export function useIsDictationReady(_input: UseIsDictationReadyInput): boolean {
  return false;
}
