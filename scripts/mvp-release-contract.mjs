#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MVP_VERSION = "0.0.0-mvp-beta";
export const MVP_TAG = `v${MVP_VERSION}`;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPaths = [
  "package.json",
  "packages/app/highlight/package.json",
  "packages/app/package.json",
  "packages/cli/package.json",
  "packages/client/package.json",
  "packages/core/package.json",
  "packages/daemon/package.json",
  "packages/desktop/package.json",
  "packages/drivers/package.json",
  "packages/protocol/package.json",
  "packages/relay/package.json",
  "packages/tui/package.json",
];
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8"));
}

function verifyInternalDependencies({ dependencies, source, failures }) {
  if (!dependencies) return;
  for (const [dependencyName, dependencyVersion] of Object.entries(dependencies)) {
    if (dependencyName.startsWith("@thoth/") && dependencyVersion !== MVP_VERSION) {
      failures.push(`${source}.${dependencyName} must be ${MVP_VERSION}, got ${dependencyVersion}`);
    }
  }
}

export function runMvpReleaseContract({ writeMode = false } = {}) {
  const manifests = packageJsonPaths.map((relativePath) => ({
    relativePath,
    value: readJson(relativePath),
  }));
  const internalPackageNames = new Set(
    manifests.map(({ value }) => value.name).filter((name) => name?.startsWith("@thoth/")),
  );
  const failures = [];

  for (const manifest of manifests) {
    const { relativePath, value } = manifest;

    if (writeMode) {
      value.version = MVP_VERSION;
      if (value.name === "@thoth/cli") {
        value.engines = { node: ">=24.14.0" };
      }
      for (const section of dependencySections) {
        const dependencies = value[section];
        if (!dependencies) continue;
        for (const dependencyName of Object.keys(dependencies)) {
          if (internalPackageNames.has(dependencyName)) {
            dependencies[dependencyName] = MVP_VERSION;
          }
        }
      }
      writeFileSync(join(repoRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
      continue;
    }

    if (value.version !== MVP_VERSION) {
      failures.push(`${relativePath}: expected version ${MVP_VERSION}, got ${value.version}`);
    }
    if (value.private !== true) {
      failures.push(`${relativePath}: MVP packages must remain private`);
    }
    if (value.name === "@thoth/cli" && value.engines?.node !== ">=24.14.0") {
      failures.push(`${relativePath}: @thoth/cli must require Node >=24.14.0`);
    }
    for (const section of dependencySections) {
      verifyInternalDependencies({
        dependencies: value[section],
        source: `${relativePath}:${section}`,
        failures,
      });
    }
  }

  if (writeMode) {
    console.log(`Pinned ${packageJsonPaths.length} package manifests to ${MVP_VERSION}.`);
    return;
  }

  const lock = readJson("package-lock.json");
  for (const { relativePath } of manifests) {
    const packagePath = relativePath === "package.json" ? "" : dirname(relativePath);
    const lockEntry = lock.packages?.[packagePath];
    if (!lockEntry) {
      failures.push(`package-lock.json is missing ${packagePath || "the root package"}`);
      continue;
    }
    if (lockEntry.version !== MVP_VERSION) {
      failures.push(
        `package-lock.json:${packagePath || "root"} expected version ${MVP_VERSION}, got ${lockEntry.version}`,
      );
    }
    for (const section of dependencySections) {
      verifyInternalDependencies({
        dependencies: lockEntry[section],
        source: `package-lock.json:${packagePath || "root"}:${section}`,
        failures,
      });
    }
  }

  const lockText = readFileSync(join(repoRoot, "package-lock.json"), "utf8");
  if (/"@thoth\/[^"]+"\s*:\s*"file:/u.test(lockText)) {
    failures.push("package-lock.json contains an internal file: dependency");
  }

  const workflowText = readFileSync(
    join(repoRoot, ".github/workflows/mvp-beta-release.yml"),
    "utf8",
  );
  if (!workflowText.includes(`THOTH_MVP_VERSION: ${MVP_VERSION}`)) {
    failures.push("MVP workflow version does not match the package version");
  }
  if (!workflowText.includes(`THOTH_MVP_TAG: ${MVP_TAG}`)) {
    failures.push("MVP workflow tag does not match the package version");
  }

  const rootScripts = manifests.find(({ relativePath }) => relativePath === "package.json")?.value
    .scripts;
  for (const scriptName of ["build:client", "build:app-deps", "build:foundation"]) {
    const script = rootScripts?.[scriptName];
    const protocolIndex = script?.indexOf("build:protocol") ?? -1;
    const relayIndex = script?.indexOf("build:relay") ?? -1;
    if (protocolIndex < 0 || relayIndex < 0 || protocolIndex > relayIndex) {
      failures.push(`${scriptName} must build @thoth/protocol before @thoth/relay`);
    }
  }
  if (rootScripts?.["setup:electron"] !== "node node_modules/electron/install.js") {
    failures.push("setup:electron must explicitly install the platform Electron binary");
  }
  const electronSetupSteps = workflowText.match(/- run: npm run setup:electron/gu) ?? [];
  if (electronSetupSteps.length !== 4) {
    failures.push(
      `MVP workflow must initialize Electron in preflight and three desktop jobs, got ${electronSetupSteps.length}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  console.log(`MVP release contract verified: ${MVP_TAG}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    runMvpReleaseContract({ writeMode: process.argv.includes("--write") });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
