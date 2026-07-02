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

### `NTH-EV-005` Relay V3 Security And Local Preview Verification

Status: `partial`

Scope:

1. Replace unauthenticated relay behavior with v3-only room registration and role-scoped token authorization.
2. Update protocol, client, daemon and app pairing paths for v3 connection offers, pairing tokens and device tokens.
3. Replace old relay/app defaults with `seeles.ai` domains.
4. Build and serve the real web app preview locally.
5. Prepare Code4Agent mirror export for hosted relay deployment.
6. Validate relay behavior through tests, local E2E and local load test.
7. Attempt hosted Code4Agent preview deployment or record exact blocker.

Evidence:

1. `npm run build:web` passed and exported `packages/app/dist` through the real Expo app build. Local static preview is served at `http://127.0.0.1:4173`; `curl http://127.0.0.1:4173/` returned HTTP `200` and HTML title `Thoth`.
2. `packages/app/dist` size check reported `12M`.
3. Domain cleanup scan returned no matches for `relay.thoth.sh`, `app.thoth.sh`, `relay.paseo`, `app.paseo` or `paseo.sh` outside ignored upstreams and generated web dist.
4. `npm run test:relay` passed: 4 files, 29 tests.
5. `npm run typecheck:relay` passed.
6. `npm run build:relay` passed.
7. `npm run test:protocol` passed: 32 files, 286 tests.
8. `npm run typecheck:protocol` passed.
9. `npm run build:protocol` passed.
10. `npm run typecheck:client` passed.
11. `npm run build:client` passed.
12. `npm run test:client` passed: 4 files, 110 tests.
13. `npm --workspace=@thoth/relay run test:e2e` passed after updating the e2e tests to v3: 1 file, 3 tests.
14. Local relay load smoke passed with 5 clients / 5 seconds / 1 second interval: 25 attempted pings, 25 pongs, error rate `0`, p95 `4ms`; receipt `/mnt/cfs/5vr0p6/yzy/thoth/.dev/relay-load-test-1782889165157.json`.
15. Local relay load test passed with 200 clients / 10 minutes / 5 second interval: 24000 attempted pings, 24000 pongs, failures `0`, error rate `0`, p50 `18ms`, p95 `24ms`, p99 `31ms`; receipt `/mnt/cfs/5vr0p6/yzy/thoth/.dev/relay-load-test-1782889793822.json`.
16. `npm run sync:code4agent-relay -- .dev/code4agent-thoth-relay-export` generated a Code4Agent-style `apps/thoth-relay` mirror under ignored `.dev/`.
17. Code4Agent dry-run using current remote `packages/config/apps.yml` and `.github/workflows/_deploy-isolated.yml` showed the mirror script can add `thoth-relay` to app registry and emits `CODE4AGENT_WORKFLOW_REQUIRED.md` because `_deploy-isolated.yml` hard-codes per-app jobs.
18. `npm --silent run gh -- api user --jq .login` reported `Royalvice`.
19. `npm --silent run gh -- repo view SeeleAI/Code4Agent --json nameWithOwner,defaultBranchRef,isPrivate,viewerPermission,url` reported private repo access, default branch `master` and `viewerPermission=WRITE`.
20. Code4Agent ruleset query reported active `protected-paths` push ruleset restricting `.github/**/*`, `scripts/**/*`, `docs/**/*`, `AGENTS.md`, `**/AGENTS.md`, `packages/presets/**/*` and `**/*/wrangler.jsonc`.

Current result:

Relay security and local validation are verified. Hosted Code4Agent preview deployment was blocked before push by repository governance: adding `apps/thoth-relay/wrangler.jsonc` and updating `.github/workflows/_deploy-isolated.yml` both hit active protected paths. This Code4Agent path is now historical and superseded by independent repository `SeeleAI/Thoth-Relay`; see `NTH-EV-006` for the hosted test relay and runtime isolation evidence.

### `NTH-EV-006` Thoth/Paseo Runtime Isolation Verification

Status: `passed`

Scope:

1. Keep the existing local Paseo daemon running on `127.0.0.1:6767`.
2. Run Thoth daemon independently on `127.0.0.1:6688`.
3. Serve the real web app review entry on local `8082` and current public mapping `8148`.
4. Deploy and validate the independent test relay service at `relay.test.thoth.seeles.ai`.
5. Produce and smoke the Linux AppImage without using Paseo or the live user daemon.
6. Produce Android Debug APK with Thoth package identity and no microphone permission.
7. Verify Codex provider smoke through the Thoth provider path.
8. Re-run repository foundation and hygiene checks.

Evidence:

1. Port isolation check:
   - `Paseo\x20` PID `1567463` listens on `127.0.0.1:6767`.
   - `Thoth\x20` PID `1529981` listens on `127.0.0.1:6688`.
   - Web static server PID `1211974` listens on `*:8082`.
2. Thoth daemon health:
   - `GET http://127.0.0.1:6688/api/health` returned `{"status":"ok"}`.
   - `GET http://127.0.0.1:6688/api/status` returned listen `127.0.0.1:6688`.
3. CLI status through the Thoth dev profile reported:
   - `localDaemon: "running"`
   - `connectedDaemon: "reachable"`
   - `home: "/mnt/cfs/5vr0p6/yzy/thoth/.dev/thoth-runtime/home"`
   - `listen: "127.0.0.1:6688"`
   - providers include `Claude`, `Codex` and `mock`.
4. Web checks:
   - `npm run build:web` passed.
   - `curl -I http://127.0.0.1:8082/` returned HTTP `200`.
   - `curl -I http://180.76.242.105:8148/` returned HTTP `200`.
   - Playwright smoke rendered the real app UI with no page errors and no `6767` console attempt. Local route showed workspace UI; public route showed Welcome / Direct connection / Paste pairing link / Settings.
5. Relay deployment:
   - Independent repo `SeeleAI/Thoth-Relay` latest pushed commit: `317bcda46571ae0ae508f4d892759eff779d9d73`.
   - GitHub Actions run `28537212728` completed with conclusion `success`.
   - Workflow URL: `https://github.com/SeeleAI/Thoth-Relay/actions/runs/28537212728`.
   - `GET https://relay.test.thoth.seeles.ai/health` returned `{"status":"ok","protocol":"3","service":"thoth-relay"}`.
6. Relay live load test:
   - Receipt: `/mnt/cfs/5vr0p6/yzy/Thoth-Relay/.dev/relay-live-load-test-1782929276055.json`.
   - Clients: `200`.
   - Duration: `600000ms`.
   - Interval: `5000ms`.
   - Connected clients: `200`.
   - Attempted pings: `23972`.
   - Pongs: `23954`.
   - Failures: `18`.
   - Error rate: `0.0007508760220256966`.
   - Latency: p50 `394ms`, p95 `427ms`, p99 `765ms`.
   - Reconnects: `114`.
