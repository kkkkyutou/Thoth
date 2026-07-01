import {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketProtocols,
  buildRelayWebSocketUrl as buildSharedRelayWebSocketUrl,
  DEFAULT_DIRECT_DAEMON_ENDPOINT,
  DEFAULT_DIRECT_DAEMON_PORT,
  deriveLabelFromEndpoint,
  extractHostPortFromWebSocketUrl,
  normalizeHostPort,
  parseConnectionUri,
  parseHostPort,
  serializeConnectionUri,
  serializeConnectionUriForStorage,
  shouldUseTlsForDefaultHostedRelay,
  type HostPortParts,
} from "@thoth/protocol/daemon-endpoints";

export { decodeOfferFragmentPayload } from "@thoth/protocol/connection-offer";

export type { HostPortParts };

export {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketProtocols,
  DEFAULT_DIRECT_DAEMON_ENDPOINT,
  DEFAULT_DIRECT_DAEMON_PORT,
  deriveLabelFromEndpoint,
  extractHostPortFromWebSocketUrl,
  normalizeHostPort,
  parseConnectionUri,
  parseHostPort,
  serializeConnectionUri,
  serializeConnectionUriForStorage,
  shouldUseTlsForDefaultHostedRelay,
};

export function buildRelayWebSocketUrl(params: {
  endpoint: string;
  serverId: string;
  useTls: boolean;
}): string {
  return buildSharedRelayWebSocketUrl({ ...params, role: "client" });
}
