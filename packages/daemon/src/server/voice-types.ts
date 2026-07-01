export interface VoiceSpeakInput {
  text: string;
  callerAgentId: string;
  signal?: AbortSignal;
}

export type VoiceSpeakHandler = (input: VoiceSpeakInput) => Promise<void>;

export interface VoiceCallerContext {
  enableVoiceTools?: boolean;
  lockedCwd?: string;
  allowCustomCwd?: boolean;
  childAgentDefaultLabels?: Record<string, string>;
}