7. Desktop AppImage:
   - Path: `/mnt/cfs/5vr0p6/yzy/thoth/packages/desktop/release/Thoth-x86_64.AppImage`.
   - sha256: `6fc25b0f92cf930b5f7e43d6eb11de8a466cc54f881e8fcbb832f288acd1fd43`.
   - Bytes: `131375945`.
   - Packaged smoke passed with desktop-managed daemon PID `1561097` listening on isolated temp port `127.0.0.1:38579`; CLI shim daemon status and terminal smoke succeeded.
8. Android Debug APK:
   - Path: `/mnt/cfs/5vr0p6/yzy/thoth/packages/app/android/app/build/outputs/apk/debug/app-debug.apk`.
   - sha256: `9579e3cb43637b6380faf2890eb496d43d7a7cc9779c787afdf16f9d98a70fa0`.
   - Bytes: `302700513`.
   - Package id: `sh.thoth.debug`.
   - `aapt dump permissions` did not include `android.permission.RECORD_AUDIO`.
9. Codex provider smoke:
   - `npm --workspace=@thoth/daemon run test:unit -- src/server/agent/providers/codex/app-server-transport.test.ts src/server/agent/providers/codex-app-server-agent.test.ts` passed: 2 files, 79 tests.
   - Debug targeted local e2e `npm --workspace=@thoth/daemon exec -- vitest run src/server/agent/providers/codex-app-server-agent.local.e2e.test.ts` passed: 1 file, 1 test.
   - Broader provider local e2e command hit an unrelated missing `opencode` binary and is not counted as an isolation failure.
10. CLI boundary checks:
    - CLI speech command exposure was removed.
    - Voice onboarding is fixed to disabled and does not prompt for enablement.
    - `npm --workspace=@thoth/cli run typecheck` passed.
    - `npm --workspace=@thoth/cli exec -- tsx tests/17-onboard.test.ts` passed.
11. Repository checks:
    - `npm run check:foundation` passed.
    - `npm --workspace=@thoth/cli exec -- vitest run src/commands/daemon/local-daemon.supervision.test.ts` passed: 1 file, 7 tests.
    - `npm --workspace=@thoth/desktop run test -- src/daemon/daemon-manager.test.ts src/daemon/desktop-packaging.test.ts src/daemon/node-entrypoint-runner.test.ts src/daemon/node-entrypoint-launcher.test.ts` passed: 4 files, 19 tests.
    - `npm run smoke:isolation` passed.
    - `git diff --check` passed.

Current result:

Thoth services can now run in parallel with the user's local Paseo daemon. This evidence proves development/runtime isolation and packaging/smoke readiness, not the New Thoth MVP task workflow.

### `NTH-EV-007` Web Workspace White-Screen Regression Verification

Status: `passed`

Scope:

1. Reproduce the web app blank page after workspace navigation.
2. Identify the concrete browser runtime exception.
3. Fix the web bundle without changing product flow or mocking the review UI.
4. Rebuild the real web export and verify local/public review entry behavior.

Evidence:

1. Playwright reproduced the blank page after clicking workspace `Greeting` and captured `TypeError: (...).channel is not a function`.
2. The crashing import path was traced to the xterm ligatures addon pulling a browser-incompatible `diagnostics_channel.channel()` path through `lru-cache`.
3. `packages/app` now aliases `@xterm/addon-ligatures` to a no-op production web stub for Metro web export and terminal webview esbuild output.
4. `npm run build:web` passed and produced `packages/app/dist/_expo/static/js/web/index-82dc0d5713cdea0252baa9435ac46581.js`.
5. Static scans confirmed the new web bundle and generated terminal webview HTML do not contain `diagnostics_channel`, `hasSubscribers&&` or the real ligatures addon markers.
6. Playwright local smoke clicked workspace `Greeting` and reached `/h/srv_Qd3ONVF7rQEHNW2PJTTBxA/workspace/wks_fe7ac40e0f64e5bb` with the composer visible and `PAGE_ERRORS []`.
7. Playwright local smoke submitted `hi`; the page stayed on the workspace route with `PAGE_ERRORS []` and surfaced the current expected `Select model` validation instead of crashing.
8. `curl` confirmed both `http://127.0.0.1:8082/open-project` and `http://180.76.242.105:8148/open-project` serve the new hashed web bundle.
9. Public fresh-browser Playwright loaded `http://180.76.242.105:8148/open-project` with `PAGE_ERRORS []`; it showed `No projects yet` because the fresh origin had no paired host registry.
10. `npm --workspace=@thoth/app run test -- --project unit src/terminal/runtime/terminal-emulator-runtime.test.ts` passed with 17 tests.
11. `npm run format:check` and `git diff --check` passed.

Current result:

The web workspace route no longer white-screens on navigation or `hi` submission. The next visible product-path issue is provider/model selection for actual message execution, not a browser crash.

### `NTH-EV-008` One Thoth Web Shell Icon Surface Verification

Status: `passed-for-slice`

Scope:

1. Use the locked transparent `05-arcade-inventory` PNG icon set as a real app asset surface.
2. Move the Web/Desktop shared entry shell toward One Thoth / task-control-plane product language.
3. Preserve existing real Add project, Import session, Provider setup and Pair device flows.
4. Keep backend-unimplemented states honest rather than showing fake task/provider/evidence success.
5. Ensure `build:web`, foundation gate and formatting hygiene remain green for this slice.

Evidence:

1. `packages/app/src/components/icons/thoth-inventory-icon.tsx` now provides a single typed registry for the locked package-local PNG assets.
2. `packages/app/src/components/icons/thoth-logo.tsx` now renders the `brand-mark` inventory PNG instead of the old vector mark.
3. `packages/app/src/screens/open-project-screen.tsx` now renders One Thoth / Task control plane copy plus honest status chips:
   - Workspace: `Needs a registered workspace`
   - Provider: `Select a model first`
   - Relay: `Fresh pairing supported`
   - Review: `Preview surface`
