import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const judgeModel = process.env.THOTH_CODEX_JUDGE_MODEL ?? "gpt-5.5";
const artifactsDir = resolve(repoRoot, ".agent-os/artifacts");
mkdirSync(artifactsDir, { recursive: true });

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const artifactPath = resolve(artifactsDir, `clarify-user-simulation-${timestamp}.md`);
const judgeResponsePath = resolve(
  artifactsDir,
  `clarify-user-simulation-codex-response-${timestamp}.md`,
);

const clarify = await import(
  pathToFileURL(resolve(repoRoot, "packages/drivers/dist/clarify/index.js")).href
);

const tempRoot = mkdtempSync(join(tmpdir(), "thoth-clarify-user-sim-"));

function writeEvidenceAndExit(status, evidence, judgeText = "") {
  const result = status === 0 ? "PASS" : "FAIL";
  const body = [
    `# Clarify User Simulation Judge`,
    "",
    `Result: ${result}`,
    "",
    "## Deterministic Evidence",
    "",
    "```json",
    JSON.stringify(evidence, null, 2),
    "```",
    "",
    "## Independent Codex Exec Judge",
    "",
    judgeText.trim() || "(judge did not run)",
    "",
  ].join("\n");
  writeFileSync(artifactPath, body);
  console.log(`Clarify user simulation judge: ${result}`);
  console.log(`Evidence artifact: ${artifactPath}`);
  process.exit(status);
}

