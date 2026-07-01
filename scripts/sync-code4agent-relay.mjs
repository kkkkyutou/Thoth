#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const targetRoot = resolve(repoRoot, process.argv[2] ?? process.env.CODE4AGENT_ROOT ?? "");

if (!process.argv[2] && !process.env.CODE4AGENT_ROOT) {
  console.error("Usage: npm run sync:code4agent-relay -- <Code4Agent repo root>");
  process.exit(1);
}

const sourceRelaySrc = join(repoRoot, "packages", "relay", "src");
const appDir = join(targetRoot, "apps", "thoth-relay");
const appSrcDir = join(appDir, "src");

rmSync(appDir, { recursive: true, force: true });
mkdirSync(appSrcDir, { recursive: true });

for (const file of [
  "base64.ts",
  "cloudflare-adapter.ts",
  "crypto.ts",
  "e2ee.ts",
  "encrypted-channel.ts",
  "index.ts",
  "types.ts",
]) {
  const source = join(sourceRelaySrc, file);
  const target = join(appSrcDir, file);
  let text = readFileSync(source, "utf8");
  if (file === "cloudflare-adapter.ts") {
    text = text.replace(
      'from "@thoth/protocol/daemon-endpoints";',
      'from "./protocol/daemon-endpoints.js";',
    );
  }
  writeFileSync(target, text, "utf8");
}

mkdirSync(join(appSrcDir, "protocol"), { recursive: true });
writeFileSync(
  join(appSrcDir, "protocol", "daemon-endpoints.ts"),
  `export const RELAY_SUBPROTOCOL = "thoth.relay.v3";
export const RELAY_TOKEN_SUBPROTOCOL_PREFIX = "thoth.relay.token.";

export function extractRelayTokenFromProtocols(protocols: string | string[] | null): string | null {
  const values = Array.isArray(protocols)
    ? protocols
    : typeof protocols === "string"
      ? protocols.split(",")
      : [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.startsWith(RELAY_TOKEN_SUBPROTOCOL_PREFIX)) {
      const token = trimmed.slice(RELAY_TOKEN_SUBPROTOCOL_PREFIX.length);
      return token || null;
    }
  }
  return null;
}
`,
  "utf8",
);

writeFileSync(
  join(appDir, "package.json"),
  `${JSON.stringify(
    {
      name: "@code4agent/thoth-relay",
      version: "0.0.0",
      private: true,
      type: "module",
      prettier: "@code4agent/presets/prettier",
      scripts: {
        dev: "wrangler dev --config ./wrangler.jsonc --port 8710 --inspector-port 9240",
        start: "wrangler dev --config ./wrangler.jsonc",
        "deploy:test": "wrangler deploy --config ./wrangler.jsonc --env test",
        "deploy:production": "wrangler deploy --config ./wrangler.jsonc --env production",
        "deploy:feature": "wrangler deploy --config ./wrangler.jsonc --env feature",
        "build:feature": "node -e \"console.log('skip build for @code4agent/thoth-relay')\"",
        typecheck: "tsc --noEmit -p ./tsconfig.json",
        lint: "eslint .",
        "lint:fix": "eslint . --fix",
        format: "prettier --write src/",
      },
      dependencies: {
        "base64-js": "^1.5.1",
        tweetnacl: "^1.0.3",
        ws: "^8.18.3",
      },
      devDependencies: {
        "@cloudflare/workers-types": "catalog:",
        "@code4agent/presets": "workspace:*",
        typescript: "catalog:",
        wrangler: "catalog:",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

writeFileSync(
  join(appDir, "tsconfig.json"),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022", "WebWorker"],
        types: ["@cloudflare/workers-types"],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        isolatedModules: true,
      },
      include: ["src/**/*.ts"],
    },
    null,
    2,
  )}\n`,
  "utf8",
);

writeFileSync(
  join(appDir, "wrangler.jsonc"),
  `{
  "name": "thoth-relay",
  "main": "src/cloudflare-adapter.ts",
  "compatibility_date": "2026-07-01",
  "observability": {
    "enabled": true,
    "logs": {
      "enabled": true,
      "invocation_logs": true
    }
  },
  "vars": {
    "RELAY_ALLOWED_ORIGINS": "https://app.thoth.seeles.ai,https://test.thoth.seeles.ai,http://localhost:4173,http://127.0.0.1:4173,http://localhost:5173,http://127.0.0.1:5173"
  },
  "durable_objects": {
    "bindings": [
      {
        "name": "RELAY",
        "class_name": "RelayDurableObject"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["RelayDurableObject"]
    }
  ],
  "env": {
    "test": {
      "name": "thoth-relay-test",
      "routes": [
        {
          "pattern": "relay.test.thoth.seeles.ai",
          "custom_domain": true
        }
      ]
    },
    "production": {
      "name": "thoth-relay",
      "routes": [
        {
          "pattern": "relay.thoth.seeles.ai",
          "custom_domain": true
        }
      ]
    },
    "feature": {
      "name": "thoth-relay-feature"
    }
  }
}
`,
  "utf8",
);

const configPath = join(targetRoot, "packages", "config", "apps.yml");
if (existsSync(configPath)) {
  const config = readFileSync(configPath, "utf8");
  if (!config.includes("thoth-relay:")) {
    const next = config
      .replace(/(deployApps:\n  standard:\n(?:    - .+\n)+)/, "$1    - thoth-relay\n")
      .replace(/(  feature:\n(?:    - .+\n)+)/, "$1    - thoth-relay\n")
      .replace(/(\s+firstPushApps:\n(?:\s+    - .+\n)+)/, "$1        - thoth-relay\n").concat(`
  thoth-relay:
    dir: apps/thoth-relay
    watchPaths:
      - apps/thoth-relay
    workers:
      production: thoth-relay
      test: thoth-relay-test
      feature: thoth-relay-feature
`);
    writeFileSync(configPath, next, "utf8");
  }
}

const workflowPath = join(targetRoot, ".github", "workflows", "_deploy-isolated.yml");
if (existsSync(workflowPath)) {
  const workflow = readFileSync(workflowPath, "utf8");
  if (!workflow.includes("deploy-thoth-relay")) {
    writeFileSync(
      join(appDir, "CODE4AGENT_WORKFLOW_REQUIRED.md"),
      `# Required Code4Agent Workflow Change

Code4Agent currently hard-codes feature deploy jobs in \`.github/workflows/_deploy-isolated.yml\`.

Add a \`deploy-thoth-relay\` job equivalent to other app jobs, include it in the \`summary.needs\` list, and include \`apps/thoth-relay/wrangler.jsonc\` in the summary sparse checkout.

This path is protected by the repository \`protected-paths\` push ruleset, so it must be merged by Bot/admin or an allowed actor.
`,
      "utf8",
    );
  }
}

cpSync(join(repoRoot, "packages", "relay", "README.md"), join(appDir, "README.md"));

console.log(`Synced Thoth relay mirror to ${appDir}`);
