# Architecture Milestones

## Current Architecture State

Current state is promoted source substrate with first-day foundation infrastructure. It is still not a runnable New Thoth product.

1. Root package manager: `npm workspaces`.
2. Runtime language direction: TypeScript / Node.
3. Package namespace: `@thoth/*`.
4. License: `AGPL-3.0-or-later`.
5. Active package layout:
   - `packages/protocol`
   - `packages/client`
   - `packages/core`
   - `packages/daemon`
   - `packages/drivers`
   - `packages/tui`
   - `packages/app`
   - `packages/desktop`
   - `packages/relay`
   - `packages/cli`
6. Formal package source trees contain promoted upstream-derived implementation substrate.
7. No tracked `_paseo/` directories should remain after `NTH-MS-008`.
8. Foundation packages now have a required green gate: `packages/app/highlight`, `packages/relay`, `packages/protocol` and `packages/client`.
9. Android Debug APK packaging is available as a local infrastructure artifact through root scripts.
10. Daemon, broader app, desktop, CLI and drivers may still be expected-broken until their dedicated migration milestones.

## Workstreams

1. `NTH-WS-001`: Product authority and decision preservation.
2. `NTH-WS-002`: Monorepo skeleton and metadata.
3. `NTH-WS-003`: Clarify, provider-backed Router, task contract and loop runtime design.
4. `NTH-WS-004`: Harness, ACP, relay and multi-device implementation research.
5. `NTH-WS-005`: Release, packaging and deployment automation.
6. `NTH-WS-006`: Upstream implementation seed import and migration substrate.

## Milestones

### `NTH-MS-001` Repo Reset

State: `done`

Goal: Remove old plugin runtime from the active working tree and establish the New Thoth skeleton.

Acceptance:

1. Old Python/plugin/runtime paths are gone.
2. `packages/` contains exactly the 10 approved packages.
3. Root metadata reflects `npm workspaces` and the current active license.
4. Recovery docs explain current truth.

### `NTH-MS-002` Authority And Router Slice

State: `ready`

Goal: Design and implement the first real New Thoth slice: local authority store, explicit task mode, provider-backed Router, workspace registry and loop task draft creation.

Acceptance:

1. `quick` and `loop` task modes exist as real protocol inputs.
2. `hi`-level input in `quick` mode stays under the `10s` user-perceived response target.
3. Provider-backed high-confidence workspace context can resolve without defensive confirmation.
4. Low-confidence workspace writes are blocked by one golden question.

### `NTH-MS-003` Clarify-To-Contract Slice

State: `backlog`

Goal: Implement the private-secretary clarify flow and contract freeze model.

Acceptance:

1. Clarify asks only material golden questions.
2. Agent-discoverable facts are not pushed back to the user.
3. Loop task readiness requires goal, constraints, risk and acceptance.

### `NTH-MS-004` Attempt Loop Slice

State: `backlog`

Goal: Implement Plan -> Execute -> Review attempts with aggressive retry policy.

Acceptance:

1. Review cannot modify files.
2. Failed review produces a non-repeating next attempt focus.
3. Default max failed attempts is 3.
4. Success requires evidence tied to frozen acceptance.

### `NTH-MS-005` Multi-Surface Skeleton Activation

State: `backlog`

Goal: Add first runnable TUI, desktop/mobile client and relay paths after authority loop semantics are stable.

Acceptance:

1. UI shells use the same protocol and authority.
2. TUI uses OpenTUI.
3. Mobile remains read-only when offline.
4. Relay remains zero-knowledge E2EE transport only.

### `NTH-MS-006` Release And Packaging Pipeline

State: `backlog`

Goal: Add a Paseo-like release and packaging pipeline after the runnable surfaces exist.

Acceptance:

1. Release package workflows are triggered by version/platform tags or manual GitHub Actions dispatch, not ordinary branch pushes.
2. Desktop packaging builds macOS, Linux and Windows installers through Electron Builder or an equivalent desktop packager.
3. Android APK builds run through Expo/EAS or an equivalent mobile build service and upload installable APK artifacts to GitHub Releases.
4. Web/app and relay deployment workflows are explicit and separately triggerable.
5. iOS distribution is handled through TestFlight/App Store/EAS submit or another Apple-approved path, not by assuming a GitHub Release IPA can be self-installed by normal users.
6. Required signing, notarization, Expo, Apple, Cloudflare and GitHub secrets are documented before enabling publish-by-tag.

### `NTH-MS-007` Upstream Implementation Seed Import

State: `done`

Goal: Import broad upstream implementation seed material into tracked package-local `_paseo/` directories while keeping raw cache ignored, provenance explicit and runtime behavior unwired.

Acceptance:

1. Raw upstream cache is local-only, ignored and tied to a recorded commit SHA.
2. Tracked seed directories exist under the approved package set only.
3. Voice, audio, speech and dictation material is excluded.
4. Root workspaces and scripts are not widened to match upstream.
5. Seed code is documented as expected-broken until future migration tasks digest it.

### `NTH-MS-008` Promote Seed To Formal Source

State: `done`

Goal: Move tracked `_paseo` implementation seed material into formal package source trees, delete `_paseo`, and preserve Thoth package identity without claiming runtime readiness.

Acceptance:

1. No tracked `_paseo` paths remain.
2. Formal `packages/*` source trees contain the promoted implementation substrate.
3. Root workspace boundary remains `packages/*` with exactly 10 formal packages.
4. Formal packages keep `@thoth/*`, `private: true`, `AGPL-3.0-or-later` and version `0.0.0`.
5. `packages/app/highlight` remains nested and does not become an 11th workspace package.
6. Expected broken compile state is documented.

### `NTH-MS-009` Development Infrastructure Gate

State: `done`

Goal: Establish the first-day development infrastructure that lets future agents develop from stable commands, package contracts, docs and local packaging evidence.

Acceptance:

1. Root `npm install` is stable under the project install policy.
2. Root validation scripts cover package boundaries, package metadata, AGENTS/CLAUDE links, docs, install policy, generated/raw path hygiene, voice/audio config residue and secret-like content.
3. `npm run check:foundation` passes.
4. Android local toolchain is installed under ignored `.dev/` and `npm run package:android:debug-apk` produces a real Debug APK.
5. iOS scripts behave truthfully on Linux by reporting the macOS/Xcode requirement.
6. Root and all 10 packages have local agent contracts.
7. Development, testing, packaging and release docs exist under `docs/`.