4. `packages/app/src/components/left-sidebar.tsx` uses inventory PNGs for Add workspace, Home, Settings and the Workspace section label.
5. `packages/app/src/screens/settings-screen.tsx` uses inventory PNGs for General, Appearance, Diagnostics, About, Connections, Agents/Tasks, Workspaces, Providers, Host and Projects navigation/detail headers where package-local icons exist.
6. `packages/app/scripts/build-terminal-webview-html.mjs` now formats its generated `terminal-emulator-webview-html.ts` output with `oxfmt`, keeping `build:web` and `format:check` compatible.
7. `npm run build:web` passed and exported `packages/app/dist/_expo/static/js/web/index-199f42bfb01d2ed5ca71875d38711970.js`; Expo export listed the arcade-inventory PNG assets in the web bundle.
8. Static bundle scan found `Task control plane`, `One Thoth`, `Needs a registered workspace`, `Fresh pairing supported` and `Preview surface` in the exported web bundle.
9. Playwright desktop-width smoke against `http://127.0.0.1:8092/open-project` at `1440x960` found the One Thoth entry text and had no React page errors.
10. Playwright mobile-width smoke against `http://localhost:8092/open-project` at `390x844` found the One Thoth entry text and exact `Provider` status, with no React page errors.
11. The temporary-origin Playwright runs logged local daemon WebSocket `403` console errors because the smoke used `8092` rather than the formal `8082 -> 8148` dogfood origin/daemon pairing path; no white screen or page exception occurred.
12. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests.
13. `npm run format:check` passed after `build:web`.
14. `git diff --check` passed.

Current result:

The real Web/Desktop shared shell now visibly presents Thoth as One Thoth / task control plane and consumes the locked transparent PNG icon set in first-viewport and navigation surfaces. This evidence does not prove the complete multi-endpoint UI productization goal: OpenTUI, final Workspace composer/task/evidence slots, desktop packaged smoke, full Playwright/PTTY stress matrix and scorecard remain unfinished.

### `NTH-EV-009` Workspace Composer And Task Surface Slice Verification

Status: `passed-for-slice`

Scope:

1. Add the fixed Thoth composer control surface for `+`, Provider, Mode, Clarify and Loop without changing provider execution semantics.
2. Keep Loop/Clarify/backend-unimplemented behavior honest as preview or needs-provider state.
3. Add Workspace task-control-plane slots for active task, frozen contract and evidence/review preview.
4. Align MVP file upload limit with the locked `<10MB` attachment rule.
5. Verify the real web export, foundation gate, formatting and smoke checks for this UI slice.

Evidence:

1. Added `packages/app/src/composer/thoth-composer-controls.tsx` with a shared Thoth composer rail:
   - `+`: `Images/files <10MB`
   - `Provider`: `Select model first` until an existing provider/model selection is present
   - `Mode`: local `Quick` / `Loop` UI selection
   - `Clarify`: local cycle through `Auto`, `Don't Ask`, `Light`, `Balanced`, `Dive Dive Dive`
   - `Loop`: disabled in Quick as `Off in Quick`, enabled in Loop with `Auto`, `Single Pass`, `Light`, `Balanced`, `Try Try Try`
2. `packages/app/src/composer/index.tsx` now renders the Thoth rail above the existing message input and derives provider readiness from the existing real agent/draft provider and model state. It does not create task authority, call a hidden model API or bypass existing provider submission.
3. The existing file upload guard in `packages/app/src/composer/index.tsx` now rejects files over `10MB`, matching the current MVP attachment rule surfaced in the composer.
4. `packages/app/src/composer/draft/workspace-tab.tsx` now renders a Workspace preview surface for draft tabs with:
   - Workspace status: `Registered` or `Needs workspace`
   - Provider status: selected provider or `Select model first`
   - Host status: `Connected` or `Offline`
   - Loop status: `Preview`
   - Active task: `No frozen task yet`
   - Contract: `Needs Clarify session`
   - Evidence: `Review receipts will land here`
5. `npm run build:web` passed and exported `packages/app/dist/_expo/static/js/web/index-9b372b8af504495884b37da2d845671e.js`.
6. Static web bundle scan found the new composer/workspace markers in the latest export, including `Images/files <10MB`, `thoth-composer-controls`, `workspace-thoth-surface-preview` and `Loop task runtime preview`.
7. Playwright desktop-width smoke against temporary `http://127.0.0.1:8093/open-project` at `1440x960` found `ONE THOTH` / `One Thoth`, `Task control plane`, `Provider` and `Fresh pairing supported`, with page errors `[]`.
8. Playwright mobile-width smoke against temporary `http://127.0.0.1:8093/open-project` at `390x844` found `ONE THOTH` / `One Thoth`, `Task control plane`, `Provider` and `Fresh pairing supported`, with page errors `[]`.
9. The temporary `8093` static server was stopped after smoke; `lsof -tiTCP:8093 -sTCP:LISTEN` returned no listener afterward.
10. `npm run format:check` passed after the final `build:web`.
11. `git diff --check` passed.
12. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

The real Web/Desktop app bundle now contains the next Workspace UI slice: fixed Thoth-level composer controls, honest provider/loop readiness states, Workspace task/contract/evidence preview slots and the MVP `10MB` attachment limit. This does not implement provider-backed Router, Clarify runtime, contract freeze, PlanExec, Review or OpenTUI.

### `NTH-EV-010` OpenTUI Shell Surface Foundation Verification

Status: `passed-for-slice`

Scope:

1. Move `packages/tui` from skeleton-only toward the first real OpenTUI shell implementation slice.
2. Keep TUI state derived from shared daemon/client/protocol shapes instead of adding separate task authority.
3. Add a guarded native OpenTUI renderer factory without pretending the locked Node `24.14.0` toolchain can run the native renderer.
4. Verify TUI unit tests, typecheck, build, formatting, diff hygiene and the current foundation gate.

Evidence:

1. `packages/tui/package.json` now declares real package exports, build/typecheck/test scripts, `@thoth/client` and `@opentui/core@0.4.2`.
2. `packages/tui/src/surface.ts` derives the One Thoth TUI surface model from `ConnectionState`, `ThothWorkspace`, `ThothAgent` and provider snapshot types exported through `@thoth/client`.
3. The derived surface covers Home, Workspace, Task / Loop, Providers, Connections, Evidence / Review and Settings / About slots with honest `ready`, `needs-action`, `preview`, `running` and `unavailable` states.
4. `packages/tui/src/runtime.ts` records the current runtime guard: Bun can be accepted for renderer creation, while Node renderer creation requires Node `26.3.0+` and `--experimental-ffi`.
5. `packages/tui/src/opentui-renderer.ts` dynamically imports `@opentui/core` only after the runtime guard passes, so the current Node `24.14.0` path fails before native renderer creation.
6. `packages/tui/README.md` and `packages/tui/tests/README.md` now state the real current status: first non-rendering OpenTUI shell slice exists, native renderer tests remain deferred until the Node FFI vs Bun spike is explicitly resolved.
7. `npm install --package-lock-only` passed; `npm install` passed and added the local OpenTUI dependency under the repository install policy.
8. `npm run test --workspace=@thoth/tui` passed: 2 files, 9 tests.
9. `npm run typecheck --workspace=@thoth/tui` passed.
10. `npm run build --workspace=@thoth/tui` passed.
11. Runtime guard smoke with `node -e "import('./packages/tui/dist/runtime.js')..."` returned `available: false`, `runtime: node`, `reason: node_version_too_old`, `currentVersion: 24.14.0`, `minimumNodeVersion: 26.3.0`.
12. `npm run format:check` passed.
13. `git diff --check` passed.
14. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

