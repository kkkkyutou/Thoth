---
name: thoth:discuss
description: Discuss or record planning decisions without entering implementation execution.
argument-hint: "<topic>"
disable-model-invocation: false
---

# /thoth:discuss

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
THOTH_DISCUSS_ARGUMENTS_FILE="$(mktemp -t thoth-discuss-arguments.XXXXXX)"
trap 'rm -f "$THOTH_DISCUSS_ARGUMENTS_FILE"' EXIT
cat > "$THOTH_DISCUSS_ARGUMENTS_FILE" <<'THOTH_DISCUSS_ARGUMENTS_EOF'
$ARGUMENTS
THOTH_DISCUSS_ARGUMENTS_EOF
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" discuss --thoth-arguments-file "$THOTH_DISCUSS_ARGUMENTS_FILE"
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `run` or `loop` is missing `--work-id`, show the returned candidate work items exactly as provided and stop.
- If `run` or `loop` is missing `--work-id`, do not invent, create, compile, or guess a work item.
- If `bridge_success` is `true` and runtime events are present, summarize progress, terminal status, and risk from those events only.
- Do not hand-edit `.thoth` or manually call runtime protocol commands; the Thoth RuntimeDriver advances phases.
- If `packet.dispatch_mode` is `external_worker`, do not duplicate the work locally; report the run id, worker mode, and the correct follow-up only.
- If you only describe what should happen next instead of reporting the executed runtime result, treat that as failure.
- Use AskUserQuestion until compact authority categories are explicit: goal, constraints, decisions, risks, run_instructions, and open_questions.
- On major semantic changes, write a draft authority checkpoint through `packet.protocol_commands.checkpoint_authority`.
- When no material assumptions remain, close with the compact authority categories plus `packet.work_json_template` through `packet.protocol_commands.close_authority`.
- Do not create ready work if any open_questions remain in the authority capsule.

## Authority Summary

### Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `command_packet`

### Objective

Interrogate the user's idea until the compact authority categories are explicit: goal, constraints, decisions, risks, run_instructions, and open_questions.

### Hard Stops

- Do not modify source code.
- Do not assume unanswered goals, constraints, success metrics, resources, timing, or authority.
- Ask about every material ambiguity; use AskUserQuestion and continue discussion until no meaningful assumptions remain.
- When a major semantic decision changes, checkpoint a compact authority event through the packet protocol command.
- When closing, translate the discussion through the compact categories: goal, constraints, decisions, risks, run_instructions, and open_questions.
- Do not hand-author a work item from memory; use packet.work_json_template and packet.required_work_json_fields.
- Do not fabricate ready execution work items from unresolved decisions.
- Do not repeat the packet or decision payload verbatim.

### Reply Contract

- reply_budget_utf8: `240`
- result_style: question-driven planning dialogue or brief receipt when closed
- validator_policy: planning authority plus compiler output decide completion
