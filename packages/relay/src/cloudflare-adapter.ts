/**
 * Cloudflare Durable Objects adapter for the Thoth relay.
 *
 * The relay is zero-knowledge: it forwards opaque ciphertext and stores only
 * connection metadata plus hashed relay capability tokens.
 */

import {
  RELAY_SUBPROTOCOL,
  extractRelayTokenFromProtocols,
} from "@thoth/protocol/daemon-endpoints";
import type { ConnectionRole, RelaySessionAttachment } from "./types.js";

const CURRENT_RELAY_VERSION = "3";
const ROOM_STORAGE_KEY = "room:v3";
const ROOM_GRACE_MS = 30 * 60 * 1000;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PENDING_FRAMES_PER_CONNECTION = 200;
const MAX_PENDING_BYTES_PER_CONNECTION = 8 * 1024 * 1024;
const MAX_CLIENT_SOCKETS_PER_ROOM = 512;
const MAX_SERVER_DATA_SOCKETS_PER_ROOM = 512;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://app.thoth.seeles.ai",
  "https://test.thoth.seeles.ai",
  "http://localhost:8081",
  "http://localhost:19006",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:8081",
  "http://127.0.0.1:19006",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

interface WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
}

interface DurableObjectState {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  storage?: DurableObjectStorage;
}

