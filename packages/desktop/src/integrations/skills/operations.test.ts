import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/thoth-user-data"),
    isPackaged: false,
  },
}));

import {
  autoUpdateInstalledSkills,
  getSkillsStatus,
  installSkills,
  THOTH_SKILL_NAMES,
  type SkillTargets,
  uninstallSkills,
  updateSkills,
} from "./operations";

interface Sandbox {
  root: string;
  targets: SkillTargets;
}

async function makeSandbox(): Promise<Sandbox> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "thoth-skills-"));
  const targets: SkillTargets = {
    sourceDir: path.join(root, "bundle"),
    agentsDir: path.join(root, "home", ".agents", "skills"),
    claudeDir: path.join(root, "home", ".claude", "skills"),
    codexDir: path.join(root, "home", ".codex", "skills"),
  };
  await fs.mkdir(targets.sourceDir, { recursive: true });
  return { root, targets };
}

async function writeFiles(rootDir: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(rootDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
}

async function writeBundleSkill(
  sourceDir: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  await writeFiles(path.join(sourceDir, name), files);
}

async function writeOnDiskSkill(
  agentsDir: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  await writeFiles(path.join(agentsDir, name), files);
}

async function writeOnDiskSkillToAllTargets(
  targets: SkillTargets,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  await Promise.all([
    writeOnDiskSkill(targets.agentsDir, name, files),
    writeOnDiskSkill(targets.claudeDir, name, files),
    writeOnDiskSkill(targets.codexDir, name, files),
  ]);
}

async function writeCurrentBundle(sourceDir: string): Promise<void> {
  await writeBundleSkill(sourceDir, "thoth", { "SKILL.md": "thoth-v1" });
  await writeBundleSkill(sourceDir, "thoth-loop", { "SKILL.md": "loop-v1" });
}

async function pathExists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

describe("getSkillsStatus", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("returns not-installed with add ops for every bundled skill when nothing is on disk", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("not-installed");
    expect(status.ops).toEqual([
      { kind: "add", name: "thoth" },
      { kind: "add", name: "thoth-loop" },
    ]);
  });

  it("returns not-installed when only user-personal skill dirs exist (the live bug)", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    for (const name of ["unslop", "tdd", "devbox"]) {
      await writeOnDiskSkill(sandbox.targets.agentsDir, name, { "SKILL.md": `user-${name}` });
    }

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("not-installed");
    expect(status.ops).toEqual([
      { kind: "add", name: "thoth" },
      { kind: "add", name: "thoth-loop" },
    ]);
  });

  it("returns up-to-date when every bundled skill matches on disk", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkillToAllTargets(sandbox.targets, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkillToAllTargets(sandbox.targets, "thoth-loop", { "SKILL.md": "loop-v1" });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status).toEqual({ state: "up-to-date", ops: [] });
  });

  it("ignores user-added files inside current managed skill dirs in every target", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkillToAllTargets(sandbox.targets, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkillToAllTargets(sandbox.targets, "thoth-loop", { "SKILL.md": "loop-v1" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth", {
      "SKILL.md": "thoth-v1",
      "my-context.md": "user context",
    });
    await writeOnDiskSkill(sandbox.targets.claudeDir, "thoth", {
      "SKILL.md": "thoth-v1",
      "commands/local.md": "user command",
    });
    await writeOnDiskSkill(sandbox.targets.codexDir, "thoth", {
      "SKILL.md": "thoth-v1",
      "hooks/guard.sh": "user guard",
    });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status).toEqual({ state: "up-to-date", ops: [] });
  });

  it("returns drift with a single update op when one bundled file diverges", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth", { "SKILL.md": "stale" });
    await writeOnDiskSkill(sandbox.targets.claudeDir, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkill(sandbox.targets.codexDir, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkillToAllTargets(sandbox.targets, "thoth-loop", { "SKILL.md": "loop-v1" });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("drift");
    expect(status.ops).toEqual([{ kind: "update", name: "thoth" }]);
  });

  it("returns drift when a secondary agent target is stale", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth-loop", { "SKILL.md": "loop-v1" });
    await writeOnDiskSkill(sandbox.targets.claudeDir, "thoth", { "SKILL.md": "stale" });
    await writeOnDiskSkill(sandbox.targets.claudeDir, "thoth-loop", { "SKILL.md": "loop-v1" });
    await writeOnDiskSkill(sandbox.targets.codexDir, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkill(sandbox.targets.codexDir, "thoth-loop", { "SKILL.md": "loop-v1" });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("drift");
    expect(status.ops).toEqual([{ kind: "update", name: "thoth" }]);
  });

  it("returns drift with add ops for the bundled skills missing from disk", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkillToAllTargets(sandbox.targets, "thoth", { "SKILL.md": "thoth-v1" });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("drift");
    expect(status.ops).toEqual([{ kind: "add", name: "thoth-loop" }]);
  });

  it("returns drift with a delete op for a legacy skill name still on disk", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkillToAllTargets(sandbox.targets, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkillToAllTargets(sandbox.targets, "thoth-loop", { "SKILL.md": "loop-v1" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth-chat", { "SKILL.md": "chat-old" });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("drift");
    expect(status.ops).toEqual([{ kind: "delete", name: "thoth-chat" }]);
  });

  it("emits add + update + delete ops sorted by name when state is mixed", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth", { "SKILL.md": "stale" });
    await writeOnDiskSkill(sandbox.targets.claudeDir, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkill(sandbox.targets.codexDir, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth-chat", { "SKILL.md": "chat-old" });

    const status = await getSkillsStatus(sandbox.targets);

    expect(status.state).toBe("drift");
    expect(status.ops).toEqual([
      { kind: "update", name: "thoth" },
      { kind: "delete", name: "thoth-chat" },
      { kind: "add", name: "thoth-loop" },
    ]);
  });
});

describe("installSkills / updateSkills", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("installs from a clean machine, populates all three targets, and leaves user dirs alone", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "unslop", { "SKILL.md": "user-unslop" });

    const status = await installSkills(sandbox.targets);

    expect(status).toEqual({ state: "up-to-date", ops: [] });
    for (const name of ["thoth", "thoth-loop"]) {
      expect(
        await fs.readFile(path.join(sandbox.targets.agentsDir, name, "SKILL.md"), "utf-8"),
      ).toBe(name === "thoth" ? "thoth-v1" : "loop-v1");
      expect(
        await fs.readFile(path.join(sandbox.targets.codexDir, name, "SKILL.md"), "utf-8"),
      ).toBe(name === "thoth" ? "thoth-v1" : "loop-v1");
      expect(await pathExists(path.join(sandbox.targets.claudeDir, name))).toBe(true);
    }
    expect(
      await fs.readFile(path.join(sandbox.targets.agentsDir, "unslop", "SKILL.md"), "utf-8"),
    ).toBe("user-unslop");
  });

  it("converges to up-to-date when state has missing + edited + legacy skills", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth", { "SKILL.md": "stale" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth-chat", { "SKILL.md": "chat-old" });
    await writeOnDiskSkill(sandbox.targets.claudeDir, "thoth-chat", { "SKILL.md": "chat-old" });
    await writeOnDiskSkill(sandbox.targets.codexDir, "thoth-chat", { "SKILL.md": "chat-old" });

    const status = await updateSkills(sandbox.targets);

    expect(status).toEqual({ state: "up-to-date", ops: [] });
    expect(
      await fs.readFile(path.join(sandbox.targets.agentsDir, "thoth", "SKILL.md"), "utf-8"),
    ).toBe("thoth-v1");
    expect(
      await fs.readFile(path.join(sandbox.targets.agentsDir, "thoth-loop", "SKILL.md"), "utf-8"),
    ).toBe("loop-v1");
    for (const dir of [
      sandbox.targets.agentsDir,
      sandbox.targets.claudeDir,
      sandbox.targets.codexDir,
    ]) {
      expect(await pathExists(path.join(dir, "thoth-chat"))).toBe(false);
    }
  });

  it("defines updated as the state reached after preserving user files", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkillToAllTargets(sandbox.targets, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkillToAllTargets(sandbox.targets, "thoth-loop", { "SKILL.md": "loop-v1" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth", {
      "SKILL.md": "stale",
      "hooks/guard.sh": "user guard",
    });
    await writeOnDiskSkill(sandbox.targets.claudeDir, "thoth", {
      "SKILL.md": "thoth-v1",
      "notes/local.md": "claude notes",
    });
    await writeOnDiskSkill(sandbox.targets.codexDir, "thoth", {
      "SKILL.md": "thoth-v1",
      "prompts/local.md": "codex prompt",
    });

    const status = await updateSkills(sandbox.targets);

    expect(status).toEqual({ state: "up-to-date", ops: [] });
    expect(await getSkillsStatus(sandbox.targets)).toEqual({ state: "up-to-date", ops: [] });
    expect(
      await fs.readFile(
        path.join(sandbox.targets.agentsDir, "thoth", "hooks", "guard.sh"),
        "utf-8",
      ),
    ).toBe("user guard");
    expect(
      await fs.readFile(
        path.join(sandbox.targets.claudeDir, "thoth", "notes", "local.md"),
        "utf-8",
      ),
    ).toBe("claude notes");
    expect(
      await fs.readFile(
        path.join(sandbox.targets.codexDir, "thoth", "prompts", "local.md"),
        "utf-8",
      ),
    ).toBe("codex prompt");
  });

  it("repairs secondary agent targets even when agents skills are current", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth-loop", { "SKILL.md": "loop-v1" });
    await writeOnDiskSkill(sandbox.targets.claudeDir, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkill(sandbox.targets.codexDir, "thoth", { "SKILL.md": "thoth-v1" });
    await writeOnDiskSkill(sandbox.targets.codexDir, "thoth-loop", { "SKILL.md": "loop-v1" });

    const status = await updateSkills(sandbox.targets);

    expect(status).toEqual({ state: "up-to-date", ops: [] });
    expect(
      await fs.readFile(path.join(sandbox.targets.claudeDir, "thoth-loop", "SKILL.md"), "utf-8"),
    ).toBe("loop-v1");
  });

  it("auto-updates drifted installed skills", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await writeOnDiskSkill(sandbox.targets.agentsDir, "thoth", {
      "SKILL.md": "stale",
      "hooks/guard.sh": "user guard",
    });

    const status = await autoUpdateInstalledSkills(sandbox.targets);

    expect(status).toEqual({ state: "up-to-date", ops: [] });
    expect(await getSkillsStatus(sandbox.targets)).toEqual({ state: "up-to-date", ops: [] });
    expect(
      await fs.readFile(path.join(sandbox.targets.agentsDir, "thoth", "SKILL.md"), "utf-8"),
    ).toBe("thoth-v1");
    expect(
      await fs.readFile(
        path.join(sandbox.targets.agentsDir, "thoth", "hooks", "guard.sh"),
        "utf-8",
      ),
    ).toBe("user guard");
  });

  it("does not auto-install skills on a clean machine", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);

    const status = await autoUpdateInstalledSkills(sandbox.targets);

    expect(status).toEqual({
      state: "not-installed",
      ops: [
        { kind: "add", name: "thoth" },
        { kind: "add", name: "thoth-loop" },
      ],
    });
    expect(await pathExists(path.join(sandbox.targets.agentsDir, "thoth"))).toBe(false);
    expect(await pathExists(path.join(sandbox.targets.claudeDir, "thoth"))).toBe(false);
    expect(await pathExists(path.join(sandbox.targets.codexDir, "thoth"))).toBe(false);
  });

  it("is idempotent — running install twice keeps state at up-to-date", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);

    const first = await installSkills(sandbox.targets);
    const second = await installSkills(sandbox.targets);

    expect(first).toEqual({ state: "up-to-date", ops: [] });
    expect(second).toEqual({ state: "up-to-date", ops: [] });
  });
});

