"""Compressed prompt authority for Thoth public commands, internal routes, and live phases."""

from __future__ import annotations

import json
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CommandPromptSpec:
    """Compressed command authority rendered into host-facing prompt surfaces."""

    command_id: str
    route_class: str
    intelligence_tier: str
    packet_authority_mode: str
    objective: str
    hard_stops: tuple[str, ...]
    reply_budget_utf8: int
    result_style: str
    validator_policy: str


@dataclass(frozen=True)
class PhasePromptSpec:
    """Compressed phase authority for validator-centered execution."""

    phase: str
    objective: str
    hard_stops: tuple[str, ...]
    required_fields: tuple[str, ...]
    summary_budget_utf8: int
    validator_policy: str


COMMAND_PROMPT_SPECS: dict[str, CommandPromptSpec] = {
    "run": CommandPromptSpec(
        command_id="run",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="phase_controller",
        objective="Finish the current strict task through the four-phase RuntimeDriver while preserving agent intelligence inside execute.",
        hard_stops=(
            "Do not invent or compile a new work item when --work-id is missing.",
            "Do not exit the monitoring session before the RuntimeDriver signals a terminal state.",
            "Do not hand-edit .thoth ledgers.",
        ),
        reply_budget_utf8=36,
        result_style="terminal receipt only",
        validator_policy="plan first; execute returns official validator receipt; validate normalizes/confirms it; reflect retries only business failures",
    ),
    "loop": CommandPromptSpec(
        command_id="loop",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="phase_controller",
        objective="Advance the current bounded loop through foreground or sleeping RuntimeDriver monitoring.",
        hard_stops=(
            "Do not decide extra iterations outside the recorded loop budget.",
            "Do not proceed to the next loop iteration before the validator signals terminal.",
            "Do not expand into iteration diaries or runtime narration.",
        ),
        reply_budget_utf8=40,
        result_style="terminal receipt only",
        validator_policy="loop budget controls retries; child validate confirms execute's validator receipt",
    ),
    "review": CommandPromptSpec(
        command_id="review",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="review_packet",
        objective="Produce the best possible review output: understand user intent, apply professional judgment and first-principles reasoning, and return structured findings without modifying code.",
        hard_stops=(
            "Do not modify project code or write fixes.",
            "Do not reduce the review to a checklist; infer the user's intent from evidence and reason from first principles.",
            "If the target, intent, or acceptance bar is ambiguous, ask with AskUserQuestion before judging instead of assuming.",
            "If review_expectation or complete_exact exists, follow it exactly.",
        ),
        reply_budget_utf8=160,
        result_style="short summary plus structured findings",
        validator_policy="exact-match route is protocol_fast; open-ended route stays live but still structured",
    ),
    "status": CommandPromptSpec(
        command_id="status",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Report only abnormal state, blockers, and active run deltas.",
        hard_stops=(
            "Do not restate healthy defaults.",
            "Do not expand into a dashboard walkthrough.",
        ),
        reply_budget_utf8=56,
        result_style="brief receipt",
        validator_policy="runtime truth comes from current authority only",
    ),
    "doctor": CommandPromptSpec(
        command_id="doctor",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Report only failing, drifting, missing checks, and any user decisions required to unblock authority.",
        hard_stops=(
            "Do not pad with passing checks.",
            "Do not claim repo health without checks.",
            "Do not launch broad Explore, Task, plugin-cache/source scans, or background investigation after the doctor result.",
            "If extra evidence is required, inspect only the smallest artifact explicitly named by the doctor payload.",
            "If work items are blocked or migration decisions are unresolved, ask with AskUserQuestion instead of guessing or fixing.",
        ),
        reply_budget_utf8=64,
        result_style="brief defect receipt",
        validator_policy="authority and generated surfaces decide health",
    ),
    "report": CommandPromptSpec(
        command_id="report",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Compress the current authority state into one short report outcome.",
        hard_stops=(
            "Do not replay the full run log.",
            "Do not invent missing evidence.",
        ),
        reply_budget_utf8=80,
        result_style="brief receipt with output path",
        validator_policy="report must stay authority-derived",
    ),
    "dashboard": CommandPromptSpec(
        command_id="dashboard",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Report endpoint, failure point, and one notable runtime delta only.",
        hard_stops=(
            "Do not narrate the whole UI.",
            "Do not omit the failure point or fabricate a runtime delta; when the result is clean, report the absence of failure as the finding.",
            "Do not describe dashboard rebuild as scaffold sync; rebuild only installs dependencies, builds dist, and restarts.",
        ),
        reply_budget_utf8=56,
        result_style="brief operator receipt",
        validator_policy="dashboard is read-only over .thoth ledgers",
    ),
    "orchestration": CommandPromptSpec(
        command_id="orchestration",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Create a controller object with dependency batches for ready work items.",
        hard_stops=(
            "Do not execute work while creating the controller.",
            "Do not invent missing work items.",
        ),
        reply_budget_utf8=56,
        result_style="brief controller receipt",
        validator_policy="object graph dependencies define batch order",
    ),
    "auto": CommandPromptSpec(
        command_id="auto",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="phase_controller",
        objective="Run actionable work items by scheduling priority through child loops until none remain, budget pauses, or stop is requested.",
        hard_stops=(
            "Do not execute blocked or draft work.",
            "Do not auto-abandon work items.",
            "Do not bypass execution-safety doctor preflight.",
        ),
        reply_budget_utf8=120,
        result_style="start or reuse the durable controller, then stream JSONL watch events until terminal or observer interruption",
        validator_policy="controller cursor, child loop results, and auto watch events define queue state",
    ),
    "init": CommandPromptSpec(
        command_id="init",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Report audit-first adopt/init outcome, generated artifacts, blockers, and user decisions required before continuing.",
        hard_stops=(
            "Do not assume the repo is blank.",
            "Do not assume goals, project identity, migration intent, work priority, unblock policy, or acceptance criteria.",
            "Do not launch broad Explore, Task, plugin-cache/source scans, or background investigation after the init result.",
            "If extra evidence is required, inspect only the smallest artifact explicitly named by the init payload.",
            "If the preview/apply result leaves blocked work or unresolved migration choices, ask with AskUserQuestion and stop.",
            "Do not narrate the full migration procedure.",
        ),
        reply_budget_utf8=60,
        result_style="brief outcome receipt",
        validator_policy="preview and generated artifacts define success",
    ),
    "sync": CommandPromptSpec(
        command_id="sync",
        route_class="mechanical_fast",
        intelligence_tier="none",
        packet_authority_mode="result_envelope",
        objective="Report whether generated surfaces are in sync and what changed.",
        hard_stops=(
            "Do not narrate unchanged surfaces.",
            "Do not hand-maintain generated semantics.",
        ),
        reply_budget_utf8=60,
        result_style="brief sync receipt",
        validator_policy="canonical renderers define parity",
    ),
    "discuss": CommandPromptSpec(
        command_id="discuss",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="command_packet",
        objective="Interrogate the user's idea until the compact authority categories are explicit: goal, constraints, decisions, risks, run_instructions, and open_questions.",
        hard_stops=(
            "Do not modify source code.",
            "Do not assume unanswered goals, constraints, success metrics, resources, timing, or authority.",
            "Ask about every material ambiguity; use AskUserQuestion and continue discussion until no meaningful assumptions remain.",
            "When a major semantic decision changes, checkpoint a compact authority event through the packet protocol command.",
            "When closing, translate the discussion through the compact categories: goal, constraints, decisions, risks, run_instructions, and open_questions.",
            "Do not hand-author a work item from memory; use packet.work_json_template and packet.required_work_json_fields.",
            "When closing authority for an existing work item, preserve its stable work_id; do not omit work_id and create a timestamp work item.",
            "Do not fabricate ready execution work items from unresolved decisions.",
            "Do not repeat the packet or decision payload verbatim.",
        ),
        reply_budget_utf8=240,
        result_style="question-driven planning dialogue or brief receipt when closed",
        validator_policy="planning authority plus compiler output decide completion",
    ),
    "extend": CommandPromptSpec(
        command_id="extend",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="command_packet",
        objective="Complete the requested repository change while preserving generated-surface parity.",
        hard_stops=(
            "Do not bypass repository test gates.",
            "Do not leave Claude and Codex projections drifting.",
            "Do not expand into changelog-style prose.",
        ),
        reply_budget_utf8=60,
        result_style="brief change receipt",
        validator_policy="repo tests and surface parity decide completion",
    ),
}