interface WebSocketWithAttachment extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface Env {
  RELAY: DurableObjectNamespace;
  RELAY_ALLOWED_ORIGINS?: string;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface CFResponseInit extends ResponseInit {
  webSocket?: WebSocket;
}

type RelaySocketKind = "server-control" | "server-data" | "client";

interface RelayRoomState {
  v: 3;
  serverTokenHash: string;
  pairingTokenHash: string | null;
  pairingExpiresAt: string | null;
  deviceTokenHashes: string[];
  updatedAt: string;
}

interface RelayRegistrationMessage {
  type: "register";
  serverTokenHash: string;
  pairingTokenHash: string | null;
  pairingExpiresAt: string | null;
  deviceTokenHashes: string[];
}

interface PendingFrameBuffer {
  frames: Array<string | ArrayBuffer>;
  bytes: number;
}

function hasAttachmentMethods(ws: WebSocket): ws is WebSocketWithAttachment {
  return (
    "serializeAttachment" in ws &&
    "deserializeAttachment" in ws &&
    typeof Reflect.get(ws, "serializeAttachment") === "function" &&
    typeof Reflect.get(ws, "deserializeAttachment") === "function"
  );
}

function deserializeAttachment(ws: WebSocket): unknown {
  if (!hasAttachmentMethods(ws)) return null;
  try {
    return ws.deserializeAttachment();
  } catch {
    return null;
  }
}

function serializeAttachment(ws: WebSocket, value: unknown): void {
  if (!hasAttachmentMethods(ws)) {
    throw new Error("WebSocket does not support attachments");
  }
  ws.serializeAttachment(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function getGlobalWebSocketPair(): (new () => WebSocketPair) | undefined {
  const WebSocketPair = Reflect.get(globalThis, "WebSocketPair") as unknown;
  return typeof WebSocketPair === "function"
    ? (WebSocketPair as new () => WebSocketPair)
    : undefined;
}

function isValidServerId(value: string | null): value is string {
  return typeof value === "string" && /^srv_[A-Za-z0-9_-]{4,80}$/.test(value);
}

function isValidConnectionId(value: string): boolean {
  return value.length <= 96 && /^[A-Za-z0-9_-]+$/.test(value);
}

function isValidToken(value: string | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

function isRelayRegistrationMessage(value: unknown): value is RelayRegistrationMessage {
  if (!isRecord(value)) return false;
  if (value.type !== "register") return false;
  if (typeof value.serverTokenHash !== "string" || !value.serverTokenHash) return false;
  if (value.pairingTokenHash !== null && typeof value.pairingTokenHash !== "string") return false;
  if (value.pairingExpiresAt !== null && typeof value.pairingExpiresAt !== "string") return false;
  if (!Array.isArray(value.deviceTokenHashes)) return false;
  return value.deviceTokenHashes.every((entry) => typeof entry === "string" && entry.length > 0);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function byteLength(message: string | ArrayBuffer): number {
  if (typeof message === "string") return new TextEncoder().encode(message).byteLength;
  return message.byteLength;
}

function hashShort(value: string | null | undefined): string {
  if (!value) return "none";
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseAllowedOrigins(env: Env): string[] {
  const raw = env.RELAY_ALLOWED_ORIGINS?.trim();
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isOriginAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return parseAllowedOrigins(env).includes(origin);
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let i = 0; i < left.length; i += 1) {
    result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return result === 0;
}

function normalizeRoomState(value: unknown): RelayRoomState | null {
  if (!isRecord(value)) return null;
  if (value.v !== 3) return null;
  if (typeof value.serverTokenHash !== "string" || !value.serverTokenHash) return null;
  if (value.pairingTokenHash !== null && typeof value.pairingTokenHash !== "string") return null;
  if (value.pairingExpiresAt !== null && typeof value.pairingExpiresAt !== "string") return null;
  if (!Array.isArray(value.deviceTokenHashes)) return null;
  if (!value.deviceTokenHashes.every((entry) => typeof entry === "string" && entry.length > 0)) {
    return null;
  }
  if (typeof value.updatedAt !== "string" || !value.updatedAt) return null;
  return {
    v: 3,
    serverTokenHash: value.serverTokenHash,
    pairingTokenHash: value.pairingTokenHash,
    pairingExpiresAt: value.pairingExpiresAt,
    deviceTokenHashes: value.deviceTokenHashes,
    updatedAt: value.updatedAt,
  };
}

function isRoomFresh(room: RelayRoomState, now: number): boolean {
  const updatedAt = Date.parse(room.updatedAt);
  return Number.isFinite(updatedAt) && now - updatedAt <= ROOM_GRACE_MS;
}

function isPairingTokenFresh(room: RelayRoomState, now: number): boolean {
  if (!room.pairingExpiresAt) return false;
  const expiresAt = Date.parse(room.pairingExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export class RelayDurableObject {
  private state: DurableObjectState;
  private roomState: RelayRoomState | null = null;
  private pendingFrames = new Map<string, PendingFrameBuffer>();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  private createWebSocketPair(): [WebSocket, WebSocket] {
    const WebSocketPairCtor = getGlobalWebSocketPair();
    if (!WebSocketPairCtor) {
      throw new Error("WebSocketPair not available in global scope");
    }
    const pair: WebSocketPair = new WebSocketPairCtor();
    return [pair[0], pair[1]];
  }

  private requireWebSocketUpgrade(request: Request): Response | null {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    return null;
  }

  private asSwitchingProtocolsResponse(client: WebSocket): Response {
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": RELAY_SUBPROTOCOL },
    } as CFResponseInit);
  }

  private async loadRoomState(): Promise<RelayRoomState | null> {
    if (this.roomState) return this.roomState;
    if (!this.state.storage) return null;
    const stored = await this.state.storage.get(ROOM_STORAGE_KEY);
    this.roomState = normalizeRoomState(stored);
    return this.roomState;
  }

  private async saveRoomState(room: RelayRoomState): Promise<void> {
    this.roomState = room;
    if (this.state.storage) {
      await this.state.storage.put(ROOM_STORAGE_KEY, room);
    }
  }

  private async clearRoomState(): Promise<void> {
    this.roomState = null;
    if (this.state.storage) {
      await this.state.storage.delete(ROOM_STORAGE_KEY);
    }
  }

  private async tokenMatches(hash: string, token: string): Promise<boolean> {
    const candidate = await sha256(token);
    return timingSafeEqualHex(candidate, hash);
  }

  private async authorizeServerToken(token: string, now: number): Promise<Response | null> {
    const room = await this.loadRoomState();
    if (!room) return null;
    if (!isRoomFresh(room, now)) {
      await this.clearRoomState();
      return new Response("Relay room expired", { status: 401 });
    }
    if (!(await this.tokenMatches(room.serverTokenHash, token))) {
      return new Response("Invalid relay token", { status: 401 });
    }
    return null;
  }

  private async authorizeClientToken(token: string, now: number): Promise<Response | null> {
    const room = await this.loadRoomState();
    if (!room) return new Response("Relay room is not registered", { status: 401 });
    if (!isRoomFresh(room, now)) {
      await this.clearRoomState();
      return new Response("Relay room expired", { status: 401 });
    }
    if (
      room.pairingTokenHash &&
      isPairingTokenFresh(room, now) &&
      (await this.tokenMatches(room.pairingTokenHash, token))
    ) {
      return null;
    }
    for (const hash of room.deviceTokenHashes) {
      if (await this.tokenMatches(hash, token)) {
        return null;
      }
    }
    return new Response("Invalid relay token", { status: 401 });
  }

  private hasServerDataSocket(connectionId: string): boolean {
    try {
      return this.state.getWebSockets(`server:${connectionId}`).length > 0;
    } catch {
      return false;
    }
  }

  private hasClientSocket(connectionId: string): boolean {
    try {
      return this.state.getWebSockets(`client:${connectionId}`).length > 0;
    } catch {
      return false;
    }
  }

  private clientSocketCount(): number {
    return this.state.getWebSockets("client").length;
  }

  private serverDataSocketCount(): number {
    return this.state.getWebSockets("server").length;
  }

  private closeExistingServerSockets(kind: RelaySocketKind, resolvedConnectionId: string): void {
    if (kind === "server-control") {
      for (const ws of this.state.getWebSockets("server-control")) {
        ws.close(1008, "Replaced by new connection");
      }
    } else if (kind === "server-data") {
      for (const ws of this.state.getWebSockets(`server:${resolvedConnectionId}`)) {
        ws.close(1008, "Replaced by new connection");
      }
    }
  }

  private nudgeOrResetControlForConnection(connectionId: string): void {
    const initialDelayMs = 10_000;
    const secondDelayMs = 5_000;

    setTimeout(() => {
      if (!this.hasClientSocket(connectionId)) return;
      if (this.hasServerDataSocket(connectionId)) return;
      this.notifyControls({ type: "sync", connectionIds: this.listConnectedConnectionIds() });

      setTimeout(() => {
        if (!this.hasClientSocket(connectionId)) return;
        if (this.hasServerDataSocket(connectionId)) return;
        for (const ws of this.state.getWebSockets("server-control")) {
          try {
            ws.close(1011, "Control unresponsive");
          } catch {
            // ignore
          }
        }
      }, secondDelayMs);
    }, initialDelayMs);
  }

  private bufferFrame(connectionId: string, message: string | ArrayBuffer): void {
    const size = byteLength(message);
    if (size > MAX_FRAME_BYTES) return;

    const existing = this.pendingFrames.get(connectionId) ?? { frames: [], bytes: 0 };
    existing.frames.push(message);
    existing.bytes += size;
    while (
      existing.frames.length > MAX_PENDING_FRAMES_PER_CONNECTION ||
      existing.bytes > MAX_PENDING_BYTES_PER_CONNECTION
    ) {
      const dropped = existing.frames.shift();
      if (!dropped) break;
      existing.bytes -= byteLength(dropped);
    }
    this.pendingFrames.set(connectionId, existing);
  }

  private flushFrames(connectionId: string, serverWs: WebSocket): void {
    const buffer = this.pendingFrames.get(connectionId);
    if (!buffer || buffer.frames.length === 0) return;
    this.pendingFrames.delete(connectionId);
    for (const frame of buffer.frames) {
      try {
        serverWs.send(frame);
      } catch {
        this.bufferFrame(connectionId, frame);
        break;
      }
    }
  }

  private listConnectedConnectionIds(): string[] {
    const out = new Set<string>();
    for (const ws of this.state.getWebSockets("client")) {
      const attachmentRaw = deserializeAttachment(ws);
      const attachment = isRecord(attachmentRaw) ? attachmentRaw : null;
      if (
        attachment?.role === "client" &&
        typeof attachment.connectionId === "string" &&
        attachment.connectionId
      ) {
        out.add(attachment.connectionId);
      }
    }
    return Array.from(out);
  }

  private notifyControls(message: unknown): void {
    const text = JSON.stringify(message);
    for (const ws of this.state.getWebSockets("server-control")) {
      try {
        ws.send(text);
      } catch {
        try {
          ws.close(1011, "Control send failed");
        } catch {
          // ignore
        }
      }
    }
  }

  private async acceptV3(args: {
    request: Request;
    role: ConnectionRole;
    serverId: string;
    connectionId: string;
    token: string;
  }): Promise<Response> {
    const upgradeError = this.requireWebSocketUpgrade(args.request);
    if (upgradeError) return upgradeError;

    const now = Date.now();
    const resolvedConnectionId =
      args.role === "client" && !args.connectionId
        ? `conn_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`
        : args.connectionId;
    if (resolvedConnectionId && !isValidConnectionId(resolvedConnectionId)) {
      return new Response("Invalid connectionId parameter", { status: 400 });
    }

    const kind: RelaySocketKind =
      args.role === "client" ? "client" : resolvedConnectionId ? "server-data" : "server-control";

    if (kind === "client" && this.clientSocketCount() >= MAX_CLIENT_SOCKETS_PER_ROOM) {
      return new Response("Relay room client limit exceeded", { status: 429 });
    }
    if (
      kind === "server-data" &&
      this.serverDataSocketCount() >= MAX_SERVER_DATA_SOCKETS_PER_ROOM
    ) {
      return new Response("Relay room server data limit exceeded", { status: 429 });
    }

    const authError =
      args.role === "client"
        ? await this.authorizeClientToken(args.token, now)
        : await this.authorizeServerToken(args.token, now);
    if (authError) return authError;

    this.closeExistingServerSockets(kind, resolvedConnectionId);

    const [client, server] = this.createWebSocketPair();
    const tags: string[] = [];
    if (kind === "client") {
      tags.push("client", `client:${resolvedConnectionId}`);
    } else if (kind === "server-control") {
      tags.push("server-control");
    } else {
      tags.push("server", `server:${resolvedConnectionId}`);
    }
    this.state.acceptWebSocket(server, tags);

    const attachment: RelaySessionAttachment = {
      serverId: args.serverId,
      role: args.role,
      version: CURRENT_RELAY_VERSION,
      connectionId: resolvedConnectionId || null,
      createdAt: now,
    };
    serializeAttachment(server, attachment);

    console.log(
      `[Relay DO] v3:${kind} connected server=${hashShort(args.serverId)} connection=${hashShort(
        resolvedConnectionId,
      )}`,
    );

    if (kind === "client") {
      this.notifyControls({ type: "connected", connectionId: resolvedConnectionId });
      this.nudgeOrResetControlForConnection(resolvedConnectionId);
    }
    if (kind === "server-control") {
      try {
        server.send(
          JSON.stringify({ type: "sync", connectionIds: this.listConnectedConnectionIds() }),
        );
      } catch {
        // ignore
      }
    }
    if (kind === "server-data" && resolvedConnectionId) {
      this.flushFrames(resolvedConnectionId, server);
    }

    return this.asSwitchingProtocolsResponse(client);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roleRaw = url.searchParams.get("role");
    const role = roleRaw === "server" || roleRaw === "client" ? roleRaw : null;
    const serverId = url.searchParams.get("serverId");
    const connectionIdRaw = url.searchParams.get("connectionId");
    const connectionId = typeof connectionIdRaw === "string" ? connectionIdRaw.trim() : "";
    const version = url.searchParams.get("v");
    const token = extractRelayTokenFromProtocols(request.headers.get("Sec-WebSocket-Protocol"));

    if (version !== CURRENT_RELAY_VERSION) {
      return new Response("Invalid v parameter (expected 3)", { status: 400 });
    }
    if (!role) {
      return new Response("Missing or invalid role parameter", { status: 400 });
    }
    if (!isValidServerId(serverId)) {
      return new Response("Missing or invalid serverId parameter", { status: 400 });
    }
    if (!isValidToken(token)) {
      return new Response("Missing or invalid relay token", { status: 401 });
    }

    return this.acceptV3({ request, role, serverId, connectionId, token });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const size = byteLength(message);
    if (size > MAX_FRAME_BYTES) {
      ws.close(1009, "Frame too large");
      return;
    }

    const attachmentRaw = deserializeAttachment(ws);
    if (!isRecord(attachmentRaw)) {
      console.error("[Relay DO] message_without_attachment");
      ws.close(1011, "Missing attachment");
      return;
    }
    const attachment = attachmentRaw;
    const role = getString(attachment, "role");
    const connectionId = getString(attachment, "connectionId");

    if (!connectionId) {
      if (typeof message === "string") {
        const parsed = parseJson(message);
        if (isRelayRegistrationMessage(parsed)) {
          await this.saveRoomState({
            v: 3,
            serverTokenHash: parsed.serverTokenHash,
            pairingTokenHash: parsed.pairingTokenHash,
            pairingExpiresAt: parsed.pairingExpiresAt,
            deviceTokenHashes: parsed.deviceTokenHashes,
            updatedAt: new Date().toISOString(),
          });
          console.log("[Relay DO] room_registered");
          return;
        }
      }
      return;
    }

    if (role === "client") {
      const servers = this.state.getWebSockets(`server:${connectionId}`);
      if (servers.length === 0) {
        this.bufferFrame(connectionId, message);
        return;
      }
      for (const target of servers) {
        try {
          target.send(message);
        } catch (error) {
          console.error(
            `[Relay DO] forward_client_to_server_failed ${hashShort(connectionId)}`,
            error,
          );
        }
      }
      return;
    }

    const targets = this.state.getWebSockets(`client:${connectionId}`);
    for (const target of targets) {
      try {
        target.send(message);
      } catch (error) {
        console.error(
          `[Relay DO] forward_server_to_client_failed ${hashShort(connectionId)}`,
          error,
        );
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): void {
    const attachmentRaw = deserializeAttachment(ws);
    if (!isRecord(attachmentRaw)) return;
    const role = getString(attachmentRaw, "role");
    const connectionId = getString(attachmentRaw, "connectionId");
    const serverId = getString(attachmentRaw, "serverId");
    console.log(
      `[Relay DO] v3:${role ?? "unknown"} disconnected server=${hashShort(
        serverId,
      )} connection=${hashShort(connectionId)} code=${code} reason=${reason}`,
    );

    if (role === "client" && connectionId) {
      const remainingClientSockets = this.state
        .getWebSockets(`client:${connectionId}`)
        .some((socket) => socket !== ws);
      if (remainingClientSockets) return;

      this.pendingFrames.delete(connectionId);
      for (const serverWs of this.state.getWebSockets(`server:${connectionId}`)) {
        try {
          serverWs.close(1001, "Client disconnected");
        } catch {
          // ignore
        }
      }
      this.notifyControls({ type: "disconnected", connectionId });
      return;
    }

    if (role === "server" && connectionId) {
      for (const clientWs of this.state.getWebSockets(`client:${connectionId}`)) {
        try {
          clientWs.close(1012, "Server disconnected");
        } catch {
          // ignore
        }
      }
    }
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    const attachmentRaw = deserializeAttachment(ws);
    const attachment = isRecord(attachmentRaw) ? attachmentRaw : null;
    console.error(
      `[Relay DO] websocket_error role=${attachment ? getString(attachment, "role") : "unknown"}`,
      error,
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ status: "ok", protocol: CURRENT_RELAY_VERSION, service: "thoth-relay" }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }
    if (!isOriginAllowed(request, env)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    const serverId = url.searchParams.get("serverId");
    if (!isValidServerId(serverId)) {
      return new Response("Missing or invalid serverId parameter", { status: 400 });
    }
    if (url.searchParams.get("v") !== CURRENT_RELAY_VERSION) {
      return new Response("Invalid v parameter (expected 3)", { status: 400 });
    }
    if (url.searchParams.has("token") || url.searchParams.has("auth")) {
      return new Response("Relay token must be sent via Sec-WebSocket-Protocol", { status: 400 });
    }

    const id = env.RELAY.idFromName(`relay-v3:${serverId}`);
    const stub = env.RELAY.get(id);
    return stub.fetch(request);
  },
};
