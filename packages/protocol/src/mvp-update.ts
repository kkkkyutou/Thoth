import { z } from "zod";

export const MvpUpdateAssetSchema = z.object({
  platform: z.enum(["darwin", "win32", "linux", "android"]),
  arch: z.enum(["x64", "arm64", "universal"]),
  installStrategy: z.enum(["open_dmg", "nsis", "appimage_replace", "system_package", "apk"]),
  name: z.string().min(1),
  url: z.string().url(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const MvpUpdateManifestSchema = z.object({
  schemaVersion: z.literal(1),
  tag: z.literal("v0.0.0-mvp-beta"),
  version: z.literal("0.0.0-mvp-beta"),
  commit: z.string().regex(/^[a-f0-9]{40}$/u),
  workflowRunId: z.string().min(1),
  publishedAt: z.string().datetime(),
  assets: z.array(MvpUpdateAssetSchema).min(1),
});

export type MvpUpdateAsset = z.infer<typeof MvpUpdateAssetSchema>;
export type MvpUpdateManifest = z.infer<typeof MvpUpdateManifestSchema>;

export function selectMvpUpdateAsset(input: {
  manifest: MvpUpdateManifest;
  platform: MvpUpdateAsset["platform"];
  arch: "x64" | "arm64" | "universal";
  preferAppImage?: boolean;
}): MvpUpdateAsset | null {
  const candidates = input.manifest.assets.filter(
    (asset) =>
      asset.platform === input.platform &&
      (asset.arch === input.arch || asset.arch === "universal"),
  );
  if (input.platform === "linux" && input.preferAppImage) {
    return candidates.find((asset) => asset.installStrategy === "appimage_replace") ?? null;
  }
  if (input.platform === "linux" && input.preferAppImage === false) {
    return candidates.find((asset) => asset.installStrategy === "system_package") ?? null;
  }
  return candidates[0] ?? null;
}