PUBLIC_COMMAND_PROMPT_IDS = frozenset(
    {"init", "discuss", "run", "loop", "review", "auto", "status", "doctor", "dashboard"}
)
INTERNAL_COMMAND_PROMPT_IDS = frozenset(COMMAND_PROMPT_SPECS) - PUBLIC_COMMAND_PROMPT_IDS


PHASE_PROMPT_SPECS: dict[str, PhasePromptSpec] = {
    "plan": PhasePromptSpec(
        phase="plan",
        objective="Act as top-level planner: prove user-authority coverage, then produce an executable plan without weakening discovery.",
        hard_stops=(
            "Do not modify project files.",
            "Do not change the work item goal, constraints, or validation entrypoint.",
            "Do not assume intent, acceptance, constraints, rejected options, permission, or cost outside strict_task.authority_context.",
            "Missing paths, dirs, tests, imports, or dependencies are discovery_tasks/execution_steps, not authority gaps.",
            "If authority_context has open questions or contradictions, set authority_complete=false and list open_gaps.",
            "Do not hand-edit .thoth ledgers.",
        ),
        required_fields=(
            "summary",
            "authority_complete",
            "authority_coverage",
            "open_gaps",
            "forbidden_assumptions_used",
            "execution_steps",
            "files_expected",
            "commands_expected",
            "validation_plan",
            "risk_assessment",
        ),
        summary_budget_utf8=1200,
        validator_policy="plan is read-only; only unresolved user authority terminalizes as needs_input; executable discovery belongs to execute",
    ),
    "execute": PhasePromptSpec(
        phase="execute",
        objective="Act as a senior implementation engineer: implement, debug engineering failures inside the repo-local boundary, run the official validator in the same host session, and return an auditable validation receipt.",
        hard_stops=(
            "Do not hand-edit .thoth ledgers.",
            "Do not terminalize the full run from inside execute.",
            "Read and follow prior_artifacts.plan before changing files; record any deviation.",
            "Do not run destructive delete/reset commands.",
            "Do not change the work item goal, validation entrypoint, metric, or acceptance threshold.",
        ),
        required_fields=("summary", "plan_artifact_read", "plan_deviations", "files_touched", "commands_run", "artifacts"),
        summary_budget_utf8=800,
        validator_policy="execute follows the plan artifact, self-debugs implementation/dependency issues, and runs the official validator; validate mechanically confirms the execute receipt",
    ),
    "validate": PhasePromptSpec(
        phase="validate",
        objective="Act as a mechanical acceptance receipt verifier: confirm the official validator receipt produced by execute.",
        hard_stops=(
            "Do not launch a new Codex or Claude worker inside validate.",
            "Do not repair code inside validate.",
            "Do not guess pass/fail from intuition.",
            "Do not skip eval_entrypoint.command receipt matching when it exists.",
        ),
        required_fields=("summary", "passed", "metric_name", "metric_value", "threshold", "checks"),
        summary_budget_utf8=800,
        validator_policy="the execute official_validation_receipt decides whether the run completes or enters reflect",
    ),
    "reflect": PhasePromptSpec(
        phase="reflect",
        objective="Act as a human-style senior reviewer: on success record compact lessons; on failure produce one direct corrective prompt for the next execute cycle without weakening authority.",
        hard_stops=(
            "Do not keep executing.",
            "Do not run extra commands.",
            "Do not change validation verdicts.",
            "Do not authorize retries for needs_input, authority gaps, permission overreach, or changed acceptance criteria.",
        ),
        required_fields=("summary", "outcome", "residual_risks", "evidence", "next_recommendation"),
        summary_budget_utf8=1200,
        validator_policy="reflect always runs after validate, never overrides validate.passed, and may authorize one execute retry through corrective_prompt",
    ),
}


