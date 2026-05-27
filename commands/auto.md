---
name: thoth:auto
description: Run the DAG-first actionable work queue until ready/active/failed work is closed, paused, or stopped.
argument-hint: "[--sleep] [--rounds <n>] [--scope all-open|ready] [--work-id <work_id> ...] [--watch <controller_id>] [--stop <controller_id>] [guidance...]"
disable-model-invocation: false
allowed-tools: Read, Glob, Grep, Edit, Write, Bash, Task, Monitor
---

# /thoth:auto

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
THOTH_AUTO_ARGUMENTS_FILE="$(mktemp -t thoth-auto-arguments.XXXXXX)"
trap 'rm -f "$THOTH_AUTO_ARGUMENTS_FILE"' EXIT
cat > "$THOTH_AUTO_ARGUMENTS_FILE" <<'THOTH_AUTO_ARGUMENTS_EOF'
$ARGUMENTS
THOTH_AUTO_ARGUMENTS_EOF
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" auto --host claude --thoth-arguments-file "$THOTH_AUTO_ARGUMENTS_FILE"
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `run` or `loop` is missing `--work-id`, show returned candidates and stop; do not invent, create, compile, or guess a work item.
- If `bridge_success` is `true` and runtime events are present, summarize progress, terminal status, and risk from those events only.
- Do not hand-edit `.thoth` or manually call runtime protocol commands; the Thoth RuntimeDriver advances phases.
- If `packet.dispatch_mode` is `external_worker`, do not duplicate the work locally; report the run id, worker mode, and the correct follow-up only.
- If you only describe what should happen next instead of reporting the executed runtime result, treat that as failure.
- Substantive execution must flow through `packet.executor`; by default this matches the host unless the user explicitly supplied `--executor`.
- Runtime lifecycle is `plan -> execute -> validate -> reflect`; execute owns the official validator receipt, validate confirms it mechanically.
- Execute must actively produce canonical acceptance evidence: missing artifacts, metrics, logs, receipts, benchmark output, service state, or files are execution work until produced or until a concrete root cause, blocker, or budget boundary is captured.
- Do not let healthy work be stopped just because a short observation window has not yet produced canonical evidence; stop or restart only as explicit debugging or cleanup with logs and a next action.
- If runtime budget expires before acceptance closes, preserve continuation evidence and the exact next command instead of presenting the work as passed.
- Live monitor should observe sparsely around every 288s; on clear runtime/env mistakes, append or interrupt guidance instead of only narrating.
- Trailing text/live corrections are temporary guidance only; never rewrite authority or validators.
- If the bridge payload exposes `body.monitor_command`, observe that command instead of executing work directly in the Claude session.
- Prefer the Claude Monitor tool with `persistent=true` for `body.monitor_command` when available; otherwise use Bash to run the same watch command in the foreground.
- Treat the monitor/watch JSONL stream as the only live progress authority; summarize progress and risks from those events only.
- If the live observer is interrupted, do not stop the auto controller unless the user explicitly requests `/thoth:auto --stop <controller_id>`.

## Authority Summary

### Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `phase_controller`

### Objective

Run actionable work items through child loops while preserving architecture-first execution, evidence-producing execute behavior, and human-quality phase handoffs.

### Hard Stops

1. Do not execute blocked or draft work.
2. Do not auto-abandon work items.
3. Do not bypass execution-safety doctor preflight.
4. Do not let child runs convert missing canonical evidence into terminal explanation when execute can still generate, repair, instrument, rerun, or diagnose it.
5. Do not let child runs satisfy work through MVP, fallback, mock, stub, simplified, branch-only, or compatibility-shim implementations unless authority explicitly asks for them.

### Reply Contract

- reply_budget_utf8: `120`
- result_style: start or reuse the durable controller, then stream JSONL watch events until terminal or observer interruption
- validator_policy: controller cursor, child loop results, and auto watch events define queue state
