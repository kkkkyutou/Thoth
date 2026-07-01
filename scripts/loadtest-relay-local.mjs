#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
} from "../packages/relay/dist/crypto.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const relayRoot = join(repoRoot, "packages", "relay");
const require = createRequire(import.meta.url);
const wranglerPackagePath = require.resolve("wrangler/package.json");
const wranglerPackage = require(wranglerPackagePath);
const wranglerCliPath = join(
  dirname(wranglerPackagePath),
  wranglerPackage.bin?.wrangler ?? "./bin/wrangler.js",
);

const clients = Number(process.env.RELAY_LOAD_CLIENTS ?? "200");
const durationMs = Number(process.env.RELAY_LOAD_DURATION_MS ?? "600000");
const intervalMs = Number(process.env.RELAY_LOAD_INTERVAL_MS ?? "5000");
const openTimeoutMs = Number(process.env.RELAY_LOAD_OPEN_TIMEOUT_MS ?? "20000");

const serverToken = "rst_abcdefghijklmnopqrstuvwxyz123456";
const pairingToken = "rpt_abcdefghijklmnopqrstuvwxyz123456";
const deviceToken = "rdt_abcdefghijklmnopqrstuvwxyz123456";

const tokenProtocols = (token) => ["thoth.relay.v3", `thoth.relay.token.${token}`];
const sha256 = (token) => createHash("sha256").update(token, "utf8").digest("hex");
const futureIso = () => new Date(Date.now() + 15 * 60_000).toISOString();
const randomId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`;

function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return Buffer.from(String(data)).buffer;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function spawnRelay(port) {
  return spawn(
    process.execPath,
    [
      wranglerCliPath,
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--live-reload=false",
      "--show-interactive-dev-session=false",
    ],
    {
      cwd: relayRoot,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function waitForTcp(port, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Relay exited early with code ${child.exitCode}`);
    try {
      await new Promise((resolve, reject) => {
        const socket = createServer();
        socket.close();
        const netSocket = new (require("node:net").Socket)();
        netSocket.once("connect", () => {
          netSocket.end();
          resolve();
        });
        netSocket.once("error", reject);
        netSocket.connect(port, "127.0.0.1");
      });
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`Relay did not open TCP port ${port}`);
}

function relayUrl(port, params) {
  const url = new URL(`ws://127.0.0.1:${port}/ws`);
  url.searchParams.set("serverId", params.serverId);
  url.searchParams.set("role", params.role);
  url.searchParams.set("v", "3");
  if (params.connectionId) url.searchParams.set("connectionId", params.connectionId);
  return url.toString();
}

