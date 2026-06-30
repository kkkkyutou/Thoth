# Acceptance Report

## Evidence Ledger

### `NTH-EV-001` Repo Reset Verification

Status: `passed`

Scope:

1. Old runtime path deletion.
2. New package skeleton creation.
3. Root metadata and original reset license verification.
4. Recovery document rewrite.
5. Local commit creation.

Required evidence:

1. `git status --short` before and after commit.
2. Structure check confirming old tracked runtime paths are gone.
3. Structure check confirming the exact 10 packages exist.
4. Node JSON parse check for root and package metadata.
5. `npm install --package-lock-only --ignore-scripts`.
6. `git diff --check`.
7. Symlink check for `CLAUDE.md -> AGENTS.md`.

Evidence:

1. Old root runtime paths checked gone: `thoth`, `scripts`, `templates`, `tests`, `commands`, `plugins`, `.claude-plugin`, `.codex-plugin`, `.agents`, `bin`, `pyproject.toml`, `.pytest_cache`, `.tmp_pytest`, `research.db`.
2. `packages/` contains exactly 10 package directories.
3. Root plus package metadata parsed successfully with Node: `package metadata ok 11`.
4. `npm install --package-lock-only --ignore-scripts` completed with `found 0 vulnerabilities`.
5. `CLAUDE.md` symlink check passed: `CLAUDE symlink ok`.
6. Design document presence check passed: `design docs ok`.
7. Official sources cache marker check passed.
8. Asset check confirmed only `thoth-icon.svg` and `thoth.png` remain under `assets/`.
9. `git diff --check` passed.

Current result:

The reset structure and metadata checks passed. Full commit evidence is recorded in `run-log.md`.

Note:

`NTH-AC-003` was later superseded from `GPL-3.0-only` to `AGPL-3.0-or-later` by `NTH-CD-017`. See `NTH-EV-002` for the active license/import evidence.

### `NTH-EV-002` AGPL And Upstream Seed Import Verification

Status: `in_progress`

Scope:

1. License switch to `AGPL-3.0-or-later`.
2. Upstream source verification and raw cache exclusion.
3. Tracked implementation seed import.
4. Git hygiene and package metadata checks.

Required evidence:

1. Remote HEAD check for the upstream source.
2. Raw cache path ignored by git.
3. Voice/audio/speech/dictation exclusion checks.
4. Node JSON parse and license metadata checks for root and package `package.json` files.
5. `npm install --package-lock-only --ignore-scripts`.
6. Tracked seed directory existence checks.
7. Large file and secret/path hygiene checks.
8. `git diff --check`.

Current result:

In progress. Do not treat implementation seeds as runnable product behavior.

## Failed Or Not-Yet-Passed Checks

1. No runtime MVP check exists yet because current checkout is intentionally skeleton-only.
2. No TypeScript typecheck exists yet because no TypeScript implementation or `tsconfig` has been introduced.
3. No product behavior test exists yet because daemon, protocol and UI shells are not implemented.
4. Some old `.tmp_pytest` fixture entries could not be unlinked promptly on NFS and were moved under ignored `.agent-os/.trash/tmp_pytest-nfs-stale-20260628`; this is not part of the committed source tree.
