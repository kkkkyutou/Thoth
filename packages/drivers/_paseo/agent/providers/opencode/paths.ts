import path from "node:path";

import { resolveThothHome } from "../../../thoth-home.js";

const OPENCODE_HOME_DIRNAME = "opencode-home";

export function resolveOpenCodeHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveThothHome(env), OPENCODE_HOME_DIRNAME);
}
