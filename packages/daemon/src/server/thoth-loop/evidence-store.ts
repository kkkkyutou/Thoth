import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { lstat, mkdir, readdir, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { AgentUsage } from "../agent/agent-sdk-types.js";
import type { LoopEvidenceRef, LoopPhaseKind } from "@thoth/protocol/thoth/rpc-schemas";

export interface CommandReceipt {
  callId: string;
  name: string;
  status: "running" | "completed" | "failed" | "canceled";
  command?: string;
  exitCode?: number | null;
  outputSha256?: string;
}

interface WorkspaceDigest {
  kind: "git" | "directory";
  canonicalPath: string;
  treeSha256: string;
  changedFiles: number;
  changedLines: number;
  coverage?: "complete" | "bounded";
  scannedEntries?: number;
  gitHead?: string;
  gitStatusSha256?: string;
  gitDiffSha256?: string;
}

export interface EvidenceManifest {
  version: 1;
  id: string;
  kind: LoopEvidenceRef["kind"];
  taskId: string;
  goalId?: string;
  phase?: LoopPhaseKind;
  phaseRunId?: string;
  createdAt: string;
  workspace: WorkspaceDigest;
  commandReceipts: CommandReceipt[];
  timelineRefs: string[];
  usage?: AgentUsage;
  declaredEvidence?: string[];
  validationPerformed?: string[];
  artifactRoot?: string;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

const execFileAsync = promisify(execFile);
const DIRECTORY_DIGEST_EXCLUDED_NAMES = new Set([
  ".cache",
  ".dev",
  ".git",
  ".next",
  ".thoth",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "venv",
]);
const DIRECTORY_DIGEST_ENTRY_LIMIT = 4_096;

function shouldExcludeFromDirectoryDigest(name: string): boolean {
  return DIRECTORY_DIGEST_EXCLUDED_NAMES.has(name);
}

interface DirectoryDigest {
  treeSha256: string;
  changedFiles: number;
  coverage: "complete" | "bounded";
  scannedEntries: number;
}

function addDirectoryDigestRecord(hash: ReturnType<typeof createHash>, record: unknown[]): void {
  hash.update(JSON.stringify(record));
  hash.update("\n");
}

function finalizeDirectoryDigest(input: {
  hash: ReturnType<typeof createHash>;
  changedFiles: number;
  scannedEntries: number;
  truncated: boolean;
}): DirectoryDigest {
  const coverage = input.truncated ? "bounded" : "complete";
  addDirectoryDigestRecord(input.hash, ["coverage", coverage, input.scannedEntries]);
  return {
    treeSha256: input.hash.digest("hex"),
    changedFiles: input.changedFiles,
    coverage,
    scannedEntries: input.scannedEntries,
  };
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

async function gitAsync(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: root,
      encoding: "utf8",
    });
    return String(stdout);
  } catch {
    return null;
  }
}

function walkDirectory(root: string, relative = ""): DirectoryDigest {
  const hash = createHash("sha256");
  let changedFiles = 0;
  let scannedEntries = 0;
  let truncated = false;
  const pendingDirectories = [relative];
  let nextDirectoryIndex = 0;

  scanDirectories: while (nextDirectoryIndex < pendingDirectories.length) {
    const currentRelative = pendingDirectories[nextDirectoryIndex++]!;
    const absolute = path.join(root, currentRelative);
    const entries = readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => !shouldExcludeFromDirectoryDigest(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (scannedEntries >= DIRECTORY_DIGEST_ENTRY_LIMIT) {
        truncated = true;
        break scanDirectories;
      }
      scannedEntries += 1;
      const nextRelative = path.join(currentRelative, entry.name);
      const nextAbsolute = path.join(root, nextRelative);
      if (entry.isDirectory()) {
        const stat = lstatSync(nextAbsolute);
        addDirectoryDigestRecord(hash, [
          nextRelative,
          `directory:${stat.mtimeMs}:${stat.ctimeMs}:${stat.mode}`,
        ]);
        pendingDirectories.push(nextRelative);
        continue;
      }
      const stat = lstatSync(nextAbsolute);
      if (stat.isSymbolicLink()) {
        addDirectoryDigestRecord(hash, [nextRelative, `symlink:${readlinkSync(nextAbsolute)}`]);
        changedFiles += 1;
        continue;
      }
      if (stat.isFile()) {
        // Git worktrees use a stronger tree/diff receipt. Non-git paths use
        // stable metadata records and report bounded coverage explicitly when
        // a broad directory would otherwise starve the task scheduler.
        addDirectoryDigestRecord(hash, [nextRelative, `${stat.size}:${stat.mtimeMs}:${stat.mode}`]);
        changedFiles += 1;
      }
    }
  }
  return finalizeDirectoryDigest({ hash, changedFiles, scannedEntries, truncated });
}

