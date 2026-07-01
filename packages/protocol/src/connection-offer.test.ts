import { describe, expect, it } from "vitest";

import {
  ConnectionOfferSchema,
  decodeOfferFragmentPayload,
  parseConnectionOfferFromUrl,
} from "./connection-offer.js";

function encodeBase64UrlNoPadUtf8(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("connection offer", () => {
  it("decodes base64url JSON payloads", () => {
    const payload = {
      v: 3,
      serverId: "srv_server123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.thoth.seeles.ai:443", protocolVersion: 3 },
      pairingToken: "pt_abcdefghijklmnopqrstuvwxyz123456",
      pairingExpiresAt: "2026-07-01T00:15:00.000Z",
    };

    expect(decodeOfferFragmentPayload(encodeBase64UrlNoPadUtf8(JSON.stringify(payload)))).toEqual(
      payload,
    );
  });

  it("parses connection offers from QR-style URLs", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 3,
      serverId: "srv_server123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.thoth.seeles.ai:443", useTls: true, protocolVersion: 3 },
      pairingToken: "pt_abcdefghijklmnopqrstuvwxyz123456",
      pairingExpiresAt: "2026-07-01T00:15:00.000Z",
    });
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));

    expect(parseConnectionOfferFromUrl(`https://app.thoth.seeles.ai/#offer=${encoded}`)).toEqual(
      offer,
    );
  });

  it("leaves relay TLS unset when absent", () => {
    expect(
      ConnectionOfferSchema.parse({
        v: 3,
        serverId: "srv_server123",
        daemonPublicKeyB64: "pubkey",
        relay: { endpoint: "relay.example.com:80", protocolVersion: 3 },
        pairingToken: "pt_abcdefghijklmnopqrstuvwxyz123456",
        pairingExpiresAt: "2026-07-01T00:15:00.000Z",
      }),
    ).toEqual({
      v: 3,
      serverId: "srv_server123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:80", protocolVersion: 3 },
      pairingToken: "pt_abcdefghijklmnopqrstuvwxyz123456",
      pairingExpiresAt: "2026-07-01T00:15:00.000Z",
    });
  });

  it("round-trips relay TLS in offers without rejecting extra relay fields", () => {
    const offer = ConnectionOfferSchema.parse({
      v: 3,
      serverId: "srv_server123",
      daemonPublicKeyB64: "pubkey",
      relay: {
        endpoint: "relay.example.com:443",
        useTls: true,
        protocolVersion: 3,
        extra: "future",
      },
      pairingToken: "pt_abcdefghijklmnopqrstuvwxyz123456",
      pairingExpiresAt: "2026-07-01T00:15:00.000Z",
    });
    const encoded = encodeBase64UrlNoPadUtf8(JSON.stringify(offer));

    expect(parseConnectionOfferFromUrl(`https://app.thoth.seeles.ai/#offer=${encoded}`)).toEqual({
      v: 3,
      serverId: "srv_server123",
      daemonPublicKeyB64: "pubkey",
      relay: { endpoint: "relay.example.com:443", useTls: true, protocolVersion: 3 },
      pairingToken: "pt_abcdefghijklmnopqrstuvwxyz123456",
      pairingExpiresAt: "2026-07-01T00:15:00.000Z",
    });
  });

  it("returns null when the URL has no offer fragment", () => {
    expect(parseConnectionOfferFromUrl("https://app.thoth.seeles.ai/pair")).toBeNull();
  });
});
