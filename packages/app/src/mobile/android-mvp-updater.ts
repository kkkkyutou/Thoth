import Constants from "expo-constants";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  MvpUpdateManifestSchema,
  selectMvpUpdateAsset,
  type MvpUpdateAsset,
} from "@thoth/protocol/mvp-update";

export interface AndroidMvpUpdateProgress {
  phase: "checking" | "up-to-date" | "downloading" | "verifying" | "installing" | "error";
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  error: string | null;
}

const MANIFEST_URL =
  "https://github.com/SeeleAI/Thoth/releases/download/v0.0.0-mvp-beta/MVP-UPDATE.json";

function currentBuildId(): string {
  const value = Constants.expoConfig?.extra?.buildCommit;
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

async function verifySha256(uri: string, asset: MvpUpdateAsset): Promise<void> {
  const file = new File(uri);
  const reader = file.readableStream().getReader();
  const digest = sha256.create();
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    digest.update(value);
    bytes += value.byteLength;
  }
  if (bytes !== asset.size || bytesToHex(digest.digest()) !== asset.sha256) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
    throw new Error("Downloaded APK failed size or SHA-256 verification.");
  }
}

export async function runAndroidMvpUpdate(
  onProgress: (progress: AndroidMvpUpdateProgress) => void,
): Promise<void> {
  const base = { downloadedBytes: 0, totalBytes: 0, percent: 0, error: null };
  onProgress({ phase: "checking", ...base });
  try {
    const response = await fetch(`${MANIFEST_URL}?build-check=${Date.now()}`, {
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
    });
    if (!response.ok) throw new Error(`Update manifest request failed: HTTP ${response.status}`);
    const manifest = MvpUpdateManifestSchema.parse(await response.json());
    if (manifest.commit === currentBuildId()) {
      onProgress({ phase: "up-to-date", ...base });
      return;
    }
    const asset = selectMvpUpdateAsset({
      manifest,
      platform: "android",
      arch: "universal",
    });
    if (!asset) throw new Error("Android APK is missing from the MVP update manifest.");
    const destination = `${FileSystem.cacheDirectory}${manifest.commit}-${asset.name}`;
    await FileSystem.deleteAsync(destination, { idempotent: true });
    const download = FileSystem.createDownloadResumable(
      `${asset.url}?build=${manifest.commit}`,
      destination,
      {},
      ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
        const totalBytes = totalBytesExpectedToWrite || asset.size;
        onProgress({
          phase: "downloading",
          downloadedBytes: totalBytesWritten,
          totalBytes,
          percent: Math.min(100, (totalBytesWritten / totalBytes) * 100),
          error: null,
        });
      },
    );
    const result = await download.downloadAsync();
    if (!result?.uri) throw new Error("APK download did not produce a local file.");
    onProgress({
      phase: "verifying",
      downloadedBytes: asset.size,
      totalBytes: asset.size,
      percent: 100,
      error: null,
    });
    await verifySha256(result.uri, asset);
    onProgress({
      phase: "installing",
      downloadedBytes: asset.size,
      totalBytes: asset.size,
      percent: 100,
      error: null,
    });
    const contentUri = await FileSystem.getContentUriAsync(result.uri);
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
      data: contentUri,
      type: "application/vnd.android.package-archive",
      flags: 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onProgress({ phase: "error", ...base, error: message });
    throw error;
  }
}