PHASE_ROLE_CONTRACTS: dict[str, tuple[str, ...]] = {
    "plan": (
        "Role: top-level planner.",
        "Be strict about user authority: intent, acceptance, constraints, rejected options, permission, and cost must be covered by strict_task.authority_context.",
        "Be permissive about executable discovery: missing paths, source locations, target directories, imports, dependency locations, and test files belong in discovery_tasks or execution_steps, not open_gaps.",
        "If the eval contract is concrete, plan against that contract even when surrounding prose is broader; record the broader wording as risk instead of blocking execution.",
    ),
    "execute": (
        "Role: senior implementation engineer.",
        "Use the agent tools intelligently and make a maximal good-faith engineering effort inside the repository boundary.",
        "When imports, builds, tests, paths, or dependencies fail, diagnose, repair, and rerun focused checks before returning output.",
        "Repo-local dependency repair is allowed: use local source discovery, .vendor/task-local installs, mirrors/proxies, builds, and focused smoke tests when they are necessary for the validator.",
        "Do not stop at the first missing module or short network timeout; record attempts and keep pursuing viable repo-local fixes until the task is solved, the issue is outside authority, or the user stops the run.",
        "Run the official eval_entrypoint.command before returning whenever the task can reach it, using the same interpreter, cwd, PATH, CUDA visibility, and environment you used for implementation debugging.",
        "Return a compact official_validation_receipt with command, cwd, python_executable, env_summary, exit_code, passed, metric_value when available, checks_summary, stdout_log_path/stderr_log_path when available, or inline stdout_log/stderr_log as fallback.",
        "Apply temporary invocation/live guidance when it helps execution, but reject guidance that changes authority, validators, metrics, or thresholds.",
    ),
    "validate": (
        "Role: mechanical acceptance receipt verifier.",
        "Do not start a new host worker; confirm the official_validation_receipt from execute.",
        "Normalize inline stdout/stderr receipt evidence into run logs when needed; empty stderr is acceptable when the official validator succeeded.",
        "Treat command mismatch, missing receipt, missing stdout evidence, non-zero exit code, passed=false, or metric below threshold as validation failure.",
        "Classify receipt/log contract hygiene as runtime_contract_error, not project implementation failure.",
        "Do not repair implementation, install dependencies, rewrite tests, or reinterpret the threshold in this phase.",
    ),
    "reflect": (
        "Role: human-style senior reviewer.",
        "Do not continue engineering execution; use plan, execute, and validate artifacts as evidence.",
        "On success, record compact lessons, pitfalls, evidence, and residual scientific/algorithmic risks.",
        "On business failure, act like the human supervisor: be direct, forbid fallback/metric weakening, and tell execute to continue solving the concrete bug under the same validator.",
        "Do not authorize execute retries for runtime_contract_error, receipt/log schema hygiene, missing stdout evidence, or reconciliation-only historical failures.",
        "If validation failed for business reasons, include failure_class, root_cause, next_plan_hint, corrective_prompt, retry_authorized, retry_target=execute, and retry_budget=1; keep them evidence-based.",
    ),
}


