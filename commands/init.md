---
name: thoth:init
description: Initialize, migrate, resync, or seed an intent discussion for canonical .thoth authority without taking ownership of repo-root `.codex`.
argument-hint: "[--sync] [--migrate preview|apply] [--migrate --preview|--apply] [--config-json <json>] [--intent <text>] [--intent-file <path>] [--] [intent...]"
disable-model-invocation: false
---

# /thoth:init

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
THOTH_INIT_ARGUMENTS_FILE="$(mktemp -t thoth-init-arguments.XXXXXX)"
trap 'rm -f "$THOTH_INIT_ARGUMENTS_FILE"' EXIT
cat > "$THOTH_INIT_ARGUMENTS_FILE" <<'THOTH_INIT_ARGUMENTS_EOF'
$ARGUMENTS
THOTH_INIT_ARGUMENTS_EOF
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" init --thoth-arguments-file "$THOTH_INIT_ARGUMENTS_FILE"
```

## Response Contract

1. Treat the structured bridge payload above as the only authority for this invocation.
2. If `bridge_success` is `false`, report the exact bridge failure and stop.
3. If stdout starts with `version=`, repeat stdout exactly and output nothing else.
4. If no `body.init_intent` exists, report only the mechanical init/sync/migrate receipt.
5. If `body.init_intent` exists, preserve the returned discussion packet as the live planning authority; do not summarize raw intent into generated docs and do not create ready work.
6. Use AskUserQuestion to ask the next material question when project_patch or work_graph authority is not closed.
7. Close init authority only through `packet.protocol_commands.close_authority`, using optional `project_patch` plus compact `work_graph` or `work_item`.
8. If extra evidence is required, inspect only the smallest artifact explicitly named by the bridge payload.
9. Do not launch broad Explore, Task, cache/source scans, or background investigation after the bridge result.

## Authority Summary

### Route

- route_class: `hybrid_init`
- intelligence_tier: `intent_sensitive`
- packet_authority_mode: `result_envelope_or_command_packet`

### Objective

Initialize audit-first project authority; when natural-language intent is supplied, save the raw intent as an init discussion and continue by questioning until compact authority is closed.

### Hard Stops

1. Do not assume the repo is blank.
2. Do not assume goals, project identity, migration intent, work ordering, unblock policy, or acceptance criteria.
3. Do not turn init intent into ready work immediately.
4. Do not bake an unconfirmed summary of the raw intent into AGENTS.md, CLAUDE.md, or generated project docs.
5. Do not combine natural-language init intent with --sync, --migrate, --preview, or --apply.
6. Do not launch broad Explore, Task, plugin-cache/source scans, or background investigation after the init result.
7. If extra evidence is required, inspect only the smallest artifact explicitly named by the init payload.
8. If init opens an intent discussion, use AskUserQuestion in Claude or Plan/request_user_input in Codex to ask only the next material questions before closing authority.
9. If the preview/apply result leaves blocked work or unresolved migration choices, ask with AskUserQuestion or the host's planning question tool and stop.
10. Do not narrate the full migration procedure.

### Reply Contract

- reply_budget_utf8: `180`
- result_style: brief mechanical receipt when no intent; question-driven planning handoff when intent discussion is opened
- validator_policy: scaffold success comes from generated artifacts; intent success comes from preserving raw discussion authority without fabricating work
