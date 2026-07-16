import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareCodexRuntimeSessionHome } from "./codex-runtime-session.js";

const originalCodexHome = process.env.CODEX_HOME;
const roots: string[] = [];

function createRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  if (originalCodexHome === undefined) {
    delete process.env.CODEX_HOME;
  } else {
    process.env.CODEX_HOME = originalCodexHome;
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("prepareCodexRuntimeSessionHome", () => {
  it("links shared auth but snapshots writable config per provider session", () => {
    const sourceHome = createRoot("thoth-codex-source-");
    const thothHome = createRoot("thoth-codex-runtime-");
    writeFileSync(join(sourceHome, "auth.json"), '{"token":"test"}\n');
    writeFileSync(join(sourceHome, "config.toml"), 'model = "initial"\n');
    process.env.CODEX_HOME = sourceHome;

    const sessionHome = prepareCodexRuntimeSessionHome({ thothHome, sessionId: "review-1" });
    const sessionAuth = join(sessionHome, "auth.json");
    const sessionConfig = join(sessionHome, "config.toml");

    expect(lstatSync(sessionAuth).isSymbolicLink()).toBe(true);
    expect(lstatSync(sessionConfig).isSymbolicLink()).toBe(false);
    expect(readFileSync(sessionConfig, "utf8")).toBe('model = "initial"\n');

    writeFileSync(join(sourceHome, "config.toml"), 'model = "changed"\n');
    expect(readFileSync(sessionConfig, "utf8")).toBe('model = "initial"\n');
  });

  it("migrates a legacy shared config symlink without replacing an existing private snapshot", () => {
    const sourceHome = createRoot("thoth-codex-source-");
    const thothHome = createRoot("thoth-codex-runtime-");
    writeFileSync(join(sourceHome, "config.toml"), 'model = "source"\n');
    process.env.CODEX_HOME = sourceHome;

    const sessionHome = join(thothHome, "provider-sessions", "review-legacy");
    const sessionConfig = join(sessionHome, "config.toml");
    prepareCodexRuntimeSessionHome({ thothHome, sessionId: "review-legacy" });
    rmSync(sessionConfig);
    symlinkSync(join(sourceHome, "config.toml"), sessionConfig);

    prepareCodexRuntimeSessionHome({ thothHome, sessionId: "review-legacy" });
    expect(lstatSync(sessionConfig).isSymbolicLink()).toBe(false);
    expect(readFileSync(sessionConfig, "utf8")).toBe('model = "source"\n');

    writeFileSync(sessionConfig, 'model = "session"\n');
    writeFileSync(join(sourceHome, "config.toml"), 'model = "new-source"\n');
    prepareCodexRuntimeSessionHome({ thothHome, sessionId: "review-legacy" });
    expect(readFileSync(sessionConfig, "utf8")).toBe('model = "session"\n');
  });
});