async function walkDirectoryAsync(root: string, relative = ""): Promise<DirectoryDigest> {
  const hash = createHash("sha256");
  let changedFiles = 0;
  let scannedEntries = 0;
  let truncated = false;
  const pendingDirectories = [relative];
  let nextDirectoryIndex = 0;

  scanDirectories: while (nextDirectoryIndex < pendingDirectories.length) {
    const currentRelative = pendingDirectories[nextDirectoryIndex++]!;
    const absolute = path.join(root, currentRelative);
    const entries = (await readdir(absolute, { withFileTypes: true }))
      .filter((entry) => !shouldExcludeFromDirectoryDigest(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (scannedEntries >= DIRECTORY_DIGEST_ENTRY_LIMIT) {
        truncated = true;
        break scanDirectories;
      }
      scannedEntries += 1;
      const nextRelative = path.join(currentRelative, entry.name);
      const nextAbsolute = path.join(root, nextRelative);
      if (entry.isDirectory()) {
        const entryStat = await lstat(nextAbsolute);
        addDirectoryDigestRecord(hash, [
          nextRelative,
          `directory:${entryStat.mtimeMs}:${entryStat.ctimeMs}:${entryStat.mode}`,
        ]);
        pendingDirectories.push(nextRelative);
        continue;
      }
      const entryStat = await lstat(nextAbsolute);
      if (entryStat.isSymbolicLink()) {
        addDirectoryDigestRecord(hash, [nextRelative, `symlink:${await readlink(nextAbsolute)}`]);
        changedFiles += 1;
        continue;
      }
      if (entryStat.isFile()) {
        addDirectoryDigestRecord(hash, [
          nextRelative,
          `${entryStat.size}:${entryStat.mtimeMs}:${entryStat.mode}`,
        ]);
        changedFiles += 1;
      }
    }
  }
  return finalizeDirectoryDigest({ hash, changedFiles, scannedEntries, truncated });
}

export function captureWorkspaceDigest(workspacePath: string): WorkspaceDigest {
  const canonicalPath = path.resolve(workspacePath);
  const gitRoot = git(canonicalPath, ["rev-parse", "--show-toplevel"]);
  if (gitRoot) {
    const root = gitRoot.trim();
    const head = git(root, ["rev-parse", "HEAD"])?.trim() ?? "unborn";
    const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]) ?? "";
    const diff = git(root, ["diff", "--no-ext-diff", "--binary", "HEAD"]) ?? "";
    const numstat = git(root, ["diff", "--numstat", "HEAD"]) ?? "";
    const rows = numstat
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => line.split("\t"));
    const changedLines = rows.reduce(
      (total, row) =>
        total +
        (Number.parseInt(row[0] ?? "0", 10) || 0) +
        (Number.parseInt(row[1] ?? "0", 10) || 0),
      0,
    );
    const tree = git(root, ["write-tree"])?.trim() ?? sha256(`${head}\n${status}\n${diff}`);
    return {
      kind: "git",
      canonicalPath: root,
      treeSha256: sha256(`${tree}\n${status}\n${diff}`),
      changedFiles: rows.length,
      changedLines,
      gitHead: head,
      gitStatusSha256: sha256(status),
      gitDiffSha256: sha256(diff),
    };
  }
  const directoryDigest = existsSync(canonicalPath)
    ? walkDirectory(canonicalPath)
    : { treeSha256: sha256(""), changedFiles: 0, coverage: "complete" as const, scannedEntries: 0 };
  return {
    kind: "directory",
    canonicalPath,
    treeSha256: directoryDigest.treeSha256,
    changedFiles: directoryDigest.changedFiles,
    changedLines: 0,
    coverage: directoryDigest.coverage,
    scannedEntries: directoryDigest.scannedEntries,
  };
}

