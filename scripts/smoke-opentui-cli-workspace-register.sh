#!/usr/bin/env bash
set -euo pipefail

width="${THOTH_TUI_SMOKE_WIDTH:-96}"
height="${THOTH_TUI_SMOKE_HEIGHT:-34}"
host="${THOTH_TUI_SMOKE_HOST:-127.0.0.1:6688}"
tmpdir="$(mktemp -d)"
tmpfile="$(mktemp)"

cleanup() {
  node --input-type=module - "$tmpdir" "$host" <<'NODE' >/dev/null 2>&1 || true
import { connectToDaemon } from "./packages/cli/dist/utils/client.js";

const [, , workspaceDirectory, host] = process.argv;
const client = await connectToDaemon({ host, timeout: 5000 });
try {
  const workspaces = await client.fetchWorkspaces({ page: { limit: 200 } });
  const workspace = workspaces.entries.find((entry) => {
    return entry.workspaceDirectory === workspaceDirectory || entry.projectRootPath === workspaceDirectory;
  });
  if (workspace) {
    await client.archiveWorkspace(workspace.id);
  }
} finally {
  await client.close().catch(() => {});
}
NODE
  rm -rf "$tmpdir" "$tmpfile"
}
trap cleanup EXIT

(
  cd "$tmpdir"
  OTUI_USE_CONSOLE=false npm exec --yes --prefix /mnt/cfs/5vr0p6/yzy/thoth --package=node-linux-x64@26.4.0 -- \
    node --experimental-ffi /mnt/cfs/5vr0p6/yzy/thoth/packages/cli/dist/index.js tui \
    --host "$host" \
    --screen main \
    --width "$width" \
    --height "$height" \
    --register-workspace-after-render-ms 100 \
    --exit-after-render-ms 1600 \
    --print-final-frame >"$tmpfile" 2>&1
)

node - "$tmpfile" "$width" "$height" "$host" "$tmpdir" <<'NODE'
const assert = require("node:assert/strict");
const fs = require("node:fs");

const [, , outputPath, width, height, host, tmpdir] = process.argv;
const raw = fs.readFileSync(outputPath, "utf8");
const plain = stripAnsi(raw);

assert.match(plain, /One Thoth - OpenTUI/);
assert.match(plain, /State: Registered workspace/);
assert.match(plain, /Route: Workspace \(Ready\)/);
assert.match(plain, /Host: Connected/);
assert.match(plain, /Workspace Control: Current workspace selected from daemon state/);
assert.match(plain, new RegExp(escapeRegExp(`Path: ${tmpdir}`)));
assert.match(plain, /Next Actions/);
assert.match(plain, /D: Pair device/);
assert.match(plain, /W workspace/);
assert.match(plain, /daemon\/client\/protocol state only/);
assert.doesNotMatch(plain, /127\.0\.0\.1:6767|localhost:6767/);
assert.doesNotMatch(plain, /offer=|pairingToken|thoth-relay-v3-client\./);

console.log(plain);
console.log(
  JSON.stringify(
    {
      ok: true,
      smoke: "opentui-cli-workspace-register",
      width: Number.parseInt(width, 10),
      height: Number.parseInt(height, 10),
      host,
      workspaceDirectory: tmpdir,
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
NODE
