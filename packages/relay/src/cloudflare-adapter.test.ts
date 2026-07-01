import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import relayWorker, { RelayDurableObject } from "./cloudflare-adapter.js";

type DurableObjectStateArg = ConstructorParameters<typeof RelayDurableObject>[0];
type RelayEnvArg = Parameters<typeof relayWorker.fetch>[1];

type MockSocket = WebSocket & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  serializeAttachment: ReturnType<typeof vi.fn>;
  deserializeAttachment: ReturnType<typeof vi.fn>;
};

function createMockSocket(attachment: unknown = null): MockSocket {
  let storedAttachment = attachment;
  return {
    send: vi.fn(),
    close: vi.fn(),
    serializeAttachment: vi.fn((value: unknown) => {
      storedAttachment = value;
    }),
    deserializeAttachment: vi.fn(() => storedAttachment),
  } as unknown as MockSocket;
}

function createMockState() {
  const socketsByTag = new Map<string, WebSocket[]>();
  const storageData = new Map<string, unknown>();
  const state = {
    acceptWebSocket: vi.fn((ws: WebSocket, tags?: string[]) => {
      for (const tag of tags ?? []) {
        const sockets = socketsByTag.get(tag) ?? [];
        sockets.push(ws);
        socketsByTag.set(tag, sockets);
      }
    }),
    getWebSockets: vi.fn((tag?: string): WebSocket[] => {
      if (!tag) {
        const out: WebSocket[] = [];
        for (const sockets of socketsByTag.values()) out.push(...sockets);
        return out;
      }
      return socketsByTag.get(tag) ?? [];
    }),
    storage: {
      get: vi.fn(async (key: string) => storageData.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storageData.set(key, value);
      }),
      delete: vi.fn(async (key: string) => storageData.delete(key)),
    },
  };

  return {
    state,
    setTagSockets: (tag: string, sockets: WebSocket[]) => {
      socketsByTag.set(tag, sockets);
    },
    setStorage: (key: string, value: unknown) => {
      storageData.set(key, value);
    },
  };
}

async function withMockWebSocketPair(
  run: (sockets: { clientWs: MockSocket; serverWs: MockSocket }) => Promise<void> | void,
): Promise<void> {
  const serverWs = createMockSocket();
  const clientWs = createMockSocket();
  const WebSocketPairMock = class {
    [index: number]: WebSocket;
    constructor() {
      this[0] = clientWs as unknown as WebSocket;
      this[1] = serverWs as unknown as WebSocket;
    }
  };

  const previousPair = (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
  (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = WebSocketPairMock;
  try {
    await run({ clientWs, serverWs });
  } finally {
    if (previousPair === undefined) {
      delete (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
    } else {
      (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = previousPair;
    }
  }
}

const swallow = () => undefined;
const serverToken = "rst_abcdefghijklmnopqrstuvwxyz123456";
const pairingToken = "rpt_abcdefghijklmnopqrstuvwxyz123456";
const deviceToken = "rdt_abcdefghijklmnopqrstuvwxyz123456";
const tokenProtocols = (token: string) => `thoth.relay.v3, thoth.relay.token.${token}`;
const sha256 = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const futureIso = () => new Date(Date.now() + 60_000).toISOString();

describe("RelayDurableObject versioning", () => {
  it("rejects legacy v1 and v2 sockets", async () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);

    for (const version of ["1", "2"]) {
      const response = await relay.fetch(
        new Request(`https://relay.test/ws?role=client&serverId=srv_test&v=${version}`, {
          headers: {
            Upgrade: "websocket",
            "Sec-WebSocket-Protocol": tokenProtocols(pairingToken),
          },
        }),
      );
      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toBe("Invalid v parameter (expected 3)");
    }
    expect(state.acceptWebSocket).not.toHaveBeenCalled();
  });

  it("accepts first daemon control socket and stores registration hashes", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async ({ serverWs }) => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      await relay
        .fetch(
          new Request("https://relay.test/ws?role=server&serverId=srv_test&v=3", {
            headers: {
              Upgrade: "websocket",
              "Sec-WebSocket-Protocol": tokenProtocols(serverToken),
            },
          }),
        )
        .catch(swallow);

      expect(state.acceptWebSocket).toHaveBeenCalled();
      await relay.webSocketMessage(
        serverWs as unknown as WebSocket,
        JSON.stringify({
          type: "register",
          serverTokenHash: sha256(serverToken),
          pairingTokenHash: sha256(pairingToken),
          pairingExpiresAt: futureIso(),
          deviceTokenHashes: [sha256(deviceToken)],
        }),
      );
      expect(state.storage.put).toHaveBeenCalledWith(
        "room:v3",
        expect.objectContaining({
          v: 3,
          serverTokenHash: sha256(serverToken),
          pairingTokenHash: sha256(pairingToken),
          deviceTokenHashes: [sha256(deviceToken)],
        }),
      );
    });
  });

  it("assigns a connectionId when a v3 client presents a fresh pairing token", async () => {
    const { state, setStorage } = createMockState();
    setStorage("room:v3", {
      v: 3,
      serverTokenHash: sha256(serverToken),
      pairingTokenHash: sha256(pairingToken),
      pairingExpiresAt: futureIso(),
      deviceTokenHashes: [],
      updatedAt: new Date().toISOString(),
    });

    await withMockWebSocketPair(async ({ serverWs }) => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request("https://relay.test/ws?role=client&serverId=srv_test&v=3", {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": tokenProtocols(pairingToken),
        },
      });
      await relay.fetch(req).catch(swallow);
      expect(state.acceptWebSocket).toHaveBeenCalled();
      const attachment = serverWs.deserializeAttachment();
      expect(attachment).toMatchObject({
        role: "client",
        connectionId: expect.stringMatching(/^conn_/),
      });
    });
  });

  it("rejects expired pairing tokens but accepts registered device tokens", async () => {
    const { state, setStorage } = createMockState();
    setStorage("room:v3", {
      v: 3,
      serverTokenHash: sha256(serverToken),
      pairingTokenHash: sha256(pairingToken),
      pairingExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      deviceTokenHashes: [sha256(deviceToken)],
      updatedAt: new Date().toISOString(),
    });
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);

    const expired = await relay.fetch(
      new Request("https://relay.test/ws?role=client&serverId=srv_test&v=3", {
        headers: {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": tokenProtocols(pairingToken),
        },
      }),
    );
    expect(expired.status).toBe(401);

    await withMockWebSocketPair(async () => {
      await relay
        .fetch(
          new Request("https://relay.test/ws?role=client&serverId=srv_test&v=3", {
            headers: {
              Upgrade: "websocket",
              "Sec-WebSocket-Protocol": tokenProtocols(deviceToken),
            },
          }),
        )
        .catch(swallow);
      expect(state.acceptWebSocket).toHaveBeenCalled();
    });
  });
});

