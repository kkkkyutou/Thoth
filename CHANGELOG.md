# Changelog

## [Unreleased]

No pending changes.

## [0.2.6.2] - 2026-05-20

### Changed
- Relaxed four-phase worker output budgets: `plan` / `reflect` summaries now allow 1200 UTF-8 bytes, `execute` / `validate` summaries allow 800, and narrative evidence/list fields allow 1024-1200 depending on field role.
- Normalized over-budget narrative, evidence, command, and path fields into compact single-line text with `_normalization_warnings` instead of rejecting the phase output and retrying.

### Fixed
- Prevented overlong `plan.validation_plan` and similar non-semantic verbosity from triggering phase-worker schema retries when the core authority result can already terminalize, such as `needs_input`.
- Kept mechanical protocol fields strict, including booleans, phase outcomes, validate schema requirements, metric names, and short failure-class labels.

## [0.2.6.1] - 2026-05-20

### Fixed
- Changed dashboard and read-model progress semantics so `failed` / `abandoned` work-item authority no longer contributes `100%` completion progress.
- Kept failed work items displayed as `failed` rather than folding them into `completed` or `blocked`.

## [0.2.6] - 2026-05-20

### Changed
- Stabilized the Codex default executor path for public `run` / `loop` / `review` / `auto` execution while preserving explicit Claude executor selection.
- Changed failed and stopped run projections to `attempt_failed` / `attempt_stopped` so ready work items stay runnable after a failed or stopped attempt.
- Added phase-specific stall guards: `plan` defaults to 900 seconds, `reflect` defaults to 600 seconds, and `execute` / `validate` no longer use short fixed default timeouts.

### Fixed
- Normalized JSON-like `plan.open_gaps` and `plan.forbidden_assumptions_used` items into compact strings, so incomplete authority terminalizes as `needs_input` instead of entering schema retries.
- Preserved invalid worker outputs, validation errors, stdout, and stderr under `worker-invalid/` before retrying phase workers.
- Added worker-log dashboard reload support and run detail log tails for active or recently failed phase workers.
- Ensured phase-worker timeout and stop paths kill the worker process group and terminalize as failed timeout attempts or stopped attempts instead of hanging foreground drivers.

## [0.2.5] - 2026-05-19

### Changed
- Hardened `dashboard start` with workspace-aware port selection, automatic fallback ports, frontend dependency install/build, Vue shell readiness checks, and direct detached uvicorn process supervision.

## [0.2.4] - 2026-05-19

### Changed
- Hardened `loop` with bounded retry decisions, compact failure context for the next child run, and clearer UTF-8 byte budget prompt wording.
- Hardened `auto` with controller-local worker locking, persisted controller event streams, lower-churn idle heartbeats, and stop cascading to the active child run.

## [0.2.3] - 2026-05-19

### Changed
- Increased `run` phase summary budgets for `plan` and `reflect` from 240 to 800 UTF-8 characters while keeping `execute` and `validate` at 240.

## [0.2.2] - 2026-05-19

### Fixed
- Fixed README inline-code formatting in the locked planning authority table row and published it as a new plugin version so remote-only host updates refresh installed marketplace caches.

## [0.2.1] - 2026-05-19

### Fixed
- Fixed `thoth init --preview` so it writes only migration preview evidence and does not apply generated project authority files unless `--apply` is explicitly selected.
- Added plugin-wrapper dependency bootstrapping through a user-local runtime venv so marketplace installs can run without relying on globally installed Python packages.
- Broadened Codex micro-prompt runtime lookup to support both observed and shorter plugin cache layouts.

## [0.2.0] - 2026-05-14

### Added
- Published the first stable compact release for the current `.thoth/objects` runtime.
- Added README launch notes for durable runs, locked work items, reviewable verdicts, and Claude Code / Codex plugin parity.
- Strengthened generated `AGENTS.md` / `CLAUDE.md` project contracts with Think Before Coding, Simplicity First, Surgical Changes, and Goal-Driven Execution guidance.

### Changed
- Standardized current authority, runtime, and dashboard read models on `work_item`, `work_id`, `work_kind`, and `runnable`.
- Renamed dashboard public routes and API endpoints from task naming to work-item naming, including `/work-items` and `/api/work-items`.
- Updated publishable plugin metadata and generated host surfaces to version `0.2.0`.

### Breaking Changes
- Removed `task_id` from current public authority, dashboard output, runtime summaries, generated surfaces, and selftest samples.
- Replaced current `work_type=task|milestone` payload shape with `work_kind=execution|milestone`; runnable execution eligibility now depends on `runnable=true`.
- Removed `/tasks`, `/api/tasks`, `/api/tasks/{task_id}`, `/api/tasks/{task_id}/active-run`, and `/api/tasks/{task_id}/runs` from the dashboard public surface.
- Removed obsolete root plugin residue directories `skills/`, `contracts/`, and `hooks/hooks.json`; publishable plugin surfaces now live under the generated Claude/Codex plugin manifests, `commands/`, `plugins/thoth/skills/thoth/`, `bin/thoth`, `scripts/thoth-cli-entry.py`, and the `thoth/` runtime package.

## [0.1.4] - 2026-04-23

### Changed
- Upgraded host hook behavior so Claude and Codex hooks now inject advisory runtime context, append standardized hook events, and refresh active-run heartbeat without becoming runtime authority

### Fixed
- Restored explicit `thoth:*` public command names so installed plugin commands render as `/thoth:*` instead of bare command names

## [0.1.2] - 2026-04-23

### Changed
- Collapsed Codex delegation into `--executor codex` on the main public commands
- Moved internal behavioral contracts out of the public plugin `skills/` surface into `contracts/`
- Added internal `thoth-main` and `codex-worker` agents plus plugin `settings.json`
- Retired the earlier shape that exposed dedicated public Codex command variants plus a matching rescue agent; the supported replacement is the smaller `/thoth:*` surface together with `--executor codex` on `run`, `loop`, and `review`

### Fixed
- Removed internal Thoth helper modules and dedicated Codex variants from the public slash-command surface

## [0.1.1] - 2026-04-22

### Changed
- Migrated plugin commands to standard root-level `commands/` layout
- Added teaser figure asset and linked it from the README
- Rewrote README for public open-source plugin positioning

### Added
- Added `.claude-plugin/marketplace.json` for Claude Code marketplace distribution
- Added repository homepage and author metadata to the plugin manifest

### Fixed
- Updated `hooks/hooks.json` to match Claude Code plugin validation format

## [0.1.0] - 2026-04-19

### Added
- Initial plugin skeleton
- 7 skills: core, audit, exec, memory, counsel, codex, testing
- 11 commands + 3 codex variants
- Session lifecycle hooks (SessionStart, SessionEnd)
- Codex rescue subagent
