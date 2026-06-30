import { expect, test } from "vitest";

test("keeps daemon-client APIs out of the server public entry", async () => {
  const serverExports = await import("./exports.js");

  expect(serverExports.createThothDaemon).toBeTypeOf("function");
  expect(serverExports.resolveThothHome).toBeTypeOf("function");

  for (const name of [
    "DaemonClient",
    "DaemonClientConfig",
    "ConnectionState",
    "DaemonEvent",
    "WebSocketFactory",
    "WebSocketLike",
  ]) {
    expect(serverExports).not.toHaveProperty(name);
  }
});
