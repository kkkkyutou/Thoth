export interface DictationOverlayProps {
  volume: number;
  duration: number;
  isRecording: boolean;
  isProcessing: boolean;
  status: "idle" | "recording" | "processing" | "failed";
  errorText?: string;
  onCancel: () => void;
  onAccept: () => void;
  onAcceptAndSend: () => void;
  onRetry?: () => void;
  onDiscard?: () => void;
}

export function DictationOverlay(_props: DictationOverlayProps) {
  return null;
}
