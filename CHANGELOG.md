# Changelog

## [Unreleased]

No pending changes.

## [0.2.7.0] - 2026-05-23

### Changed
- Work item authority now writes the compact payload shape only: `goal`, `context`, `constraints`, `acceptance_spec`, `approach_notes`, `scheduling`, `run_limits`, and `missing_questions`.
- Ready and active work items require a concrete `acceptance_spec`; legacy payload fields such as `work_kind`, `runnable`, `execution_plan`, `eval_contract`, `runtime_policy`, `depends_on`, and `scheduling.priority` are rejected on new public writes.
- `depends_on` and `decisions` remain public input conveniences but are stored as canonical object links instead of payload fields.
- `auto` now builds a DAG-first actionable queue: dependency links are satisfied only by `validated` work items, optional `scheduling.order` controls tie-breaking, and legacy priority semantics are removed.
- Phase prompts are rewritten around numbered, high-intelligence role contracts while keeping acceptance and authority strict; reconcile/history continuation is now part of the plan phase instead of a public run flag.

### Fixed
- Dashboard and status read models no longer require compact authority payloads to carry dashboard-only `module` / `direction` fields.
- Public work-json diagnostics report a missing `acceptance_spec` at the right level instead of exploding it into empty normalized subfields.
- Legacy closed discussion authority is backfilled as a `primary_parent` link without reintroducing stored `authority_context` payload fields.

### Removed
- Removed the public `thoth run --reconcile` flag. Historical run continuation is now handled by the plan worker through `history_action`.

## [0.2.6.12] - 2026-05-23

### Fixed
- `$thoth auto` now repairs a stale `.thoth/docs/object-graph-summary.json` preflight once by refreshing the object graph summary and rerunning the execution-safety doctor before deciding whether to block execution.
- Auto still refuses real authority or safety failures after the refresh, but no longer blocks ready work solely because derived docs/read-model counts lag behind canonical `.thoth/objects`.

## [0.2.6.11] - 2026-05-23

### Changed
- `validate` now treats `eval_entrypoint.command` as the reference official validator instead of a hard string cage: command mismatch is retained as a diagnostic while authority, validator intent, metric, threshold, and evidence sufficiency decide acceptance.
- Execute prompts now explicitly allow reasonable GPU, interpreter, environment, or thin-wrapper adjustments when they preserve the same official validation intent and leave auditable evidence.
- Dashboard validate cards now surface command relation, equivalence rationale, and validation-evidence preservation signals.

### Fixed
- Prevented runs from failing solely because the passed official validator was invoked with a leading environment selector such as `CUDA_VISIBLE_DEVICES=3`.
- Reflect output validation now normalizes clear object-shaped outcomes such as `{"status":"failed"}` to `failed`, reducing schema-only worker retries without loosening ambiguous outcomes.

## [0.2.6.10] - 2026-05-23

### Changed
- Auto controllers now record a per-child `attempts` ledger with `work_id`, `run_id`, status, child exit status, and finish time, so controller failure summaries are backed by real child runs instead of queue inference.
- Dashboard/runtime auto summaries now expose `attempt_count` and `failed_attempt_count`; the existing `failed_count` is aligned with failed attempts rather than raw queued work.

### Fixed
- Recomputed the remaining auto queue after every child completion, skipped work item, and rounds pause so terminal controllers do not keep a stale startup snapshot that looks like every work item was touched.
- Added regression coverage proving that a failed `auto --rounds 1` child marks only the attempted work item as `attempt_failed`, leaves other ready work untouched, and keeps work item authority status `ready`.

## [0.2.6.9] - 2026-05-22

### Changed
- Compacted phase worker output contracts so `plan` now requires only `summary`, `authority_complete`, `open_gaps`, and a rich markdown `plan`; `execute` requires `summary`, rich markdown `report`, and `official_validation_receipt`; `reflect` requires `summary`, `outcome`, and rich markdown `review`.
- Updated `auto`, `run`, and `loop` phase prompts to push final-architecture-first implementation, reject MVP/fallback/mock/stub/simplified shortcut paths unless explicitly authorized, and use task-appropriate verification.
- Scoped GPU-first guidance to AI research, model training, CUDA, and inference tasks instead of applying it globally.
- Dashboard phase cards now prefer the new `plan`, `report`, and `review` bodies while still displaying legacy structured fields when present.

### Fixed
- Kept legacy phase fields accepted as optional compatibility input without making them required by the new prompt contract.
- Reflect failure handling now treats `corrective_prompt` as the primary retry instruction while retaining runtime-managed `retry_target=execute` and one internal execute retry.

## [0.2.6.8] - 2026-05-21

### Changed
- `validate` now treats execute's `official_validation_receipt` as the business acceptance source while normalizing inline `stdout_log` / `stderr_log` fields into run-local log artifacts.
- `reflect` no longer sends receipt/log contract hygiene back to `execute`; `runtime_contract_error` is treated as a Thoth runtime contract issue rather than a project implementation failure.
- Dashboard validate cards now show observed validation facts, runtime contract health, normalized receipt paths, and acceptance state as structured sections.

### Added
- `thoth run --reconcile <run_id>` can safely reconcile historical failed/stopped runs when the existing execute receipt already proves the official validator command passed with the required metric.
- Stale canonical worker outputs are archived under `worker-archived/` instead of `worker-invalid/`, reserving `worker-invalid/` for true schema/JSON/worker-output failures.

### Fixed
- Prevented passed official validators from failing solely because stdout/stderr evidence was inline text, an empty stderr sentinel, or a path-shaped receipt field needing materialization.
- Preserved runtime-generated `_normalization_warnings` through validate schema normalization so dashboards and run artifacts retain the real receipt contract history.

