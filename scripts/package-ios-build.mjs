#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = join(repoRoot, "packages", "app");
const mode = process.argv.includes("--build") ? "build" : "prebuild";

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, APP_VARIANT: "development" },
    ...options,
  });
}

if (process.platform !== "darwin") {
  console.log(
    `THOTH_IOS_${mode.toUpperCase()}_SKIPPED: iOS ${mode} requires macOS with Xcode. Current platform is ${process.platform}.`,
  );
  if (mode === "build") {
    process.exit(1);
  }
  process.exit(0);
}

run("npm", ["run", "build:client"]);
run("npx", ["expo", "prebuild", "--platform", "ios", "--non-interactive"], { cwd: appRoot });

if (mode === "prebuild") {
  console.log("THOTH_IOS_PREBUILD_OK");
  process.exit(0);
}

if (!existsSync(join(appRoot, "ios"))) {
  throw new Error("Expo prebuild did not create packages/app/ios");
}

run("bash", ["-lc", "xcodebuild -list"], { cwd: join(appRoot, "ios") });
run("bash", ["-lc", "xcodebuild -configuration Debug -sdk iphonesimulator build"], {
  cwd: join(appRoot, "ios"),
});

console.log("THOTH_IOS_BUILD_OK");
