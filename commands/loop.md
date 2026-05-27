---
name: thoth:loop
description: Start one bounded controller service whose parent creates four-phase child runs.
argument-hint: "[--executor claude|codex] [--host claude|codex] [--sleep] [--attach <run_id>] [--resume <run_id>] [--watch <run_id>] [--stop <run_id>] --work-id <work_id> [guidance...]"
disable-model-invocation: false
allowed-tools: Read, Glob, Grep, Edit, Write, Bash, Task
---

# /thoth:loop

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
THOTH_LOOP_ARGUMENTS_FILE="$(mktemp -t thoth-loop-arguments.XXXXXX)"
trap 'rm -f "$THOTH_LOOP_ARGUMENTS_FILE"' EXIT
cat > "$THOTH_LOOP_ARGUMENTS_FILE" <<'THOTH_LOOP_ARGUMENTS_EOF'
$ARGUMENTS
THOTH_LOOP_ARGUMENTS_EOF
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" loop --host claude --thoth-arguments-file "$THOTH_LOOP_ARGUMENTS_FILE"
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
- Use `packet.strict_task.goal_statement`, `packet.strict_task.authority_context`, `packet.strict_task.implementation_recipe`, and `packet.strict_task.eval_entrypoint` as the only task authority.
- If plan reports `authority_complete=false` or `reason=needs_input`, stop and route the user back to `/thoth:discuss` instead of guessing.

## Authority Summary

### Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `phase_controller`

### Objective

Advance the current bounded loop through foreground or sleeping RuntimeDriver monitoring while preserving evidence-producing execute behavior in each child run.

### Hard Stops

1. Do not decide extra iterations outside the recorded loop budget.
2. Do not proceed to the next loop iteration before the validator signals terminal.
3. Do not let a child execute stop merely because a self-imposed observation window has not yet seen canonical evidence.
4. Do not expand into iteration diaries or runtime narration.

### Reply Contract

- reply_budget_utf8: `40`
- result_style: terminal receipt only
- validator_policy: loop budget controls retries; child validate confirms execute's validator receipt
