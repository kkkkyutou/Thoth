# $thoth discuss

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `command_packet`

## Objective

Interrogate the user's idea until the compact authority categories are explicit: goal, constraints, decisions, risks, run_instructions, and open_questions.

## Hard Stops

- Do not modify source code.
- Do not assume unanswered goals, constraints, success metrics, resources, timing, or authority.
- Ask about every material ambiguity; use AskUserQuestion and continue discussion until no meaningful assumptions remain.
- When a major semantic decision changes, checkpoint a compact authority event through the packet protocol command.
- When closing, translate the discussion through the compact categories: goal, constraints, decisions, risks, run_instructions, and open_questions.
- Do not hand-author a work item from memory; use packet.work_json_template and packet.required_work_json_fields.
- When closing authority for an existing work item, preserve its stable work_id; do not omit work_id and create a timestamp work item.
- Do not fabricate ready execution work items from unresolved decisions.
- Do not repeat the packet or decision payload verbatim.

## Reply Contract

- reply_budget_utf8: `240`
- result_style: question-driven planning dialogue or brief receipt when closed
- validator_policy: planning authority plus compiler output decide completion

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth discuss`, but in the workspace shell you must execute it literally as `bash -lc 'set -euo pipefail; if [ -n "${THOTH_SELFTEST_RUNTIME_ROOT:-}" ]; then if [ -x "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" ]; then exec "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" "$@"; fi; if [ -f "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" ]; then exec python3 "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" "$@"; fi; fi; if command -v thoth >/dev/null 2>&1; then exec thoth "$@"; fi; candidates="$(ls -td "$HOME"/.codex/plugins/cache/thoth/thoth/* "$HOME"/.codex/plugins/cache/thoth/* "$HOME"/.codex/plugins/cache/*/thoth/* "$HOME"/.codex/plugins/cache/*/Thoth/* 2>/dev/null || true)"; marketplace="$HOME/.codex/.tmp/marketplaces/thoth"; if [ -d "$marketplace" ]; then candidates="$candidates
$marketplace"; fi; for candidate in $candidates; do if [ -x "$candidate/bin/thoth" ]; then exec "$candidate/bin/thoth" "$@"; fi; if [ -f "$candidate/scripts/thoth-cli-entry.py" ]; then if command -v python3 >/dev/null 2>&1; then exec python3 "$candidate/scripts/thoth-cli-entry.py" "$@"; else exec python "$candidate/scripts/thoth-cli-entry.py" "$@"; fi; fi; done; echo '"'"'thoth installed runtime not found'"'"' >&2; exit 127' thoth discuss`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the user supplied arguments or trailing natural-language guidance after the public command, preserve those exact arguments in the shell invocation. If neither PATH nor the installed Codex plugin cache or marketplace root contains the runtime entrypoint, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=command_packet. Objective: Interrogate the user's idea until the compact authority categories are explicit: goal, constraints, decisions, risks, run_instructions, and open_questions. Hard stop: Do not modify source code. Hard stop: Do not assume unanswered goals, constraints, success metrics, resources, timing, or authority. Hard stop: Ask about every material ambiguity; use AskUserQuestion and continue discussion until no meaningful assumptions remain. Hard stop: When a major semantic decision changes, checkpoint a compact authority event through the packet protocol command. Hard stop: When closing, translate the discussion through the compact categories: goal, constraints, decisions, risks, run_instructions, and open_questions. Hard stop: Do not hand-author a work item from memory; use packet.work_json_template and packet.required_work_json_fields. Hard stop: When closing authority for an existing work item, preserve its stable work_id; do not omit work_id and create a timestamp work item. Hard stop: Do not fabricate ready execution work items from unresolved decisions. Hard stop: Do not repeat the packet or decision payload verbatim. If the command returns a command packet, use that packet as the only authority for the follow-up action. Checkpoint major semantic changes through packet.protocol_commands.checkpoint_authority. Close only by filling compact authority categories plus packet.work_json_template, then executing packet.protocol_commands.close_authority. When closing authority for an existing work item, preserve that stable work_id in work_json_template; do not omit work_id and create a timestamp work item. Do not restate packet fields or expand into teaching prose. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
