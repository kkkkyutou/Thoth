# Architecture Milestones

## Current Architecture State

Current state is a skeleton, not an implementation.

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
6. Formal `src/` directories do not contain business implementation.
7. `_paseo/` directories may contain non-runnable implementation seed material that is not wired into package exports.

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