`packages/tui` now has the first shared-state OpenTUI shell foundation and a truthful native renderer guard. This does not complete the interactive TUI app, renderer/input smoke, Node FFI vs Bun runtime decision, task backend, Clarify runtime, contract freeze, PlanExec or Review.

### `NTH-EV-011` OpenTUI Renderer Smoke Verification

Status: `passed-for-slice`

Scope:

1. Run the first OpenTUI runtime spike for `packages/tui`.
2. Choose a reproducible native renderer smoke path that does not change the repository's locked Node `24.14.0` developer toolchain.
3. Render the actual One Thoth TUI surface model through OpenTUI, not a hello-world-only check.
4. Verify default, narrow and wide terminal character frames.

Evidence:

1. Node `24.14.0` can import `@opentui/core` and `@opentui/core/testing`, but `createTestRenderer()` fails with `OpenTUI native FFI is not available for this runtime yet`.
2. `npm view bun@1.3.14` showed a package with `bun`/`bunx` bins, but `npm exec --package=bun@1.3.14 -- bun --version` failed because the package requires a postinstall script and the repository install policy uses `ignore-scripts=true`.
3. `npm pack @oven/bun-linux-x64@1.3.14 --dry-run --json` showed the package contains `bin/bun`, but `npm exec --package=@oven/bun-linux-x64@1.3.14 -- bun --version` did not expose `bun` on PATH.
4. `npm exec --package=node@26.4.0 -- node --version` still resolved to the current Node `24.14.0`, so the generic `node` package was not a valid spike path.
5. `npm pack node-linux-x64@26.4.0 --dry-run --json` showed a Linux x64 Node package containing `bin/node`.
6. `npm exec --package=node-linux-x64@26.4.0 -- node --version` returned `v26.4.0`.
7. Manual spike with `npm exec --package=node-linux-x64@26.4.0 -- node --experimental-ffi -e ...createTestRenderer...` created an OpenTUI test renderer and captured `One Thoth TUI smoke`.
8. Added `packages/tui/src/render.ts` to mount the existing `TuiSurfaceModel` through OpenTUI and added `packages/tui/src/render.test.ts` for pure surface-line formatting.
9. Added root `npm run smoke:tui:renderer`, which runs `npm run build --workspace=@thoth/tui` then `npm exec --yes --package=node-linux-x64@26.4.0 -- node --experimental-ffi scripts/smoke-opentui-renderer.mjs`.
10. Default `npm run smoke:tui:renderer` passed and captured a `96x34` split surface with `One Thoth - OpenTUI split surface`, `Needs a registered workspace`, `Select model first`, `Fresh pairing supported`, `Evidence / Review`, `+ Images/files <10MB | Provider | Mode Quick/Loop | Clarify | Loop`, and `Authority: daemon/client/protocol state only`.
11. Narrow `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:renderer` passed and captured a compact surface.
12. Wide `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:renderer` passed and captured a split surface.
13. `npm run test --workspace=@thoth/tui` passed: 3 files, 10 tests.
14. `npm run typecheck --workspace=@thoth/tui` passed.
15. `npm run build --workspace=@thoth/tui` passed.
16. `npm run format:check` passed.
17. `git diff --check` passed.
18. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

The OpenTUI renderer runtime spike now has a reproducible root-script path using pinned `node-linux-x64@26.4.0` plus experimental FFI. Bun is not selected for the current repo-local smoke path. This proves renderer creation and character-frame capture for the One Thoth surface, not the complete interactive CLI workspace TUI, daemon-connected TUI state, focus/input loops or final TUI scorecard.

### `NTH-EV-012` OpenTUI Interaction Navigation Slice Verification

Status: `passed-for-slice`

Scope:

1. Add a testable OpenTUI interaction state layer for focus, route navigation, route history and explicit composer controls.
2. Keep interaction state limited to UI focus/control presentation; do not create fake task authority, fake daemon state or fake backend behavior.
3. Render active route, focus, state notices, composer values and authority guard text through the existing OpenTUI render path.
4. Add a root navigation smoke that simulates deterministic interaction actions and captures an OpenTUI character frame under the pinned Node FFI renderer path.
5. Verify default, compact and wide terminal frames.

Evidence:

