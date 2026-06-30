#!/usr/bin/env node
import { rmSync } from "node:fs";
import { join } from "node:path";

const cwd = process.cwd();

for (const relativePath of ["dist", "tsconfig.tsbuildinfo"]) {
  rmSync(join(cwd, relativePath), { force: true, recursive: true });
}

console.log(`Cleaned build outputs in ${cwd}`);
