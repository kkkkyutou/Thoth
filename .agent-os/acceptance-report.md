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

### `NTH-EV-003` Promoted Source Verification

Status: `passed`

Scope:

1. Promote tracked `_paseo` implementation seed material into formal package source trees.
2. Delete tracked `_paseo` directories.
3. Preserve the formal 10-package Thoth workspace boundary and package identity.
4. Refresh package-lock metadata without claiming compile or runtime readiness.
5. Check obvious generated/cache, voice/audio/speech/dictation path residue and secret-like residue.

Required evidence:

1. Structural check confirming no `_paseo` paths remain under `packages/`.
2. Package list check confirming exactly the 10 formal packages remain.
3. Check confirming no `packages/highlight` workspace package was created.
4. Check confirming `packages/tui` remains skeleton-only.
5. Node JSON and package identity checks for root, formal packages and nested `packages/app/highlight`.
6. `npm install --package-lock-only --ignore-scripts`.
7. Raw cache ignore check.
8. Generated/cache path scan.
9. Voice/audio/speech/dictation path and package/config/script residue scan.
10. Old internal package-name scan.
11. Large-file and secret-like scan.
12. `git diff --check`.

Evidence:

1. `_paseo` path check reported `0`.
2. Formal package list check reported exactly: `app`, `cli`, `client`, `core`, `daemon`, `desktop`, `drivers`, `protocol`, `relay`, `tui`.
3. `packages/highlight` absence check reported `packages/highlight absent`.
4. `packages/tui` file check reported only `README.md`, `package.json`, `src/.gitkeep` and `tests/README.md`.
5. Node package identity check reported `formal package identity ok`.
6. JSON parse check reported `json ok 12` for root package metadata, 10 formal package metadata files and nested `packages/app/highlight/package.json`.
7. `npm install --package-lock-only --ignore-scripts` completed: `up to date, audited 2189 packages in 10s`; it reported `40 vulnerabilities (4 low, 28 moderate, 8 high)`, which is recorded as follow-up triage input and was not fixed in this round.
8. Raw cache ignore check reported `.gitignore:25:.agent-os/upstreams/` for `.agent-os/upstreams/paseo` and `.agent-os/upstreams/paseo/README.md`.
9. Generated/cache scan under `packages/` returned no paths matching `.git`, `node_modules`, `dist`, `build`, `.expo`, `.next`, `.wrangler` or `coverage`.
10. Path-level voice/audio/speech/dictation/TTS/STT/PCM/WAV scan under `packages/` returned no paths.
11. Package/config/script voice residue scan over root/package metadata, app config, daemon README, daemon CLAUDE and daemon scripts returned no matches.
12. Old internal package-name scan for `@thoth/server` returned no matches.
13. Large-file scan found no package files over `5MB`.
14. Secret-like scan found no `ghp_`, real-looking `sk-...` token or private-key block in staged source candidates.
15. `git diff --check` passed.

Current result:

The promoted source structure is verified as the formal implementation substrate. This evidence does not claim that any package builds, typechecks, launches or implements the New Thoth MVP behavior.

### `NTH-EV-004` First-Day Development Infrastructure Verification

Status: `passed`

Scope:

1. Stable install and root-script command surface.
2. Foundation package build/typecheck/test gate.
3. Repository structure, metadata, AGENTS/CLAUDE link, install policy and hygiene validation.
4. Local Android Debug APK packaging.
5. Linux-safe iOS packaging scripts.
6. Development, testing, packaging and release documentation.

Required evidence:

1. `npm install`.
2. `npm run validate:repo`.
3. `npm run format:check`.
4. `npm run lint:foundation`.
5. `npm run build:foundation`.
6. `npm run typecheck:foundation`.
7. `npm run test:foundation`.
8. `npm run check:foundation`.
9. `npm run doctor:android`.
10. `npm run setup:android-toolchain`.
11. `npm run package:android:debug-apk`.
12. `npm run package:ios:prebuild`.
13. `npm run package:ios:build` on Linux, expecting a clear macOS/Xcode-only message and exit code `1`.
14. AGENTS/CLAUDE symlink coverage for root and all 10 packages.
15. Generated/raw path hygiene checks and `git diff --check`.

