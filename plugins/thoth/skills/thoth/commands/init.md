# $thoth init

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `hybrid_init`
- intelligence_tier: `intent_sensitive`
- packet_authority_mode: `result_envelope_or_command_packet`

## Objective

Initialize audit-first project authority; when natural-language intent is supplied, save the raw intent as an init discussion and continue by questioning until compact authority is closed.

## Hard Stops

1. Do not assume the repo is blank.
2. Do not assume goals, project identity, migration intent, work priority, unblock policy, or acceptance criteria.
3. Do not turn init intent into ready work immediately.
4. Do not bake an unconfirmed summary of the raw intent into AGENTS.md, CLAUDE.md, or generated project docs.
5. Do not combine natural-language init intent with --sync, --migrate, --preview, or --apply.
6. Do not launch broad Explore, Task, plugin-cache/source scans, or background investigation after the init result.
7. If extra evidence is required, inspect only the smallest artifact explicitly named by the init payload.
8. If init opens an intent discussion, use AskUserQuestion in Claude or Plan/request_user_input in Codex to ask only the next material questions before closing authority.
9. If the preview/apply result leaves blocked work or unresolved migration choices, ask with AskUserQuestion or the host's planning question tool and stop.
10. Do not narrate the full migration procedure.

## Reply Contract

- reply_budget_utf8: `180`
- result_style: brief mechanical receipt when no intent; question-driven planning handoff when intent discussion is opened
- validator_policy: scaffold success comes from generated artifacts; intent success comes from preserving raw discussion authority without fabricating work

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth init`, but in the workspace shell you must execute it literally as `bash -lc 'set -euo pipefail; if [ -n "${THOTH_SELFTEST_RUNTIME_ROOT:-}" ]; then if [ -x "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" ]; then exec "$THOTH_SELFTEST_RUNTIME_ROOT/bin/thoth" "$@"; fi; if [ -f "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" ]; then exec python3 "$THOTH_SELFTEST_RUNTIME_ROOT/scripts/thoth-cli-entry.py" "$@"; fi; fi; if command -v thoth >/dev/null 2>&1; then exec thoth "$@"; fi; candidates="$(ls -td "$HOME"/.codex/plugins/cache/thoth/thoth/* "$HOME"/.codex/plugins/cache/thoth/* "$HOME"/.codex/plugins/cache/*/thoth/* "$HOME"/.codex/plugins/cache/*/Thoth/* 2>/dev/null || true)"; marketplace="$HOME/.codex/.tmp/marketplaces/thoth"; if [ -d "$marketplace" ]; then candidates="$candidates
$marketplace"; fi; for candidate in $candidates; do if [ -x "$candidate/bin/thoth" ]; then exec "$candidate/bin/thoth" "$@"; fi; if [ -f "$candidate/scripts/thoth-cli-entry.py" ]; then if command -v python3 >/dev/null 2>&1; then exec python3 "$candidate/scripts/thoth-cli-entry.py" "$@"; else exec python "$candidate/scripts/thoth-cli-entry.py" "$@"; fi; fi; done; echo '"'"'thoth installed runtime not found'"'"' >&2; exit 127' thoth init`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the user supplied arguments or trailing natural-language guidance after the public command, preserve those exact arguments in the shell invocation. If neither PATH nor the installed Codex plugin cache or marketplace root contains the runtime entrypoint, report host install drift instead of inventing another entrypoint. route_class=hybrid_init. intelligence_tier=intent_sensitive. packet_authority_mode=result_envelope_or_command_packet. Objective: Initialize audit-first project authority; when natural-language intent is supplied, save the raw intent as an init discussion and continue by questioning until compact authority is closed. Hard stop: Do not assume the repo is blank. Hard stop: Do not assume goals, project identity, migration intent, work priority, unblock policy, or acceptance criteria. Hard stop: Do not turn init intent into ready work immediately. Hard stop: Do not bake an unconfirmed summary of the raw intent into AGENTS.md, CLAUDE.md, or generated project docs. Hard stop: Do not combine natural-language init intent with --sync, --migrate, --preview, or --apply. Hard stop: Do not launch broad Explore, Task, plugin-cache/source scans, or background investigation after the init result. Hard stop: If extra evidence is required, inspect only the smallest artifact explicitly named by the init payload. Hard stop: If init opens an intent discussion, use AskUserQuestion in Claude or Plan/request_user_input in Codex to ask only the next material questions before closing authority. Hard stop: If the preview/apply result leaves blocked work or unresolved migration choices, ask with AskUserQuestion or the host's planning question tool and stop. Hard stop: Do not narrate the full migration procedure. If no natural-language intent is present, keep the response as a short mechanical init/sync/migrate receipt. If natural-language intent is present, the command must save the raw text into an init discussion and return the discussion packet; do not create ready work from it. After an init intent discussion opens, help the user close authority through compact project_patch/work_graph fields only after asking all material questions. In Codex non-Plan sessions, tell the user Plan mode is recommended before closing authority; in Plan mode, use request_user_input for the next material question. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
