import { describe, expect, it } from "vitest";

import {
  readThothRuntimeToolsConfig,
  withThothRuntimeTools,
} from "./thoth-runtime-tools-config.js";

describe("Thoth runtime tools config", () => {
  it("writes the provider-neutral runtime contract without changing provider-private config", () => {
    expect(
      withThothRuntimeTools(
        { extra: { opencode: { providerVisibleOption: true } } },
        { enabled: true, scope: "clarify", sessionHome: "/tmp/session-home" },
      ),
    ).toEqual({
      extra: {
        opencode: { providerVisibleOption: true },
        thothRuntimeTools: {
          enabled: true,
          scope: "clarify",
          sessionHome: "/tmp/session-home",
        },
      },
    });
  });

  it("reads every pre-migration Codex runtime flag as parse-only compatibility", () => {
    expect(
      readThothRuntimeToolsConfig({
        extra: { codex: { thothClarifyRuntimeTools: true } },
      }),
    ).toEqual({ enabled: true, scope: "clarify" });
    expect(
      readThothRuntimeToolsConfig({
        extra: { codex: { thothClarifyAuditRuntimeTools: true } },
      }),
    ).toEqual({ enabled: true, scope: "clarify_audit" });
    expect(
      readThothRuntimeToolsConfig({
        extra: { codex: { thothContractAuditRuntimeTools: true } },
      }),
    ).toEqual({ enabled: true, scope: "contract_audit" });
    expect(
      readThothRuntimeToolsConfig(
        {
          extra: {
            codex: {
              thothLoopRuntimeTools: true,
              thothLoopSessionHome: "/tmp/legacy-loop-home",
            },
          },
        },
        { legacyLoopScope: "loop_review" },
      ),
    ).toEqual({
      enabled: true,
      scope: "loop_review",
      sessionHome: "/tmp/legacy-loop-home",
    });
  });

  it("does not infer runtime tools from an unknown provider-private field", () => {
    expect(
      readThothRuntimeToolsConfig({ extra: { opencode: { thothClarifyRuntimeTools: true } } }),
    ).toBeNull();
  });

  it("does not revive legacy flags when a newer runtime contract explicitly disables tools", () => {
    expect(
      readThothRuntimeToolsConfig({
        extra: {
          thothRuntimeTools: { enabled: false },
          codex: { thothClarifyRuntimeTools: true },
        },
      }),
    ).toBeNull();
  });
});
