import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type pino from "pino";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";

export const RELAY_PAIRING_TTL_MS = 15 * 60 * 1000;
export const RELAY_DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const RELAY_CREDENTIALS_FILENAME = "relay-credentials.json";

export interface RelayRegistrationMessage {
  type: "register";
  serverTokenHash: string;
  pairingTokenHash: string | null;
  pairingExpiresAt: string | null;
  deviceTokenHashes: string[];
}

export interface RelayPairingTicket {
  token: string;
  expiresAt: string;
}

export interface RelayDeviceToken {
  token: string;
  expiresAt: string;
}

interface PersistedRelayPairingTicket {
  token: string;
  expiresAt: string;
}

interface PersistedRelayDeviceToken {
  hash: string;
  expiresAt: string;
  issuedAt: string;
}

interface PersistedRelayCredentials {
  v: 1;
  serverToken: string;
  pairing: PersistedRelayPairingTicket | null;
  deviceTokens: PersistedRelayDeviceToken[];
  updatedAt: string;
}

export interface RelayCredentialsManager {
  readonly serverToken: string;
  createPairingTicket(): RelayPairingTicket;
  issueDeviceToken(): RelayDeviceToken;
  rotateAllDevices(): void;
  buildRegistrationMessage(): RelayRegistrationMessage;
  onRegistrationChanged(handler: (message: RelayRegistrationMessage) => void): () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function hashRelayToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function addMs(date: Date, ms: number): string {
  return new Date(date.getTime() + ms).toISOString();
}

function isFuture(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > now;
}

function credentialsPath(thothHome: string): string {
  return path.join(thothHome, RELAY_CREDENTIALS_FILENAME);
}

function normalizePersistedCredentials(value: unknown): PersistedRelayCredentials | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return null;
  if (typeof record.serverToken !== "string" || !record.serverToken.trim()) return null;
  const deviceTokens = Array.isArray(record.deviceTokens)
    ? record.deviceTokens
        .map((entry): PersistedRelayDeviceToken | null => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
          const item = entry as Record<string, unknown>;
          if (typeof item.hash !== "string" || !item.hash) return null;
          if (typeof item.expiresAt !== "string" || !item.expiresAt) return null;
          if (typeof item.issuedAt !== "string" || !item.issuedAt) return null;
          return { hash: item.hash, expiresAt: item.expiresAt, issuedAt: item.issuedAt };
        })
        .filter((entry): entry is PersistedRelayDeviceToken => entry !== null)
    : [];
  let pairing: PersistedRelayPairingTicket | null = null;
  if (record.pairing && typeof record.pairing === "object" && !Array.isArray(record.pairing)) {
    const pairingRecord = record.pairing as Record<string, unknown>;
    if (
      typeof pairingRecord.token === "string" &&
      pairingRecord.token.trim() &&
      typeof pairingRecord.expiresAt === "string" &&
      pairingRecord.expiresAt.trim()
    ) {
      pairing = { token: pairingRecord.token, expiresAt: pairingRecord.expiresAt };
    }
  }
  return {
    v: 1,
    serverToken: record.serverToken,
    pairing,
    deviceTokens,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : nowIso(),
  };
}

function createFreshCredentials(): PersistedRelayCredentials {
  return {
    v: 1,
    serverToken: generateToken("rst"),
    pairing: null,
    deviceTokens: [],
    updatedAt: nowIso(),
  };
}

function readCredentials(filePath: string, logger?: pino.Logger): PersistedRelayCredentials {
  if (!existsSync(filePath)) return createFreshCredentials();
  try {
    ensurePrivateFile(filePath);
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return normalizePersistedCredentials(parsed) ?? createFreshCredentials();
  } catch (error) {
    logger?.warn({ err: error }, "relay_credentials_read_failed_regenerating");
    return createFreshCredentials();
  }
}

export function loadOrCreateRelayCredentials(
  thothHome: string,
  logger?: pino.Logger,
): RelayCredentialsManager {
  const filePath = credentialsPath(thothHome);
  let data = readCredentials(filePath, logger);
  const listeners = new Set<(message: RelayRegistrationMessage) => void>();

  function persist(): void {
    data = pruneExpired(data);
    data.updatedAt = nowIso();
    writePrivateFileAtomicSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  }

  function notify(): void {
    const message = buildRegistrationMessage();
    for (const listener of listeners) {
      try {
        listener(message);
      } catch (error) {
        logger?.warn({ err: error }, "relay_registration_listener_failed");
      }
    }
  }

  function pruneExpired(input: PersistedRelayCredentials): PersistedRelayCredentials {
    return {
      ...input,
      pairing: isFuture(input.pairing?.expiresAt) ? input.pairing : null,
      deviceTokens: input.deviceTokens.filter((token) => isFuture(token.expiresAt)),
    };
  }

  function buildRegistrationMessage(): RelayRegistrationMessage {
    data = pruneExpired(data);
    return {
      type: "register",
      serverTokenHash: hashRelayToken(data.serverToken),
      pairingTokenHash: data.pairing ? hashRelayToken(data.pairing.token) : null,
      pairingExpiresAt: data.pairing?.expiresAt ?? null,
      deviceTokenHashes: data.deviceTokens.map((token) => token.hash),
    };
  }

  persist();

  return {
    get serverToken() {
      return data.serverToken;
    },
    createPairingTicket() {
      const ticket = {
        token: generateToken("rpt"),
        expiresAt: addMs(new Date(), RELAY_PAIRING_TTL_MS),
      };
      data.pairing = ticket;
      persist();
      notify();
      return ticket;
    },
    issueDeviceToken() {
      const token = generateToken("rdt");
      const issuedAt = nowIso();
      const expiresAt = addMs(new Date(), RELAY_DEVICE_TOKEN_TTL_MS);
      data.deviceTokens.push({
        hash: hashRelayToken(token),
        issuedAt,
        expiresAt,
      });
      persist();
      notify();
      return { token, expiresAt };
    },
    rotateAllDevices() {
      data.pairing = null;
      data.deviceTokens = [];
      persist();
      notify();
    },
    buildRegistrationMessage,
    onRegistrationChanged(handler) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
  };
}