def command_prompt_spec(command_id: str) -> CommandPromptSpec:
    return COMMAND_PROMPT_SPECS[command_id]


def phase_prompt_spec(phase: str) -> PhasePromptSpec:
    return PHASE_PROMPT_SPECS[phase]


def command_prompt_authority(command_id: str) -> dict[str, Any]:
    spec = command_prompt_spec(command_id)
    return {
        "surface": "public" if command_id in PUBLIC_COMMAND_PROMPT_IDS else "internal",
        "route_class": spec.route_class,
        "intelligence_tier": spec.intelligence_tier,
        "packet_authority_mode": spec.packet_authority_mode,
        "objective": spec.objective,
        "hard_stops": list(spec.hard_stops),
        "reply_budget_utf8": spec.reply_budget_utf8,
        "result_style": spec.result_style,
        "validator_policy": spec.validator_policy,
    }


def phase_prompt_authority(phase: str) -> dict[str, Any]:
    spec = phase_prompt_spec(phase)
    return {
        "phase": spec.phase,
        "objective": spec.objective,
        "hard_stops": list(spec.hard_stops),
        "required_fields": list(spec.required_fields),
        "summary_budget_utf8": spec.summary_budget_utf8,
        "validator_policy": spec.validator_policy,
    }


def _render_bullets(items: tuple[str, ...]) -> str:
    return "\n".join(f"- {item}" for item in items)


