import { describe, expect, it } from "vitest";
import { MvpUpdateManifestSchema, selectMvpUpdateAsset } from "./mvp-update.js";

const manifest = MvpUpdateManifestSchema.parse({
  schemaVersion: 1,
  tag: "v0.0.0-mvp-beta",
  version: "0.0.0-mvp-beta",
  commit: "a".repeat(40),
  workflowRunId: "42",
  publishedAt: "2026-07-17T00:00:00.000Z",
  assets: [
    {
      platform: "linux",
      arch: "x64",
      installStrategy: "appimage_replace",
      name: "Thoth-x86_64.AppImage",
      url: "https://example.test/Thoth-x86_64.AppImage",
      size: 100,
      sha256: "b".repeat(64),
    },
    {
      platform: "linux",
      arch: "x64",
      installStrategy: "system_package",
      name: "Thoth-amd64.deb",
      url: "https://example.test/Thoth-amd64.deb",
      size: 150,
      sha256: "d".repeat(64),
    },
    {
      platform: "android",
      arch: "universal",
      installStrategy: "apk",
      name: "Thoth.apk",
      url: "https://example.test/Thoth.apk",
      size: 200,
      sha256: "c".repeat(64),
    },
  ],
});

describe("MVP build update manifest", () => {
  it("selects the running AppImage independently of semantic version", () => {
    expect(
      selectMvpUpdateAsset({ manifest, platform: "linux", arch: "x64", preferAppImage: true }),
    ).toMatchObject({ name: "Thoth-x86_64.AppImage", installStrategy: "appimage_replace" });
  });

  it("selects the system package when the app is not running as an AppImage", () => {
    expect(
      selectMvpUpdateAsset({ manifest, platform: "linux", arch: "x64", preferAppImage: false }),
    ).toMatchObject({ name: "Thoth-amd64.deb", installStrategy: "system_package" });
  });

  it("selects the universal Android APK", () => {
    expect(
      selectMvpUpdateAsset({ manifest, platform: "android", arch: "universal" }),
    ).toMatchObject({ name: "Thoth.apk", installStrategy: "apk" });
  });
});
