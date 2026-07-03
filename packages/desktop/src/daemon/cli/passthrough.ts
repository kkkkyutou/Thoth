import { pathToFileURL } from "node:url";
import { resolvePassthroughCliEntrypoint } from "./entrypoints.js";

const DESKTOP_CLI_ENV = "THOTH_DESKTOP_CLI";
const IGNORED_ARG_PREFIXES = ["-psn_", "--no-sandbox", "--remote-debugging-port"];

export type PassthroughCliRunner = (argv: string[]) => Promise<number>;

export function parsePassthroughCliArgs(input: {
  argv: string[];
  isDefaultApp: boolean;
  forceCli: boolean;
  ignoredPaths?: string[];
}): string[] | null {
  const startIndex = input.isDefaultApp ? 2 : 1;
  const ignoredPaths = new Set((input.ignoredPaths ?? []).map((item) => pathToFileURL(item).href));
  const effective: string[] = [];

  for (const arg of input.argv.slice(startIndex)) {
    if (IGNORED_ARG_PREFIXES.some((prefix) => arg.startsWith(prefix))) {
      continue;
    }
    try {
      if (ignoredPaths.has(pathToFileURL(arg).href)) {
        continue;
      }
    } catch {
      // Non-path arguments are valid CLI passthrough values.
    }
    effective.push(arg);
  }

  if (input.forceCli) {
    return effective;
  }

  return effective.length > 0 ? effective : null;
}

export function parsePassthroughCliArgsFromArgv(
  argv: string[],
  options: { ignoredPaths?: string[] } = {},
): string[] | null {
  return parsePassthroughCliArgs({
    argv,
    isDefaultApp: process.defaultApp,
    forceCli: process.env[DESKTOP_CLI_ENV] === "1",
    ignoredPaths: options.ignoredPaths,
  });
}

async function importPassthroughCliRunner(): Promise<PassthroughCliRunner> {
  const entrypoint = resolvePassthroughCliEntrypoint();
  const imported = (await import(pathToFileURL(entrypoint).href)) as {
    runCli?: unknown;
  };
  if (typeof imported.runCli !== "function") {
    throw new Error(`Passthrough CLI entrypoint did not export runCli: ${entrypoint}`);
  }
  return imported.runCli as PassthroughCliRunner;
}

export async function runPassthroughCli(
  args: string[],
  options: { runCli?: PassthroughCliRunner } = {},
): Promise<number> {
  const runCli = options.runCli ?? (await importPassthroughCliRunner());
  return await runCli(args);
}
