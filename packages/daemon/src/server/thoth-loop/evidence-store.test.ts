import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureWorkspaceDigest, captureWorkspaceDigestAsync } from "./evidence-store.js";

const temporaryDirectories: string[] = [];

function createTemporaryWorkspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "thoth-loop-evidence-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Loop workspace evidence digest", () => {
  it("streams a large non-git directory deterministically and excludes daemon runtime trees", async () => {
    const workspacePath = createTemporaryWorkspace();
    const sourceDirectory = join(workspacePath, "source");
    mkdirSync(sourceDirectory, { recursive: true });
    for (let index = 0; index < 320; index += 1) {
      writeFileSync(
        join(sourceDirectory, `file-${String(index).padStart(4, "0")}.txt`),
        `${index}\n`,
      );
    }

    let nestedDirectory = join(workspacePath, "nested");
    for (let index = 0; index < 80; index += 1) {
      nestedDirectory = join(nestedDirectory, `level-${String(index).padStart(3, "0")}`);
      mkdirSync(nestedDirectory, { recursive: true });
    }
    writeFileSync(join(nestedDirectory, "leaf.txt"), "tracked leaf\n");
    writeFileSync(join(workspacePath, "README.txt"), "tracked root\n");

    for (const ignoredDirectory of [".dev/runtime", ".git", "node_modules/pkg", ".thoth"]) {
      const directory = join(workspacePath, ignoredDirectory);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "ignored.txt"), "ignored runtime data\n");
    }

    const synchronous = captureWorkspaceDigest(workspacePath);
    const asynchronous = await captureWorkspaceDigestAsync(workspacePath);
    expect(synchronous).toMatchObject({ kind: "directory", changedFiles: 322 });
    expect(asynchronous).toMatchObject({
      kind: "directory",
      changedFiles: synchronous.changedFiles,
      treeSha256: synchronous.treeSha256,
    });

    writeFileSync(join(workspacePath, ".dev/runtime", "later.txt"), "still ignored\n");
    const ignoredChange = await captureWorkspaceDigestAsync(workspacePath);
    expect(ignoredChange).toMatchObject({
      changedFiles: synchronous.changedFiles,
      treeSha256: synchronous.treeSha256,
    });

    writeFileSync(join(sourceDirectory, "new-tracked-file.txt"), "tracked\n");
    const trackedChange = await captureWorkspaceDigestAsync(workspacePath);
    expect(trackedChange.changedFiles).toBe(synchronous.changedFiles + 1);
    expect(trackedChange.treeSha256).not.toBe(synchronous.treeSha256);
  });

  it("seals a bounded manifest instead of indefinitely walking a broad non-git workspace", async () => {
    const workspacePath = createTemporaryWorkspace();
    const sourceDirectory = join(workspacePath, "source");
    mkdirSync(sourceDirectory, { recursive: true });
    for (let index = 0; index < 4_200; index += 1) {
      writeFileSync(
        join(sourceDirectory, `file-${String(index).padStart(5, "0")}.txt`),
        `${index}\n`,
      );
    }

    const digest = await captureWorkspaceDigestAsync(workspacePath);

    expect(digest).toMatchObject({
      kind: "directory",
      coverage: "bounded",
      scannedEntries: 4_096,
      changedFiles: 4_095,
    });
  });
});
