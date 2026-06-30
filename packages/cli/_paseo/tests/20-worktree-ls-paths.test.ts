#!/usr/bin/env npx tsx

import assert from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveThothHomePath, resolveThothWorktreesDir } from "../src/commands/worktree/ls.js";

console.log("=== Worktree LS Path Helper Tests ===\n");

const originalThothHome = process.env.THOTH_HOME;

try {
  {
    console.log("Test 1: resolves explicit THOTH_HOME when set");
    process.env.THOTH_HOME = "/tmp/thoth-explicit-home";

    assert.strictEqual(resolveThothHomePath(), "/tmp/thoth-explicit-home");
    assert.strictEqual(resolveThothWorktreesDir(), "/tmp/thoth-explicit-home/worktrees");
    console.log("\u2713 explicit THOTH_HOME is respected\n");
  }

  {
    console.log("Test 2: falls back to homedir/.thoth when THOTH_HOME is unset");
    delete process.env.THOTH_HOME;

    assert.strictEqual(resolveThothHomePath(), join(homedir(), ".thoth"));
    assert.strictEqual(resolveThothWorktreesDir(), join(homedir(), ".thoth", "worktrees"));
    console.log("\u2713 fallback home path is derived from os.homedir()\n");
  }
} finally {
  if (originalThothHome === undefined) {
    delete process.env.THOTH_HOME;
  } else {
    process.env.THOTH_HOME = originalThothHome;
  }
}

console.log("=== All worktree ls path helper tests passed ===");
