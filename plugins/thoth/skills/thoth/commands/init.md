# $thoth init

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Report audit-first adopt/init outcome, generated artifacts, blockers, and user decisions required before continuing.

## Hard Stops

- Do not assume the repo is blank.
- Do not assume goals, project identity, migration intent, work priority, unblock policy, or acceptance criteria.
- Do not launch broad Explore, Task, plugin-cache/source scans, or background investigation after the init result.
- If extra evidence is required, inspect only the smallest artifact explicitly named by the init payload.
- If the preview/apply result leaves blocked work or unresolved migration choices, ask with AskUserQuestion and stop.
- Do not narrate the full migration procedure.

## Reply Contract

- reply_budget_utf8: `60`
- result_style: brief outcome receipt
- validator_policy: preview and generated artifacts define success

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth init`, but in the workspace shell you must execute it literally as `bash -lc 'set -euo pipefail; if command -v thoth >/dev/null 2>&1; then exec thoth "$@"; fi; latest="$(ls -td "$HOME"/.codex/plugins/cache/thoth/thoth/* 2>/dev/null | head -n 1 || true)"; if [ -n "$latest" ]; then if [ -x "$latest/bin/thoth" ]; then exec "$latest/bin/thoth" "$@"; fi; if [ -f "$latest/scripts/thoth-cli-entry.py" ]; then if command -v python3 >/dev/null 2>&1; then exec python3 "$latest/scripts/thoth-cli-entry.py" "$@"; else exec python "$latest/scripts/thoth-cli-entry.py" "$@"; fi; fi; fi; echo '"'"'thoth installed runtime not found'"'"' >&2; exit 127' thoth init`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If neither PATH nor the installed Codex plugin cache contains the runtime entrypoint, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Report audit-first adopt/init outcome, generated artifacts, blockers, and user decisions required before continuing. Hard stop: Do not assume the repo is blank. Hard stop: Do not assume goals, project identity, migration intent, work priority, unblock policy, or acceptance criteria. Hard stop: Do not launch broad Explore, Task, plugin-cache/source scans, or background investigation after the init result. Hard stop: If extra evidence is required, inspect only the smallest artifact explicitly named by the init payload. Hard stop: If the preview/apply result leaves blocked work or unresolved migration choices, ask with AskUserQuestion and stop. Hard stop: Do not narrate the full migration procedure. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
