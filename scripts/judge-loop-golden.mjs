import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const judgeModel = process.env.THOTH_CODEX_JUDGE_MODEL ?? "gpt-5.5";
const artifactsDir = resolve(repoRoot, ".agent-os/artifacts");
mkdirSync(artifactsDir, { recursive: true });

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const evalPath = resolve(artifactsDir, `loop-golden-eval-${timestamp}.json`);
const judgePath = resolve(artifactsDir, `loop-golden-codex-judge-${timestamp}.md`);

const evalJson = execFileSync(
  process.execPath,
  [resolve(repoRoot, "packages/drivers/dist/loop/eval.js"), "--json"],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
);
writeFileSync(evalPath, evalJson);

const evalReport = JSON.parse(evalJson);
if (!evalReport.passed) {
  console.error(`Loop deterministic eval failed before judge: ${evalPath}`);
  process.exit(1);
}

const { LOOP_GOLDEN_SCENARIOS } = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/loop/golden.js")).href
);
const clarify = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/clarify/index.js")).href
);

const tempRoot = mkdtempSync(join(tmpdir(), "thoth-loop-golden-judge-"));
const artifact = clarify.loadRuntimeSkillArtifact("thoth.loop");
const mount = clarify.mountRuntimeSkillForSession({
  artifact,
  thothSessionHome: join(tempRoot, "thoth-runtime-home"),
  sessionId: "loop_golden_judge",
  home: join(tempRoot, "bare-provider-home"),
});

const prompt = [
  "You are an independent judge for Thoth Loop background PlanExec/Review quality.",
  "",
  "Review the installed `thoth.loop` Skill artifact, deterministic eval report, and golden scenarios. Do not change files.",
  "Judge whether they are sufficient to prevent these failure modes:",
  "- PlanExec asks the user for new clarification after Task/Goals are frozen",
  "- PlanExec jumps to a later goal or edits outside the current goal boundary",
  "- Review only runs tests mechanically instead of validating evidence against acceptance",
  "- Review modifies source files",
  "- Review pass consumes failed-review budget",
  "- Review fail lacks root cause, next-round guidance, or anti-repeat strategy",
  "- Retry mechanically repeats the same failed strategy",
  "- Budget exhaustion silently continues or pretends blocked instead of entering budget wait with the latest verdict",
  "- Permission or provider failures are treated as Review failures",
  "- All-goals completion is claimed before every linear goal passes Review",
  "",
  "If all cases pass, end the final answer with exactly: JUDGE_RESULT: PASS",
  "If any case fails, list each failure and end with exactly: JUDGE_RESULT: FAIL",
  "",
  "## Deterministic Eval Report",
  JSON.stringify(evalReport, null, 2),
  "",
  "## Canonical Skill Artifact",
  JSON.stringify(
    {
      path: artifact.path,
      digest: artifact.digest,
      frontmatter: artifact.frontmatter,
      source: artifact.source,
    },
    null,
    2,
  ),
  "",
  "## Session-Scoped Mount Evidence",
  JSON.stringify(mount, null, 2),
  "",
  "## Loop Golden Scenarios",
  JSON.stringify(LOOP_GOLDEN_SCENARIOS, null, 2),
].join("\n");

const judge = spawnSync(
  "codex",
  [
    "exec",
    "--model",
    judgeModel,
    "--cd",
    repoRoot,
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--output-last-message",
    judgePath,
    "-",
  ],
  {
    cwd: repoRoot,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20,
  },
);

if (judge.error) {
  console.error(`Failed to run codex exec judge: ${judge.error.message}`);
  rmSync(tempRoot, { recursive: true, force: true });
  process.exit(1);
}
if (judge.status !== 0) {
  console.error(judge.stdout);
  console.error(judge.stderr);
  rmSync(tempRoot, { recursive: true, force: true });
  console.error(`codex exec judge failed with status ${judge.status}`);
  process.exit(judge.status ?? 1);
}

const judgeText = readFileSync(judgePath, "utf8");
if (!judgeText.includes("JUDGE_RESULT: PASS")) {
  console.log(judge.stdout);
  console.error(`Loop codex judge did not pass. Evidence: ${judgePath}`);
  rmSync(tempRoot, { recursive: true, force: true });
  process.exit(1);
}

rmSync(tempRoot, { recursive: true, force: true });
console.log("Loop codex judge: PASS");
console.log(`Deterministic eval evidence: ${evalPath}`);
console.log(`Codex judge evidence: ${judgePath}`);