## [0.2.6.7] - 2026-05-21

### Changed
- `execute` now owns the implementation/debug/official-validator cycle in one Codex or Claude worker session and returns a compact `official_validation_receipt` with command, interpreter, cwd, environment summary, exit code, logs, and checks.
- `validate` is now a mechanical receipt-confirmation phase instead of a separate intelligent worker, preventing execute/validate interpreter or CUDA environment drift.
- `reflect` now acts as a human-style corrective reviewer: successful runs record compact lessons, while failed validation can feed one direct corrective prompt back into `execute` without changing authority, metrics, thresholds, or validators.
- Live host prompt surfaces now prefer low-frequency monitoring around 90 seconds during quiet progress, but proactively append or interrupt guidance when clear runtime/environment mistakes appear.

### Fixed
- Prevented runs from failing solely because validate used a different Python environment than execute after execute had already passed the official validator.
- Dashboard phase cards now surface execute validation receipts, mechanical validate checks, and reflect feedback retries as structured evidence instead of relying on raw runtime logs.

## [0.2.6.6] - 2026-05-21

### Changed
- `run`, `loop`, and `auto` now preserve trailing natural-language text as temporary runtime guidance, recording it in run/controller ledgers and passing it into phase worker packets without changing work-item authority or validators.
- Phase worker prompts now tell agents to read guidance at phase start, before key implementation choices, after failures, and before focused validation reruns; `execute` remains responsible for engineering debugging rather than deferring fixable implementation issues to `reflect`.
- Host surfaces now describe live guidance injection: active-run user corrections should be appended to the run guidance inbox, with strong corrections allowed to interrupt and restart the current phase worker.

### Fixed
- `validate` now uses GPU-capable worker execution instead of Codex workspace sandboxing: Codex validate uses `--dangerously-bypass-approvals-and-sandbox`, while Claude validate uses `--dangerously-skip-permissions` with `IS_SANDBOX=1`.
- Added a run-local guidance inbox and interrupt archive path so live corrections preserve stdout/stderr/prompt evidence instead of looking like schema failures or stopped attempts.

## [0.2.6.5] - 2026-05-21

### Changed
- Added host-neutral phase role contracts: `plan` stays strict about user authority while treating path/import/dependency lookup as executable discovery, `execute` acts as a senior implementation engineer, `validate` remains an independent acceptance verifier, and `reflect` focuses on validation evidence, scientific/system risks, and next recommendations.
- `execute` now explicitly encourages repo-local engineering debugging and dependency repair inside task boundaries, including `.vendor` or task-local installs, focused smoke checks, and structured fields for `debug_attempts`, `dependency_actions`, `verification_steps`, `resolved_failures`, and `remaining_failures`.
- Dashboard run detail now renders structured phase cards from `plan` / `execute` / `validate` / `reflect` artifacts, with phase summaries, warnings, checks, dependency actions, and validation evidence instead of raw worker-log walls in the normal work-item detail view.

### Fixed
- Removed the remaining default `execute` timeout inherited from run payload loop budgets; execute has no short fixed Thoth timeout unless an explicit environment/runtime policy sets one.
- Synthesized missing `reflect` failure fields from validate evidence when validation has already failed, preventing a missing `failure_class` / `root_cause` / `next_plan_hint` from hiding the real acceptance failure.
- `thoth init --sync` now marks legacy timestamp duplicate work items such as `work-<timestamp>-work` as `abandoned`, hidden, and superseded by their stable work id when there is one unambiguous matching authority item.

## [0.2.6.4] - 2026-05-20

### Changed
- `run` and `loop` now resolve missing `strict_task.authority_context` from embedded work authority, linked closed discussions, legacy `DISC-*` work references, or a compact ready-work compatibility context, and record `authority-resolution.json` for audit.
- `plan` now supports optional `discovery_tasks` so path search, source checkout discovery, target directory creation, imports, and test-entry creation can proceed to `execute` instead of being misclassified as user authority gaps.
- `thoth init --sync` now refreshes the project-local managed dashboard scaffold and backs up the previous scaffold under ignored `.thoth/derived/dashboard-sync-backups/`.

### Fixed
- Prevented `discuss close` from creating timestamp work items when the close payload omits a stable `work_id`; the command now returns `needs_input` and asks for an explicit work binding.
- Kept broad goal wording from blocking execution when `eval_contract` and constraints already define the current run acceptance boundary.
- Ensured older project-local dashboard code can be upgraded through `init --sync`, so ready work with failed latest attempts remains ready, does not display as completed, and does not contribute completion progress.

## [0.2.6.3] - 2026-05-20

### Changed
- Split repo-local Thoth state into portable authority, local runtime evidence, and dashboard dependency/cache layers.
- `thoth init` and `thoth init --sync` now append idempotent ignore rules for `.thoth/runs/`, `.thoth/derived/`, generated work-results, runtime object kinds, dashboard frontend `node_modules/` / `dist/`, and local dashboard cache.
- `status --json` and dashboard read models derive work counts from portable authority without requiring Git-tracked run ledgers.

### Fixed
- Prevented new run/loop/review/auto ledgers, worker logs, invalid worker outputs, dashboard PID/log/status files, local leases, and dashboard dependencies from appearing in `git status --short` by default.
- Moved the dashboard SQLite read model under ignored `.thoth/derived/dashboard/` local state.
- Preserved ready work item authority when the latest attempt failed or stopped, while keeping failed/stopped/abandoned attempts out of completion progress.

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
