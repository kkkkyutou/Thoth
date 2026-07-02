import assert from "node:assert/strict";
import { createTestRenderer } from "@opentui/core/testing";
import {
  applyTuiInteractionAction,
  buildTuiSurfaceModel,
  createInitialTuiInteractionState,
  mountTuiSurface,
} from "../packages/tui/dist/index.js";

const width = Number.parseInt(process.env.THOTH_TUI_SMOKE_WIDTH ?? "96", 10);
const height = Number.parseInt(process.env.THOTH_TUI_SMOKE_HEIGHT ?? "34", 10);

const model = buildTuiSurfaceModel({
  connection: { status: "idle" },
  cwd: process.cwd(),
  terminalWidth: width,
  terminalHeight: height,
});

let interaction = createInitialTuiInteractionState(model);
interaction = applyTuiInteractionAction(
  interaction,
  { type: "setRoute", route: "providers" },
  model,
);
interaction = applyTuiInteractionAction(interaction, { type: "cycleLoop" }, model);
interaction = applyTuiInteractionAction(interaction, { type: "cycleMode" }, model);
interaction = applyTuiInteractionAction(interaction, { type: "cycleLoop" }, model);
interaction = applyTuiInteractionAction(interaction, { type: "setRoute", route: "review" }, model);
interaction = {
  ...interaction,
  focus: { kind: "composer-control", id: "loop" },
};

const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
  width,
  height,
});

try {
  mountTuiSurface(renderer, model, { interaction });
  await renderOnce();
  const frame = captureCharFrame();

  assert.match(frame, /One Thoth/);
  assert.match(frame, /Route: Evidence \/ Review/);
  assert.match(frame, /Focus: Loop/);
  assert.match(frame, /Mode: Loop/);
  assert.match(frame, /Loop: One Plan, One Do/);
  assert.match(frame, /Evidence and review receipts are preview-only/);
  assert.match(frame, /daemon\/client\/protocol state only/);

  console.log(frame);
  console.log(
    JSON.stringify(
      {
        ok: true,
        smoke: "opentui-navigation",
        runtime: process.version,
        width,
        height,
        route: interaction.activeRoute,
        focus: interaction.focus,
        mode: interaction.composer.mode,
        loop: interaction.composer.loop,
      },
      null,
      2,
    ),
  );
} finally {
  renderer.destroy();
}
