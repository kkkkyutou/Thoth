import { createHash } from "node:crypto";
import { chmod, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { app, BrowserWindow, shell } from "electron";
import {
  MvpUpdateManifestSchema,
  selectMvpUpdateAsset,
  type MvpUpdateAsset,
  type MvpUpdateManifest,
} from "@thoth/protocol/mvp-update";

export type AppReleaseChannel = "stable" | "beta";
export type AppUpdateCheckIntent = "automatic" | "manual";

export interface AppUpdateCheckResult {
  hasUpdate: boolean;
  readyToInstall: boolean;
  currentVersion: string;
  latestVersion: string;
  currentBuildId: string | null;
  latestBuildId: string | null;
  body: string | null;
  date: string | null;
  errorMessage: string | null;
}

export interface AppUpdateInstallResult {
  installed: boolean;
  version: string | null;
  message: string;
}

export interface AppUpdateProgress {
  phase: "checking" | "downloading" | "verifying" | "installing" | "complete" | "error";
  currentBuildId: string | null;
  latestBuildId: string | null;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  bytesPerSecond: number;
  error: string | null;
}

const MANIFEST_URL =
  "https://github.com/SeeleAI/Thoth/releases/download/v0.0.0-mvp-beta/MVP-UPDATE.json";
let cachedManifest: MvpUpdateManifest | null = null;
let cachedAsset: MvpUpdateAsset | null = null;
let activeAbortController: AbortController | null = null;
let currentProgress: AppUpdateProgress | null = null;

function emitProgress(progress: AppUpdateProgress): void {
  currentProgress = progress;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("thoth:event:app-update-progress", progress);
  }
}

async function readCurrentBuildId(): Promise<string | null> {
  if (!app.isPackaged) return "development";
  try {
    const parsed = JSON.parse(
      await readFile(path.join(process.resourcesPath, "build-identity.json"), "utf8"),
    ) as { commit?: unknown };
    return typeof parsed.commit === "string" && parsed.commit.trim() ? parsed.commit.trim() : null;
  } catch {
    return null;
  }
}

function chooseAsset(manifest: MvpUpdateManifest): MvpUpdateAsset | null {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") return null;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return selectMvpUpdateAsset({
    manifest,
    platform,
    arch,
    preferAppImage: platform === "linux" && Boolean(process.env.APPIMAGE),
  });
}

async function fetchManifest(): Promise<MvpUpdateManifest> {
  const response = await fetch(`${MANIFEST_URL}?build-check=${Date.now()}`, {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  });
  if (!response.ok) throw new Error(`Update manifest request failed: HTTP ${response.status}`);
  return MvpUpdateManifestSchema.parse(await response.json());
}

export function resolveUpdateDownloadDestination(input: {
  asset: MvpUpdateAsset;
  commit: string;
  tempPath: string;
  runningAppImage?: string;
}): string {
  if (input.asset.installStrategy === "appimage_replace" && input.runningAppImage) {
    return `${input.runningAppImage}.download-${input.commit}`;
  }
  return path.join(input.tempPath, `${input.commit}-${input.asset.name}`);
}

export function downloadedAssetMatches(input: {
  downloadedBytes: number;
  actualHash: string;
  asset: MvpUpdateAsset;
}): boolean {
  return input.downloadedBytes === input.asset.size && input.actualHash === input.asset.sha256;
}

