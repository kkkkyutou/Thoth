import { describe, expect, test } from "vitest";
import { buildTuiSurfaceLines } from "./render.js";
import { buildTuiSurfaceModel } from "./surface.js";

describe("buildTuiSurfaceLines", () => {
  test("formats the product surface without adding hidden task authority", () => {
    const model = buildTuiSurfaceModel({
      connection: { status: "idle" },
      cwd: "/repo/current",
      terminalWidth: 100,
      terminalHeight: 32,
    });

    const text = buildTuiSurfaceLines(model)
      .map((line) => line.text)
      .join("\n");

    expect(text).toContain("One Thoth - OpenTUI");
    expect(text).toContain("Workspace: Needs a registered workspace");
    expect(text).toContain("+ Images/files <10MB | Provider | Mode Quick/Loop | Clarify | Loop");
    expect(text).toContain("Active task: No frozen task yet");
    expect(text).toContain("Authority: daemon/client/protocol state only");
  });
});