export async function captureWorkspaceDigestAsync(workspacePath: string): Promise<WorkspaceDigest> {
  const canonicalPath = path.resolve(workspacePath);
  const gitRoot = await gitAsync(canonicalPath, ["rev-parse", "--show-toplevel"]);
  if (gitRoot) {
    const root = gitRoot.trim();
    const [headResult, statusResult, diffResult, numstatResult, treeResult] = await Promise.all([
      gitAsync(root, ["rev-parse", "HEAD"]),
      gitAsync(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
      gitAsync(root, ["diff", "--no-ext-diff", "--binary", "HEAD"]),
      gitAsync(root, ["diff", "--numstat", "HEAD"]),
      gitAsync(root, ["write-tree"]),
    ]);
    const head = headResult?.trim() ?? "unborn";
    const status = statusResult ?? "";
    const diff = diffResult ?? "";
    const rows = (numstatResult ?? "")
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => line.split("\t"));
    const changedLines = rows.reduce(
      (total, row) =>
        total +
        (Number.parseInt(row[0] ?? "0", 10) || 0) +
        (Number.parseInt(row[1] ?? "0", 10) || 0),
      0,
    );
    const tree = treeResult?.trim() ?? sha256(`${head}\n${status}\n${diff}`);
    return {
      kind: "git",
      canonicalPath: root,
      treeSha256: sha256(`${tree}\n${status}\n${diff}`),
      changedFiles: rows.length,
      changedLines,
      gitHead: head,
      gitStatusSha256: sha256(status),
      gitDiffSha256: sha256(diff),
    };
  }
  const directoryDigest = existsSync(canonicalPath)
    ? await walkDirectoryAsync(canonicalPath)
    : { treeSha256: sha256(""), changedFiles: 0, coverage: "complete" as const, scannedEntries: 0 };
  return {
    kind: "directory",
    canonicalPath,
    treeSha256: directoryDigest.treeSha256,
    changedFiles: directoryDigest.changedFiles,
    changedLines: 0,
    coverage: directoryDigest.coverage,
    scannedEntries: directoryDigest.scannedEntries,
  };
}

export class LoopEvidenceStore {
  private readonly manifestsRoot: string;
  private readonly artifactRoot: string;

  constructor(thothHome: string) {
    this.manifestsRoot = path.join(thothHome, "thoth-loop", "evidence");
    this.artifactRoot = path.join(thothHome, "thoth-loop", "review-artifacts");
    mkdirSync(this.manifestsRoot, { recursive: true });
    mkdirSync(this.artifactRoot, { recursive: true });
  }

  createReviewArtifactDirectory(input: { taskId: string; phaseRunId: string }): string {
    const target = path.join(this.artifactRoot, input.taskId, input.phaseRunId);
    mkdirSync(target, { recursive: true });
    return target;
  }

  createTemporaryDirectory(input: { taskId: string; phaseRunId: string }): string {
    const target = path.join(this.artifactRoot, input.taskId, input.phaseRunId, "tmp");
    mkdirSync(target, { recursive: true });
    return target;
  }

