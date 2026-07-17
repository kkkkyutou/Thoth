import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const commit = process.env.GITHUB_SHA ?? process.env.THOTH_BUILD_COMMIT ?? "development";
if (commit !== "development" && !/^[a-f0-9]{40}$/u.test(commit)) {
  throw new Error(`Invalid Thoth build commit: ${commit}`);
}
await writeFile(
  join(desktopRoot, ".build-identity.json"),
  `${JSON.stringify({ commit }, null, 2)}\n`,
);
