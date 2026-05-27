# $thoth auto

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `phase_controller`

## Objective

Run actionable work items through child loops while preserving architecture-first execution, evidence-producing execute behavior, and human-quality phase handoffs.

## Hard Stops

1. Do not execute blocked or draft work.
2. Do not auto-abandon work items.
3. Do not bypass execution-safety doctor preflight.
4. Do not let child runs convert missing canonical evidence into terminal explanation when execute can still generate, repair, instrument, rerun, or diagnose it.
5. Do not let child runs satisfy work through MVP, fallback, mock, stub, simplified, branch-only, or compatibility-shim implementations unless authority explicitly asks for them.

## Reply Contract

- reply_budget_utf8: `120`
- result_style: start or reuse the durable controller, then stream JSONL watch events until terminal or observer interruption
- validator_policy: controller cursor, child loop results, and auto watch events define queue state

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth auto`, but in the workspace shell you must execute it literally as `bash -lc 'set -euo pipefail; if [ -n "${THOTH_SELFTEST_RUNTIME_ROOT:-}" ]; then if [ -x "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" ]; then exec "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" "$@"; fi; if [ -f "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" ]; then exec python3 "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" "$@"; fi; fi; if command -v thoth >/dev/null 2>&1; then exec thoth "$@"; fi; candidates="$(ls -td "$HOME"/.codex/plugins/cache/thoth/thoth/* "$HOME"/.codex/plugins/cache/thoth/* "$HOME"/.codex/plugins/cache/*/thoth/* "$HOME"/.codex/plugins/cache/*/Thoth/* 2>/dev/null || true)"; marketplace="$HOME/.codex/.tmp/marketplaces/thoth"; if [ -d "$marketplace" ]; then candidates="$candidates
$marketplace"; fi; for candidate in $candidates; do if [ -x "$candidate/bin/thoth" ]; then exec "$candidate/bin/thoth" "$@"; fi; if [ -f "$candidate/scripts/thoth-cli-entry.py" ]; then if command -v python3 >/dev/null 2>&1; then exec python3 "$candidate/scripts/thoth-cli-entry.py" "$@"; else exec python "$candidate/scripts/thoth-cli-entry.py" "$@"; fi; fi; done; echo '"'"'thoth installed runtime not found'"'"' >&2; exit 127' thoth auto`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the user supplied arguments or trailing natural-language guidance after the public command, preserve those exact arguments in the shell invocation. If neither PATH nor the installed Codex plugin cache or marketplace root contains the runtime entrypoint, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=phase_controller. Objective: Run actionable work items through child loops while preserving architecture-first execution, evidence-producing execute behavior, and human-quality phase handoffs. Hard stop: Do not execute blocked or draft work. Hard stop: Do not auto-abandon work items. Hard stop: Do not bypass execution-safety doctor preflight. Hard stop: Do not let child runs convert missing canonical evidence into terminal explanation when execute can still generate, repair, instrument, rerun, or diagnose it. Hard stop: Do not let child runs satisfy work through MVP, fallback, mock, stub, simplified, branch-only, or compatibility-shim implementations unless authority explicitly asks for them. If the command streams runtime events, report progress and risks from those events only. Stay in the same session until the RuntimeDriver reaches terminal state unless --sleep was requested. Runtime lifecycle is plan -> execute -> validate -> reflect; auto advances selected work through child loops. In current runtime semantics, execute owns implementation plus the official validator run; validate mechanically normalizes and confirms execute's official_validation_receipt. Child phases should work directly toward the final architecture. They must not satisfy work through MVP, fallback, mock, stub, simplified, branch-only, or compatibility-shim implementations unless authority explicitly asks for them. If acceptance depends on canonical artifacts, metrics, logs, receipts, benchmark output, service state, or files, missing evidence is execution work for the child execute phase, not a final explanation by itself. For long-running work, first-artifact evidence proves startup only; continue or resume canonical execution until acceptance evidence, a concrete blocker, or a real budget boundary exists. Do not let a healthy process be stopped merely because a self-imposed observation window has not yet produced canonical evidence; stop or restart only as explicit debugging/cleanup with captured logs and a next action. If authorized runtime budget expires before acceptance closes, preserve continuation evidence and the exact next command instead of presenting the work as passed. Verification must match the task. For example, AI research/model/CUDA/inference tasks should use a GPU-first verification posture: prefer real GPU training/inference smoke and official validators over CPU-only, mock-only, shape-only, or MVP-only substitutes. Do not hand-edit `.thoth`; let the Thoth runtime driver advance phases. If the user sends a natural-language correction while a live run/loop/auto is active, inject it into the active run guidance inbox through the packet protocol or installed runtime instead of merely replying with advice. Treat such live corrections as temporary guidance: they may steer execution and debugging, but they must not rewrite work authority or validation criteria. Prefer sparse foreground observation: check roughly every 288 seconds during quiet progress, unless terminal/error evidence, worker-invalid, missing receipt, runtime mismatch, or user guidance appears. When evidence shows a low-level engineering mistake or runtime mismatch, proactively append guidance or interrupt the active run instead of only narrating the problem. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
