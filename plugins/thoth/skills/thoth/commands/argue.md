# $thoth argue

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `argument_record`

## Objective

Run a human-quality adversarial discussion: resolve the intended target, ask if ambiguous, let an attacker challenge the direction from first principles, then let an independent adjudicator decide decision_impact and preview any authority patch.

## Hard Stops

1. Do not modify project code or write fixes.
2. Do not silently choose among multiple plausible work items or decisions; ask with AskUserQuestion instead.
3. Do not summarize the executor's position as adjudication; attacker and adjudicator must be independent fresh sessions.
4. Do not collapse the result into PASS/WARN/FAIL; use decision_impact.
5. Do not mutate work_item, decision, or discussion authority unless the user explicitly confirms the apply step.

## Reply Contract

- reply_budget_utf8: `220`
- result_style: short receipt with artifact paths, decision_impact, and confirmation-required patch preview when present
- validator_policy: argument artifacts are evidence; only a confirmed apply command may change compact authority fields

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth argue`, but in the workspace shell you must execute it literally as `bash -lc 'set -euo pipefail; if [ -n "${THOTH_SELFTEST_RUNTIME_ROOT:-}" ]; then if [ -x "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" ]; then exec "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" "$@"; fi; if [ -f "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" ]; then exec python3 "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" "$@"; fi; fi; if command -v thoth >/dev/null 2>&1; then exec thoth "$@"; fi; candidates="$(ls -td "$HOME"/.codex/plugins/cache/thoth/thoth/* "$HOME"/.codex/plugins/cache/thoth/* "$HOME"/.codex/plugins/cache/*/thoth/* "$HOME"/.codex/plugins/cache/*/Thoth/* 2>/dev/null || true)"; marketplace="$HOME/.codex/.tmp/marketplaces/thoth"; if [ -d "$marketplace" ]; then candidates="$candidates
$marketplace"; fi; for candidate in $candidates; do if [ -x "$candidate/bin/thoth" ]; then exec "$candidate/bin/thoth" "$@"; fi; if [ -f "$candidate/scripts/thoth-cli-entry.py" ]; then if command -v python3 >/dev/null 2>&1; then exec python3 "$candidate/scripts/thoth-cli-entry.py" "$@"; else exec python "$candidate/scripts/thoth-cli-entry.py" "$@"; fi; fi; done; echo '"'"'thoth installed runtime not found'"'"' >&2; exit 127' thoth argue`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the user supplied arguments or trailing natural-language guidance after the public command, preserve those exact arguments in the shell invocation. If neither PATH nor the installed Codex plugin cache or marketplace root contains the runtime entrypoint, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=argument_record. Objective: Run a human-quality adversarial discussion: resolve the intended target, ask if ambiguous, let an attacker challenge the direction from first principles, then let an independent adjudicator decide decision_impact and preview any authority patch. Hard stop: Do not modify project code or write fixes. Hard stop: Do not silently choose among multiple plausible work items or decisions; ask with AskUserQuestion instead. Hard stop: Do not summarize the executor's position as adjudication; attacker and adjudicator must be independent fresh sessions. Hard stop: Do not collapse the result into PASS/WARN/FAIL; use decision_impact. Hard stop: Do not mutate work_item, decision, or discussion authority unless the user explicitly confirms the apply step. If target resolution is ambiguous, ask the user to choose; do not guess. Treat argument artifacts as evidence, not as automatic run/auto acceptance. If an authority patch preview is returned, ask the user before executing any apply command. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
