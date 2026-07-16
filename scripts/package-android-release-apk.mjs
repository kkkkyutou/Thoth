#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MVP_VERSION } from "./mvp-release-contract.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = join(repoRoot, "packages", "app");
const devRoot = join(repoRoot, ".dev");
const managedJdkRoot = join(devRoot, "jdk-17");
const managedAndroidRoot = join(devRoot, "android-sdk");
const jdkRoot = process.env.JAVA_HOME ?? managedJdkRoot;
const androidRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? managedAndroidRoot;
const generatedApk = join(appRoot, "android/app/build/outputs/apk/release/app-release.apk");
const outputDir = resolve(
  repoRoot,
  process.env.THOTH_RELEASE_OUTPUT_DIR ?? ".dev/release-artifacts",
);
const outputApk = join(outputDir, `Thoth-${MVP_VERSION}-android.apk`);
const signingVariables = [
  "THOTH_ANDROID_KEYSTORE_PATH",
  "THOTH_ANDROID_KEYSTORE_PASSWORD",
  "THOTH_ANDROID_KEY_ALIAS",
  "THOTH_ANDROID_KEY_PASSWORD",
];

for (const variable of signingVariables) {
  if (!process.env[variable]) {
    throw new Error(`Missing required Android release signing variable: ${variable}`);
  }
}

function androidEnv() {
  return {
    ...process.env,
    APP_VARIANT: "production",
    CI: "1",
    NODE_ENV: "production",
    GRADLE_USER_HOME: join(devRoot, "gradle"),
    JAVA_HOME: jdkRoot,
    ANDROID_HOME: androidRoot,
    ANDROID_SDK_ROOT: androidRoot,
    PATH: [
      join(jdkRoot, "bin"),
      join(androidRoot, "cmdline-tools", "latest", "bin"),
      join(androidRoot, "platform-tools"),
      process.env.PATH ?? "",
    ].join(":"),
  };
}

function run(command, args, cwd = repoRoot) {
  console.log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { cwd, env: androidEnv(), stdio: "inherit" });
}

if (
  (!existsSync(join(jdkRoot, "bin", "java")) || !existsSync(join(androidRoot, "platform-tools"))) &&
  jdkRoot === managedJdkRoot &&
  androidRoot === managedAndroidRoot
) {
  run("node", ["scripts/setup-android-toolchain.mjs"]);
}

run("npm", ["run", "build:client"]);
run("npx", ["expo", "prebuild", "--platform", "android", "--clean", "--non-interactive"], appRoot);
run("bash", ["-lc", "./gradlew :app:assembleRelease --no-daemon"], join(appRoot, "android"));

if (!existsSync(generatedApk)) {
  throw new Error(`Expected release APK was not created: ${generatedApk}`);
}

mkdirSync(outputDir, { recursive: true });
copyFileSync(generatedApk, outputApk);
const stats = statSync(outputApk);
const sha256 = createHash("sha256").update(readFileSync(outputApk)).digest("hex");
console.log(
  JSON.stringify({ version: MVP_VERSION, apk: outputApk, bytes: stats.size, sha256 }, null, 2),
);
