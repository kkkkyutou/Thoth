#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { request } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket } from "ws";

const repoRoot = process.cwd();
const captureDir = path.join(repoRoot, "docs/ui-review-captures/desktop-scorecard");
const forbiddenSurfacePatterns = [
  /Paseo/i,
  /127\.0\.0\.1:6767/,
  /localhost:6767/,
  /offer=/,
  /#offer=/,
  /pairingToken/,
  /thoth-relay-v3-client\./,
  /thoth\.relay\.token\./,
];

function logStep(message, details = {}) {
  console.log(`[desktop-scorecard] ${message} ${JSON.stringify(details)}`);
}

function reserveLocalTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve local TCP port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with ${signal ?? code}`));
    });
  });
}

function spawnLogged(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    ...options,
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => {
    stdout.push(chunk.toString());
  });
  child.stderr.on("data", (chunk) => {
    stderr.push(chunk.toString());
  });
  return { child, stdout, stderr, command, args };
}

async function stopProcess(handle) {
  const child = handle.child ?? handle;
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  } else {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        } else {
          child.kill("SIGKILL");
        }
      }
      resolve();
    }, 6000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForHttpOk(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const req = request(url, (res) => {
          res.resume();
          if ((res.statusCode ?? 500) < 500) {
            resolve();
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
        req.setTimeout(1000, () => req.destroy(new Error("HTTP wait timed out")));
        req.on("error", reject);
        req.end();
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function waitForChildFailure(handle, label) {
  const { child, stdout, stderr } = handle;
  if (child.exitCode === null && child.signalCode === null) {
    return;
  }
  throw new Error(
    `${label} exited early with ${child.signalCode ?? child.exitCode}\nstdout:\n${stdout.join("").trim()}\n\nstderr:\n${stderr.join("").trim()}`,
  );
}

function createTempGitRepo(prefix) {
  const repoPath = mkdtempSync(path.join(os.tmpdir(), prefix));
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "desktop-scorecard@thoth.test"], {
    cwd: repoPath,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Thoth Desktop Scorecard"], {
    cwd: repoPath,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: repoPath, stdio: "ignore" });
  writeFileSync(path.join(repoPath, "README.md"), "# Desktop Scorecard Workspace\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: repoPath, stdio: "ignore" });
  return repoPath;
}

async function loadDaemonClient() {
  const moduleUrl = pathToFileURL(
    path.join(repoRoot, "packages/client/dist/daemon-client.js"),
  ).href;
  const mod = await import(moduleUrl);
  return mod.DaemonClient;
}

async function ensureElectronBinary() {
  const electronBinary =
    process.platform === "win32"
      ? path.join(repoRoot, "node_modules/electron/dist/electron.exe")
      : path.join(repoRoot, "node_modules/electron/dist/electron");
  if (existsSync(electronBinary)) {
    return electronBinary;
  }
  await run(process.execPath, [path.join(repoRoot, "node_modules/electron/install.js")]);
  return electronBinary;
}

async function connectDaemonClient(port) {
  const DaemonClient = await loadDaemonClient();
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${port}/ws`,
    clientId: `desktop-scorecard-${process.pid}-${Date.now()}`,
    clientType: "cli",
    appVersion: "0.0.0",
    webSocketFactory: (url, options) => new WebSocket(url, { headers: options?.headers }),
  });
  await client.connect();
  return client;
}

function buildWorkspaceRoute(serverId, workspaceId) {
  return `/h/${encodeURIComponent(serverId)}/workspace/${encodeURIComponent(workspaceId)}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findElectronPageTarget(cdpPort, appPort) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const targetListText = await fetchText(`http://127.0.0.1:${cdpPort}/json/list`);
      const targets = JSON.parse(targetListText);
      for (const target of targets) {
        if (!target || target.type !== "page" || typeof target.url !== "string") {
          continue;
        }
        const isExpectedAppUrl =
          target.url.includes(`localhost:${appPort}`) ||
          target.url.includes(`127.0.0.1:${appPort}`);
        if (
          isExpectedAppUrl &&
          typeof target.webSocketDebuggerUrl === "string" &&
          target.webSocketDebuggerUrl.length > 0
        ) {
          return target;
        }
      }
    } catch {
      // Electron may expose /json/version before the page target is ready.
    }
    await delay(500);
  }
  let targetList = "<unavailable>";
  try {
    targetList = await fetchText(`http://127.0.0.1:${cdpPort}/json/list`);
  } catch {}
  throw new Error(
    `Unable to find Electron app page target for static app port ${appPort}\n\nCDP targets:\n${targetList}`,
  );
}

