import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

import { ensurePrivateFile, writePrivateFileAtomicSync } from "./private-files.js";

interface LoggerLike {
  child(bindings: Record<string, unknown>): LoggerLike;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

const SERVER_ID_FILENAME = "server-id";

function getLogger(logger: LoggerLike | undefined): LoggerLike | undefined {
  return logger?.child({ module: "server-id" });
}

function getServerIdPath(thothHome: string): string {
  return path.join(thothHome, SERVER_ID_FILENAME);
}

function generateServerId(): string {
  // 16 bytes -> 128 bits of URL-safe room entropy.
  const rand = randomBytes(16).toString("base64url");
  return `srv_${rand}`;
}

/**
 * Stable daemon identifier scoped to a given $THOTH_HOME.
 *
 * - Persisted to `$THOTH_HOME/server-id`
 * - Can be overridden via `THOTH_SERVER_ID` (useful for tests)
 */
export function getOrCreateServerId(
  thothHome: string,
  options?: { env?: NodeJS.ProcessEnv; logger?: LoggerLike },
): string {
  const env = options?.env ?? process.env;
  const log = getLogger(options?.logger);
  const serverIdPath = getServerIdPath(thothHome);

  const envOverride =
    typeof env.THOTH_SERVER_ID === "string" && env.THOTH_SERVER_ID.trim().length > 0
      ? env.THOTH_SERVER_ID.trim()
      : null;

  if (envOverride) {
    // Persist the override for consistent identity across restarts.
    if (!existsSync(serverIdPath)) {
      try {
        writePrivateFileAtomicSync(serverIdPath, `${envOverride}\n`);
        log?.info({ serverId: envOverride }, "Persisted THOTH_SERVER_ID override");
      } catch (error) {
        log?.warn({ error }, "Failed to persist THOTH_SERVER_ID override");
      }
    } else {
      ensurePrivateFile(serverIdPath);
    }
    return envOverride;
  }

  if (existsSync(serverIdPath)) {
    try {
      ensurePrivateFile(serverIdPath);
      const raw = readFileSync(serverIdPath, "utf8");
      const parsed = raw.trim();
      if (parsed.length > 0) {
        return parsed;
      }
    } catch (error) {
      log?.warn({ error }, "Failed to read server-id file, regenerating");
    }
  }

  const created = generateServerId();
  try {
    writePrivateFileAtomicSync(serverIdPath, `${created}\n`);
  } catch (error) {
    log?.warn({ error }, "Failed to persist serverId (continuing with in-memory id)");
  }
  return created;
}
