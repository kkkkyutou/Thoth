import type { Logger } from "pino";
import type { ThothOpenAIConfig, ThothSpeechConfig } from "../bootstrap.js";

export interface SpeechReadinessState {
  enabled: boolean;
  available: boolean;
  message: string;
}

export interface SpeechFeatureReadiness {
  reasonCode: "disabled" | "model_download_in_progress";
  message: string;
}

export interface SpeechReadinessSnapshot {
  dictation: SpeechReadinessState;
  realtimeVoice: SpeechReadinessState;
  voiceFeature: SpeechFeatureReadiness;
}

export interface SpeechService {
  start(): void;
  stop(): void;
  getReadiness(): SpeechReadinessSnapshot;
  onReadinessChange(listener: (snapshot: SpeechReadinessSnapshot) => void): () => void;
  resolveStt(): null;
  resolveSttLanguage(): string;
  resolveTts(): null;
  resolveTurnDetection(): null;
  resolveDictationStt(): null;
  resolveDictationSttLanguage(): string;
}

export interface CreateSpeechServiceOptions {
  logger: Logger;
  openaiConfig?: ThothOpenAIConfig;
  speechConfig?: ThothSpeechConfig;
}

const DISABLED_MESSAGE = "Voice, speech and dictation are disabled in the current Thoth MVP.";

const DISABLED_READINESS: SpeechReadinessSnapshot = {
  dictation: {
    enabled: false,
    available: false,
    message: DISABLED_MESSAGE,
  },
  realtimeVoice: {
    enabled: false,
    available: false,
    message: DISABLED_MESSAGE,
  },
  voiceFeature: {
    reasonCode: "disabled",
    message: DISABLED_MESSAGE,
  },
};

export function createSpeechService(options: CreateSpeechServiceOptions): SpeechService {
  options.logger.debug("Speech runtime disabled for current Thoth MVP");
  return {
    start: () => {},
    stop: () => {},
    getReadiness: () => DISABLED_READINESS,
    onReadinessChange: () => () => {},
    resolveStt: () => null,
    resolveSttLanguage: () => "en",
    resolveTts: () => null,
    resolveTurnDetection: () => null,
    resolveDictationStt: () => null,
    resolveDictationSttLanguage: () => "en",
  };
}
