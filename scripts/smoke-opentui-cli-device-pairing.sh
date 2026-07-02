#!/usr/bin/env bash
set -euo pipefail

width="${THOTH_TUI_SMOKE_WIDTH:-96}"
height="${THOTH_TUI_SMOKE_HEIGHT:-34}"
host="${THOTH_TUI_SMOKE_HOST:-127.0.0.1:6688}"
tmpfile="$(mktemp)"

cleanup() {
  rm -f "$tmpfile"
}
trap cleanup EXIT

OTUI_USE_CONSOLE=false npm exec --yes --package=node-linux-x64@26.4.0 -- \
  node --experimental-ffi packages/cli/dist/index.js tui \
  --host "$host" \
  --screen main \
  --width "$width" \
  --height "$height" \
  --pair-device-after-render-ms 100 \
  --exit-after-render-ms 2500 \
  --print-final-frame >"$tmpfile" 2>&1

node - "$tmpfile" "$width" "$height" "$host" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");

const [, , outputPath, width, height, host] = process.argv;
const raw = fs.readFileSync(outputPath, "utf8");
const plain = stripAnsi(raw);

assert.match(plain, /One Thoth - OpenTUI/);
assert.match(plain, /Route: Connections \(/);
assert.match(plain, /State: Pairing offer ready/);
assert.match(plain, /Host: Connected/);
assert.match(plain, /Connections \/ Devices: Pairing offer ready/);
assert.match(plain, /Relay: Pairing offer ready/);
assert.match(plain, /Pairing endpoint: relay\.test\.thoth\.seeles\.ai:443/);
assert.match(plain, /Pairing expiry:/);
assert.match(plain, /Credential safety: Offer URL, QR and tokens are kept out of the TUI frame/);
assert.match(plain, /D: Pair device - Refresh safe daemon pairing offer/);
assert.match(plain, /daemon\/client\/protocol state only/);
assert.doesNotMatch(plain, /offer=|#offer=|pairingToken|thoth-relay-v3-client\.|thoth\.relay\.token\./);
assert.doesNotMatch(plain, /Scan to pair|BEGIN:VCARD|QRCode|QR:/);
assert.doesNotMatch(plain, /127\.0\.0\.1:6767|localhost:6767/);

console.log(plain);
console.log(
  JSON.stringify(
    {
      ok: true,
      smoke: "opentui-cli-device-pairing",
      width: Number.parseInt(width, 10),
      height: Number.parseInt(height, 10),
      host,
    },
    null,
    2,
  ),
);

function stripAnsi(value) {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1BP[^\x1B]*(?:\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B[@-Z\\-_]/g, "");
}
NODE
