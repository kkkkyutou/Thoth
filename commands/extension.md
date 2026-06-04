---
name: thoth:extension
description: Create, list, validate, and manage project-local Dashboard/TUI extensions and experiment registry objects.
argument-hint: "create <extension_id> | list | validate [--fix] | experiment register|update|attach-source|detach-source|list|show|select|validate|discover"
disable-model-invocation: true
---

# /thoth:extension

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
THOTH_EXTENSION_ARGUMENTS_FILE="$(mktemp -t thoth-extension-arguments.XXXXXX)"
trap 'rm -f "$THOTH_EXTENSION_ARGUMENTS_FILE"' EXIT
cat > "$THOTH_EXTENSION_ARGUMENTS_FILE" <<'THOTH_EXTENSION_ARGUMENTS_EOF'
$ARGUMENTS
THOTH_EXTENSION_ARGUMENTS_EOF
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" extension --thoth-arguments-file "$THOTH_EXTENSION_ARGUMENTS_FILE"
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If stdout starts with `version=`, repeat stdout exactly and output nothing else.
- If `bridge_success` is `true`, report only the real command result in one short receipt.
- If extra evidence is required, inspect only the smallest artifact explicitly named by the bridge payload.
- Do not launch broad Explore, Task, cache/source scans, or background investigation after the bridge result.
- If the result exposes blockers or asks for human decisions, use AskUserQuestion to ask only the unresolved questions and stop.
- Do not expand into runtime explanation, walkthroughs, or extra command execution.

## Authority Summary

### Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

### Objective

Create, list, validate, and manage project-local Dashboard/TUI extensions and experiment registry objects while preserving manifest schema v3 and local audit receipts.

### Hard Stops

1. Do not execute extension Python code while creating, listing, validating, or managing experiments.
2. Do not write extension sources outside .thoth/extensions/plugins unless an explicit project-relative source was provided.
3. Do not treat local action receipts as portable project authority.
4. Do not persist absolute downstream paths into portable experiment registry objects.
5. Do not invent extension capabilities beyond the CLI arguments and manifest contents.

### Reply Contract

- reply_budget_utf8: `72`
- result_style: brief extension or experiment registry receipt
- validator_policy: manifest schema validation, experiment registry validation, and local action receipts decide completion
