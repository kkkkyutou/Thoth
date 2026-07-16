#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";

export function mergeMacUpdateManifest(arm64Path, x64Path, outputPath) {
  const arm64 = parse(readFileSync(arm64Path, "utf8"));
  const x64 = parse(readFileSync(x64Path, "utf8"));
  if (arm64.version !== x64.version) {
    throw new Error(`macOS update manifest versions differ: ${arm64.version} vs ${x64.version}`);
  }
  const files = [...(arm64.files ?? []), ...(x64.files ?? [])].filter(
    (file, index, all) => all.findIndex((entry) => entry.url === file.url) === index,
  );
  const output = stringify({ ...arm64, files }, { lineWidth: 0 });
  writeFileSync(outputPath, output);
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , arm64Path, x64Path, outputPath] = process.argv;
  if (!arm64Path || !x64Path || !outputPath) {
    throw new Error(
      "Usage: node scripts/merge-mac-update-manifest.mjs <arm64.yml> <x64.yml> <out.yml>",
    );
  }
  process.stdout.write(mergeMacUpdateManifest(arm64Path, x64Path, outputPath));
}
