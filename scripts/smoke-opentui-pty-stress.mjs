import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const host = process.env.THOTH_TUI_SMOKE_HOST ?? "127.0.0.1:6688";
const height = Number.parseInt(process.env.THOTH_TUI_SMOKE_HEIGHT ?? "34", 10);
const widths = parseWidths(process.env.THOTH_TUI_STRESS_WIDTHS ?? "72,96,132");
const forbiddenPatterns = [
  /127\.0\.0\.1:6767|localhost:6767/,
  /offer=|#offer=|pairingToken|thoth-relay-v3-client\.|thoth\.relay\.token\./,
  /Scan to pair|BEGIN:VCARD|QRCode|QR:/,
  /\bundefined\b|\[object Object\]/,
  /UnhandledPromiseRejection|TypeError|ReferenceError|SyntaxError/,
];

for (const width of widths) {
  const plain = runStress({ width, height, host });
  assertFrame(plain, { width, height, host });
  console.log(plain);
  console.log(
    JSON.stringify(
      {
        ok: true,
        smoke: "opentui-pty-stress",
        width,
        height,
        host,
      },
      null,
      2,
    ),
  );
}

function runStress({ width, height, host }) {
  const tuiCommand = [
    "npm",
    "exec",
    "--yes",
    "--package=node-linux-x64@26.4.0",
    "--",
    "node",
    "--experimental-ffi",
    "packages/cli/dist/index.js",
    "tui",
    "--host",
    host,
    "--screen",
    "main",
    "--width",
    String(width),
    "--height",
    String(height),
    "--stress-after-render-ms",
    "100",
    "--exit-after-render-ms",
    "8000",
    "--print-final-frame",
  ];
  const commandLine = tuiCommand.map(shellQuote).join(" ");
  const result = spawnSync("script", ["-qfec", commandLine, "/dev/null"], {
    encoding: "utf8",
    env: {
      ...process.env,
      OTUI_USE_CONSOLE: "false",
    },
  });

  const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    console.error(stripAnsi(combined));
    throw new Error(`OpenTUI PTY stress failed for ${width}x${height}`);
  }
  return stripAnsi(combined);
}

function assertFrame(plain, { width, height, host }) {
  assert.match(plain, /One Thoth - OpenTUI/);
  assert.match(plain, /Route: Connections \(Offer ready\)/);
  assert.match(plain, /Focus: Connections/);
  assert.match(plain, /State: Stress completed: route\/focus\/composer\/provider\/device churn/);
  assert.match(plain, /Host: Connected/);
  assert.match(plain, /Snapshot: Updated/);
  assert.match(plain, /Active Route Detail/);
  assert.match(plain, /Connections \/ Devices: Pairing offer ready/);
  assert.match(plain, /Pairing endpoint: relay\.test\.thoth\.seeles\.ai:443/);
  assert.match(plain, /Pairing expiry:/);
  assert.match(plain, /Credential safety: Offer URL, QR and tokens are kept out of the TUI frame/);
  assert.match(plain, /Task \/ Loop/);
  assert.match(plain, /Providers/);
  assert.match(plain, /Evidence \/ Review/);
  assert.match(plain, /Settings \/ About/);
  assert.match(plain, /Mode: Loop/);
  assert.match(plain, /Clarify: Light/);
  assert.match(plain, /Loop: Light/);
  assert.match(plain, /P providers/);
  assert.match(plain, /D devices/);
  assert.match(plain, /R refresh/);
  assert.match(plain, /daemon\/client\/protocol state only/);

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(plain, pattern);
  }

  assert.equal(Number.isInteger(width) && width > 0, true);
  assert.equal(Number.isInteger(height) && height > 0, true);
  assert.equal(typeof host, "string");
}

function parseWidths(value) {
  const widths = value
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
  if (widths.length === 0) {
    throw new Error("THOTH_TUI_STRESS_WIDTHS must contain at least one positive integer width");
  }
  return widths;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function stripAnsi(value) {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1BP[^\x1B]*(?:\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B[@-Z\\-_]/g, "");
}
