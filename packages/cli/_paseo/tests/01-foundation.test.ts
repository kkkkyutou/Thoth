#!/usr/bin/env npx zx

/**
 * Phase 1: Foundation Tests
 *
 * Tests basic CLI functionality that doesn't require a daemon:
 * - thoth --version outputs version
 * - thoth --help shows commands
 */

import { $ } from "zx";

$.verbose = false;

console.log("📋 Phase 1: Foundation Tests\n");

// Test 1.1: --version outputs version
console.log("  Testing thoth --version...");
const versionResult = await $`thoth --version`.nothrow();
if (versionResult.exitCode !== 0) {
  console.error("  ❌ thoth --version failed with exit code", versionResult.exitCode);
  console.error("     stderr:", versionResult.stderr);
  process.exit(1);
}
const versionOutput = versionResult.stdout.trim();
if (!versionOutput.match(/\d+\.\d+\.\d+/)) {
  console.error("  ❌ thoth --version output does not contain version number");
  console.error("     output:", versionOutput);
  process.exit(1);
}
console.log("  ✅ thoth --version outputs:", versionOutput);

// Test 1.2: --help shows commands
console.log("  Testing thoth --help...");
const helpResult = await $`thoth --help`.nothrow();
if (helpResult.exitCode !== 0) {
  console.error("  ❌ thoth --help failed with exit code", helpResult.exitCode);
  console.error("     stderr:", helpResult.stderr);
  process.exit(1);
}
const helpOutput = helpResult.stdout;

// Check for expected sections in help output
const expectedTerms = ["agent", "daemon", "Usage", "Options", "Commands"];
const missingTerms = expectedTerms.filter((term) => !helpOutput.includes(term));
if (missingTerms.length > 0) {
  console.error("  ❌ thoth --help missing expected terms:", missingTerms.join(", "));
  console.error("     output:", helpOutput);
  process.exit(1);
}
console.log("  ✅ thoth --help shows commands");

console.log("\n✅ Phase 1: Foundation Tests PASSED");