1. Added `packages/tui/src/interaction.ts` with `createInitialTuiInteractionState`, `applyTuiInteractionAction`, focus order, route open/back behavior, Mode/Clarify/Loop cycling, Quick-mode Loop disablement and user-facing interaction hints.
2. Added `packages/tui/src/interaction.test.ts`; `npm run test --workspace=@thoth/tui` passed with 4 files and 16 tests.
3. Updated `packages/tui/src/render.ts` so the frame shows route, focus, state notice, authority guard, focused/active navigation markers and composer control values while retaining the original surface model input.
4. Added root `npm run smoke:tui:navigation`, which runs `npm run build --workspace=@thoth/tui` and then `npm exec --yes --package=node-linux-x64@26.4.0 -- node --experimental-ffi scripts/smoke-opentui-navigation.mjs`.
5. Default `npm run smoke:tui:renderer` passed at `96x34` and captured the updated Home frame with `Route: Home`, `Focus: Home`, `State: One Thoth overview`, `Loop: Off in Quick` and `Authority: daemon/client/protocol state only`.
6. Default `npm run smoke:tui:navigation` passed at `96x34` and captured `Route: Evidence / Review (Preview)`, `Focus: Loop`, `State: Evidence and review receipts are preview-only`, `Mode: Loop`, `Loop: One Plan, One Do` and the authority guard.
7. Compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:navigation` passed and captured the compact frame.
8. Wide `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:navigation` passed and captured the split frame.
9. `npm run typecheck --workspace=@thoth/tui` passed.
10. `npm run build --workspace=@thoth/tui` passed.
11. `npm run format:check` passed.
12. `git diff --check` passed.
13. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

`packages/tui` now has a deterministic interaction/navigation model and an OpenTUI navigation smoke that proves the renderer can display simulated focus, route and composer-control state. This still does not complete a live interactive CLI TUI, daemon-connected workspace state, native keypress loop, task backend, Clarify runtime, contract freeze, PlanExec or Review.

### `NTH-EV-013` OpenTUI CLI Dogfood Entry Verification

Status: `passed-for-slice`

Scope:

1. Add a real top-level `thoth tui` command rather than a detached TUI smoke script.
2. Build the TUI surface from the same daemon/client/protocol state used by other CLI commands.
3. From the current `pwd`, choose the matching registered workspace, preferring the most specific workspace root when parent and child workspaces both match.
4. Keep Node `24.14.0` behavior truthful: the live native renderer is unavailable without Node `26.3.0+` and `--experimental-ffi`.
5. Verify a daemon-connected OpenTUI CLI smoke against Thoth `127.0.0.1:6688` without touching Paseo `127.0.0.1:6767`.

Evidence:

1. Added `packages/cli/src/commands/tui.ts` and registered top-level `thoth tui` in `packages/cli/src/cli.ts`.
2. `thoth tui` connects through existing CLI daemon utilities, fetches real `fetchWorkspaces`, `fetchAgents` and `getProvidersSnapshot` data, then mounts the shared `@thoth/tui` OpenTUI surface. If the daemon cannot be reached, it renders a disconnected/needs-host surface rather than fake connected state.
3. `packages/tui/src/surface.ts` now treats `cwd` descendants as workspace matches and chooses the most specific registered workspace root. `packages/tui/src/surface.test.ts` covers descendant and parent/child specificity cases.
4. Added `packages/tui/src/keyboard.ts` and live `mountTuiSurface(...).handleKey(...)` support so Tab/arrows, Enter, Esc, `M`, `C`, `L`, `Q` and Ctrl+C map to deterministic interaction actions or exit.
5. Added root `npm run smoke:tui:cli`, which builds `@thoth/tui`, builds CLI/daemon/client dependencies, then runs the real CLI entry under pinned `node-linux-x64@26.4.0 --experimental-ffi`.
6. Node `24.14.0` direct command check returned the truthful runtime error: OpenTUI native renderer is disabled for Node `24.14.0` and needs Node `26.3.0+` with experimental FFI.
7. `npm run smoke:tui:cli` passed against `127.0.0.1:6688`, capturing `One Thoth - OpenTUI split surface`, `Route: Workspace (Ready)`, `Host: Connected`, `Workspace: yzy`, `Provider: Provider available`, `Relay: Fresh pairing supported`, composer controls, task/evidence preview slots and the authority guard. The smoke asserts that `127.0.0.1:6767` / `localhost:6767` do not appear.
8. Compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed.
9. Wide `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed.
10. `npm run test --workspace=@thoth/tui` passed with 5 files and 21 tests.
11. `npm run typecheck --workspace=@thoth/tui` passed.
12. `npm --workspace=@thoth/cli run typecheck` passed.
13. `npm --workspace=@thoth/cli run build` passed.
14. `npm run smoke:isolation` passed: Paseo remained on `127.0.0.1:6767`, Thoth remained on `127.0.0.1:6688`, and the PIDs differed.
15. `npm run smoke:tui:renderer` and `npm run smoke:tui:navigation` passed after the CLI changes.
16. `npm run format:check` passed.
17. `git diff --check` passed.
18. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI now has a real CLI dogfood entry that uses daemon/client/protocol authority and can render the current workspace from `pwd` under the pinned Node 26 FFI path. This still does not complete the final OpenTUI product: deeper onboarding flows, live daemon refresh, richer error recovery, task backend, Clarify runtime, contract freeze, PlanExec, Review and the full UI review scorecard remain incomplete.

### `NTH-EV-014` OpenTUI Live Refresh And Recovery Verification

Status: `passed-for-slice`

Scope:

1. Add a discoverable refresh action to the live OpenTUI CLI entry without creating TUI-only daemon, workspace, provider or task truth.
2. Re-fetch real daemon workspaces, agents and provider snapshots from the CLI/client layer when the user presses `R` or when a smoke test requests refresh.
3. Show honest `Snapshot` / last-updated state in the TUI frame.
4. Keep disconnected recovery inside the TUI surface instead of exiting, crashing or pretending to be connected.
5. Avoid leaking relay pairing tokens, URL `offer=` values, password query values or legacy `6767` fallback text in CLI TUI frames.

Evidence:

