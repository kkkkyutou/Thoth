# $thoth status

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Report only abnormal state, blockers, and active run deltas.

## Hard Stops

- Do not restate healthy defaults.
- Do not expand into a dashboard walkthrough.

## Reply Contract

- reply_budget_utf8: `56`
- result_style: brief receipt
- validator_policy: runtime truth comes from current authority only

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth status`, but in the workspace shell you must execute it literally as `bash -lc 'set -euo pipefail; if command -v thoth >/dev/null 2>&1; then exec thoth "$@"; fi; latest="$(ls -td "$HOME"/.codex/plugins/cache/thoth/thoth/* 2>/dev/null | head -n 1 || true)"; if [ -n "$latest" ]; then if [ -x "$latest/bin/thoth" ]; then exec "$latest/bin/thoth" "$@"; fi; if [ -f "$latest/scripts/thoth-cli-entry.py" ]; then if command -v python3 >/dev/null 2>&1; then exec python3 "$latest/scripts/thoth-cli-entry.py" "$@"; else exec python "$latest/scripts/thoth-cli-entry.py" "$@"; fi; fi; fi; echo '"'"'thoth installed runtime not found'"'"' >&2; exit 127' thoth status`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If neither PATH nor the installed Codex plugin cache contains the runtime entrypoint, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Report only abnormal state, blockers, and active run deltas. Hard stop: Do not restate healthy defaults. Hard stop: Do not expand into a dashboard walkthrough. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
