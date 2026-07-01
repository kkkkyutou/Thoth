export interface UseDictationInput {
  client: unknown;
  onTranscript: (text: string) => void;
  onError: (error: Error) => void;
  canStart: () => boolean;
  canConfirm: () => boolean;
  enableDuration?: boolean;
}

export type DictationStatus = "idle" | "recording" | "processing" | "failed";

export function useDictation(_input: UseDictationInput) {
  return {
    isRecording: false,
    isProcessing: false,
    partialTranscript: "",
    volume: 0,
    duration: 0,
    error: null as string | null,
    status: "idle" as DictationStatus,
    startDictation: async () => {},
    cancelDictation: async () => {},
    confirmDictation: async () => {},
    retryFailedDictation: () => {},
    discardFailedDictation: () => {},
  };
}
