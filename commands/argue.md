---
name: thoth:argue
description: Run an adversarial attacker/adjudicator discussion against an idea, work item, or decision.
argument-hint: "[--executor claude|codex] [--host claude|codex] [--work-id <work_id>] [--decision-id <decision_id>] [--target-kind work_item|decision|idea --target-id <id>] [--apply-artifact <path>] <idea-or-query>"
disable-model-invocation: false
allowed-tools: Read, Glob, Grep, Bash, Task
---

# /thoth:argue

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" argue --host claude $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `run` or `loop` is missing `--work-id`, show returned candidates and stop; do not invent, create, compile, or guess a work item.
- If `bridge_success` is `true` and runtime events are present, summarize progress, terminal status, and risk from those events only.
- Do not hand-edit `.thoth` or manually call runtime protocol commands; the Thoth RuntimeDriver advances phases.
- If `packet.dispatch_mode` is `external_worker`, do not duplicate the work locally; report the run id, worker mode, and the correct follow-up only.
- If you only describe what should happen next instead of reporting the executed runtime result, treat that as failure.
- For `argue`, use the returned argument artifacts as evidence; do not replace attacker/adjudicator output with a local summary.
- If target resolution is ambiguous, use AskUserQuestion to ask the user to choose one candidate and stop.
- If `body.authority_patch_preview.confirmation_required` is true, ask for explicit confirmation before running the apply command.

## Authority Summary

### Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `argument_record`

### Objective

Run a human-quality adversarial discussion: resolve the intended target, ask if ambiguous, let an attacker challenge the direction from first principles, then let an independent adjudicator decide decision_impact and preview any authority patch.

### Hard Stops

- Do not modify project code or write fixes.
- Do not silently choose among multiple plausible work items or decisions; ask with AskUserQuestion instead.
- Do not summarize the executor's position as adjudication; attacker and adjudicator must be independent fresh sessions.
- Do not collapse the result into PASS/WARN/FAIL; use decision_impact.
- Do not mutate work_item, decision, or discussion authority unless the user explicitly confirms the apply step.

### Reply Contract

- reply_budget_utf8: `220`
- result_style: short receipt with artifact paths, decision_impact, and confirmation-required patch preview when present
- validator_policy: argument artifacts are evidence; only a confirmed apply command may change compact authority fields
