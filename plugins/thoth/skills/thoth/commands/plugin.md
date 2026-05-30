# $thoth plugin

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Create, list, or validate project-local Dashboard/TUI extension plugins while preserving manifest schema v2 and local audit receipts.

## Hard Stops

1. Do not execute extension Python code while creating, listing, or validating plugins.
2. Do not write plugin sources outside .thoth/extensions/plugins unless an explicit project-relative source was provided.
3. Do not treat local action receipts as portable project authority.
4. Do not invent plugin capabilities beyond the CLI arguments and manifest contents.

## Reply Contract

- reply_budget_utf8: `72`
- result_style: brief plugin manifest receipt
- validator_policy: manifest schema validation plus local action receipt decide completion

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth plugin`, but in the workspace shell you must execute it literally as `bash -lc 'set -euo pipefail; if [ -n "${THOTH_SELFTEST_RUNTIME_ROOT:-}" ]; then if [ -x "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" ]; then exec "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" "$@"; fi; if [ -f "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" ]; then exec python3 "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" "$@"; fi; fi; if command -v thoth >/dev/null 2>&1; then exec thoth "$@"; fi; candidates="$(ls -td "$HOME"/.codex/plugins/cache/thoth/thoth/* "$HOME"/.codex/plugins/cache/thoth/* "$HOME"/.codex/plugins/cache/*/thoth/* "$HOME"/.codex/plugins/cache/*/Thoth/* 2>/dev/null || true)"; marketplace="$HOME/.codex/.tmp/marketplaces/thoth"; if [ -d "$marketplace" ]; then candidates="$candidates
$marketplace"; fi; for candidate in $candidates; do if [ -x "$candidate/bin/thoth" ]; then exec "$candidate/bin/thoth" "$@"; fi; if [ -f "$candidate/scripts/thoth-cli-entry.py" ]; then if command -v python3 >/dev/null 2>&1; then exec python3 "$candidate/scripts/thoth-cli-entry.py" "$@"; else exec python "$candidate/scripts/thoth-cli-entry.py" "$@"; fi; fi; done; echo '"'"'thoth installed runtime not found'"'"' >&2; exit 127' thoth plugin`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the user supplied arguments or trailing natural-language guidance after the public command, preserve those exact arguments in the shell invocation. If neither PATH nor the installed Codex plugin cache or marketplace root contains the runtime entrypoint, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Create, list, or validate project-local Dashboard/TUI extension plugins while preserving manifest schema v2 and local audit receipts. Hard stop: Do not execute extension Python code while creating, listing, or validating plugins. Hard stop: Do not write plugin sources outside .thoth/extensions/plugins unless an explicit project-relative source was provided. Hard stop: Do not treat local action receipts as portable project authority. Hard stop: Do not invent plugin capabilities beyond the CLI arguments and manifest contents. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
