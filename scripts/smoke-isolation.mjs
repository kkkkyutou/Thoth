#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function listPort(port) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    return output
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((line) => {
        const fields = line.trim().split(/\s+/);
        return {
          command: fields[0] ?? "",
          pid: Number(fields[1]),
          raw: line,
        };
      })
      .filter((entry) => Number.isInteger(entry.pid));
  } catch {
    return [];
  }
}

function assertNoLegacyWebFallback() {
  const distIndex = resolve("packages/app/dist/index.html");
  if (!existsSync(distIndex)) return;
  const html = readFileSync(distIndex, "utf8");
  if (html.includes("localhost:6767") || html.includes("127.0.0.1:6767")) {
    throw new Error("Web dist contains legacy 6767 fallback text.");
  }
}

const paseo = listPort(6767);
const thoth = listPort(6688);
const paseoPids = new Set(paseo.map((entry) => entry.pid));

for (const entry of thoth) {
  if (paseoPids.has(entry.pid)) {
    throw new Error(`Port 6688 and 6767 are owned by the same PID ${entry.pid}.`);
  }
  if (/paseo/i.test(entry.command)) {
    throw new Error(`Port 6688 appears to be owned by a Paseo process: ${entry.raw}`);
  }
}

assertNoLegacyWebFallback();

const summary = {
  paseoPort6767: paseo,
  thothPort6688: thoth,
  checks: {
    samePid: "passed",
    thothPortCommand: "passed",
    webDistLegacyFallback: "passed",
  },
};

console.log(JSON.stringify(summary, null, 2));