def render_command_contract_markdown(command_id: str, *, heading_level: int = 2) -> str:
    spec = command_prompt_spec(command_id)
    heading = "#" * max(1, heading_level)
    return f"""{heading} Route

- route_class: `{spec.route_class}`
- intelligence_tier: `{spec.intelligence_tier}`
- packet_authority_mode: `{spec.packet_authority_mode}`

{heading} Objective

{spec.objective}

{heading} Hard Stops

{_render_bullets(spec.hard_stops)}

{heading} Reply Contract

- reply_budget_utf8: `{spec.reply_budget_utf8}`
- result_style: {spec.result_style}
- validator_policy: {spec.validator_policy}
"""


def render_phase_worker_prompt(
    *,
    phase_packet: dict[str, Any],
    run_id: str,
    project_root: Path,
    output_path: Path,
    correction_error: str | None = None,
) -> str:
    phase = str(phase_packet.get("phase") or "")
    authority = phase_packet.get("phase_authority")
    if not isinstance(authority, dict):
        authority = phase_prompt_authority(phase)
    hard_stops = authority.get("hard_stops") if isinstance(authority.get("hard_stops"), list) else []
    required_fields = authority.get("required_fields") if isinstance(authority.get("required_fields"), list) else []
    role_contract = PHASE_ROLE_CONTRACTS.get(phase, ())
    lines = [
        f"Run id: {run_id}",
        f"Work only inside `{project_root}`.",
        f"Execute exactly one phase: `{phase}`.",
        "Finish with exactly one JSON object and no surrounding prose.",
        "Do not create or edit `.thoth` ledgers by hand.",
        "Do not invoke `$thoth run`, `$thoth loop`, or `$thoth review`.",
        f"Objective: {authority.get('objective')}",
        f"Required fields: {', '.join(str(item) for item in required_fields)}",
        f"Summary budget UTF-8 bytes: {authority.get('summary_budget_utf8')}",
        "Keep narrative fields compact; runtime records _normalization_warnings when normalizing over-budget text.",
        f"Validator policy: {authority.get('validator_policy')}",
    ]
    if role_contract:
        lines.append("Phase role contract:")
        lines.extend(f"  - {item}" for item in role_contract)
    loop_context = phase_packet.get("loop_context")
    if isinstance(loop_context, dict) and loop_context:
        lines.append("Use `loop_context` to avoid repeating the previous failure; follow its next_plan_hint without changing the work goal or validator.")
    guidance = phase_packet.get("guidance")
    if isinstance(guidance, dict) and guidance:
        lines.append("Guidance is temporary: read inbox/tail at phase start/failures; never change authority, validators, metrics, or thresholds.")
    if output_path:
        lines.append(f"Runtime driver capture path: `{output_path}`.")
    if phase == "plan":
        lines.append("Set authority_complete=false only when user intent, acceptance, constraints, rejected options, permission, or cost is missing/contradictory.")
        lines.append("Put missing paths, sources, target dirs, tests, imports, and dependency locations in optional `discovery_tasks`; continue.")
        lines.append("If goal is broad but eval contract is concrete, use that contract and record a risk.")
        lines.append("Do not invent authority; the plan may only prepare execution for already closed discussion authority.")
    if phase == "execute":
        lines.append("Read `required_plan_artifact` or `prior_artifacts.plan` before touching files and set plan_artifact_read=true only after doing so.")
        lines.append("Follow the plan artifact; if deviation is necessary, list it in plan_deviations without changing the goal or validator.")
        lines.append("Use focused validation during execute as an engineering feedback loop, then run the official eval_entrypoint.command before returning whenever reachable.")
        lines.append("Return `official_validation_receipt` with command, cwd, python_executable, env_summary, exit_code, passed, metric_value when available, checks_summary, stdout_log_path/stderr_log_path when available, or inline stdout_log/stderr_log as fallback. The later validate phase mechanically normalizes and confirms this receipt instead of launching a separate worker.")
        lines.append("If you repair dependencies, prefer repo-local or task-local locations such as `.vendor`; do not mutate global environments unless the work item explicitly authorizes it.")
        lines.append("Do not wait for reflect to solve engineering bugs; debug imports, CUDA visibility, local dependency shims, build issues, and test failures here when they are inside task authority.")
        lines.append("Optional structured fields for human dashboards: debug_attempts, verification_steps, dependency_actions, resolved_failures, remaining_failures.")
    if phase == "reflect":
        lines.append("If validate failed for a project/business issue still inside task authority, return retry_authorized=true, retry_target=\"execute\", retry_budget=1, and a direct corrective_prompt for the next execute cycle.")
        lines.append("If validate failure_class or runtime_contract_health is runtime_contract_error, return retry_authorized=false and explain the Thoth runtime/reconcile issue instead of sending execute back to edit the project.")
        lines.append("The corrective_prompt should preserve the original goal, validator, metric, and threshold while telling execute to continue debugging the concrete failure.")
    lines.extend(f"Hard stop: {item}" for item in hard_stops)
    if correction_error:
        lines.append(f"Previous output failed validation: {correction_error}")
        lines.append("Rewrite one shorter, stricter JSON object only.")
    return f"""# Thoth Phase Worker

{chr(10).join(f"- {line}" for line in lines)}

Phase Packet
```json
{json.dumps(phase_packet, ensure_ascii=False)}
```
"""


