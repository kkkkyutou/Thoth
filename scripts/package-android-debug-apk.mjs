#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = join(repoRoot, "packages", "app");
const devRoot = join(repoRoot, ".dev");
const jdkRoot = join(devRoot, "jdk-17");
const androidRoot = join(devRoot, "android-sdk");
const apkPath = join(
  appRoot,
  "android",
  "app",
  "build",
  "outputs",
  "apk",
  "debug",
  "app-debug.apk",
);
const receiptPath = join(repoRoot, ".agent-os", "artifacts", "android-debug-apk.json");

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: androidEnv(),
    ...options,
  });
}

function androidEnv() {
  const gradleProxyOptions = gradleProxyOptionsFromEnv();
  const gradleOptions = [process.env.GRADLE_OPTS, ...gradleProxyOptions].filter(Boolean).join(" ");

  return {
    ...process.env,
    APP_VARIANT: "development",
    CI: "1",
    GRADLE_USER_HOME: join(devRoot, "gradle"),
    GRADLE_OPTS: gradleOptions,
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

function gradleProxyOptionsFromEnv() {
  const proxyValue =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;
  if (!proxyValue) return [];

  try {
    const proxyUrl = new URL(proxyValue);
    const hostname = proxyUrl.hostname;
    const port = proxyUrl.port || (proxyUrl.protocol === "https:" ? "443" : "80");
    const options = [
      `-Dhttp.proxyHost=${hostname}`,
      `-Dhttp.proxyPort=${port}`,
      `-Dhttps.proxyHost=${hostname}`,
      `-Dhttps.proxyPort=${port}`,
    ];

    if (proxyUrl.username) {
      options.push(`-Dhttp.proxyUser=${decodeURIComponent(proxyUrl.username)}`);
      options.push(`-Dhttps.proxyUser=${decodeURIComponent(proxyUrl.username)}`);
    }

    if (proxyUrl.password) {
      options.push(`-Dhttp.proxyPassword=${decodeURIComponent(proxyUrl.password)}`);
      options.push(`-Dhttps.proxyPassword=${decodeURIComponent(proxyUrl.password)}`);
    }

    return options;
  } catch (error) {
    console.warn(`Ignoring invalid proxy URL for Gradle: ${error.message}`);
    return [];
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

if (!existsSync(join(jdkRoot, "bin", "java")) || !existsSync(join(androidRoot, "platform-tools"))) {
  run("node", ["scripts/setup-android-toolchain.mjs"]);
}

run("npm", ["run", "build:client"]);
run("npx", ["expo", "prebuild", "--platform", "android"], { cwd: appRoot });
run("bash", ["-lc", "./gradlew :app:assembleDebug --no-daemon"], { cwd: join(appRoot, "android") });

if (!existsSync(apkPath)) {
  throw new Error(`Expected debug APK was not created: ${apkPath}`);
}

const stats = statSync(apkPath);
const receipt = {
  command: "npm run package:android:debug-apk",
  apkPath,
  sha256: sha256(apkPath),
  bytes: stats.size,
  createdAt: new Date().toISOString(),
};

mkdirSync(dirname(receiptPath), { recursive: true });
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

console.log(JSON.stringify(receipt, null, 2));
console.log("THOTH_ANDROID_DEBUG_APK_OK");
