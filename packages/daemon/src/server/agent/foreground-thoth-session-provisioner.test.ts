import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readThothRuntimeToolsConfig } from "./thoth-runtime-tools-config.js";
import { provisionForegroundThothSession } from "./foreground-thoth-session-provisioner.js";

const roots: string[] = [];

function createHome(): string {
  const home = mkdtempSync(join(tmpdir(), "thoth-foreground-tools-"));
  roots.push(home);
  return home;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("foreground Thoth session provisioner", () => {
  it("mounts Clarify and marks a capable foreground session before thread start", () => {
    const thothHome = createHome();
    const config = provisionForegroundThothSession({
      agentId: "foreground-agent",
      config: { provider: "codex", cwd: thothHome },
      thothHome,
      supportsNativeThothTools: true,
    });

    const runtime = readThothRuntimeToolsConfig(config);
    expect(runtime).toMatchObject({ enabled: true, scope: "clarify" });
    expect(runtime?.sessionHome).toContain("foreground-agent");
    expect(
      existsSync(
        join(
          thothHome,
          "provider-sessions",
          "foreground-agent",
          "skills",
          "thoth-clarify",
          "SKILL.md",
        ),
      ),
    ).toBe(true);
  });

  it("does not contaminate internal Loop sessions or unsupported adapters", () => {
    const thothHome = createHome();
    const internal = { provider: "codex" as const, cwd: thothHome, internal: true };
    const unsupported = { provider: "opencode" as const, cwd: thothHome };

    expect(
      provisionForegroundThothSession({
        agentId: "loop-review",
        config: internal,
        thothHome,
        supportsNativeThothTools: true,
      }),
    ).toBe(internal);
    expect(
      provisionForegroundThothSession({
        agentId: "unsupported-agent",
        config: unsupported,
        thothHome,
        supportsNativeThothTools: false,
      }),
    ).toBe(unsupported);
  });

  it("uses the provider-declared runtime adapter for a derived provider", () => {
    const thothHome = createHome();
    const config = provisionForegroundThothSession({
      agentId: "derived-foreground-agent",
      config: { provider: "custom-codex", cwd: thothHome },
      thothHome,
      supportsNativeThothTools: true,
      runtimeSessionProvider: "codex",
    });

    expect(readThothRuntimeToolsConfig(config)?.sessionHome).toContain("derived-foreground-agent");
  });
});