  capture(input: {
    kind: LoopEvidenceRef["kind"];
    taskId: string;
    workspacePath: string;
    goalId?: string;
    phase?: LoopPhaseKind;
    phaseRunId?: string;
    commandReceipts?: CommandReceipt[];
    timelineRefs?: string[];
    usage?: AgentUsage;
    declaredEvidence?: string[];
    validationPerformed?: string[];
    artifactRoot?: string;
  }): LoopEvidenceRef {
    const manifest: EvidenceManifest = {
      version: 1,
      id: `evidence-${randomUUID()}`,
      kind: input.kind,
      taskId: input.taskId,
      ...(input.goalId ? { goalId: input.goalId } : {}),
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.phaseRunId ? { phaseRunId: input.phaseRunId } : {}),
      createdAt: nowIso(),
      workspace: captureWorkspaceDigest(input.workspacePath),
      commandReceipts: input.commandReceipts ?? [],
      timelineRefs: input.timelineRefs ?? [],
      ...(input.usage ? { usage: input.usage } : {}),
      ...(input.declaredEvidence ? { declaredEvidence: input.declaredEvidence } : {}),
      ...(input.validationPerformed ? { validationPerformed: input.validationPerformed } : {}),
      ...(input.artifactRoot ? { artifactRoot: input.artifactRoot } : {}),
    };
    const taskRoot = path.join(this.manifestsRoot, input.taskId);
    mkdirSync(taskRoot, { recursive: true });
    const manifestPath = path.join(
      taskRoot,
      `${manifest.createdAt.replaceAll(":", "-")}-${manifest.id}.json`,
    );
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    writeFileSync(manifestPath, serialized, "utf8");
    return {
      id: manifest.id,
      manifestPath,
      sha256: sha256(serialized),
      kind: manifest.kind,
      createdAt: manifest.createdAt,
      ...(manifest.workspace.coverage ? { coverage: manifest.workspace.coverage } : {}),
      ...(manifest.workspace.scannedEntries !== undefined
        ? { scannedEntries: manifest.workspace.scannedEntries }
        : {}),
    };
  }

  async captureAsync(input: {
    kind: LoopEvidenceRef["kind"];
    taskId: string;
    workspacePath: string;
    goalId?: string;
    phase?: LoopPhaseKind;
    phaseRunId?: string;
    commandReceipts?: CommandReceipt[];
    timelineRefs?: string[];
    usage?: AgentUsage;
    declaredEvidence?: string[];
    validationPerformed?: string[];
    artifactRoot?: string;
  }): Promise<LoopEvidenceRef> {
    const manifest: EvidenceManifest = {
      version: 1,
      id: `evidence-${randomUUID()}`,
      kind: input.kind,
      taskId: input.taskId,
      ...(input.goalId ? { goalId: input.goalId } : {}),
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.phaseRunId ? { phaseRunId: input.phaseRunId } : {}),
      createdAt: nowIso(),
      workspace: await captureWorkspaceDigestAsync(input.workspacePath),
      commandReceipts: input.commandReceipts ?? [],
      timelineRefs: input.timelineRefs ?? [],
      ...(input.usage ? { usage: input.usage } : {}),
      ...(input.declaredEvidence ? { declaredEvidence: input.declaredEvidence } : {}),
      ...(input.validationPerformed ? { validationPerformed: input.validationPerformed } : {}),
      ...(input.artifactRoot ? { artifactRoot: input.artifactRoot } : {}),
    };
    const taskRoot = path.join(this.manifestsRoot, input.taskId);
    await mkdir(taskRoot, { recursive: true });
    const manifestPath = path.join(
      taskRoot,
      `${manifest.createdAt.replaceAll(":", "-")}-${manifest.id}.json`,
    );
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, serialized, "utf8");
    return {
      id: manifest.id,
      manifestPath,
      sha256: sha256(serialized),
      kind: manifest.kind,
      createdAt: manifest.createdAt,
      ...(manifest.workspace.coverage ? { coverage: manifest.workspace.coverage } : {}),
      ...(manifest.workspace.scannedEntries !== undefined
        ? { scannedEntries: manifest.workspace.scannedEntries }
        : {}),
    };
  }

  reviewWorkspaceUnchanged(before: LoopEvidenceRef, after: LoopEvidenceRef): boolean {
    const beforeManifest = this.readManifest(before);
    const afterManifest = this.readManifest(after);
    return Boolean(
      beforeManifest &&
      afterManifest &&
      beforeManifest.workspace.treeSha256 === afterManifest.workspace.treeSha256,
    );
  }

  readManifest(ref: LoopEvidenceRef): EvidenceManifest | null {
    try {
      return JSON.parse(readFileSync(ref.manifestPath, "utf8")) as EvidenceManifest;
    } catch {
      return null;
    }
  }

  garbageCollectReviewArtifacts(
    now = Date.now(),
    retentionMs = 30 * 24 * 60 * 60 * 1000,
  ): string[] {
    if (!existsSync(this.artifactRoot)) {
      return [];
    }
    const removed: string[] = [];
    for (const taskEntry of readdirSync(this.artifactRoot, { withFileTypes: true })) {
      if (!taskEntry.isDirectory()) {
        continue;
      }
      const taskRoot = path.join(this.artifactRoot, taskEntry.name);
      for (const phaseEntry of readdirSync(taskRoot, { withFileTypes: true })) {
        if (!phaseEntry.isDirectory()) {
          continue;
        }
        const target = path.join(taskRoot, phaseEntry.name);
        if (now - statSync(target).mtimeMs > retentionMs) {
          rmSync(target, { recursive: true, force: true });
          removed.push(target);
        }
      }
    }
    return removed;
  }
}

export function reviewTempRoot(): string {
  return tmpdir();
}
