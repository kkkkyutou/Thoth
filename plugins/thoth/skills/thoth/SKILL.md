---
name: thoth
description: Official Codex public surface for the Thoth authority runtime. Use this skill when the user wants to operate Thoth through the single `$thoth <command>` public entry.
---

# Thoth

Official Codex public surface for Thoth. This skill is generated from the same host-neutral command specification that renders the Claude `/thoth:*` commands.

## Public Entry

Use the single public entrypoint:

- `$thoth <command>`

Supported commands:
- `$thoth init`: Initialize, migrate, resync, or seed an intent discussion for canonical .thoth authority without taking ownership of repo-root `.codex`.
- `$thoth run`: Start one strict run bound to `work_id@revision`; live runs foreground and `--sleep` detaches the same runtime driver.
- `$thoth loop`: Start one bounded controller service whose parent creates four-phase child runs.
- `$thoth argue`: Run an adversarial attacker/adjudicator discussion against an idea, work item, or decision.
- `$thoth auto`: Run the DAG-first actionable work queue until ready/active/failed work is closed, paused, or stopped.
- `$thoth status`: Show repo status and active durable runs from the shared ledger.
- `$thoth discuss`: Discuss or record planning decisions without entering implementation execution.
- `$thoth doctor`: Alias for `status --doctor`; strictly audit project health without writing authority.
- `$thoth dashboard`: Alias for `status --dashboard`; manage the local dashboard backed by .thoth ledgers.
- `$thoth tui`: Open or snapshot the read-only terminal dashboard backed by shared Thoth providers.
- `$thoth plugin`: Create, list, or validate project-local Dashboard/TUI extension plugins with local audit receipts.

## Dispatcher

- `.thoth` is the only runtime authority.
- Parse the requested `$thoth <command>`, then open only the matching micro prompt under `./commands/<command>.md`.
- Execute the literal shell command immediately; do not replace it with explanation.
- If `thoth` is not on PATH, use the installed Codex plugin cache or marketplace-root runtime entrypoint described by the micro prompt; do not use a local checkout as fallback.
- If neither PATH nor the installed Codex plugin cache / marketplace root contains the runtime entrypoint, treat that as host install drift.
- Do not create alternative public Codex variants such as `run:codex` or `loop:codex`.

## Route Table

- `init` -> `hybrid_init` / `intent_sensitive` / `result_envelope_or_command_packet`
- `run` -> `live_intelligent` / `high` / `phase_controller`
- `loop` -> `live_intelligent` / `high` / `phase_controller`
- `argue` -> `live_intelligent` / `high` / `argument_record`
- `auto` -> `live_intelligent` / `high` / `phase_controller`
- `status` -> `mechanical_fast` / `none` / `result_envelope`
- `discuss` -> `live_intelligent` / `high` / `command_packet`
- `doctor` -> `mechanical_fast` / `none` / `result_envelope`
- `dashboard` -> `mechanical_fast` / `none` / `result_envelope`
- `tui` -> `mechanical_fast` / `none` / `result_envelope`
- `plugin` -> `mechanical_fast` / `none` / `result_envelope`

## Shared Rules

- `init` is hybrid: no intent is a mechanical audit-first receipt; natural-language intent opens an inquiring discussion and must be closed through compact project_patch/work_graph authority.
- `status`, `doctor`, `dashboard`, `tui`, and `plugin` are mechanical fast-path commands and should return only short receipts.
- `discuss`, `run`, `loop`, `auto`, and `argue` are high-intelligence paths.
- `argue` preserves full attacker/adjudicator artifacts; authority patches require explicit confirmation before apply.
- `run` and `loop` use one RuntimeDriver: lifecycle is `plan -> execute -> validate -> reflect`; live is foreground monitor, `--sleep` is detached monitor.
- For `run`, `loop`, and `auto`, preserve trailing natural-language command text as temporary runtime guidance. During a live run, inject user corrections into the active run guidance inbox instead of only narrating advice.
- Host hooks and subagents may improve throughput but are never correctness requirements.
