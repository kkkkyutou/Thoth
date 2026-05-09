# $thoth discuss

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `command_packet`

## Objective

Interrogate the user's idea until goals, constraints, success criteria, risks, and authority are explicit; use AskUserQuestion until no material assumptions remain.

## Hard Stops

- Do not modify source code.
- Do not assume unanswered goals, constraints, success metrics, resources, timing, or authority.
- Ask about every material ambiguity; use AskUserQuestion and continue discussion until no meaningful assumptions remain.
- Do not fabricate ready execution tasks from unresolved decisions.
- Do not repeat the packet or decision payload verbatim.

## Reply Contract

- reply_budget_utf8: `240`
- result_style: question-driven planning dialogue or brief receipt when closed
- validator_policy: planning authority plus compiler output decide completion

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth discuss`, but in the workspace shell you must execute it literally as `bash -lc 'set -euo pipefail; if command -v thoth >/dev/null 2>&1; then exec thoth "$@"; fi; candidates="$(ls -td "$HOME"/.codex/plugins/cache/thoth/thoth/* 2>/dev/null || true)"; marketplace="$HOME/.codex/.tmp/marketplaces/thoth"; if [ -d "$marketplace" ]; then candidates="$candidates
$marketplace"; fi; for candidate in $candidates; do if [ -x "$candidate/bin/thoth" ]; then exec "$candidate/bin/thoth" "$@"; fi; if [ -f "$candidate/scripts/thoth-cli-entry.py" ]; then if command -v python3 >/dev/null 2>&1; then exec python3 "$candidate/scripts/thoth-cli-entry.py" "$@"; else exec python "$candidate/scripts/thoth-cli-entry.py" "$@"; fi; fi; done; echo '"'"'thoth installed runtime not found'"'"' >&2; exit 127' thoth discuss`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If neither PATH nor the installed Codex plugin cache or marketplace root contains the runtime entrypoint, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=command_packet. Objective: Interrogate the user's idea until goals, constraints, success criteria, risks, and authority are explicit; use AskUserQuestion until no material assumptions remain. Hard stop: Do not modify source code. Hard stop: Do not assume unanswered goals, constraints, success metrics, resources, timing, or authority. Hard stop: Ask about every material ambiguity; use AskUserQuestion and continue discussion until no meaningful assumptions remain. Hard stop: Do not fabricate ready execution tasks from unresolved decisions. Hard stop: Do not repeat the packet or decision payload verbatim. If the command returns a command packet, use that packet as the only authority for the follow-up action. Do not restate packet fields or expand into teaching prose. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
