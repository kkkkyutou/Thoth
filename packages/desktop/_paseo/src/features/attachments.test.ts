import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyAttachmentFileToManagedStorage } from "./attachments";

const originalThothHome = process.env.THOTH_HOME;
let testHome: string | null = null;

async function useTempThothHome(): Promise<string> {
  testHome = await mkdtemp(path.join(os.tmpdir(), "thoth-desktop-attachments-"));
  process.env.THOTH_HOME = testHome;
  return testHome;
}

describe("desktop attachment files", () => {
  afterEach(async () => {
    if (originalThothHome === undefined) {
      delete process.env.THOTH_HOME;
    } else {
      process.env.THOTH_HOME = originalThothHome;
    }

    if (testHome) {
      await rm(testHome, { recursive: true, force: true });
      testHome = null;
    }
  });

  it("accepts dot-prefixed picker extensions for managed copies", async () => {
    const thothHome = await useTempThothHome();
    const sourcePath = path.join(thothHome, "report.md");
    await writeFile(sourcePath, "# Report\n");

    const result = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_markdown",
      sourcePath,
      extension: ".md",
    });

    expect(result).toEqual({
      path: path.join(thothHome, "desktop-attachments", "att_markdown.md"),
      byteSize: 9,
    });
    await expect(readFile(result.path, "utf8")).resolves.toBe("# Report\n");
  });

  it("normalizes legacy bare extensions for managed copies", async () => {
    const thothHome = await useTempThothHome();
    const sourcePath = path.join(thothHome, "report.md");
    await writeFile(sourcePath, "# Report\n");

    const result = await copyAttachmentFileToManagedStorage({
      attachmentId: "att_markdown_legacy",
      sourcePath,
      extension: "md",
    });

    expect(result).toEqual({
      path: path.join(thothHome, "desktop-attachments", "att_markdown_legacy.md"),
      byteSize: 9,
    });
    await expect(readFile(result.path, "utf8")).resolves.toBe("# Report\n");
  });
});
