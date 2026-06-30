#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devRoot = join(repoRoot, ".dev");
const jdkRoot = join(devRoot, "jdk-17");
const androidRoot = join(devRoot, "android-sdk");
const expectedApk = join(
  repoRoot,
  "packages/app/android/app/build/outputs/apk/debug/app-debug.apk",
);

function tryCommand(command, args, env = process.env) {
  try {
    return execFileSync(command, args, { encoding: "utf8", env }).trim();
  } catch (error) {
    return `UNAVAILABLE: ${error.message.split("\n")[0]}`;
  }
}

const env = {
  ...process.env,
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

const report = {
  repoRoot,
  javaHome: jdkRoot,
  javaReady: existsSync(join(jdkRoot, "bin", "java")),
  androidHome: androidRoot,
  sdkmanagerReady: existsSync(join(androidRoot, "cmdline-tools", "latest", "bin", "sdkmanager")),
  adbReady: existsSync(join(androidRoot, "platform-tools", "adb")),
  expectedDebugApk: expectedApk,
  system: {
    java: tryCommand("java", ["-version"]),
    projectJava: tryCommand(join(jdkRoot, "bin", "java"), ["-version"], env),
    sdkmanager: tryCommand("bash", ["-lc", "command -v sdkmanager"], env),
    adb: tryCommand("bash", ["-lc", "command -v adb"], env),
  },
};

mkdirSync(join(repoRoot, ".agent-os", "artifacts"), { recursive: true });
writeFileSync(
  join(repoRoot, ".agent-os", "artifacts", "android-doctor.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

console.log(JSON.stringify(report, null, 2));
if (report.javaReady && report.sdkmanagerReady && report.adbReady) {
  console.log("THOTH_ANDROID_DOCTOR_OK");
} else {
  console.log("THOTH_ANDROID_DOCTOR_NEEDS_SETUP");
}
