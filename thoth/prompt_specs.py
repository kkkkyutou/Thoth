"""Compressed prompt authority for Thoth public commands, internal routes, and live phases."""

from __future__ import annotations

import json
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from thoth.run.model import DEFAULT_LIVE_OBSERVE_INTERVAL_SECONDS


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
        objective="Finish the current strict task through the four-phase RuntimeDriver while preserving agent intelligence and producing canonical acceptance evidence inside execute.",
        hard_stops=(
            "Do not invent or compile a new work item when --work-id is missing.",
            "Do not exit the monitoring session before the RuntimeDriver signals a terminal state.",
            "Do not treat missing canonical artifacts, metrics, logs, receipts, benchmark output, or service state as final failure before execute has produced them or captured a concrete root cause.",
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
        objective="Advance the current bounded loop through foreground or sleeping RuntimeDriver monitoring while preserving evidence-producing execute behavior in each child run.",
        hard_stops=(
            "Do not decide extra iterations outside the recorded loop budget.",
            "Do not proceed to the next loop iteration before the validator signals terminal.",
            "Do not let a child execute stop merely because a self-imposed observation window has not yet seen canonical evidence.",
            "Do not expand into iteration diaries or runtime narration.",
        ),
        reply_budget_utf8=40,
        result_style="terminal receipt only",
        validator_policy="loop budget controls retries; child validate confirms execute's validator receipt",
    ),
    "argue": CommandPromptSpec(
        command_id="argue",
        route_class="live_intelligent",
        intelligence_tier="high",
        packet_authority_mode="argument_record",
        objective="Run a human-quality adversarial discussion: resolve the intended target, ask if ambiguous, let an attacker challenge the direction from first principles, then let an independent adjudicator decide decision_impact and preview any authority patch.",
        hard_stops=(
            "Do not modify project code or write fixes.",
            "Do not silently choose among multiple plausible work items or decisions; ask with AskUserQuestion instead.",
            "Do not summarize the executor's position as adjudication; attacker and adjudicator must be independent fresh sessions.",
            "Do not collapse the result into PASS/WARN/FAIL; use decision_impact.",
            "Do not mutate work_item, decision, or discussion authority unless the user explicitly confirms the apply step.",
        ),
        reply_budget_utf8=220,
        result_style="short receipt with artifact paths, decision_impact, and confirmation-required patch preview when present",
        validator_policy="argument artifacts are evidence; only a confirmed apply command may change compact authority fields",
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
        objective="Run actionable work items through child loops while preserving architecture-first execution, evidence-producing execute behavior, and human-quality phase handoffs.",
        hard_stops=(
            "Do not execute blocked or draft work.",
            "Do not auto-abandon work items.",
            "Do not bypass execution-safety doctor preflight.",
            "Do not let child runs convert missing canonical evidence into terminal explanation when execute can still generate, repair, instrument, rerun, or diagnose it.",
            "Do not let child runs satisfy work through MVP, fallback, mock, stub, simplified, branch-only, or compatibility-shim implementations unless authority explicitly asks for them.",
        ),
        reply_budget_utf8=120,
        result_style="start or reuse the durable controller, then stream JSONL watch events until terminal or observer interruption",
        validator_policy="controller cursor, child loop results, and auto watch events define queue state",
    ),
    "init": CommandPromptSpec(
        command_id="init",
        route_class="hybrid_init",
        intelligence_tier="intent_sensitive",
        packet_authority_mode="result_envelope_or_command_packet",
        objective="Initialize audit-first project authority; when natural-language intent is supplied, save the raw intent as an init discussion and continue by questioning until compact authority is closed.",
        hard_stops=(
            "Do not assume the repo is blank.",
            "Do not assume goals, project identity, migration intent, work ordering, unblock policy, or acceptance criteria.",
            "Do not turn init intent into ready work immediately.",
            "Do not bake an unconfirmed summary of the raw intent into AGENTS.md, CLAUDE.md, or generated project docs.",
            "Do not combine natural-language init intent with --sync, --migrate, --preview, or --apply.",
            "Do not launch broad Explore, Task, plugin-cache/source scans, or background investigation after the init result.",
            "If extra evidence is required, inspect only the smallest artifact explicitly named by the init payload.",
            "If init opens an intent discussion, use AskUserQuestion in Claude or Plan/request_user_input in Codex to ask only the next material questions before closing authority.",
            "If the preview/apply result leaves blocked work or unresolved migration choices, ask with AskUserQuestion or the host's planning question tool and stop.",
            "Do not narrate the full migration procedure.",
        ),
        reply_budget_utf8=180,
        result_style="brief mechanical receipt when no intent; question-driven planning handoff when intent discussion is opened",
        validator_policy="scaffold success comes from generated artifacts; intent success comes from preserving raw discussion authority without fabricating work",
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
        objective="Interrogate the user's idea until the compact authority categories are explicit: goal, constraints, decisions, risks, approach_notes, and open_questions.",
        hard_stops=(
            "Do not modify source code.",
            "Do not assume unanswered goals, constraints, success metrics, resources, timing, or authority.",
            "Ask about every material ambiguity; use AskUserQuestion and continue discussion until no meaningful assumptions remain.",
            "When a major semantic decision changes, checkpoint a compact authority event through the packet protocol command.",
            "When closing, translate the discussion through the compact categories: goal, constraints, decisions, risks, approach_notes, and open_questions.",
            "Do not hand-author work authority from memory; use packet.work_json_template or packet.work_graph_schema, and obey packet.required_work_json_fields for single work items.",
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
    {"init", "discuss", "run", "loop", "argue", "auto", "status", "doctor", "dashboard"}
)
INTERNAL_COMMAND_PROMPT_IDS = frozenset(COMMAND_PROMPT_SPECS) - PUBLIC_COMMAND_PROMPT_IDS


PHASE_PROMPT_SPECS: dict[str, PhasePromptSpec] = {
    "plan": PhasePromptSpec(
        phase="plan",
        objective="Act as a senior planner: read authority plus recent run history, identify the canonical evidence ladder, decide whether to continue, close from history, or request input, then write a rich handoff for a fresh execute session.",
        hard_stops=(
            "Do not modify project files.",
            "Do not change the work item goal, constraints, acceptance_spec metric, threshold, or user authority.",
            "Do not assume missing user intent, acceptance, permission, or cost.",
            "Missing paths, scripts, imports, dependencies, or validator files are executable discovery, not authority gaps.",
            "Do not treat missing canonical evidence as a final acceptance failure while execute can still produce, repair, instrument, rerun, or diagnose it.",
            "If authority has open questions or contradictions, set authority_complete=false and history_action=needs_input.",
            "Do not hand-edit .thoth ledgers.",
        ),
        required_fields=(
            "summary",
            "authority_complete",
            "open_gaps",
            "history_action",
            "plan",
        ),
        summary_budget_utf8=1200,
        validator_policy="plan is read-only; history_action controls continuation, history closure, or needs_input; the plan body carries the cross-session handoff",
    ),
    "execute": PhasePromptSpec(
        phase="execute",
        objective="Act as a senior implementation engineer: read the full plan handoff, implement the final architecture directly, actively produce canonical acceptance evidence, report what happened in rich markdown, and return an auditable official validation receipt.",
        hard_stops=(
            "Do not hand-edit .thoth ledgers.",
            "Do not terminalize the full run from inside execute.",
            "Read and follow the complete plan artifact before changing files.",
            "Do not run destructive delete/reset commands.",
            "Do not change the work item goal, acceptance intent, metric, or threshold.",
            "Do not use MVP, fallback, mock, stub, or simplified evidence as a substitute for acceptance_spec.",
            "Do not terminate healthy work because a short observation window has not yet produced canonical artifacts, metrics, logs, receipts, benchmark output, or service state.",
            "Do not return missing canonical evidence as the final failure until you have captured a concrete root cause, blocker, or budget boundary.",
        ),
        required_fields=("summary", "report", "official_validation_receipt"),
        summary_budget_utf8=800,
        validator_policy="execute follows the full plan handoff, materializes/repairs validators when needed, self-debugs inside authority, and returns evidence-centric official_validation_receipt",
    ),
    "validate": PhasePromptSpec(
        phase="validate",
        objective="Runtime validation contract: mechanically audit execute's official_validation_receipt without launching another worker.",
        hard_stops=(
            "Do not launch a new Codex or Claude worker inside validate.",
            "Do not repair code inside validate.",
            "Do not guess pass/fail from intuition.",
            "Do not treat reference_command string mismatch as failure when acceptance intent, metric, threshold, and evidence are preserved.",
        ),
        required_fields=("summary", "passed", "metric_name", "metric_value", "threshold", "checks"),
        summary_budget_utf8=800,
        validator_policy="execute owns intelligent validation work; validate audits receipt evidence, metric, threshold, and acceptance preservation",
    ),
    "reflect": PhasePromptSpec(
        phase="reflect",
        objective="Act as a technical lead: read the prior artifacts, write a rich markdown review, and on failure produce one direct corrective prompt that continues evidence production or fixes the concrete root cause without weakening authority.",
        hard_stops=(
            "Do not keep executing.",
            "Do not run extra commands.",
            "Do not change validation verdicts.",
            "Do not let missing canonical evidence without a concrete root cause become a vague final explanation.",
            "Do not authorize retries for needs_input, authority gaps, permission overreach, or changed acceptance criteria.",
        ),
        required_fields=("summary", "outcome", "review"),
        summary_budget_utf8=1200,
        validator_policy="reflect always runs after validate, never overrides validate.passed, and may authorize one execute retry through corrective_prompt",
    ),
}


PHASE_ROLE_CONTRACTS: dict[str, tuple[str, ...]] = {
    "plan": (
        "1. Role: act like a senior teammate preparing a new execute session, not a schema filler.",
        "2. Authority: protect goal, constraints, acceptance_spec, metric, threshold, rejected options, permission, and cost.",
        "3. History: inspect current work_id history from the packet; if useful work exists, continue from it; if current acceptance is already proven, choose close_from_history.",
        "4. Evidence ladder: name the canonical artifacts, metrics, logs, receipts, benchmark outputs, service states, or files that prove acceptance.",
        "5. Gaps: only user intent, acceptance, permission, or real contradiction can become open_gaps; missing code paths, validators, or evidence files are execution work.",
        "6. Handoff: write `plan` as a clear markdown handoff with history lessons, continuation point, evidence-production sequence, validator materialization, and risks.",
        "7. Output: set history_action to exactly continue, close_from_history, or needs_input.",
    ),
    "execute": (
        "1. Role: act as the implementation and validation engineer in one shared context.",
        "2. Authority: preserve goal, acceptance intent, metric, threshold, and user constraints; reject guidance that weakens them.",
        "3. Work: implement the final target directly and repair repo-local engineering issues instead of stopping at first friction.",
        "4. Validator: if acceptance_spec starts as prose, IO examples, or a missing script name, materialize the validator and record what changed.",
        "5. Evidence-production doctrine: if acceptance depends on a canonical artifact, metric, log, receipt, benchmark output, service state, or file, missing evidence is execution work; generate it, repair it, instrument it, rerun it, or capture the concrete root cause.",
        "6. Process judgment: do not kill healthy work because a self-imposed observation window expired; stop or restart only as explicit debugging or cleanup for failed, stuck, resource-conflicted, or blocking processes, and preserve the reason and logs.",
        "7. Budget boundary: if the authorized budget ends before acceptance closes, preserve continuation evidence such as logs, checkpoints, partial metrics, monitor commands, and the exact next command instead of presenting the work as passed.",
        "8. Evidence: do not use MVP, fallback, mock, stub, or simplified evidence as a substitute for acceptance_spec.",
        "9. Task-fit: for example AI research, training, CUDA, or inference tasks should use GPU-first training/inference or official validation when acceptance depends on it.",
        "10. Receipt: return compact facts: command, exit_code, passed, metric_value, stdout_log/stderr_log or paths, and command relation when a reference command exists.",
        "11. Report: explain what was built, what validation was materialized or repaired, what canonical evidence was produced, and the true root cause or budget boundary if not passed.",
    ),
    "validate": (
        "1. Runtime: no separate worker is launched for validate.",
        "2. Receipt: normalize execute's official_validation_receipt into one compact canonical shape before auditing it.",
        "3. Command relation: reference command mismatch is diagnostic only when the same acceptance intent is preserved.",
        "4. Failure: missing receipt/evidence, passed=false, metric miss, validator drift, or insufficient evidence fails validation.",
        "5. Boundary: validate never repairs code or rewrites acceptance.",
    ),
    "reflect": (
        "1. Role: act as a senior reviewer for the user and the next execute attempt.",
        "2. Evidence: review plan, execute, validate, and receipt artifacts without running new commands.",
        "3. Success: explain why acceptance was preserved and what residual risk remains.",
        "4. Missing evidence: if canonical artifacts, metrics, logs, receipts, benchmark output, service state, or files are missing and no concrete root cause was captured, make corrective_prompt continue evidence production or root-cause capture.",
        "5. Failure: always provide corrective_prompt; for business/project failures it is the next execute instruction, for runtime_contract_error it is an operator/runtime repair instruction.",
        "6. Boundary: set retry_authorized=false for needs_input, authority gaps, permission overreach, runtime contract errors, or changed acceptance.",
        "7. Standards: call out MVP/fallback/mock/stub/simplified evidence when it substituted for acceptance_spec.",
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
    return "\n".join(f"{index}. {item}" for index, item in enumerate(items, start=1))


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
        "Do not invoke `$thoth run`, `$thoth loop`, or `$thoth argue`.",
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
        lines.append("Use `loop_context` to avoid repeating the previous failure; follow its corrective_prompt or next_plan_hint without changing the work goal or validator.")
    guidance = phase_packet.get("guidance")
    if isinstance(guidance, dict) and guidance:
        lines.append("Guidance is temporary: read inbox/tail at phase start/failures; never change authority, validators, metrics, or thresholds.")
    if output_path:
        lines.append(f"Runtime driver capture path: `{output_path}`.")
    if phase == "plan":
        lines.append("1. Set authority_complete=false only when user intent, acceptance, constraints, rejected options, permission, or cost is missing/contradictory.")
        lines.append("2. Inspect history_context for this work_id before planning; do not restart if a prior run has usable progress or lessons.")
        lines.append("3. Set history_action=continue when execution should proceed, close_from_history when historical receipt already proves current acceptance, or needs_input when authority is not closed.")
        lines.append("4. Identify the canonical evidence ladder: artifacts, metrics, logs, receipts, benchmark outputs, service states, files, or validator results that prove acceptance.")
        lines.append("5. Write `plan` as a rich markdown handoff for the next fresh execute session, including history lessons, continuation point, evidence-production sequence, validator materialization, and risks.")
        lines.append("6. Missing paths, scripts, tests, imports, dependency locations, validator files, or canonical evidence files are executable discovery inside the plan body, not open_gaps.")
    if phase == "execute":
        lines.append("Read the complete `required_plan_artifact` or `prior_artifacts.plan` before touching files. Your `report` must show how you followed its final-architecture constraints.")
        lines.append("Follow the plan artifact without changing the goal, acceptance intent, metric, or threshold.")
        lines.append("Do not use MVP, fallback, mock, stub, or simplified work/evidence as a substitute for acceptance_spec.")
        lines.append("Temporary probes are allowed only as diagnostics; they must not become the implementation path or hide final-architecture failure.")
        lines.append("Evidence-production doctrine: when acceptance depends on a canonical artifact, metric, log, receipt, benchmark output, service state, or file, missing evidence is execution work; generate it, repair it, instrument it, rerun it, or capture the concrete root cause.")
        lines.append("Do not terminate healthy work because a self-imposed observation window expired or because canonical metrics/logs/artifacts have not appeared yet.")
        lines.append("You may stop or restart a process only as explicit debugging or cleanup when it is failed, stuck, resource-conflicted, or blocking; preserve logs, the reason, and the next action.")
        lines.append("If the authorized budget ends before acceptance closes, preserve continuation evidence such as logs, checkpoints, partial metrics, monitor commands, and the exact next command; do not present the work as passed.")
        lines.append("Do not return missing canonical evidence as the final failure until you have captured a concrete root cause, unrecoverable blocker, or budget boundary.")
        lines.append("Choose verification that matches the task. For example, AI research, model training, CUDA, or inference tasks should use a GPU-first verification posture: run real GPU training/inference smoke tests and the official validator early enough to guide implementation instead of substituting CPU-only, mock-only, shape-only, or MVP-only evidence.")
        lines.append("Use focused validation during execute as an engineering feedback loop. If acceptance_spec names a missing script or prose/IO standard, materialize the validator and run it.")
        lines.append("Return compact `official_validation_receipt` facts: command, exit_code, passed, metric_value, stdout_log/stderr_log or stdout_log_path/stderr_log_path, and materialized_validator_refs when you wrote or changed validators.")
        lines.append("Prefer canonical `command`, `metric_value`, `stdout_log`, and `stderr_log`; validate also understands natural aliases like actual_command/stdout/stderr and normalizes them.")
        lines.append("If the actual command differs from a reference command, include reference_command, command_relation, and equivalence_rationale.")
        lines.append("The later validate phase audits this receipt and evidence instead of launching a separate worker or judging command strings as the whole truth.")
        lines.append("If you repair dependencies, prefer repo-local or task-local locations such as `.vendor`; do not mutate global environments unless the work item explicitly authorizes it.")
        lines.append("Do not wait for reflect to solve engineering bugs; debug imports, CUDA visibility, local dependency shims, build issues, and test failures here when they are inside task authority.")
        lines.append("Use `report` as rich markdown: final architecture implemented, shortcuts rejected, real validation run, official validator result, and the true remaining failure if any.")
    if phase == "reflect":
        lines.append("Use `review` as a rich markdown technical lead review for the user and next worker.")
        lines.append("If validate failed for a project/business issue still inside task authority, return retry_authorized=true and a direct corrective_prompt for the next execute cycle.")
        lines.append("If validate failure_class or runtime_contract_health is runtime_contract_error, return retry_authorized=false and make corrective_prompt an operator/runtime instruction: do not edit project code or retry execute for this evidence-contract failure.")
        lines.append("The corrective_prompt should preserve the original goal, acceptance intent, metric, threshold, and final architecture; it is the unified failure exit, not always an execute retry prompt.")
        lines.append("If execute drifted into MVP/fallback/mock/stub/simplified paths or task-inappropriate evidence, call that out and instruct execute to remove the shortcut rather than weaken acceptance.")
        lines.append("If canonical evidence is missing and execute did not capture a concrete root cause, make corrective_prompt require the next execute to continue evidence production or root-cause capture before declaring terminal failure.")
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
    observe_interval = int(DEFAULT_LIVE_OBSERVE_INTERVAL_SECONDS)
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
                "Child phases should work directly toward the final architecture. They must not satisfy work through MVP, fallback, mock, stub, simplified, branch-only, or compatibility-shim implementations unless authority explicitly asks for them.",
                "If acceptance depends on canonical artifacts, metrics, logs, receipts, benchmark output, service state, or files, missing evidence is execution work for the child execute phase, not a final explanation by itself.",
                "Do not let a healthy process be stopped merely because a self-imposed observation window has not yet produced canonical evidence; stop or restart only as explicit debugging/cleanup with captured logs and a next action.",
                "If authorized runtime budget expires before acceptance closes, preserve continuation evidence and the exact next command instead of presenting the work as passed.",
                "Verification must match the task. For example, AI research/model/CUDA/inference tasks should use a GPU-first verification posture: prefer real GPU training/inference smoke and official validators over CPU-only, mock-only, shape-only, or MVP-only substitutes.",
                "Do not hand-edit `.thoth`; let the Thoth runtime driver advance phases.",
                "If the user sends a natural-language correction while a live run/loop/auto is active, inject it into the active run guidance inbox through the packet protocol or installed runtime instead of merely replying with advice.",
                "Treat such live corrections as temporary guidance: they may steer execution and debugging, but they must not rewrite work authority or validation criteria.",
                f"Prefer sparse foreground observation: check roughly every {observe_interval} seconds during quiet progress, unless terminal/error evidence, worker-invalid, missing receipt, runtime mismatch, or user guidance appears.",
                "When evidence shows a low-level engineering mistake or runtime mismatch, proactively append guidance or interrupt the active run instead of only narrating the problem.",
            )
        )
    if command_id == "init":
        lines.extend(
            (
                "If no natural-language intent is present, keep the response as a short mechanical init/sync/migrate receipt.",
                "If natural-language intent is present, the command must save the raw text into an init discussion and return the discussion packet; do not create ready work from it.",
                "After an init intent discussion opens, help the user close authority through compact project_patch/work_graph fields only after asking all material questions.",
                "In Codex non-Plan sessions, tell the user Plan mode is recommended before closing authority; in Plan mode, use request_user_input for the next material question.",
            )
        )
    if command_id in {"run", "loop"}:
        lines.append("Plan must prove user-authority coverage before execute; executable discovery such as finding paths or creating missing target files should flow into execute, not needs_input.")
    elif command_id == "argue":
        lines.extend(
            (
                "If target resolution is ambiguous, ask the user to choose; do not guess.",
                "Treat argument artifacts as evidence, not as automatic run/auto acceptance.",
                "If an authority patch preview is returned, ask the user before executing any apply command.",
            )
        )
    elif command_id == "discuss":
        lines.extend(
            (
                "If the command returns a command packet, use that packet as the only authority for the follow-up action.",
                "Checkpoint major semantic changes through packet.protocol_commands.checkpoint_authority.",
                "Close only by filling compact authority categories plus either packet.work_json_template or packet.work_graph_schema, then executing packet.protocol_commands.close_authority.",
                "Use packet.init_project_patch_schema only for init discussions; ordinary discussions cannot mutate project name, description, or directions.",
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


def build_codex_selftest_argue_probe_prompt(*, public_command: str, shell_command: str, done_token: str) -> str:
    public_equivalent = public_command.replace("$thoth ", "thoth ", 1)
    return " ".join(
        (
            "This is a Thoth heavy selftest argue probe.",
            "Operate only on this repo.",
            f"The Codex public surface is `{public_command}`, but in the workspace shell you must execute it literally as `{shell_command}`.",
            f"The public shell equivalent is `{public_equivalent}`.",
            "Execute that shell command immediately as your first action.",
            "Do not send commentary, progress updates, plans, explanations, or any non-command message before that command.",
            "After the argument run completes, inspect only the returned argument artifact paths if needed.",
            "Do not inspect CLI help, do not explore unrelated files, and do not execute exploratory commands.",
            "Do not modify code and do not apply any authority patch during the probe.",
            f"After the argue run terminalizes successfully, reply with `{done_token}` only.",
        )
    )


def build_codex_selftest_review_probe_prompt(*, public_command: str, shell_command: str, done_token: str) -> str:
    return build_codex_selftest_argue_probe_prompt(
        public_command=public_command,
        shell_command=shell_command,
        done_token=done_token,
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
    "build_codex_selftest_argue_probe_prompt",
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
