#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";

import { MVP_VERSION } from "./mvp-release-contract.mjs";

const [releaseDate, ...paths] = process.argv.slice(2);
if (!releaseDate || paths.length === 0 || Number.isNaN(new Date(releaseDate).getTime())) {
  throw new Error(
    "Usage: node scripts/stamp-mvp-update-manifests.mjs <release-date-iso> <manifest>...",
  );
}

for (const path of paths) {
  const manifest = parse(readFileSync(path, "utf8")) ?? {};
  if (manifest.version !== MVP_VERSION) {
    throw new Error(`${path}: expected version ${MVP_VERSION}, got ${manifest.version}`);
  }
  writeFileSync(path, stringify({ ...manifest, releaseDate, rolloutHours: 0 }, { lineWidth: 0 }));
}
