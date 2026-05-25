# $thoth run

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `phase_controller`

## Objective

Finish the current strict task through the four-phase RuntimeDriver while preserving agent intelligence inside execute.

## Hard Stops

1. Do not invent or compile a new work item when --work-id is missing.
2. Do not exit the monitoring session before the RuntimeDriver signals a terminal state.
3. Do not hand-edit .thoth ledgers.

## Reply Contract

- reply_budget_utf8: `36`
- result_style: terminal receipt only
- validator_policy: plan first; execute returns official validator receipt; validate normalizes/confirms it; reflect retries only business failures

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth run`, but in the workspace shell you must execute it literally as `bash -lc 'set -euo pipefail; if [ -n "${THOTH_SELFTEST_RUNTIME_ROOT:-}" ]; then if [ -x "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" ]; then exec "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" "$@"; fi; if [ -f "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" ]; then exec python3 "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" "$@"; fi; fi; if command -v thoth >/dev/null 2>&1; then exec thoth "$@"; fi; candidates="$(ls -td "$HOME"/.codex/plugins/cache/thoth/thoth/* "$HOME"/.codex/plugins/cache/thoth/* "$HOME"/.codex/plugins/cache/*/thoth/* "$HOME"/.codex/plugins/cache/*/Thoth/* 2>/dev/null || true)"; marketplace="$HOME/.codex/.tmp/marketplaces/thoth"; if [ -d "$marketplace" ]; then candidates="$candidates
$marketplace"; fi; for candidate in $candidates; do if [ -x "$candidate/bin/thoth" ]; then exec "$candidate/bin/thoth" "$@"; fi; if [ -f "$candidate/scripts/thoth-cli-entry.py" ]; then if command -v python3 >/dev/null 2>&1; then exec python3 "$candidate/scripts/thoth-cli-entry.py" "$@"; else exec python "$candidate/scripts/thoth-cli-entry.py" "$@"; fi; fi; done; echo '"'"'thoth installed runtime not found'"'"' >&2; exit 127' thoth run`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the user supplied arguments or trailing natural-language guidance after the public command, preserve those exact arguments in the shell invocation. If neither PATH nor the installed Codex plugin cache or marketplace root contains the runtime entrypoint, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=phase_controller. Objective: Finish the current strict task through the four-phase RuntimeDriver while preserving agent intelligence inside execute. Hard stop: Do not invent or compile a new work item when --work-id is missing. Hard stop: Do not exit the monitoring session before the RuntimeDriver signals a terminal state. Hard stop: Do not hand-edit .thoth ledgers. If the command streams runtime events, report progress and risks from those events only. Stay in the same session until the RuntimeDriver reaches terminal state unless --sleep was requested. Runtime lifecycle is plan -> execute -> validate -> reflect; auto advances selected work through child loops. In current runtime semantics, execute owns implementation plus the official validator run; validate mechanically normalizes and confirms execute's official_validation_receipt. Child phases should work directly toward the final architecture. They must not satisfy work through MVP, fallback, mock, stub, simplified, branch-only, or compatibility-shim implementations unless authority explicitly asks for them. Verification must match the task. For example, AI research/model/CUDA/inference tasks should use a GPU-first verification posture: prefer real GPU training/inference smoke and official validators over CPU-only, mock-only, shape-only, or MVP-only substitutes. Do not hand-edit `.thoth`; let the Thoth runtime driver advance phases. If the user sends a natural-language correction while a live run/loop/auto is active, inject it into the active run guidance inbox through the packet protocol or installed runtime instead of merely replying with advice. Treat such live corrections as temporary guidance: they may steer execution and debugging, but they must not rewrite work authority or validation criteria. Prefer waiting over polling: check roughly every 90 seconds during quiet progress, unless terminal/error evidence, worker-invalid, missing receipt, runtime mismatch, or user guidance appears. When evidence shows a low-level engineering mistake or runtime mismatch, proactively append guidance or interrupt the active run instead of only narrating the problem. Plan must prove user-authority coverage before execute; executable discovery such as finding paths or creating missing target files should flow into execute, not needs_input. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