def build_codex_public_command_prompt(
    command_id: str,
    *,
    public_command: str,
    shell_command: str,
    done_token: str,
) -> str:
    spec = command_prompt_spec(command_id)
    lines = [
        "Operate only on this repo.",
        "Use the installed skill named thoth.",
        f"The Codex public surface is `{public_command}`, but in the workspace shell you must execute it literally as `{shell_command}`.",
        "Execute that shell command immediately as your first meaningful action.",
        "Do not explain the command before executing it.",
        "Do not replace execution with prose.",
        "If the user supplied arguments or trailing natural-language guidance after the public command, preserve those exact arguments in the shell invocation.",
        "If neither PATH nor the installed Codex plugin cache or marketplace root contains the runtime entrypoint, report host install drift instead of inventing another entrypoint.",
        f"route_class={spec.route_class}.",
        f"intelligence_tier={spec.intelligence_tier}.",
        f"packet_authority_mode={spec.packet_authority_mode}.",
        f"Objective: {spec.objective}",
    ]
    lines.extend(f"Hard stop: {item}" for item in spec.hard_stops)
    if command_id in {"run", "loop", "auto"}:
        lines.extend(
            (
                "If the command streams runtime events, report progress and risks from those events only.",
                "Stay in the same session until the RuntimeDriver reaches terminal state unless --sleep was requested.",
                "Runtime lifecycle is plan -> execute -> validate -> reflect; auto advances selected work through child loops.",
                "In current runtime semantics, execute owns implementation plus the official validator run; validate mechanically normalizes and confirms execute's official_validation_receipt.",
                "Do not hand-edit `.thoth`; let the Thoth runtime driver advance phases.",
                "If the user sends a natural-language correction while a live run/loop/auto is active, inject it into the active run guidance inbox through the packet protocol or installed runtime instead of merely replying with advice.",
                "Treat such live corrections as temporary guidance: they may steer execution and debugging, but they must not rewrite work authority or validation criteria.",
                "Prefer waiting over polling: check roughly every 90 seconds during quiet progress, unless terminal/error evidence, worker-invalid, missing receipt, runtime mismatch, or user guidance appears.",
                "When evidence shows a low-level engineering mistake or runtime mismatch, proactively append guidance or interrupt the active run instead of only narrating the problem.",
            )
        )
    if command_id in {"run", "loop"}:
        lines.append("Plan must prove user-authority coverage before execute; executable discovery such as finding paths or creating missing target files should flow into execute, not needs_input.")
    elif command_id == "review":
        lines.extend(
            (
                "If the command returns a review packet, stay inside that review protocol only.",
                "If `packet.review_mode` is `exact_match`, reproduce that exact structured result.",
                "If `packet.protocol_commands.complete_exact` exists, execute that exact completion command.",
            )
        )
    elif command_id == "discuss":
        lines.extend(
            (
                "If the command returns a command packet, use that packet as the only authority for the follow-up action.",
                "Checkpoint major semantic changes through packet.protocol_commands.checkpoint_authority.",
                "Close only by filling compact authority categories plus packet.work_json_template, then executing packet.protocol_commands.close_authority.",
                "When closing authority for an existing work item, preserve that stable work_id in work_json_template; do not omit work_id and create a timestamp work item.",
                "Do not restate packet fields or expand into teaching prose.",
            )
        )
    lines.append(f"Reply with `{done_token}` only after the command path reaches its terminal outcome.")
    return " ".join(lines)


