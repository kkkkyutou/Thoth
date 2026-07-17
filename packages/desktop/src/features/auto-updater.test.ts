import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
    isPackaged: true,
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  shell: { openPath: vi.fn() },
}));

import { downloadedAssetMatches, resolveUpdateDownloadDestination } from "./auto-updater.js";

const appImageAsset = {
  platform: "linux" as const,
  arch: "x64" as const,
  installStrategy: "appimage_replace" as const,
  name: "Thoth-x86_64.AppImage",
  url: "https://example.test/Thoth-x86_64.AppImage",
  size: 123,
  sha256: "a".repeat(64),
};

describe("MVP build updater", () => {
  it("downloads an AppImage beside the running binary for atomic replacement", () => {
    expect(
      resolveUpdateDownloadDestination({
        asset: appImageAsset,
        commit: "b".repeat(40),
        tempPath: "/tmp",
        runningAppImage: "/opt/Thoth.AppImage",
      }),
    ).toBe(`/opt/Thoth.AppImage.download-${"b".repeat(40)}`);
  });

  it("uses the system temp directory for installers that do not replace themselves", () => {
    expect(
      resolveUpdateDownloadDestination({
        asset: { ...appImageAsset, installStrategy: "system_package", name: "Thoth.deb" },
        commit: "c".repeat(40),
        tempPath: "/var/tmp",
        runningAppImage: "/opt/Thoth.AppImage",
      }),
    ).toBe(path.join("/var/tmp", `${"c".repeat(40)}-Thoth.deb`));
  });

  it("requires both exact byte size and SHA-256 before installation", () => {
    expect(
      downloadedAssetMatches({
        downloadedBytes: 123,
        actualHash: "a".repeat(64),
        asset: appImageAsset,
      }),
    ).toBe(true);
    expect(
      downloadedAssetMatches({
        downloadedBytes: 122,
        actualHash: "a".repeat(64),
        asset: appImageAsset,
      }),
    ).toBe(false);
    expect(
      downloadedAssetMatches({
        downloadedBytes: 123,
        actualHash: "d".repeat(64),
        asset: appImageAsset,
      }),
    ).toBe(false);
  });
});
