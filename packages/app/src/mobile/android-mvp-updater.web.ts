export interface AndroidMvpUpdateProgress {
  phase: "checking" | "up-to-date" | "downloading" | "verifying" | "installing" | "error";
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  error: string | null;
}

export async function runAndroidMvpUpdate(
  onProgress: (progress: AndroidMvpUpdateProgress) => void,
): Promise<void> {
  const message = "Android updates are unavailable on this platform.";
  onProgress({
    phase: "error",
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
    error: message,
  });
  throw new Error(message);
}
