import { copyFileSync, existsSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { ProviderRuntimeSessionAdapter } from "../provider-runtime-session.js";

const CODEX_AUTH_FILES = ["auth.json", "config.toml"] as const;

function defaultCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || resolve(homedir(), ".codex");
}

function mirrorFile(sourceHome: string, targetHome: string, fileName: string): void {
  const source = resolve(sourceHome, fileName);
  const target = resolve(targetHome, fileName);
  if (!existsSync(source) || existsSync(target)) {
    return;
  }
  try {
    symlinkSync(source, target);
  } catch {
    copyFileSync(source, target);
  }
}

/**
 * Codex-specific credential isolation. Task orchestration calls this only through the generic
 * provider runtime-session boundary; no Loop or Secretary state transition depends on it.
 */
export function prepareCodexRuntimeSessionHome(input: {
  thothHome: string;
  sessionId: string;
}): string {
  const sessionHome = resolve(input.thothHome, "provider-sessions", input.sessionId);
  mkdirSync(sessionHome, { recursive: true });
  const sourceHome = defaultCodexHome();
  for (const fileName of CODEX_AUTH_FILES) {
    mirrorFile(sourceHome, sessionHome, fileName);
  }
  return sessionHome;
}

export function codexRuntimeSessionEnvironment(sessionHome: string | null): Record<string, string> {
  return sessionHome ? { CODEX_HOME: sessionHome } : {};
}

export const codexRuntimeSessionAdapter: ProviderRuntimeSessionAdapter = {
  provider: "codex",
  prepare(input) {
    const home = prepareCodexRuntimeSessionHome(input);
    return { home, env: codexRuntimeSessionEnvironment(home) };
  },
  environment: codexRuntimeSessionEnvironment,
};
