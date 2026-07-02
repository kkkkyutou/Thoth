#!/usr/bin/env bash
set -euo pipefail

width="${THOTH_TUI_SMOKE_WIDTH:-96}"
height="${THOTH_TUI_SMOKE_HEIGHT:-34}"
host="${THOTH_TUI_SMOKE_HOST:-127.0.0.1:1}"
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
  --refresh-after-render-ms 100 \
  --exit-after-render-ms 1000 \
  --print-final-frame >"$tmpfile" 2>&1

node - "$tmpfile" "$width" "$height" "$host" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");

const [, , outputPath, width, height, host] = process.argv;
const raw = fs.readFileSync(outputPath, "utf8");
const plain = stripAnsi(raw);

assert.match(plain, /One Thoth - OpenTUI/);
assert.match(plain, /Host: Cannot connect to/);
assert.match(plain, /Snapshot: Refresh failed/);
assert.match(plain, /State: Refresh failed; recovery state shown/);
assert.match(plain, /Recovery: start Thoth daemon on 127\.0\.0\.1:6688 or pair a fresh relay offer, then press R\./);
assert.match(plain, /Active Route Detail/);
assert.match(plain, /One Thoth Home: Needs host/);
assert.match(plain, /Next step: Register\/connect this workspace before task loops/);
assert.match(plain, /R refresh/);
assert.match(plain, /W workspace/);
assert.match(plain, /Workspace: Needs a registered workspace/);
assert.match(plain, /daemon\/client\/protocol state only/);
assert.doesNotMatch(plain, /Host: Connected/);
assert.doesNotMatch(plain, /127\.0\.0\.1:6767|localhost:6767/);
assert.doesNotMatch(plain, /offer=|pairingToken|thoth-relay-v3-client\./);

console.log(plain);
console.log(
  JSON.stringify(
    {
      ok: true,
      smoke: "opentui-cli-recovery",
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