1. `packages/tui/src/surface.ts` now accepts an optional refresh input and derives a `Snapshot` status chip plus `refresh` state from it. The state is still input-derived and does not create durable authority in `packages/tui`.
2. `packages/tui/src/keyboard.ts` maps `R` to a refresh intent. Existing Tab/arrows, Enter, Esc, `M`, `C`, `L`, `Q` and Ctrl+C behavior remains deterministic UI interaction.
3. `packages/tui/src/render.ts` now lets the live mount replace its current `TuiSurfaceModel`, renders `R refresh` in the key hints, and shows recovery text when the host is unavailable or a refresh fails.
4. `packages/cli/src/commands/tui.ts` handles refresh in the CLI layer by calling the same real daemon-loading path used on startup: `fetchWorkspaces`, `fetchAgents` and `getProvidersSnapshot`. Refresh updates the mounted OpenTUI surface rather than writing a mock file or using a fake backend.
5. `packages/cli/src/commands/tui.ts` redacts sensitive host material for TUI recovery text: relay pairing offers are described as relay pairing offers, URL `password=` is redacted, and error messages scrub `offer=` / `password=` fragments.
6. Added root `npm run smoke:tui:cli:recovery`, backed by `scripts/smoke-opentui-cli-recovery.sh`, which runs the real CLI OpenTUI entry under pinned `node-linux-x64@26.4.0 --experimental-ffi` against an unreachable host and verifies the disconnected recovery frame.
7. `npm run test --workspace=@thoth/tui` passed with 5 files and 23 tests, including refresh state, recovery rendering and `R` key mapping coverage.
8. `npm run typecheck --workspace=@thoth/tui` passed.
9. `npm --workspace=@thoth/cli run typecheck` passed.
10. `npm run build --workspace=@thoth/tui` and `npm --workspace=@thoth/cli run build` passed.
11. `npm run smoke:tui:renderer` passed and still captured the One Thoth OpenTUI surface under the pinned Node 26 FFI renderer path.
12. `npm run smoke:tui:navigation` passed and still captured route/focus/composer interaction state.
13. `npm run smoke:tui:cli` passed against Thoth `127.0.0.1:6688`; the final frame included `State: Refreshed daemon snapshot`, `Snapshot: Updated ...`, `Host: Connected`, `Workspace: yzy`, provider readiness, task/evidence preview slots and `R refresh`.
14. Compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed and captured the connected refresh frame in compact layout.
15. Wide `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed and captured the connected refresh frame in split layout.
16. `npm run smoke:tui:cli:recovery` passed; the final frame included `State: Refresh failed; recovery state shown`, `Snapshot: Refresh failed ...`, `Recovery: start Thoth daemon on 127.0.0.1:6688 or pair a fresh relay offer, then press R.`, `Workspace: Needs a registered workspace`, and no fake connected host state.
17. CLI smoke assertions now reject `127.0.0.1:6767`, `localhost:6767`, `offer=`, `pairingToken` and `thoth-relay-v3-client.` in final frames.
18. `npm run smoke:isolation` passed: Paseo remained on `127.0.0.1:6767`, Thoth remained on `127.0.0.1:6688`, and the PIDs differed.
19. `npm run format:check` passed.
20. `git diff --check` passed.
21. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI now has a live CLI refresh/recovery slice: users can discover `R refresh`, the CLI re-fetches real daemon/client state, the TUI shows updated snapshot state, and disconnected hosts remain inside an honest recovery surface. This still does not complete final OpenTUI onboarding, in-TUI workspace registration, richer route detail panels, task backend, Clarify runtime, contract freeze, PlanExec, Review, long interactive PTY stress or the full UI review scorecard.

### `NTH-EV-015` OpenTUI Route Detail Panels Verification

Status: `passed-for-slice`

Scope:

1. Add route-specific detail panels for Home, Workspace, Task / Loop, Providers, Connections, Evidence / Review and Settings / About.
2. Derive detail content only from existing TUI surface inputs: connection chip, daemon workspaces, provider snapshot, agents, refresh state, relay paired state and current `cwd`.
3. Keep the panels honest about unavailable or preview-only capabilities: no fake task authority, no fake Clarify/Loop backend, no fake Review validation and no hidden provider/API call.
4. Render the active route detail above the composer so the selected route has a product-like status explanation without pushing Mode/Loop out of compact 34-row frames.
5. Extend renderer, navigation, connected CLI and recovery CLI smokes to assert the detail panels.

Evidence:

1. Added `TuiDetailLine`, `TuiDetailSection` and `routeDetails: Record<TuiRouteId, TuiDetailSection>` to `packages/tui/src/surface.ts`.
2. `buildTuiSurfaceModel` now builds route details for Home, Workspace, Task / Loop, Providers, Connections, Evidence / Review and Settings / About from input state; `packages/tui` still does not own durable task, provider, workspace or daemon authority.
3. `packages/tui/src/render.ts` now renders `Active Route Detail` for the current route before the composer. The default order is Header, Status, Active Route Detail, Composer, Navigation, Interaction and Task Control Plane.
4. `packages/tui/src/index.ts` exports the new detail-section types for consumers.
5. `packages/tui/src/surface.test.ts` covers provider, connection, review and settings detail values from real surface inputs.
6. `packages/tui/src/render.test.ts` covers Home detail rendering plus provider/settings route detail formatting.
7. `scripts/smoke-opentui-renderer.mjs` now verifies `Active Route Detail`, `One Thoth Home` and `Next step: Register/connect this workspace before task loops`.
8. `scripts/smoke-opentui-navigation.mjs` now verifies the Evidence / Review detail panel and `Independent Review backend unavailable`.
9. `scripts/smoke-opentui-cli.sh` now verifies connected Workspace detail: `Workspace Control: Current workspace selected from daemon state` and `Context/files: Workspace context preview; attachments stay <10MB`.
10. `scripts/smoke-opentui-cli-recovery.sh` now verifies disconnected Home detail: `One Thoth Home: Needs host` and the workspace registration next step.
11. `npm run test --workspace=@thoth/tui` passed with 5 files and 25 tests.
12. `npm run typecheck --workspace=@thoth/tui` passed.
13. `npm run build --workspace=@thoth/tui` passed.
14. `npm run smoke:tui:renderer` passed under pinned `node-linux-x64@26.4.0 --experimental-ffi`; the frame contained Home detail and the workspace registration next step.
15. `npm run smoke:tui:navigation` passed under pinned Node FFI; the frame contained Evidence / Review detail, Review receipt preview and the unavailable independent Review backend state.
16. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:navigation` passed; the compact frame still showed composer Mode and Loop after the detail panel.
17. `npm run smoke:tui:cli` passed against real Thoth daemon `127.0.0.1:6688`; the final frame showed connected Workspace detail for workspace `yzy`.
18. `npm run smoke:tui:cli:recovery` passed against unreachable host `127.0.0.1:1`; the final frame showed recovery state, Home detail and no fake connected state.
19. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed with connected Workspace detail.
20. `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed with connected Workspace detail.
21. `npm run format:check` passed.
22. `git diff --check` passed.
23. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI route detail panels now give each major route a richer, product-shaped status explanation while remaining derived from existing daemon/client/provider/agent/refresh inputs. This still does not complete final OpenTUI onboarding, in-TUI workspace registration, provider setup flows, task backend, Clarify runtime, Loop runtime, independent Review runtime, long interactive PTY stress or the full Web/Desktop/OpenTUI UI scorecard.

### `NTH-EV-016` OpenTUI Onboarding Next Actions And Workspace Registration Verification

Status: `passed-for-slice`

Scope:

1. Add an OpenTUI `Next Actions` surface derived from existing daemon/client state, not from fake local authority.
2. Make unregistered current `pwd` visible as an onboarding state instead of silently selecting an unrelated workspace.
3. Add a discoverable `W workspace` key path that registers the current `pwd` through the real daemon workspace RPC and then reloads the daemon snapshot.
4. Keep provider setup, relay/device pairing and recovery as honest next actions where backend/UI editing paths are not yet implemented in TUI.
5. Verify compact terminal layout keeps composer Mode/Loop visible after adding next actions.

Evidence:

1. `packages/tui/src/surface.ts` now adds `TuiNextAction` and `nextActions` to the surface model. Actions are derived from connection, workspace readiness, provider readiness, relay paired state, refresh state and current `cwd`.
2. `packages/tui/src/render.ts` now renders `Next Actions` after the composer, keeping Mode/Clarify/Loop visible before onboarding actions in default and compact frames.
3. `packages/tui/src/keyboard.ts` maps `W` to workspace registration, `P` to Providers and `D` to Connections / Devices while preserving existing Tab/arrows/Enter/Esc/R/M/C/L/Q behavior.
4. `packages/cli/src/commands/tui.ts` now handles `W` by calling the existing daemon `createWorkspace({ source: { kind: "directory", path: cwd } })` path, then reloading workspaces, agents and provider snapshots through the same client layer used by refresh.
5. The TUI workspace selector no longer falls back to the first registered workspace when the current `cwd` is not under any registered workspace. It now shows `Needs a registered workspace` and offers `W: Register workspace`.
6. Added `npm run smoke:tui:cli:workspace-register`, backed by `scripts/smoke-opentui-cli-workspace-register.sh`. The smoke starts TUI from a temporary directory, auto-triggers workspace registration, verifies `State: Registered workspace`, `Route: Workspace (Ready)`, the temporary path and the workspace detail panel, then archives the temporary workspace.
7. Temporary workspace cleanup check after the smoke reported `tmpWorkspaceCount: 0`.
8. `npm run test --workspace=@thoth/tui` passed with 5 files and 26 tests, including the unregistered-`cwd` regression.
9. `npm run typecheck --workspace=@thoth/tui` passed.
10. `npm run build --workspace=@thoth/tui` passed.
11. `npm --workspace=@thoth/cli run typecheck` passed.
12. `npm run smoke:tui:renderer` passed and showed `Next Actions`, `W: Register workspace`, `P: Provider setup`, composer Mode/Clarify/Loop and the existing authority guard.
13. `npm run smoke:tui:navigation` passed and showed composer Mode/Loop plus next actions in default `96x34`.
14. `npm run smoke:tui:cli` passed against real Thoth daemon `127.0.0.1:6688`, showing connected Workspace detail and `D: Pair device`.
15. `npm run smoke:tui:cli:recovery` passed against unreachable host `127.0.0.1:1`, showing recovery state without fake connected host state.
16. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:navigation` passed and kept composer Mode/Loop visible in compact layout.
17. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed against `127.0.0.1:6688`.
18. `npm run smoke:isolation` passed: Paseo remained on `127.0.0.1:6767`, Thoth remained on `127.0.0.1:6688`, and PIDs differed.
19. `npm run format:check` passed.
20. `git diff --check` passed.
21. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI now has a real onboarding next-action surface and can register the current `pwd` as a workspace from inside `thoth tui` through daemon authority. This still does not complete provider setup editing inside TUI, relay pairing execution inside TUI, task backend, Clarify runtime, Loop runtime, independent Review runtime, long PTY stress or the full Web/Desktop/OpenTUI UI scorecard.

