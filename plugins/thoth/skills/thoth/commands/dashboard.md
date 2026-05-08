# $thoth dashboard

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Report endpoint, failure point, and one notable runtime delta only.

## Hard Stops

- Do not narrate the whole UI.
- Do not restate healthy panels.

## Reply Contract

- reply_budget_utf8: `56`
- result_style: brief operator receipt
- validator_policy: dashboard is read-only over .thoth ledgers

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth dashboard`, but in the workspace shell you must execute it literally as `bash -lc 'set -euo pipefail; if command -v thoth >/dev/null 2>&1; then exec thoth "$@"; fi; latest="$(ls -td "$HOME"/.codex/plugins/cache/thoth/thoth/* 2>/dev/null | head -n 1 || true)"; if [ -n "$latest" ]; then if [ -x "$latest/bin/thoth" ]; then exec "$latest/bin/thoth" "$@"; fi; if [ -f "$latest/scripts/thoth-cli-entry.py" ]; then if command -v python3 >/dev/null 2>&1; then exec python3 "$latest/scripts/thoth-cli-entry.py" "$@"; else exec python "$latest/scripts/thoth-cli-entry.py" "$@"; fi; fi; fi; echo '"'"'thoth installed runtime not found'"'"' >&2; exit 127' thoth dashboard`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If neither PATH nor the installed Codex plugin cache contains the runtime entrypoint, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Report endpoint, failure point, and one notable runtime delta only. Hard stop: Do not narrate the whole UI. Hard stop: Do not restate healthy panels. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
