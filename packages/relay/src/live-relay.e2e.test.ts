import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { createHash, randomBytes } from "node:crypto";
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
  encrypt,
  decrypt,
} from "./crypto.js";

// This live test uses the hosted relay's real TLS endpoint. Self-hosted relay TLS
// opt-in is covered at URL-building/integration level so the local E2E does not
// need to provision trusted certificates.
const RELAY_BASE_URL = process.env.THOTH_RELAY_LIVE_URL ?? "wss://relay.test.thoth.seeles.ai";
const randomToken = (prefix: string) => `${prefix}_${randomBytes(24).toString("base64url")}`;
const serverToken = randomToken("rst");
const pairingToken = randomToken("rpt");
const deviceToken = randomToken("rdt");

const tokenProtocols = (token: string) => ["thoth.relay.v3", `thoth.relay.token.${token}`];
const sha256 = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const futureIso = () => new Date(Date.now() + 60_000).toISOString();
const openRelayWebSocket = (url: string, token: string) =>
  new WebSocket(url, tokenProtocols(token), { family: 4, handshakeTimeout: 10_000 });

async function withRetry<T>(
  fn: () => Promise<T>,
  options: { retries: number; delayMs: number },
): Promise<T> {
  async function attempt(attemptNumber: number, lastError: unknown): Promise<T> {
    if (attemptNumber > options.retries) {
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    try {
      return await fn();
    } catch (error) {
      if (attemptNumber < options.retries) {
        await new Promise((r) => setTimeout(r, options.delayMs));
      }
      return attempt(attemptNumber + 1, error);
    }
  }
  return attempt(0, null);
}

function waitOpen(ws: WebSocket, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off("open", onOpen);
      ws.off("error", onError);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out opening ${label} websocket`));
    }, 10_000);
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
  });
}

function waitForConnected(ws: WebSocket, connectionId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off("message", onMessage);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for connected"));
    }, 10_000);
    const onMessage = (raw: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(raw.toString());
        const isConnected = msg?.type === "connected" && msg.connectionId === connectionId;
        const isInSync =
          msg?.type === "sync" &&
          Array.isArray(msg.connectionIds) &&
          msg.connectionIds.includes(connectionId);
        if (isConnected || isInSync) {
          cleanup();
          resolve();
        }
      } catch {
        // ignore
      }
    };
    ws.on("message", onMessage);
  });
}

function waitForOnceMessage<T extends "string" | "buffer">(
  ws: WebSocket,
  mode: T,
  timeoutError: string,
): Promise<T extends "string" ? string : Buffer> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off("message", onMessage);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutError));
    }, 10_000);
    const onMessage = (data: WebSocket.RawData) => {
      cleanup();
      resolve(
        (mode === "string" ? data.toString() : (data as Buffer)) as T extends "string"
          ? string
          : Buffer,
      );
    };
    ws.once("message", onMessage);
  });
}

async function registerRelayRoom(ws: WebSocket): Promise<void> {
  ws.send(
    JSON.stringify({
      type: "register",
      serverTokenHash: sha256(serverToken),
      pairingTokenHash: sha256(pairingToken),
      pairingExpiresAt: futureIso(),
      deviceTokenHashes: [sha256(deviceToken)],
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
}

describe("Live Seele Relay v3 E2E", () => {
  const liveIt = process.env.THOTH_RELAY_LIVE_E2E === "1" ? it : it.skip;

  liveIt("bridges encrypted traffic end-to-end", { timeout: 120_000 }, async () => {
    await withRetry(
      async () => {
        const serverId = `srv_live_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const connectionId = `clt_live_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const serverControlUrl = `${RELAY_BASE_URL}/ws?serverId=${encodeURIComponent(serverId)}&role=server&v=3`;
        const serverDataUrl = `${RELAY_BASE_URL}/ws?serverId=${encodeURIComponent(
          serverId,
        )}&role=server&connectionId=${encodeURIComponent(connectionId)}&v=3`;
        const clientUrl = `${RELAY_BASE_URL}/ws?serverId=${encodeURIComponent(
          serverId,
        )}&role=client&connectionId=${encodeURIComponent(connectionId)}&v=3`;

        // === Key setup ===
        const daemonKeyPair = generateKeyPair();
        const daemonPubKeyB64 = exportPublicKey(daemonKeyPair.publicKey);

        const clientKeyPair = generateKeyPair();
        const clientPubKeyB64 = exportPublicKey(clientKeyPair.publicKey);

        const daemonPubKeyOnClient = importPublicKey(daemonPubKeyB64);
        const clientSharedKey = deriveSharedKey(clientKeyPair.secretKey, daemonPubKeyOnClient);

        // === Connect ===
        const daemonControlWs = openRelayWebSocket(serverControlUrl, serverToken);
        let clientWs: WebSocket | null = null;
        let daemonWs: WebSocket | null = null;

        try {
          await waitOpen(daemonControlWs, "server-control");
          await registerRelayRoom(daemonControlWs);

          const waitForClientSeen = waitForConnected(daemonControlWs, connectionId);
          clientWs = openRelayWebSocket(clientUrl, pairingToken);
          await Promise.all([waitOpen(clientWs, "client"), waitForClientSeen]);

          daemonWs = openRelayWebSocket(serverDataUrl, serverToken);
          await waitOpen(daemonWs, "server-data");

          // === Handshake ===
          // Client sends hello with its public key (not encrypted).
          const waitForHello = waitForOnceMessage(
            daemonWs,
            "string",
            "Timed out waiting for hello",
          );
          clientWs.send(JSON.stringify({ type: "hello", key: clientPubKeyB64 }));
          const daemonReceivedHello = await waitForHello;

          const hello = JSON.parse(daemonReceivedHello) as {
            type: string;
            key?: string;
          };
          expect(hello.type).toBe("hello");
          expect(typeof hello.key).toBe("string");

          const clientPubKeyOnDaemon = importPublicKey(hello.key!);
          const daemonSharedKey = deriveSharedKey(daemonKeyPair.secretKey, clientPubKeyOnDaemon);

          // === Encrypted exchange ===
          const plaintextFromClient = "hello-from-client";
          const ciphertextFromClient = encrypt(clientSharedKey, plaintextFromClient);
          const waitForClientCiphertext = waitForOnceMessage(
            daemonWs,
            "buffer",
            "Timed out waiting for encrypted message",
          );
          clientWs.send(Buffer.from(ciphertextFromClient));
          const daemonReceivedCiphertext = await waitForClientCiphertext;

          const decryptedOnDaemon = decrypt(
            daemonSharedKey,
            daemonReceivedCiphertext.buffer.slice(
              daemonReceivedCiphertext.byteOffset,
              daemonReceivedCiphertext.byteOffset + daemonReceivedCiphertext.byteLength,
            ),
          );
          expect(decryptedOnDaemon).toBe(plaintextFromClient);

          const plaintextFromDaemon = "hello-from-daemon";
          const ciphertextFromDaemon = encrypt(daemonSharedKey, plaintextFromDaemon);
          const waitForDaemonCiphertext = waitForOnceMessage(
            clientWs,
            "buffer",
            "Timed out waiting for encrypted response",
          );
          daemonWs.send(Buffer.from(ciphertextFromDaemon));
          const clientReceivedCiphertext = await waitForDaemonCiphertext;

          const decryptedOnClient = decrypt(
            clientSharedKey,
            clientReceivedCiphertext.buffer.slice(
              clientReceivedCiphertext.byteOffset,
              clientReceivedCiphertext.byteOffset + clientReceivedCiphertext.byteLength,
            ),
          );
          expect(decryptedOnClient).toBe(plaintextFromDaemon);
        } finally {
          daemonControlWs.close();
          daemonWs?.close();
          clientWs?.close();
        }
      },
      { retries: 4, delayMs: 1_000 },
    );
  });
});
