---
name: thoth:tui
description: Open or snapshot the read-only terminal dashboard backed by shared Thoth providers.
argument-hint: "[--snapshot-json] [--export-snapshots] [--snapshot-dir <path>] [--no-gpu] [--refresh <seconds>]"
disable-model-invocation: true
---

# /thoth:tui

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
THOTH_TUI_ARGUMENTS_FILE="$(mktemp -t thoth-tui-arguments.XXXXXX)"
trap 'rm -f "$THOTH_TUI_ARGUMENTS_FILE"' EXIT
cat > "$THOTH_TUI_ARGUMENTS_FILE" <<'THOTH_TUI_ARGUMENTS_EOF'
$ARGUMENTS
THOTH_TUI_ARGUMENTS_EOF
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" tui --thoth-arguments-file "$THOTH_TUI_ARGUMENTS_FILE"
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

Open or snapshot the read-only terminal dashboard from shared observe providers without mutating authority or runtime ledgers.

### Hard Stops

1. Do not mutate .thoth authority, run ledgers, checkpoints, or training artifacts.
2. Do not infer metrics paths by scanning arbitrary project directories; metrics must come from enabled extension providers.
3. Do not narrate the whole UI; report only the launch/snapshot result and any provider errors.

### Reply Contract

- reply_budget_utf8: `56`
- result_style: brief TUI launch or snapshot receipt
- validator_policy: tui is read-only over shared observe providers