Evidence:

1. Root `.npmrc` now sets `ignore-scripts=true`, `audit=false` and `fund=false`; after removing the unused local `eas-cli` devDependency, plain `npm install` completed with `up to date in 4s`.
2. Lockfile scan confirmed `node_modules/eas-cli` and `node_modules/dtrace-provider` are absent from `package-lock.json`; `npm ls dtrace-provider --all` reported `(empty)`.
3. `npm run validate:repo` passed and reported `THOTH_REPO_VALIDATION_OK`, including package boundary, package metadata, AGENTS/CLAUDE links, docs, npm install policy, generated/raw path hygiene, package/config voice residue and secret-like scan.
4. `npm run format:check` passed: `All matched files use the correct format`.
5. `npm run lint:foundation` passed: `Found 0 warnings and 0 errors`.
6. `npm run build:foundation` passed for `packages/app/highlight`, `packages/relay`, `packages/protocol` and `packages/client`.
7. `npm run typecheck:foundation` passed with `tsc --noEmit` for the same four foundation packages.
8. `npm run test:foundation` passed:
   - `packages/app/highlight`: 4 files, 66 tests passed.
   - `packages/relay`: 4 files, 25 tests passed.
   - `packages/protocol`: 32 files, 286 tests passed.
   - `packages/client`: 4 files, 110 tests passed.
9. `npm run check:foundation` passed end-to-end through validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests.
10. `npm run doctor:android` passed after setup and reported `THOTH_ANDROID_DOCTOR_OK`, with project JDK at `.dev/jdk-17` and Android SDK at `.dev/android-sdk`.
11. `npm run setup:android-toolchain` completed and reported `THOTH_ANDROID_TOOLCHAIN_READY`.
12. `npm run package:android:debug-apk` completed and reported `THOTH_ANDROID_DEBUG_APK_OK`.
13. Android APK receipt:
    - Path: `/mnt/cfs/5vr0p6/yzy/thoth/packages/app/android/app/build/outputs/apk/debug/app-debug.apk`
    - sha256: `1a3cde6a8c2eab458683a5255291ed03ca6db1aaca1ab0d6dbbb39626fd8e540`
    - Bytes: `302693683`
    - Receipt: ignored `.agent-os/artifacts/android-debug-apk.json`
14. `npm run package:ios:prebuild` on Linux reported `THOTH_IOS_PREBUILD_SKIPPED: iOS prebuild requires macOS with Xcode. Current platform is linux.` and exited `0`.
15. `npm run package:ios:build` on Linux reported `THOTH_IOS_BUILD_SKIPPED: iOS build requires macOS with Xcode. Current platform is linux.` and exited `1`, as expected.
16. Root and all 10 package `CLAUDE.md` links point to their local `AGENTS.md`.
17. Generated/raw path checks confirmed no tracked `.dev/`, `.agent-os/upstreams/`, `.agent-os/artifacts/`, `packages/app/android/`, `packages/app/ios/` or `_paseo` paths.
18. The app config microphone/audio permission residue was removed, and package/config voice residue scan now passes.
19. `git diff --check` passed.

Current result:

The first-day development infrastructure is verified. This evidence proves the foundation gate and local packaging infrastructure, not any New Thoth MVP product behavior.

## Failed Or Not-Yet-Passed Checks

1. No runtime MVP check exists yet because task authority, provider-backed Router, Clarify, PlanExec, Review, daemon orchestration, TUI, desktop and mobile product behavior are not implemented.
2. Full daemon/app/desktop/CLI/driver build and test suites are still outside the foundation gate and may remain expected-broken until their dedicated migration milestones.
3. Some old `.tmp_pytest` fixture entries could not be unlinked promptly on NFS and were moved under ignored `.agent-os/.trash/tmp_pytest-nfs-stale-20260628`; this is not part of the committed source tree.
4. Android build currently emits upstream Expo/React Native/Gradle deprecation warnings; the Debug APK is still produced successfully.
5. Real iOS build was not run because the current environment is Linux and lacks macOS/Xcode.
