# $thoth auto

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `phase_controller`

## Objective

Run actionable work items by scheduling priority through child loops until none remain, budget pauses, or stop is requested.

## Hard Stops

- Do not execute blocked or draft work.
- Do not auto-abandon work items.
- Do not bypass execution-safety doctor preflight.

## Reply Contract

- reply_budget_utf8: `120`
- result_style: stream runtime events until terminal or paused
- validator_policy: controller cursor and child loop results define queue state

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth auto`, but in the workspace shell you must execute it literally as `thoth auto`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=phase_controller. Objective: Run actionable work items by scheduling priority through child loops until none remain, budget pauses, or stop is requested. Hard stop: Do not execute blocked or draft work. Hard stop: Do not auto-abandon work items. Hard stop: Do not bypass execution-safety doctor preflight. If the command streams runtime events, report progress and risks from those events only. Stay in the same session until the RuntimeDriver reaches terminal state unless --sleep was requested. Runtime lifecycle is plan -> execute -> validate -> reflect; auto advances selected work through child loops. Do not hand-edit `.thoth`; let the Thoth runtime driver advance phases. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
