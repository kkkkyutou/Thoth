import type { ThothOpenAIConfig, ThothSpeechConfig } from "../bootstrap.js";
import type { PersistedConfig } from "../persisted-config.js";

export interface ResolveSpeechConfigInput {
  thothHome: string;
  env: NodeJS.ProcessEnv;
  persisted: PersistedConfig;
}

export interface ResolvedSpeechConfig {
  openai?: ThothOpenAIConfig;
  speech?: ThothSpeechConfig;
}

export function resolveSpeechConfig(_input: ResolveSpeechConfigInput): ResolvedSpeechConfig {
  return {
    openai: undefined,
    speech: {
      providers: {},
    },
  };
}
