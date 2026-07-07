import { describe, expect, test } from "vitest";
import { applyTuiInteractionAction, createInitialTuiInteractionState } from "./interaction.js";
import { buildTuiSurfaceLines } from "./render.js";
import { buildTuiSurfaceModel } from "./surface.js";

describe("buildTuiSurfaceLines", () => {
  test("formats the product surface without adding hidden task authority", () => {
    const model = buildTuiSurfaceModel({
      connection: { status: "idle" },
      cwd: "/repo/current",
      terminalWidth: 100,
      terminalHeight: 32,
    });

    const text = buildTuiSurfaceLines(model)
      .map((line) => line.text)
      .join("\n");

    expect(text).toContain("One Thoth - OpenTUI");
    expect(text).toContain("Workspace: Needs a registered workspace");
    expect(text).toContain("Snapshot: Startup snapshot");
    expect(text).toContain("Next Actions");
    expect(text).toContain("W: Register workspace");
    expect(text).toContain("P: Provider setup");
    expect(text).toContain("Refresh provider readiness from daemon");
    expect(text).toContain("Active Route Detail");
    expect(text).toContain("One Thoth Home: Needs host");
    expect(text).toContain("+ Images/files <10MB | Provider | Mode Quick/Loop | Clarify | Loop");
    expect(text).toContain("Loop: Off in Quick");
    expect(text).toContain("Keys: Tab/arrows focus");
    expect(text).toContain("W workspace");
    expect(text).toContain("R refresh");
    expect(text).toContain("Active task: No frozen task yet");
    expect(text).toContain("Authority: daemon/client/protocol state only");
  });

  test("formats disconnected recovery without claiming a connected host", () => {
    const model = buildTuiSurfaceModel({
      connection: { status: "disconnected", reason: "Cannot connect to relay pairing offer" },
      cwd: "/repo/current",
      terminalWidth: 72,
      terminalHeight: 22,
      refresh: {
        status: "failed",
        updatedAt: "2026-07-02T12:00:00.000Z",
        error: "Relay closed before handshake completed",
      },
    });

    const text = buildTuiSurfaceLines(model)
      .map((line) => line.text)
      .join("\n");

    expect(text).toContain("Host: Cannot connect to relay pairing offer");
    expect(text).toContain("Refresh: Refresh failed 2026-07-02T12:00:00.000Z");
    expect(text).toContain("Refresh error: Relay closed before handshake completed");
    expect(text).toContain("Recovery: start Thoth daemon on 127.0.0.1:6688");
    expect(text).toContain("R: Retry snapshot");
    expect(text).toContain("Host: Start daemon");
    expect(text).not.toContain("Host: Connected");
  });

  test("formats provider and settings route detail panels", () => {
    const model = buildTuiSurfaceModel({
      connection: { status: "connected" },
      providers: {
        entries: [
          {
            provider: "codex",
            status: "ready",
            enabled: true,
            label: "Codex",
            models: [{ provider: "codex", id: "gpt-5", label: "GPT-5" }],
          },
        ],
        generatedAt: "2026-07-02T00:00:00.000Z",
        requestId: "providers_1",
      },
    });
    let interaction = createInitialTuiInteractionState(model);

    interaction = applyTuiInteractionAction(
      interaction,
      { type: "setRoute", route: "providers" },
      model,
    );
    const providersText = buildTuiSurfaceLines(model, { interaction })
      .map((line) => line.text)
      .join("\n");
    expect(providersText).toContain("Providers: Provider session source available");
    expect(providersText).toContain("- Codex: ready, 1 models, first GPT-5");

    interaction = applyTuiInteractionAction(
      interaction,
      { type: "setRoute", route: "settings" },
      model,
    );
    const settingsText = buildTuiSurfaceLines(model, { interaction })
      .map((line) => line.text)
      .join("\n");
    expect(settingsText).toContain("Settings / About: One Thoth identity and runtime guard");
    expect(settingsText).toContain("No Textual, no archived plugin TUI, no hidden LLM API");
  });

  test("formats safe pairing detail without raw offer credentials", () => {
    const model = buildTuiSurfaceModel({
      connection: { status: "connected" },
      pairing: {
        status: "offer-ready",
        endpoint: "relay.test.thoth.seeles.ai:443",
        expiresAt: "2026-07-02T13:00:00.000Z",
      },
    });
    const interaction = {
      ...createInitialTuiInteractionState(model),
      activeRoute: "connections" as const,
      focus: { kind: "nav" as const, route: "connections" as const },
    };
    const text = buildTuiSurfaceLines(model, { interaction })
      .map((line) => line.text)
      .join("\n");

    expect(text).toContain("Connections / Devices: Pairing offer ready");
    expect(text).toContain("Pairing endpoint: relay.test.thoth.seeles.ai:443");
    expect(text).toContain("Pairing expiry: 2026-07-02T13:00:00.000Z");
    expect(text).toContain("Offer URL, QR and tokens are kept out of the TUI frame");
    expect(text).toContain("D: Pair device - Refresh safe daemon pairing offer");
    expect(text).not.toMatch(/offer=|#offer=|pairingToken|thoth-relay-v3-client\./);
  });
});