def codex_installed_runtime_shell_command(public_command: str) -> str:
    parts = shlex.split(public_command.strip())
    if parts and parts[0] == "$thoth":
        args = parts[1:]
    elif parts and parts[0] == "thoth":
        args = parts[1:]
    else:
        args = parts
    resolver = (
        "set -euo pipefail; "
        "if [ -n \"${THOTH_SELFTEST_RUNTIME_ROOT:-}\" ]; then "
        "if [ -x \"$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth\" ]; then exec \"$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth\" \"$@\"; fi; "
        "if [ -f \"$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py\" ]; then exec python3 \"$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py\" \"$@\"; fi; "
        "fi; "
        "if command -v thoth >/dev/null 2>&1; then exec thoth \"$@\"; fi; "
        "candidates=\"$(ls -td \"$HOME\"/.codex/plugins/cache/thoth/thoth/* \"$HOME\"/.codex/plugins/cache/thoth/* \"$HOME\"/.codex/plugins/cache/*/thoth/* \"$HOME\"/.codex/plugins/cache/*/Thoth/* 2>/dev/null || true)\"; "
        "marketplace=\"$HOME/.codex/.tmp/marketplaces/thoth\"; "
        "if [ -d \"$marketplace\" ]; then candidates=\"$candidates\n$marketplace\"; fi; "
        "for candidate in $candidates; do "
        "if [ -x \"$candidate/bin/thoth\" ]; then exec \"$candidate/bin/thoth\" \"$@\"; fi; "
        "if [ -f \"$candidate/scripts/thoth-cli-entry.py\" ]; then "
        "if command -v python3 >/dev/null 2>&1; then exec python3 \"$candidate/scripts/thoth-cli-entry.py\" \"$@\"; "
        "else exec python \"$candidate/scripts/thoth-cli-entry.py\" \"$@\"; fi; "
        "fi; "
        "done; "
        "echo 'thoth installed runtime not found' >&2; exit 127"
    )
    def quote_runtime_arg(arg: str) -> str:
        if arg.startswith("$(cat ") and arg.endswith(")") and "\n" not in arg:
            return '"' + arg.replace('"', '\\"') + '"'
        return shlex.quote(arg)

    return " ".join(["bash", "-lc", shlex.quote(resolver), "thoth", *(quote_runtime_arg(arg) for arg in args)])


def render_codex_command_micro_prompt(command_id: str) -> str:
    public_command = f"$thoth {command_id}"
    shell_command = codex_installed_runtime_shell_command(public_command)
    done_token = "THOTH_DONE"
    return f"""# {public_command}

Generated micro prompt for the Thoth Codex dispatcher.

{render_command_contract_markdown(command_id, heading_level=2).strip()}

## Execution String

{build_codex_public_command_prompt(command_id, public_command=public_command, shell_command=shell_command, done_token=done_token)}
"""


