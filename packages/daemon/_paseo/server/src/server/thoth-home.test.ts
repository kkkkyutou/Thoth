import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveThothHome } from "./thoth-home.js";
import { PRIVATE_DIRECTORY_MODE } from "./private-files.js";

const MODE_MASK = 0o777;

function modeOf(filePath: string): number {
  return statSync(filePath).mode & MODE_MASK;
}

describe.skipIf(process.platform === "win32")("resolveThothHome permissions", () => {
  test("creates THOTH_HOME with private permissions", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "thoth-home-parent-"));
    const thothHome = path.join(parent, "home");
    try {
      expect(resolveThothHome({ THOTH_HOME: thothHome })).toBe(thothHome);
      expect(modeOf(thothHome)).toBe(PRIVATE_DIRECTORY_MODE);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
