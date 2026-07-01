import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { app } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getBundledSkillsDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "skills");
  }
  return path.join(__dirname, "..", "..", "..", "..", "..", "skills");
}

export function getAgentsSkillsDir(): string {
  return path.join(os.homedir(), ".agents", "skills");
}

export function getClaudeSkillsDir(): string {
  return path.join(os.homedir(), ".claude", "skills");
}

export function getCodexSkillsDir(): string {
  return path.join(os.homedir(), ".codex", "skills");
}