def build_codex_selftest_command_probe_prompt(*, public_command: str, shell_command: str, done_token: str) -> str:
    public_equivalent = public_command.replace("$thoth ", "thoth ", 1)
    return " ".join(
        (
            "This is a Thoth heavy selftest command probe.",
            "Operate only on this repo.",
            f"The Codex public surface is `{public_command}`, but in the workspace shell you must execute it literally as `{shell_command}`.",
            f"The public shell equivalent is `{public_equivalent}`.",
            "Execute that shell command immediately as your first meaningful action.",
            "Do not inspect files, search memories, explain, retry, or execute any second shell command.",
            "Do not manually continue runtime protocol phases and do not substitute a different entrypoint.",
            "If the installed Thoth runtime is missing from PATH, the installed Codex plugin cache, and the marketplace root, treat that as host install drift.",
            f"After the shell command exits successfully, reply with `{done_token}` only.",
        )
    )


def build_codex_selftest_review_probe_prompt(*, public_command: str, shell_command: str, done_token: str) -> str:
    public_equivalent = public_command.replace("$thoth ", "thoth ", 1)
    return " ".join(
        (
            "This is a Thoth heavy selftest review probe.",
            "Operate only on this repo.",
            f"The Codex public surface is `{public_command}`, but in the workspace shell you must execute it literally as `{shell_command}`.",
            f"The public shell equivalent is `{public_equivalent}`.",
            "Execute that shell command immediately as your first action.",
            "Do not send commentary, progress updates, plans, explanations, or any non-command message before that command.",
            "After the review packet is prepared, stay inside the Thoth review protocol only.",
            "Inspect only the review target, the prepared packet, and files directly required by the protocol.",
            "Do not inspect CLI help, do not explore unrelated files, and do not execute exploratory commands.",
            "Allowed follow-up commands only: the packet-provided protocol command(s), the strict task eval entrypoint, and the minimum direct file reads needed to perform this review.",
            "Do not run `--help`, `which`, `codex`, `grep`, or any discovery command after the packet is prepared.",
            "Do not modify code, do not add a second finding, and do not emit prose outside the structured review result.",
            "If `packet.strict_task.review_expectation` exists, use that exact object as the final review result.",
            "If `packet.protocol_commands.complete_exact` exists, execute that exact completion command.",
            "Run the strict task eval entrypoint exactly once if the packet requires it, then finish the run via the packet-provided complete command.",
            "For review completion, `--summary` must be a short plain string only; the structured review object belongs only in `--result-json`.",
            "When completing the run, pass the exact review result via `--result-json` and mark the exact-match check as passing via `--checks-json`.",
            f"After the review run terminalizes successfully, reply with `{done_token}` only.",
        )
    )


def build_review_result_shape() -> dict[str, Any]:
    return {
        "summary": "Short summary <= 48 UTF-8 bytes.",
        "findings": [
            {
                "severity": "high|medium|low",
                "title": "Short title <= 32 UTF-8 bytes.",
                "path": "relative/file/path",
                "line": 1,
                "summary": "Short summary <= 48 UTF-8 bytes.",
            }
        ],
    }


__all__ = [
    "COMMAND_PROMPT_SPECS",
    "INTERNAL_COMMAND_PROMPT_IDS",
    "PHASE_PROMPT_SPECS",
    "PUBLIC_COMMAND_PROMPT_IDS",
    "CommandPromptSpec",
    "PhasePromptSpec",
    "build_codex_public_command_prompt",
    "codex_installed_runtime_shell_command",
    "build_codex_selftest_command_probe_prompt",
    "build_codex_selftest_review_probe_prompt",
    "build_review_result_shape",
    "command_prompt_authority",
    "command_prompt_spec",
    "phase_prompt_authority",
    "phase_prompt_spec",
    "render_codex_command_micro_prompt",
    "render_command_contract_markdown",
    "render_phase_worker_prompt",
]
