#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devRoot = join(repoRoot, ".dev");
const cacheRoot = join(devRoot, "cache");
const jdkRoot = join(devRoot, "jdk-17");
const androidRoot = join(devRoot, "android-sdk");
const commandLineToolsZip = join(cacheRoot, "commandlinetools-linux.zip");
const jdkTarball = join(cacheRoot, "temurin-jdk17-linux-x64.tar.gz");

const jdkUrl =
  "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk";
const commandLineToolsUrl =
  "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip";

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(" ")}`);
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options,
  });
}

function ensureTool(command, hint) {
  try {
    execFileSync("bash", ["-lc", `command -v ${command}`], { stdio: "ignore" });
  } catch {
    throw new Error(`${command} is required. ${hint}`);
  }
}

function download(url, target) {
  if (existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  run("curl", ["-L", "--fail", "--retry", "3", "-o", target, url]);
}

function findExtractedJdk(tmpRoot) {
  for (const entry of readdirSync(tmpRoot)) {
    const candidate = join(tmpRoot, entry);
    if (statSync(candidate).isDirectory() && existsSync(join(candidate, "bin", "java"))) {
      return candidate;
    }
  }
  throw new Error("Could not find extracted JDK directory with bin/java");
}

function installJdk() {
  if (existsSync(join(jdkRoot, "bin", "java"))) {
    console.log(`JDK already installed at ${jdkRoot}`);
    return;
  }
  ensureTool("curl", "Install curl or pre-populate .dev/cache with the JDK tarball.");
  ensureTool("tar", "Install tar or extract the JDK manually under .dev/jdk-17.");
  download(jdkUrl, jdkTarball);
  const tmpRoot = join(devRoot, "jdk-17.tmp");
  rmSync(tmpRoot, { force: true, recursive: true });
  mkdirSync(tmpRoot, { recursive: true });
  run("tar", ["-xzf", jdkTarball, "-C", tmpRoot]);
  rmSync(jdkRoot, { force: true, recursive: true });
  renameSync(findExtractedJdk(tmpRoot), jdkRoot);
  rmSync(tmpRoot, { force: true, recursive: true });
}

function installCommandLineTools() {
  const sdkmanager = join(androidRoot, "cmdline-tools", "latest", "bin", "sdkmanager");
  if (existsSync(sdkmanager)) {
    console.log(`Android command line tools already installed at ${sdkmanager}`);
    return;
  }
  ensureTool("curl", "Install curl or pre-populate .dev/cache with Android command line tools.");
  ensureTool(
    "unzip",
    "Install unzip or extract command line tools manually under .dev/android-sdk.",
  );
  download(commandLineToolsUrl, commandLineToolsZip);
  const tmpRoot = join(devRoot, "cmdline-tools.tmp");
  rmSync(tmpRoot, { force: true, recursive: true });
  mkdirSync(tmpRoot, { recursive: true });
  run("unzip", ["-q", commandLineToolsZip, "-d", tmpRoot]);
  const extracted = join(tmpRoot, "cmdline-tools");
  if (!existsSync(join(extracted, "bin", "sdkmanager"))) {
    throw new Error("Downloaded Android command line tools did not contain bin/sdkmanager");
  }
  const latestRoot = join(androidRoot, "cmdline-tools", "latest");
  rmSync(latestRoot, { force: true, recursive: true });
  mkdirSync(dirname(latestRoot), { recursive: true });
  renameSync(extracted, latestRoot);
  rmSync(tmpRoot, { force: true, recursive: true });
}

function sdkEnv() {
  return {
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
}

function installAndroidPackages() {
  const sdkmanager = join(androidRoot, "cmdline-tools", "latest", "bin", "sdkmanager");
  run("bash", ["-lc", `yes | "${sdkmanager}" --sdk_root="${androidRoot}" --licenses >/dev/null`], {
    env: sdkEnv(),
  });
  run(
    sdkmanager,
    [
      `--sdk_root=${androidRoot}`,
      "platform-tools",
      "platforms;android-35",
      "build-tools;35.0.0",
      "platforms;android-36",
      "build-tools;36.0.0",
    ],
    { env: sdkEnv() },
  );
}

mkdirSync(cacheRoot, { recursive: true });
installJdk();
installCommandLineTools();
installAndroidPackages();

console.log(`JAVA_HOME=${jdkRoot}`);
console.log(`ANDROID_HOME=${androidRoot}`);
console.log("THOTH_ANDROID_TOOLCHAIN_READY");
