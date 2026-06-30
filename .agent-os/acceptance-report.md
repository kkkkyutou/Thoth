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

Status: `passed`

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

Evidence:

1. Remote upstream `main` checked through `git ls-remote` with proxy: `5fc53c576ef0d4dee55455ccc95660703f71b892`.
2. Raw cache path checked ignored by git: `.gitignore:25:.agent-os/upstreams/`.
3. Seed directory check passed for all nine planned targets under `packages/*/_paseo`.
4. Root package metadata check passed: `packages=10`, `workspaces=packages/*`, active package licenses `AGPL-3.0-or-later`.
5. All package JSON files under `packages/` parsed successfully: `count=19`.
6. Path-level exclusion checks returned no seed or raw cache paths matching voice/audio/speech/dictation/TTS/STT/PCM/WAV patterns.
7. Generated/cache path check returned no seed paths matching `.git`, `node_modules`, `dist`, `build`, `.expo`, `.next`, `.wrangler` or `coverage`.
8. Large file check returned no tracked seed files over `5MB`.
9. Seed content naming scan found no `@getpaseo`, `getpaseo`, `PASEO`, `Paseo` or `paseo` content matches inside tracked seed.
10. Refined secret-like scan found no `ghp_`, real-looking `sk-...` token or private-key block in tracked seed/provenance files.
11. `npm install --package-lock-only --ignore-scripts` completed with `found 0 vulnerabilities`.
12. `git diff --check` passed.

Current result:

The AGPL policy and implementation seed import are verified as a non-runnable migration substrate. No CLI, daemon, TUI, desktop app, mobile app, relay or provider behavior is implemented by this evidence.

## Failed Or Not-Yet-Passed Checks

1. No runtime MVP check exists yet because current checkout is intentionally skeleton-only.
2. No TypeScript typecheck exists yet because no TypeScript implementation or `tsconfig` has been introduced.
3. No product behavior test exists yet because daemon, protocol and UI shells are not implemented.
4. Some old `.tmp_pytest` fixture entries could not be unlinked promptly on NFS and were moved under ignored `.agent-os/.trash/tmp_pytest-nfs-stale-20260628`; this is not part of the committed source tree.