function waitOpen(ws, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out opening ${label}`)), openTimeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  if (!Number.isFinite(clients) || clients < 1) throw new Error("RELAY_LOAD_CLIENTS must be >= 1");
  if (!Number.isFinite(durationMs) || durationMs < 1000) {
    throw new Error("RELAY_LOAD_DURATION_MS must be >= 1000");
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 100) {
    throw new Error("RELAY_LOAD_INTERVAL_MS must be >= 100");
  }

  const port = await getAvailablePort();
  const child = spawnRelay(port);
  child.stdout?.on("data", (data) => process.stdout.write(`[relay] ${data}`));
  child.stderr?.on("data", (data) => process.stderr.write(`[relay] ${data}`));

  const startedAt = new Date();
  const serverId = randomId("srv_load");
  const connections = [];
  const stats = {
    clients,
    attemptedPings: 0,
    pongs: 0,
    decryptFailures: 0,
    sendFailures: 0,
    socketErrors: 0,
    unexpectedMessages: 0,
    latenciesMs: [],
  };

  try {
    await waitForTcp(port, child, 30_000);
    const control = new WebSocket(
      relayUrl(port, { serverId, role: "server" }),
      tokenProtocols(serverToken),
    );
    await waitOpen(control, "server-control");
    control.send(
      JSON.stringify({
        type: "register",
        serverTokenHash: sha256(serverToken),
        pairingTokenHash: sha256(pairingToken),
        pairingExpiresAt: futureIso(),
        deviceTokenHashes: [sha256(deviceToken)],
      }),
    );
    await sleep(100);

    for (let i = 0; i < clients; i += 1) {
      const connectionId = `conn_${i}_${randomBytes(8).toString("hex")}`;
      const daemonKeyPair = generateKeyPair();
      const clientKeyPair = generateKeyPair();
      const sharedKey = deriveSharedKey(clientKeyPair.secretKey, daemonKeyPair.publicKey);
      const serverSharedKey = deriveSharedKey(daemonKeyPair.secretKey, clientKeyPair.publicKey);
      const clientWs = new WebSocket(
        relayUrl(port, { serverId, role: "client", connectionId }),
        tokenProtocols(pairingToken),
      );
      const serverWs = new WebSocket(
        relayUrl(port, { serverId, role: "server", connectionId }),
        tokenProtocols(serverToken),
      );
      await Promise.all([waitOpen(clientWs, `client-${i}`), waitOpen(serverWs, `server-${i}`)]);

      const pending = new Map();
      serverWs.on("message", (data) => {
        try {
          const text = decrypt(serverSharedKey, toArrayBuffer(data));
          if (typeof text !== "string" || !text.startsWith("ping:")) {
            stats.unexpectedMessages += 1;
            return;
          }
          serverWs.send(Buffer.from(encrypt(serverSharedKey, text.replace("ping:", "pong:"))));
        } catch {
          stats.decryptFailures += 1;
        }
      });
      clientWs.on("message", (data) => {
        try {
          const text = decrypt(sharedKey, toArrayBuffer(data));
          if (typeof text !== "string" || !text.startsWith("pong:")) {
            stats.unexpectedMessages += 1;
            return;
          }
          const key = text.slice("pong:".length);
          const sentAt = pending.get(key);
          if (sentAt) {
            stats.pongs += 1;
            stats.latenciesMs.push(Date.now() - sentAt);
            pending.delete(key);
          }
        } catch {
          stats.decryptFailures += 1;
        }
      });
      clientWs.on("error", () => {
        stats.socketErrors += 1;
      });
      serverWs.on("error", () => {
        stats.socketErrors += 1;
      });
      connections.push({ clientWs, serverWs, sharedKey, pending });
    }

    const deadline = Date.now() + durationMs;
    let tick = 0;
    while (Date.now() < deadline) {
      for (const connection of connections) {
        const id = `${tick}:${randomBytes(4).toString("hex")}`;
        connection.pending.set(id, Date.now());
        try {
          connection.clientWs.send(Buffer.from(encrypt(connection.sharedKey, `ping:${id}`)));
          stats.attemptedPings += 1;
        } catch {
          stats.sendFailures += 1;
        }
      }
      tick += 1;
      await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }

    await sleep(2000);
    const endedAt = new Date();
    const failures =
      stats.attemptedPings -
      stats.pongs +
      stats.decryptFailures +
      stats.sendFailures +
      stats.socketErrors;
    const errorRate = stats.attemptedPings > 0 ? failures / stats.attemptedPings : 1;
    const sorted = [...stats.latenciesMs].sort((a, b) => a - b);
    const percentile = (p) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
    const receipt = {
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      relayUrl: `ws://127.0.0.1:${port}`,
      serverIdPrefix: serverId.slice(0, 16),
      clients,
      durationMs,
      intervalMs,
      attemptedPings: stats.attemptedPings,
      pongs: stats.pongs,
      failures,
      errorRate,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      decryptFailures: stats.decryptFailures,
      sendFailures: stats.sendFailures,
      socketErrors: stats.socketErrors,
      unexpectedMessages: stats.unexpectedMessages,
    };
    mkdirSync(join(repoRoot, ".dev"), { recursive: true });
    const receiptPath = join(repoRoot, ".dev", `relay-load-test-${Date.now()}.json`);
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({ receiptPath, ...receipt }, null, 2));
    if (errorRate >= 0.01) process.exitCode = 1;
  } finally {
    for (const connection of connections) {
      connection.clientWs.close();
      connection.serverWs.close();
    }
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 2000).unref();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