function createCdpClient(webSocketDebuggerUrl) {
  let socket = null;
  let nextId = 1;
  const pending = new Map();
  const consoleMessages = [];

  function rejectPending(error) {
    for (const [id, callbacks] of pending) {
      pending.delete(id);
      callbacks.reject(new Error(`${error.message} before CDP response ${id}`));
    }
  }

  function recordRuntimeError(message) {
    const text = message.params?.exceptionDetails?.text;
    const description = message.params?.exceptionDetails?.exception?.description;
    consoleMessages.push({
      type: "pageerror",
      text: description || text || JSON.stringify(message.params ?? {}),
    });
  }

  function recordLogEntry(message) {
    const entry = message.params?.entry;
    if (entry?.level === "error") {
      consoleMessages.push({ type: "error", text: entry.text ?? JSON.stringify(entry) });
    }
  }

  function recordConsoleCall(message) {
    if (message.params?.type !== "error") {
      return;
    }
    const args = Array.isArray(message.params.args)
      ? message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" ")
      : JSON.stringify(message.params ?? {});
    consoleMessages.push({ type: "error", text: args });
  }

  return {
    consoleMessages,
    async connect() {
      socket = new WebSocket(webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      socket.on("close", () => rejectPending(new Error("CDP socket closed")));
      socket.on("error", (error) => rejectPending(error));
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.id) {
          const callbacks = pending.get(message.id);
          if (!callbacks) {
            return;
          }
          pending.delete(message.id);
          if (message.error) {
            callbacks.reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
          } else {
            callbacks.resolve(message.result ?? {});
          }
          return;
        }
        if (message.method === "Runtime.exceptionThrown") {
          recordRuntimeError(message);
        } else if (message.method === "Log.entryAdded") {
          recordLogEntry(message);
        } else if (message.method === "Runtime.consoleAPICalled") {
          recordConsoleCall(message);
        }
      });
      await this.send("Page.enable");
      await this.send("Runtime.enable");
      await this.send("Log.enable");
    },
    send(method, params = {}) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error(`CDP socket is not open for ${method}`));
      }
      const id = nextId++;
      const payload = JSON.stringify({ id, method, params });
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for CDP response to ${method}`));
        }, 30_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        socket.send(payload, (error) => {
          if (error) {
            pending.delete(id);
            clearTimeout(timeout);
            reject(error);
          }
        });
      });
    },
    async evaluate(expression) {
      const result = await this.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(JSON.stringify(result.exceptionDetails));
      }
      return result.result?.value;
    },
    async navigate(url) {
      await this.send("Page.navigate", { url });
      await waitForCondition(
        async () => (await this.evaluate("document.readyState")) !== "loading",
        `page ${url} to leave loading state`,
      );
    },
    async setViewportSize(size) {
      await this.send("Emulation.setDeviceMetricsOverride", {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    },
    async screenshot(filePath) {
      const result = await this.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true,
      });
      writeFileSync(filePath, Buffer.from(result.data, "base64"));
    },
    async close() {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      for (const [id, callbacks] of pending) {
        pending.delete(id);
        callbacks.reject(new Error(`CDP socket closed before response ${id}`));
      }
    },
  };
}

async function waitForCondition(check, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (await check()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
  );
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    req.setTimeout(1000, () => req.destroy(new Error("HTTP fetch timed out")));
    req.on("error", reject);
    req.end();
  });
}

async function capture(cdp, name) {
  const filePath = path.join(captureDir, name);
  await cdp.screenshot(filePath);
  return filePath;
}

async function expectVisibleText(cdp, text) {
  let latestText = "";
  const expected = text.toLowerCase();
  await waitForCondition(
    async () => {
      const bodyText = await cdp.evaluate("document.body?.innerText ?? ''");
      latestText = String(bodyText);
      return latestText.toLowerCase().includes(expected);
    },
    `visible text ${text}: ${latestText.slice(0, 800)}`,
  );
}

async function expectTestId(cdp, testId) {
  await waitForCondition(async () => {
    return cdp.evaluate(
      `Boolean(document.querySelector(${JSON.stringify(`[data-testid="${testId}"]`)}))`,
    );
  }, `test id ${testId}`);
}

async function clickTestId(cdp, testId) {
  await expectTestId(cdp, testId);
  await cdp.evaluate(
    `document.querySelector(${JSON.stringify(`[data-testid="${testId}"]`)})?.click()`,
  );
}

async function expectHealthySurface(cdp) {
  const text = await cdp.evaluate("document.body?.innerText ?? ''");
  const pageUrl = await cdp.evaluate("window.location.href");
  if (text.trim().length < 80) {
    throw new Error(`Desktop surface looks empty: ${text}`);
  }
  for (const pattern of forbiddenSurfacePatterns) {
    if (pattern.test(text) || pattern.test(pageUrl)) {
      throw new Error(`Desktop surface leaked forbidden pattern ${pattern}`);
    }
  }
}

async function inspectDesktopBridge(cdp) {
  return cdp.evaluate(`(() => {
    const bridge = window.thothDesktop;
    const keys = bridge && typeof bridge === "object" ? Object.keys(bridge) : [];
    return {
      exists: Boolean(bridge && typeof bridge === "object"),
      keys,
      platform: bridge?.platform ?? null,
    };
  })()`);
}

async function main() {
  mkdirSync(captureDir, { recursive: true });

  const daemonPort = await reserveLocalTcpPort();
  const appPort = await reserveLocalTcpPort();
  const cdpPort = await reserveLocalTcpPort();
  const appBaseUrl = `http://127.0.0.1:${appPort}`;
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "thoth-desktop-scorecard-"));
  const thothHome = path.join(tempRoot, "home");
  const userData = path.join(tempRoot, "user-data");
  const repoPath = createTempGitRepo("thoth-desktop-scorecard-repo-");
  mkdirSync(thothHome, { recursive: true });
  mkdirSync(userData, { recursive: true });

  const commonEnv = {
    ...process.env,
    THOTH_HOME: thothHome,
    THOTH_DEV_ROOT: tempRoot,
    THOTH_LISTEN: `127.0.0.1:${daemonPort}`,
    THOTH_RELAY_ENDPOINT: "relay.test.thoth.seeles.ai:443",
    THOTH_RELAY_PUBLIC_ENDPOINT: "relay.test.thoth.seeles.ai:443",
    THOTH_RELAY_USE_TLS: "true",
    THOTH_RELAY_PUBLIC_USE_TLS: "true",
    THOTH_CORS_ORIGINS: [`http://localhost:${appPort}`, appBaseUrl].join(","),
    THOTH_ELECTRON_USER_DATA_DIR: userData,
    THOTH_DISABLE_SINGLE_INSTANCE_LOCK: "1",
    THOTH_ELECTRON_REMOTE_DEBUGGING_PORT: String(cdpPort),
    THOTH_ELECTRON_FLAGS:
      `${process.env.THOTH_ELECTRON_FLAGS ?? ""} --remote-debugging-port=${cdpPort} --no-sandbox`.trim(),
    EXPO_PORT: String(appPort),
    EXPO_DEV_URL: appBaseUrl,
    EXPO_PUBLIC_LOCAL_DAEMON: `127.0.0.1:${daemonPort}`,
    THOTH_WEB_PLATFORM: "electron",
    BROWSER: "none",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
  };

  let daemon = null;
  let desktop = null;
  let staticServer = null;
  let cdp = null;
  let client = null;

  try {
    logStep("build-web.start", { appPort, daemonPort });
    await run("npm", ["run", "build:web"], { env: commonEnv });
    logStep("build-web.done");
    logStep("build-main.start");
    await run("npm", ["--workspace=@thoth/desktop", "run", "build:main"], { env: commonEnv });
    logStep("build-main.done");
    const electronBinary = await ensureElectronBinary();
    logStep("electron-binary.ready", { electronBinary });

    logStep("daemon.start", { daemonPort });
    daemon = spawnLogged("npm", ["run", "dev", "--workspace=@thoth/daemon"], { env: commonEnv });
    await waitForHttpOk(`http://127.0.0.1:${daemonPort}/api/status`);
    await waitForChildFailure(daemon, "Desktop scorecard daemon");
    logStep("daemon.ready", { daemonPort });

    client = await connectDaemonClient(daemonPort);
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repoPath },
    });
    if (!created.workspace || created.error) {
      throw new Error(created.error ?? `Failed to create scorecard workspace ${repoPath}`);
    }
    const workspaceId = created.workspace.id;
    logStep("workspace.created", { workspaceId });

    logStep("static-server.start", { appPort });
    staticServer = spawnLogged(
      process.execPath,
      ["scripts/serve-static.mjs", "packages/app/dist", String(appPort), "127.0.0.1"],
      { env: commonEnv },
    );
    await waitForHttpOk(appBaseUrl);
    await waitForChildFailure(staticServer, "Desktop scorecard static web export");
    logStep("static-server.ready", { appBaseUrl });

    const electronArgs = [`--remote-debugging-port=${cdpPort}`];
    if (
      process.platform === "linux" &&
      typeof process.getuid === "function" &&
      process.getuid() === 0
    ) {
      electronArgs.push("--no-sandbox");
    }
    electronArgs.push(path.join(repoRoot, "packages/desktop"));
    const desktopCommand =
      process.platform === "linux" && existsSync("/usr/bin/xvfb-run")
        ? { command: "xvfb-run", args: ["-a", electronBinary, ...electronArgs] }
        : { command: electronBinary, args: electronArgs };
    logStep("electron.start", {
      command: desktopCommand.command,
      args: desktopCommand.args,
      cdpPort,
    });
    desktop = spawnLogged(desktopCommand.command, desktopCommand.args, { env: commonEnv });
    await waitForHttpOk(`http://127.0.0.1:${cdpPort}/json/version`);
    await waitForChildFailure(desktop, "Desktop scorecard Electron dev app");
    logStep("electron.cdp-ready", { cdpPort });

    const target = await findElectronPageTarget(cdpPort, appPort);
    logStep("electron.page-target", { id: target.id, url: target.url });
    cdp = createCdpClient(target.webSocketDebuggerUrl);
    await cdp.connect();
    logStep("cdp.connected");
    await waitForCondition(
      async () => (await cdp.evaluate("document.readyState")) === "complete",
      "initial Electron app load",
      60_000,
    );
    logStep("electron.initial-load-complete");

    await cdp.setViewportSize({ width: 1280, height: 880 });
    logStep("initial.body", {
      url: await cdp.evaluate("window.location.href"),
      text: String(await cdp.evaluate("document.body?.innerText ?? ''")).slice(0, 300),
    });
    await cdp.navigate(`${appBaseUrl}/open-project`);
    logStep("open-project.body", {
      url: await cdp.evaluate("window.location.href"),
      text: String(await cdp.evaluate("document.body?.innerText ?? ''")).slice(0, 300),
    });
    await expectVisibleText(cdp, "One Thoth");
    await expectVisibleText(cdp, "Task control plane");
    await expectTestId(cdp, "open-project-submit");
    await expectHealthySurface(cdp);
    const desktopBridge = await inspectDesktopBridge(cdp);
    logStep("home.verified", { bridgeKeys: desktopBridge.keys });
    const requiredDesktopKeys = ["invoke", "events", "window", "dialog", "notification", "opener"];
    for (const key of requiredDesktopKeys) {
      if (!desktopBridge.keys.includes(key)) {
        throw new Error(`Desktop bridge is missing key ${key}: ${JSON.stringify(desktopBridge)}`);
      }
    }
    const desktopStatus = await cdp.evaluate(`window.thothDesktop.invoke("desktop_daemon_status")`);
    if (!desktopStatus || typeof desktopStatus.serverId !== "string") {
      throw new Error(`Invalid desktop daemon status: ${JSON.stringify(desktopStatus)}`);
    }
    const serverId = desktopStatus.serverId.trim();
    await capture(cdp, "desktop-home.png");
    logStep("home.captured");

    await cdp.navigate(`${appBaseUrl}${buildWorkspaceRoute(serverId, workspaceId)}`);
    await expectTestId(cdp, "workspace-thoth-surface-preview");
    await expectVisibleText(cdp, "One Thoth workspace");
    await expectVisibleText(cdp, "Needs provider before execution");
    await expectTestId(cdp, "thoth-composer-controls");
    await clickTestId(cdp, "thoth-control-mode");
    await clickTestId(cdp, "thoth-control-clarify");
    await clickTestId(cdp, "thoth-control-loop");
    await expectHealthySurface(cdp);
    await capture(cdp, "desktop-workspace.png");
    logStep("workspace.captured");

    await cdp.navigate(`${appBaseUrl}/settings/about`);
    await expectVisibleText(cdp, "About Thoth");
    await expectHealthySurface(cdp);
    await capture(cdp, "desktop-settings-about.png");
    logStep("settings-about.captured");

    await cdp.navigate(`${appBaseUrl}/settings/hosts/${encodeURIComponent(serverId)}/providers`);
    await expectTestId(cdp, "host-page-providers-card");
    await expectHealthySurface(cdp);
    await capture(cdp, "desktop-settings-providers.png");
    logStep("settings-providers.captured");

    await cdp.navigate(`${appBaseUrl}/settings/hosts/${encodeURIComponent(serverId)}/connections`);
    await expectTestId(cdp, "host-page-connections-card");
    await expectHealthySurface(cdp);
    await capture(cdp, "desktop-settings-connections.png");
    logStep("settings-connections.captured");

    const badConsoleMessages = cdp.consoleMessages.filter(
      (message) => message.type === "pageerror" || message.type === "error",
    );
    if (badConsoleMessages.length > 0) {
      throw new Error(
        `Desktop scorecard saw console errors: ${JSON.stringify(badConsoleMessages)}`,
      );
    }

    const report = {
      status: "passed",
      daemonPort,
      appPort,
      cdpPort,
      workspaceId,
      desktopBridge,
      desktopStatus: {
        serverId: desktopStatus.serverId,
        status: desktopStatus.status,
        desktopManaged: desktopStatus.desktopManaged,
        listen: desktopStatus.listen,
      },
      screenshots: [
        "desktop-home.png",
        "desktop-workspace.png",
        "desktop-settings-about.png",
        "desktop-settings-providers.png",
        "desktop-settings-connections.png",
      ].map((name) => path.join(captureDir, name)),
    };
    writeFileSync(
      path.join(captureDir, "desktop-scorecard-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (cdp) {
      try {
        const diagnostics = {
          url: await cdp.evaluate("window.location.href").catch((innerError) => String(innerError)),
          readyState: await cdp
            .evaluate("document.readyState")
            .catch((innerError) => String(innerError)),
          bodyText: String(
            await cdp
              .evaluate("document.body?.innerText ?? ''")
              .catch((innerError) => String(innerError)),
          ).slice(0, 1200),
          html: String(
            await cdp
              .evaluate("document.documentElement?.outerHTML ?? ''")
              .catch((innerError) => String(innerError)),
          ).slice(0, 2000),
          consoleMessages: cdp.consoleMessages,
        };
        console.error(
          `Desktop scorecard CDP diagnostics:\n${JSON.stringify(diagnostics, null, 2)}`,
        );
        await capture(cdp, "desktop-debug-failure.png").catch(() => undefined);
      } catch (diagnosticError) {
        console.error(
          `Desktop scorecard failed to collect CDP diagnostics: ${
            diagnosticError instanceof Error ? diagnosticError.stack : String(diagnosticError)
          }`,
        );
      }
    }
    if (daemon) {
      console.error(
        `Desktop scorecard daemon logs:\nstdout:\n${daemon.stdout.join("").trim()}\n\nstderr:\n${daemon.stderr.join("").trim()}`,
      );
    }
    if (desktop) {
      console.error(
        `Desktop scorecard Electron logs:\nstdout:\n${desktop.stdout.join("").trim()}\n\nstderr:\n${desktop.stderr.join("").trim()}`,
      );
    }
    throw error;
  } finally {
    if (cdp) {
      await cdp.close().catch(() => undefined);
    }
    if (client) {
      await client.close().catch(() => undefined);
    }
    if (desktop) {
      await stopProcess(desktop);
    }
    if (staticServer) {
      await stopProcess(staticServer);
    }
    if (daemon) {
      await stopProcess(daemon);
    }
    rmSync(repoPath, { recursive: true, force: true });
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