try {
  const fakeHome = join(tempRoot, "bare-provider-home");
  const fakeGlobalSkillDirs = [
    join(fakeHome, ".codex/skills"),
    join(fakeHome, ".claude/skills"),
    join(fakeHome, ".agents/skills"),
  ];
  for (const dir of fakeGlobalSkillDirs) {
    mkdirSync(dir, { recursive: true });
  }

  const artifact = clarify.loadRuntimeSkillArtifact("thoth.clarify");
  const artifactFailures = clarify.validateClarifyRuntimeSkillArtifact(artifact);
  const mount = clarify.mountRuntimeSkillForSession({
    artifact,
    thothSessionHome: join(tempRoot, "thoth-runtime-home"),
    sessionId: "sec_user_sim_pathtracing",
    home: fakeHome,
  });
  const mountedSource = readFileSync(mount.mountedPath, "utf8");
  const simulationReport = clarify.buildClarifyUserSimulationReport(mount.skillRef);
  const simulationValidation = clarify.validateClarifyUserSimulationReport(simulationReport);

  const noGlobalPollution = fakeGlobalSkillDirs.map((dir) => {
    const thothClarifyPath = join(dir, "thoth-clarify/SKILL.md");
    return {
      dir,
      thothClarifyPath,
      exists: existsSync(thothClarifyPath),
    };
  });

  const actualHomeGlobalMountCheck = clarify
    .getGlobalProviderSkillDirs(process.env.HOME ?? "")
    .map((dir) => ({
      dir,
      mountedInsideActualGlobalDir:
        mount.mountedPath === dir || mount.mountedPath.startsWith(`${dir}/`),
    }));

  const evidence = {
    timestamp,
    runtimeArtifact: {
      id: artifact.id,
      sourcePath: artifact.path,
      digest: artifact.digest,
      frontmatter: artifact.frontmatter,
      source: artifact.source,
      validationFailures: artifactFailures,
    },
    sessionScopedMount: {
      sourcePath: mount.sourcePath,
      mountedPath: mount.mountedPath,
      sessionSkillHome: mount.sessionSkillHome,
      skillRef: mount.skillRef,
      mountedSourceMatchesCanonical: mountedSource === artifact.source,
      visibleToSession: existsSync(mount.mountedPath),
    },
    bareProviderIsolation: {
      fakeHome,
      noGlobalPollution,
      actualHomeGlobalMountCheck,
    },
    simulationValidation,
    simulationReport,
  };

  const deterministicFailures = [
    ...artifactFailures,
    ...simulationValidation.failures,
    ...noGlobalPollution
      .filter((entry) => entry.exists)
      .map((entry) => `global skill pollution detected: ${entry.thothClarifyPath}`),
    ...actualHomeGlobalMountCheck
      .filter((entry) => entry.mountedInsideActualGlobalDir)
      .map((entry) => `mounted inside actual global provider skill dir: ${entry.dir}`),
  ];
  if (mountedSource !== artifact.source) {
    deterministicFailures.push("mounted session SKILL.md does not match canonical SKILL.md");
  }
  if (!existsSync(mount.mountedPath)) {
    deterministicFailures.push("session-scoped mounted SKILL.md is not visible");
  }

  if (deterministicFailures.length > 0) {
    writeEvidenceAndExit(1, {
      ...evidence,
      deterministicFailures,
    });
  }

  const prompt = [
    "You are an independent `codex exec` judge for Thoth `thoth.clarify` user simulation.",
    "",
    "You must judge the installed Thoth runtime artifact and session-scoped invocation evidence below. Do not rely on any main development session conclusion and do not change files.",
    "",
    "Pass only if all of these are true:",
    "- `SKILL.md` is a standard cross-provider Skill artifact with YAML frontmatter and Markdown body, not a Codex-only hook/metadata format.",
    "- The canonical `SKILL.md` is mounted into a Thoth-owned provider-session skill home.",
    "- The mount does not write to `.codex/skills`, `.claude/skills`, or `.agents/skills` under the clean bare provider home, and the mounted path is not under the actual global provider skill dirs.",
    "- Normal same-state packets do not repeat Skill rules and do not include `skill_ref`.",
    "- Runtime input packets carry controls with clarify strength and effective clarify strength, plus compact refs when available.",
    "- Session start and transition packets carry `skill_ref`/digest markers without copying the rules.",
    "- Repair packet repairs shape/state/provenance only and does not reinterpret intent, fabricate transcript, change target, or change approved CEO Task Card.",
    "- The multi-turn user simulation covers `hi`, vague large task, Three.js PathTracing, branch choice answer, note-only answer, `you decide`, `enough/do not ask more`, unclear acceptance, delete/risk boundary, contradiction, Task Card confirmation, and Goal Card confirmation.",
    "- The simulated behavior is secretary-like: direct when direct is better, one high-leverage behavior-tree frontier card when asking, no field questionnaire, no fallback downgrade, no low-value repeat, no asking discoverable facts, no unsolicited default recommendation.",
    "- C_ASK cards use one title, 2-4 questions, short branch choices, note support, and hidden internal meta for strength/tree depth/QA rounds/assumptions/question value.",
    "- Assumption ownership is respected: user_must_decide is asked only when high impact; agent_can_decide and agent_can_discover are not pushed to the user.",
    "- `C_TASK_CARD` carries the full transcript, and `C_GOAL_CARD` carries the full transcript plus the approved CEO Task Card.",
    "",
    "If all checks pass, end the final answer with exactly: JUDGE_RESULT: PASS",
    "If any check fails, list failures and end with exactly: JUDGE_RESULT: FAIL",
    "",
    "## Installed Runtime Artifact And Simulation Evidence",
    "",
    "```json",
    JSON.stringify(evidence, null, 2),
    "```",
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
      judgeResponsePath,
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
    writeEvidenceAndExit(1, evidence, `Failed to run codex exec judge: ${judge.error.message}`);
  }
  if (judge.status !== 0) {
    writeEvidenceAndExit(
      judge.status ?? 1,
      evidence,
      [judge.stdout, judge.stderr, `codex exec judge failed with status ${judge.status}`].join(
        "\n",
      ),
    );
  }

  const judgeText = readFileSync(judgeResponsePath, "utf8");
  if (!judgeText.includes("JUDGE_RESULT: PASS")) {
    writeEvidenceAndExit(1, evidence, judgeText);
  }

  writeEvidenceAndExit(0, evidence, judgeText);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