export async function checkForAppUpdate({
  currentVersion,
}: {
  currentVersion: string;
  releaseChannel: AppReleaseChannel;
  intent: AppUpdateCheckIntent;
}): Promise<AppUpdateCheckResult> {
  const currentBuildId = await readCurrentBuildId();
  emitProgress({
    phase: "checking",
    currentBuildId,
    latestBuildId: null,
    downloadedBytes: 0,
    totalBytes: 0,
    percent: 0,
    bytesPerSecond: 0,
    error: null,
  });
  if (!app.isPackaged) {
    return {
      hasUpdate: false,
      readyToInstall: false,
      currentVersion,
      latestVersion: currentVersion,
      currentBuildId,
      latestBuildId: null,
      body: null,
      date: null,
      errorMessage: null,
    };
  }
  try {
    cachedManifest = await fetchManifest();
    cachedAsset = chooseAsset(cachedManifest);
    if (!cachedAsset)
      throw new Error(`No MVP update asset for ${process.platform}/${process.arch}`);
    const hasUpdate = currentBuildId !== cachedManifest.commit;
    return {
      hasUpdate,
      readyToInstall: false,
      currentVersion,
      latestVersion: cachedManifest.version,
      currentBuildId,
      latestBuildId: cachedManifest.commit,
      body: null,
      date: cachedManifest.publishedAt,
      errorMessage: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitProgress({
      phase: "error",
      currentBuildId,
      latestBuildId: null,
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      bytesPerSecond: 0,
      error: message,
    });
    return {
      hasUpdate: false,
      readyToInstall: false,
      currentVersion,
      latestVersion: currentVersion,
      currentBuildId,
      latestBuildId: null,
      body: null,
      date: null,
      errorMessage: message,
    };
  }
}

async function downloadAndVerify(
  asset: MvpUpdateAsset,
  manifest: MvpUpdateManifest,
): Promise<string> {
  const destination = resolveUpdateDownloadDestination({
    asset,
    commit: manifest.commit,
    tempPath: app.getPath("temp"),
    ...(process.env.APPIMAGE ? { runningAppImage: process.env.APPIMAGE } : {}),
  });
  await rm(destination, { force: true });
  const controller = new AbortController();
  activeAbortController = controller;
  const response = await fetch(`${asset.url}?build=${manifest.commit}`, {
    cache: "no-store",
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Update download failed: HTTP ${response.status}`);
  }
  const file = await open(destination, "w");
  const hash = createHash("sha256");
  const reader = response.body.getReader();
  const startedAt = Date.now();
  const currentBuildId = await readCurrentBuildId();
  let downloadedBytes = 0;
  let downloadError: unknown = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await file.write(value);
      hash.update(value);
      downloadedBytes += value.byteLength;
      const elapsedSeconds = Math.max(0.1, (Date.now() - startedAt) / 1000);
      emitProgress({
        phase: "downloading",
        currentBuildId,
        latestBuildId: manifest.commit,
        downloadedBytes,
        totalBytes: asset.size,
        percent: Math.min(100, (downloadedBytes / asset.size) * 100),
        bytesPerSecond: downloadedBytes / elapsedSeconds,
        error: null,
      });
    }
  } catch (error) {
    downloadError = error;
  } finally {
    await file.close();
    activeAbortController = null;
  }
  if (downloadError) {
    await rm(destination, { force: true });
    throw downloadError;
  }
  emitProgress({
    phase: "verifying",
    currentBuildId,
    latestBuildId: manifest.commit,
    downloadedBytes,
    totalBytes: asset.size,
    percent: 100,
    bytesPerSecond: 0,
    error: null,
  });
  const actualHash = hash.digest("hex");
  if (!downloadedAssetMatches({ downloadedBytes, actualHash, asset })) {
    await rm(destination, { force: true });
    throw new Error("Downloaded update failed size or SHA-256 verification.");
  }
  return destination;
}

async function installDownloaded(asset: MvpUpdateAsset, file: string): Promise<void> {
  if (asset.installStrategy === "open_dmg" || asset.installStrategy === "system_package") {
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
    app.quit();
    return;
  }
  if (asset.installStrategy === "nsis") {
    spawn(file, ["/S"], { detached: true, stdio: "ignore" }).unref();
    app.quit();
    return;
  }
  if (asset.installStrategy === "appimage_replace") {
    const target = process.env.APPIMAGE;
    if (!target) throw new Error("The running AppImage path is unavailable.");
    const backup = `${target}.previous`;
    await chmod(file, 0o755);
    await rm(backup, { force: true });
    await rename(target, backup);
    try {
      await rename(file, target);
    } catch (error) {
      await rename(backup, target).catch(() => undefined);
      throw error;
    }
    spawn(target, [], { detached: true, stdio: "ignore" }).unref();
    app.quit();
    return;
  }
  throw new Error(`Unsupported desktop install strategy: ${asset.installStrategy}`);
}

export async function downloadAndInstallUpdate(
  { currentVersion }: { currentVersion: string; releaseChannel: AppReleaseChannel },
  onBeforeQuit?: () => Promise<void>,
): Promise<AppUpdateInstallResult> {
  try {
    if (!cachedManifest || !cachedAsset) {
      const result = await checkForAppUpdate({
        currentVersion,
        releaseChannel: "beta",
        intent: "manual",
      });
      if (!result.hasUpdate || !cachedManifest || !cachedAsset) {
        return { installed: false, version: currentVersion, message: "No newer MVP build found." };
      }
    }
    const file = await downloadAndVerify(cachedAsset, cachedManifest);
    emitProgress({
      phase: "installing",
      currentBuildId: await readCurrentBuildId(),
      latestBuildId: cachedManifest.commit,
      downloadedBytes: cachedAsset.size,
      totalBytes: cachedAsset.size,
      percent: 100,
      bytesPerSecond: 0,
      error: null,
    });
    if (onBeforeQuit) await onBeforeQuit();
    await installDownloaded(cachedAsset, file);
    return { installed: true, version: cachedManifest.version, message: "Installing update." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitProgress({
      phase: "error",
      currentBuildId: await readCurrentBuildId(),
      latestBuildId: cachedManifest?.commit ?? null,
      downloadedBytes: 0,
      totalBytes: cachedAsset?.size ?? 0,
      percent: 0,
      bytesPerSecond: 0,
      error: message,
    });
    return { installed: false, version: currentVersion, message: `Update failed: ${message}` };
  }
}

export function cancelAppUpdate(): void {
  activeAbortController?.abort();
  activeAbortController = null;
}

export function getAppUpdateSnapshot(): AppUpdateProgress | null {
  return currentProgress ? { ...currentProgress } : null;
}
