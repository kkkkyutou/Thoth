#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const defaultConfigDir = join(repoRoot, ".dev", "gh");
const configDir = process.env.THOTH_GH_CONFIG_DIR
  ? resolve(repoRoot, process.env.THOTH_GH_CONFIG_DIR)
  : defaultConfigDir;

function printUsage() {
  console.log(`Usage:
  npm run gh -- <gh args>

Examples:
  npm run gh -- auth status --hostname github.com
  npm run gh -- api user
  npm run gh -- repo view SeeleAI/Code4Agent

This wrapper forces GH_CONFIG_DIR to:
  ${configDir}

It does not read, print, or store tokens itself. To log in locally:
  printf '%s\\n' "$GITHUB_TOKEN" | npm run gh -- auth login --hostname github.com --with-token`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printUsage();
  process.exit(0);
}

mkdirSync(configDir, { recursive: true });
try {
  chmodSync(join(repoRoot, ".dev"), 0o700);
  chmodSync(configDir, 0o700);
} catch {
  // Best-effort only. Some filesystems do not support POSIX modes.
}

const result = spawnSync("gh", args, {
  cwd: repoRoot,
  env: {
    ...process.env,
    GH_CONFIG_DIR: configDir,
  },
  stdio: "inherit",
});

if (result.error) {
  if (result.error.code === "ENOENT") {
    console.error("gh is not installed or is not on PATH.");
  } else {
    console.error(result.error.message);
  }
  process.exit(1);
}

process.exit(result.status ?? 1);
