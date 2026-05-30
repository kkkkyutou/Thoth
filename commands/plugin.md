---
name: thoth:plugin
description: Create, list, or validate project-local Dashboard/TUI extension plugins with local audit receipts.
argument-hint: "create <plugin_id> [--title <title>] [--surface dashboard,tui] [--capability tool|metrics_provider|system_provider|tui_python_plugin] | list | validate [--fix]"
disable-model-invocation: true
---

# /thoth:plugin

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
THOTH_PLUGIN_ARGUMENTS_FILE="$(mktemp -t thoth-plugin-arguments.XXXXXX)"
trap 'rm -f "$THOTH_PLUGIN_ARGUMENTS_FILE"' EXIT
cat > "$THOTH_PLUGIN_ARGUMENTS_FILE" <<'THOTH_PLUGIN_ARGUMENTS_EOF'
$ARGUMENTS
THOTH_PLUGIN_ARGUMENTS_EOF
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" plugin --thoth-arguments-file "$THOTH_PLUGIN_ARGUMENTS_FILE"
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

Create, list, or validate project-local Dashboard/TUI extension plugins while preserving manifest schema v2 and local audit receipts.

### Hard Stops

1. Do not execute extension Python code while creating, listing, or validating plugins.
2. Do not write plugin sources outside .thoth/extensions/plugins unless an explicit project-relative source was provided.
3. Do not treat local action receipts as portable project authority.
4. Do not invent plugin capabilities beyond the CLI arguments and manifest contents.

### Reply Contract

- reply_budget_utf8: `72`
- result_style: brief plugin manifest receipt
- validator_policy: manifest schema validation plus local action receipt decide completion
