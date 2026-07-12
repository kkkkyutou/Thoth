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
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { AgentUsage } from "../agent/agent-sdk-types.js";
import type {
  LoopEvidenceRef,
  LoopPhaseKind,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";

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

function walkDirectory(root: string, relative = ""): Array<{ path: string; digest: string }> {
  const absolute = path.join(root, relative);
  const entries = readdirSync(absolute, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const rows: Array<{ path: string; digest: string }> = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".thoth") {
      continue;
    }
    const nextRelative = path.join(relative, entry.name);
    const nextAbsolute = path.join(root, nextRelative);
    if (entry.isDirectory()) {
      rows.push(...walkDirectory(root, nextRelative));
      continue;
    }
    const stat = lstatSync(nextAbsolute);
    if (stat.isSymbolicLink()) {
      rows.push({ path: nextRelative, digest: `symlink:${readlinkSync(nextAbsolute)}` });
      continue;
    }
    if (stat.isFile()) {
      // Hashing metadata keeps non-git workspaces bounded; git workspaces use
      // the actual diff/tree below for stronger evidence.
      rows.push({ path: nextRelative, digest: `${stat.size}:${stat.mtimeMs}:${stat.mode}` });
    }
  }
  return rows;
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
  const rows = existsSync(canonicalPath) ? walkDirectory(canonicalPath) : [];
  return {
    kind: "directory",
    canonicalPath,
    treeSha256: sha256(JSON.stringify(rows)),
    changedFiles: rows.length,
    changedLines: 0,
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