describe("RelayDurableObject control nudge/reset behavior", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not nudge or reset control after the client already disconnected", () => {
    vi.useFakeTimers();
    const clientId = "clt_stale_timer";
    const control = createMockSocket();
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets("client", []);
    setTagSockets(`client:${clientId}`, []);
    setTagSockets(`server:${clientId}`, []);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    (
      relay as unknown as { nudgeOrResetControlForConnection(id: string): void }
    ).nudgeOrResetControlForConnection(clientId);

    vi.advanceTimersByTime(15_000);

    expect(control.send).not.toHaveBeenCalled();
    expect(control.close).not.toHaveBeenCalled();
  });

  it("resets control when the client remains connected but no server-data socket appears", () => {
    vi.useFakeTimers();
    const clientId = "clt_waiting_for_daemon";
    const control = createMockSocket();
    const client = createMockSocket({
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets("client", [client]);
    setTagSockets(`client:${clientId}`, [client]);
    setTagSockets(`server:${clientId}`, []);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    (
      relay as unknown as { nudgeOrResetControlForConnection(id: string): void }
    ).nudgeOrResetControlForConnection(clientId);

    vi.advanceTimersByTime(10_000);
    expect(control.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    expect(control.close).toHaveBeenCalledWith(1011, "Control unresponsive");
  });

  it("does not replace existing client sockets for the same connectionId", async () => {
    const existingClient = createMockSocket({
      version: "3",
      role: "client",
      connectionId: "clt_same_session",
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets, setStorage } = createMockState();
    setStorage("room:v3", {
      v: 3,
      serverTokenHash: sha256(serverToken),
      pairingTokenHash: sha256(pairingToken),
      pairingExpiresAt: futureIso(),
      deviceTokenHashes: [],
      updatedAt: new Date().toISOString(),
    });
    setTagSockets("client:clt_same_session", [existingClient]);
    setTagSockets("client", [existingClient]);

    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request(
        "https://relay.test/ws?role=client&serverId=srv_test&connectionId=clt_same_session&v=3",
        {
          headers: {
            Upgrade: "websocket",
            "Sec-WebSocket-Protocol": tokenProtocols(pairingToken),
          },
        },
      );

      await relay.fetch(req).catch(swallow);
      expect(existingClient.close).not.toHaveBeenCalled();
    });
  });

  it("keeps server data socket alive while at least one client socket remains", () => {
    const clientId = "clt_multi";
    const disconnectedClient = createMockSocket({
      version: "3",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const stillConnectedClient = createMockSocket({
      version: "3",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const serverData = createMockSocket();
    const control = createMockSocket();
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets(`server:${clientId}`, [serverData]);
    setTagSockets("client", [stillConnectedClient]);
    setTagSockets(`client:${clientId}`, [stillConnectedClient]);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    relay.webSocketClose(
      disconnectedClient as unknown as WebSocket,
      1001,
      "Client disconnected",
      true,
    );

    expect(serverData.close).not.toHaveBeenCalled();
    expect(control.send).not.toHaveBeenCalledWith(
      JSON.stringify({ type: "disconnected", connectionId: clientId }),
    );
  });
});

describe("relay worker endpoint routing", () => {
  it("rejects missing v instead of falling back to legacy protocols", async () => {
    const fetch = vi.fn(
      async (request: Request) => new Response(`ok:${new URL(request.url).searchParams.get("v")}`),
    );
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server"),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid v parameter (expected 3)");
    expect(idFromName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("routes v=3 to v3 isolated DO ids", async () => {
    const fetch = vi.fn(
      async (request: Request) => new Response(`ok:${new URL(request.url).searchParams.get("v")}`),
    );
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server&v=3", {
        headers: {
          "Sec-WebSocket-Protocol": tokenProtocols(serverToken),
        },
      }),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(idFromName).toHaveBeenCalledWith("relay-v3:srv_test");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("ok:3");
  });

  it("rejects invalid v values", async () => {
    const fetch = vi.fn();
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server&v=nope"),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid v parameter (expected 3)");
    expect(idFromName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects relay tokens in query parameters", async () => {
    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server&v=3&token=secret"),
      {
        RELAY: {
          idFromName: vi.fn(),
          get: vi.fn(),
        },
      } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "Relay token must be sent via Sec-WebSocket-Protocol",
    );
  });

  it("rejects browser origins outside the allowlist", async () => {
    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server&v=3", {
        headers: {
          Origin: "https://evil.example",
          "Sec-WebSocket-Protocol": tokenProtocols(serverToken),
        },
      }),
      {
        RELAY: {
          idFromName: vi.fn(),
          get: vi.fn(),
        },
      } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Origin not allowed");
  });
});
