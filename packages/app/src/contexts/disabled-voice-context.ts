export interface DisabledAudioPlaybackSource {
  size: number;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface DisabledVoiceAudioEngine {
  initialize: () => Promise<void>;
  stop: () => void;
  play: (source: DisabledAudioPlaybackSource) => Promise<void>;
}

export interface DisabledVoiceRuntime {
  registerSession: (session: {
    serverId: string;
    agentId: string;
    sendVoiceAudioChunk: (audioData: string, mimeType: string) => Promise<void>;
    audioPlayed: (chunkId: string) => Promise<void>;
  }) => () => void;
  updateSessionConnection: (serverId: string, isConnected: boolean) => void;
  onTurnEvent: (serverId: string, agentId: string, eventType: string) => void;
  handleAudioOutput: (serverId: string, payload: unknown) => void;
  shouldPlayVoiceAudio: (serverId: string) => boolean;
  onAssistantAudioStarted: (serverId: string) => void;
  onAssistantAudioFinished: (serverId: string) => void;
  onTranscriptionResult: (serverId: string, transcript: string) => void;
  onServerSpeechStateChanged: (serverId: string, isSpeaking: boolean) => void;
}

export interface DisabledVoiceController {
  isMuted: boolean;
  isVoiceSwitching: boolean;
  isVoiceModeForAgent: (serverId: string, agentId: string) => boolean;
  startVoice: (serverId: string, agentId: string) => Promise<unknown>;
  stopVoice: () => Promise<unknown>;
  toggleMute: () => void;
}

export function useVoiceOptional(): DisabledVoiceController | null {
  return null;
}

export function useVoiceRuntimeOptional(): DisabledVoiceRuntime | null {
  return null;
}

export function useVoiceAudioEngineOptional(): DisabledVoiceAudioEngine | null {
  return null;
}