### `NTH-EV-017` OpenTUI Provider Readiness Action Verification

Status: `passed-for-slice`

Scope:

1. Turn `P providers` from a local-only route shortcut into a real provider readiness action handled by the CLI/client layer.
2. Refresh daemon provider snapshot state through existing provider authority, without adding TUI-owned provider configuration, fake auth checks, hidden LLM/API calls or a fake default model setting.
3. Keep the Providers route honest: show provider readiness/read-only setup state derived from daemon snapshots and tell users to select a model before task loops when no ready model exists.
4. Preserve existing workspace registration, recovery, renderer, navigation, connected CLI and isolation behavior.
5. Verify compact terminal layout still exposes both `W` and `P` next actions after shortening the workspace registration action copy.

Evidence:

1. `packages/tui/src/keyboard.ts` now maps `P` to a `providerSetup` intent instead of a pure `setRoute` action. The TUI package still does not call daemon/provider APIs directly.
2. `packages/tui/src/render.ts` now returns `providerSetup` from the mounted surface so the CLI layer can decide how to handle it.
3. `packages/cli/src/commands/tui.ts` now handles provider setup by opening the Providers route, calling the real daemon client `refreshProvidersSnapshot({ cwd })`, reloading the same surface input path used by refresh, and updating the frame with either `Provider readiness refreshed from daemon` or `Provider snapshot refreshed; select a model before task loops`.
4. Added `--provider-setup-after-render-ms` as a smoke-only automation option for the real `thoth tui` command.
5. Added root `npm run smoke:tui:cli:provider-setup`, backed by `scripts/smoke-opentui-cli-provider-setup.sh`. The smoke runs the real CLI OpenTUI entry under pinned `node-linux-x64@26.4.0 --experimental-ffi`, triggers provider setup, verifies `Route: Providers (...)`, `State: Provider readiness refreshed from daemon` or provider snapshot refresh state, `Host: Connected`, Providers route detail and the authority guard.
6. Provider setup smoke assertions reject `fake configured`, `configured by TUI`, `TUI-only provider`, `127.0.0.1:6767`, `localhost:6767`, `offer=`, `pairingToken` and `thoth-relay-v3-client.` in final frames.
7. `packages/tui/src/surface.ts` now phrases the `P` next action as `Refresh provider readiness from daemon`, and shortens the `W` action to `Create daemon workspace for current pwd` so compact `72x34` frames keep both `W` and `P` visible.
8. `npm run test --workspace=@thoth/tui` passed with 5 files and 26 tests.
9. `npm run typecheck --workspace=@thoth/tui` passed.
10. `npm run build --workspace=@thoth/tui` passed.
11. `npm --workspace=@thoth/cli run typecheck` passed.
12. `npm run smoke:tui:cli:provider-setup` passed against real Thoth daemon `127.0.0.1:6688`, showing `Route: Providers (Available)`, `State: Provider readiness refreshed from daemon`, provider entries from daemon snapshot and the authority guard.
13. `npm run smoke:tui:renderer` passed at default `96x34`.
14. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:renderer` passed and showed both `W: Register workspace - Create daemon workspace for current pwd` and `P: Provider setup - Refresh provider readiness from daemon`.
15. `npm run smoke:tui:navigation` passed.
16. `npm run smoke:tui:cli` passed against real Thoth daemon `127.0.0.1:6688`.
17. `npm run smoke:tui:cli:recovery` passed against unreachable host `127.0.0.1:1`.
18. `npm run smoke:tui:cli:workspace-register` passed; a post-smoke active workspace check reported `tmpWorkspaceCount: 0`.
19. `npm run smoke:isolation` passed: Paseo remained on `127.0.0.1:6767`, Thoth remained on `127.0.0.1:6688`, and the PIDs differed.
20. `npm run format:check` passed.
21. `git diff --check` passed.
22. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI now has a real provider readiness action: pressing `P` refreshes provider state through daemon/client authority and lands users on the Providers route with honest readiness status. This still does not complete provider/model editing or auth setup inside TUI, relay pairing execution inside TUI, task backend, Clarify runtime, Loop runtime, independent Review runtime, long PTY stress or the full Web/Desktop/OpenTUI UI scorecard.

### `NTH-EV-018` OpenTUI Device Pairing Action Verification

Status: `passed-for-slice`

Scope:

1. Turn `D devices` from a local route shortcut into a real daemon pairing action handled by the CLI/client layer.
2. Request a fresh daemon pairing offer through existing daemon authority, which refreshes relay registration before returning the offer.
3. Parse the sensitive daemon offer only inside the CLI layer and pass only safe summary fields into the TUI surface.
4. Keep raw offer URLs, QR payloads, pairing tokens and relay subprotocol tokens out of the TUI model, final frame, smoke output and final report.
5. Preserve existing workspace registration, provider readiness, recovery, renderer, navigation, connected CLI and isolation behavior.

Evidence:

1. `packages/tui/src/keyboard.ts` now maps `D` to a `devicePairing` intent instead of a pure local route action. The TUI package still does not call daemon or relay APIs directly.
2. `packages/tui/src/render.ts` now returns `devicePairing` from the mounted surface so the CLI layer owns the daemon call.
3. `packages/cli/src/commands/tui.ts` now handles device pairing by opening the Connections route, calling real daemon client `getDaemonPairingOffer({ timeout: 5000 })`, parsing the returned offer with `parseConnectionOfferFromUrl`, and injecting only `endpoint` plus `pairingExpiresAt` into the surface input.
4. The TUI Connections route now shows `Pairing offer ready`, `Pairing endpoint`, `Pairing expiry` and `Credential safety: Offer URL, QR and tokens are kept out of the TUI frame`.
5. CLI TUI redaction now scrubs URL `offer=` / `#offer=` material, `pairingToken`, `thoth-relay-v3-client.*`, `thoth.relay.token.*` and URL passwords from recovery/error text before it can enter a TUI frame.
6. Added `--pair-device-after-render-ms` as a smoke-only automation option for the real `thoth tui` command.
7. Added root `npm run smoke:tui:cli:device-pairing`, backed by `scripts/smoke-opentui-cli-device-pairing.sh`. The smoke runs the real CLI OpenTUI entry under pinned `node-linux-x64@26.4.0 --experimental-ffi`, triggers daemon pairing, verifies the Connections route and rejects raw offer/token/QR/legacy-host leakage.
8. `npm run test --workspace=@thoth/tui` passed with 5 files and 28 tests, including `D` key mapping, safe pairing surface state and rendered Connections detail.
9. `npm run typecheck --workspace=@thoth/tui` passed.
10. `npm run build --workspace=@thoth/tui` passed.
11. `npm --workspace=@thoth/cli run typecheck` passed.
12. `npm run smoke:tui:cli:device-pairing` passed against real Thoth daemon `127.0.0.1:6688`, showing `Route: Connections (Offer ready)`, `State: Pairing offer ready for relay.test.thoth.seeles.ai:443; credential hidden`, `Pairing endpoint: relay.test.thoth.seeles.ai:443`, `Pairing expiry: ...` and the credential safety line. The smoke rejects `offer=`, `#offer=`, `pairingToken`, `thoth-relay-v3-client.`, `thoth.relay.token.`, QR text and legacy `6767` hosts.
13. `npm run smoke:tui:renderer` passed at default `96x34`.
14. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:renderer` passed and still showed compact `W` / `P` onboarding actions.
15. `npm run smoke:tui:navigation` passed.
16. `npm run smoke:tui:cli` passed against real Thoth daemon `127.0.0.1:6688`.
17. `npm run smoke:tui:cli:recovery` passed against unreachable host `127.0.0.1:1`.
18. `npm run smoke:tui:cli:workspace-register` passed; a post-smoke active workspace check reported `tmpWorkspaceCount: 0`.
19. `npm run smoke:tui:cli:provider-setup` passed against real Thoth daemon `127.0.0.1:6688`.
20. `npm run smoke:isolation` passed: Paseo remained on `127.0.0.1:6767`, Thoth remained on `127.0.0.1:6688`, and the PIDs differed.
21. `npm run format:check` passed.
22. `git diff --check` passed.
23. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI now has a safe real device pairing action: pressing `D` asks the daemon for a fresh pairing offer, lands users on the Connections route and shows only safe relay endpoint/expiry summary. This still does not complete full paired-device persistence UI, provider/model editing or auth setup inside TUI, task backend, Clarify runtime, Loop runtime, independent Review runtime, long PTY stress or the full Web/Desktop/OpenTUI UI scorecard.

### `NTH-EV-019` Desktop Semantic Menu And UI Scorecard Baseline Verification

Status: `passed-for-slice`

Scope:

1. Move the Desktop application menu away from a generic Electron shell toward Thoth product
   navigation.
2. Add Thoth semantic top-level menus for Desktop without changing daemon lifecycle or claiming
   unimplemented backend actions work.
3. Keep unfinished Workspace, Task and Provider menu targets disabled instead of presenting fake
   behavior.
4. Establish a durable UI scorecard document for the final Web/Desktop/OpenTUI review while marking
   the current score as not passing.

Evidence:

1. `packages/desktop/src/features/menu.ts` now exports `buildApplicationMenuTemplate` and uses
   top-level menus `Thoth`, `File`, `Workspace`, `Task`, `Provider`, `View`, `Window` and `Help`.
2. The generic top-level `Edit` menu was removed; standard editing roles remain under `File` so
   basic desktop edit commands are still present.
3. The new `Workspace`, `Task` and `Provider` menu groups expose final product slots such as
   `Open Workspace...`, `Register Current Workspace`, `New Loop Task`, `Clarify Contract`,
   `Review Evidence`, `Provider Settings`, `Refresh Provider Readiness`, `Select Model` and
   `Permission Mode`, all disabled until the real backing actions are wired.
4. Added `packages/desktop/src/features/menu.test.ts` with an Electron mock. The tests verify the
   Thoth top-level menu order, absence of the generic `Edit` top-level menu, disabled unfinished
   product actions and preserved `File`, `View` and `Window` commands.
5. Added `docs/ui-review-scorecard.md` as a working scorecard and evidence ledger. It records the
   final Web/Desktop/OpenTUI threshold, dimensions, current failing working scores and missing
   screenshot/stress artifacts. It explicitly does not claim final UI acceptance.
6. `npm --workspace=@thoth/desktop run test -- src/features/menu.test.ts` passed with 1 file and
   3 tests.
7. `npm --workspace=@thoth/desktop run typecheck` passed.
8. `npm --workspace=@thoth/desktop run build:main` passed.
9. `npm run format:check` passed.
10. `git diff --check` passed.

Current result:

Desktop now has a Thoth-specific application menu surface and the project has a durable working UI
scorecard. This still does not complete Web/Desktop/OpenTUI final UI acceptance: current scorecard
status is failing until fresh screenshots, Playwright UI stress, Desktop smoke, OpenTUI PTY stress,
full endpoint score evidence and final thresholds are satisfied.

## Failed Or Not-Yet-Passed Checks

1. No runtime MVP check exists yet because task authority, provider-backed Router, Clarify, PlanExec, Review, daemon orchestration, TUI, desktop and mobile product behavior are not implemented.
2. Full daemon/app/desktop/CLI/driver build and test suites are still outside the foundation gate and may remain expected-broken until their dedicated migration milestones.
3. Some old `.tmp_pytest` fixture entries could not be unlinked promptly on NFS and were moved under ignored `.agent-os/.trash/tmp_pytest-nfs-stale-20260628`; this is not part of the committed source tree.
4. Android build currently emits upstream Expo/React Native/Gradle deprecation warnings; the Debug APK is still produced successfully.
5. Real iOS build was not run because the current environment is Linux and lacks macOS/Xcode.
6. The Code4Agent hosted relay preview path was abandoned after protected-path blockers; independent `SeeleAI/Thoth-Relay` is now the verified test relay authority.