describe("uninstallSkills", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("removes every Thoth skill from all three targets and preserves user dirs", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    await installSkills(sandbox.targets);
    for (const name of ["unslop", "tdd", "devbox"]) {
      await writeOnDiskSkill(sandbox.targets.agentsDir, name, { "SKILL.md": `user-${name}` });
    }

    const status = await uninstallSkills(sandbox.targets);

    expect(status.state).toBe("not-installed");
    for (const name of THOTH_SKILL_NAMES) {
      expect(await pathExists(path.join(sandbox.targets.agentsDir, name))).toBe(false);
      expect(await pathExists(path.join(sandbox.targets.claudeDir, name))).toBe(false);
      expect(await pathExists(path.join(sandbox.targets.codexDir, name))).toBe(false);
    }
    for (const name of ["unslop", "tdd", "devbox"]) {
      expect(
        await fs.readFile(path.join(sandbox.targets.agentsDir, name, "SKILL.md"), "utf-8"),
      ).toBe(`user-${name}`);
    }
  });

  it("is a no-op when nothing is installed", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);

    const status = await uninstallSkills(sandbox.targets);

    expect(status.state).toBe("not-installed");
  });

  it("cleans up legacy skill names that linger in agents, claude, and codex", async () => {
    await writeCurrentBundle(sandbox.targets.sourceDir);
    for (const dir of [
      sandbox.targets.agentsDir,
      sandbox.targets.claudeDir,
      sandbox.targets.codexDir,
    ]) {
      await writeOnDiskSkill(dir, "thoth-chat", { "SKILL.md": "chat-old" });
    }

    const status = await uninstallSkills(sandbox.targets);

    expect(status.state).toBe("not-installed");
    for (const dir of [
      sandbox.targets.agentsDir,
      sandbox.targets.claudeDir,
      sandbox.targets.codexDir,
    ]) {
      expect(await pathExists(path.join(dir, "thoth-chat"))).toBe(false);
    }
  });
});
