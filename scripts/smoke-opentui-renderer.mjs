import assert from "node:assert/strict";
import { createTestRenderer } from "@opentui/core/testing";
import { buildTuiSurfaceModel, mountTuiSurface } from "../packages/tui/dist/index.js";

const width = Number.parseInt(process.env.THOTH_TUI_SMOKE_WIDTH ?? "96", 10);
const height = Number.parseInt(process.env.THOTH_TUI_SMOKE_HEIGHT ?? "34", 10);

const model = buildTuiSurfaceModel({
  connection: { status: "idle" },
  cwd: process.cwd(),
  terminalWidth: width,
  terminalHeight: height,
});

const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
  width,
  height,
});

try {
  mountTuiSurface(renderer, model);
  await renderOnce();
  const frame = captureCharFrame();

  assert.match(frame, /One Thoth/);
  assert.match(frame, /OpenTUI/);
  assert.match(frame, /Workspace/);
  assert.match(frame, /Provider/);
  assert.match(frame, /Evidence \/ Review/);
  assert.match(frame, /Images\/files <10MB/);
  assert.match(frame, /daemon\/client\/protocol state only/);

  console.log(frame);
  console.log(
    JSON.stringify(
      {
        ok: true,
        smoke: "opentui-renderer",
        runtime: process.version,
        width,
        height,
      },
      null,
      2,
    ),
  );
} finally {
  renderer.destroy();
}
