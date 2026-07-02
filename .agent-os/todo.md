# TODO

## Backlog

1. `NTH-TD-003` `[backlog]`: Write the first SQLite authority schema and migration policy.
   - Related: `NTH-MS-002`, `NTH-REQ-002`, `NTH-REQ-004`
2. `NTH-TD-004` `[backlog]`: Design the first Claude Code, Codex and ACP driver capability contract.
   - Related: `NTH-MS-004`, `NTH-REQ-005`
3. `NTH-TD-006` `[backlog]`: Design E2EE relay deployment path for Cloudflare prototype and seeles.ai hosted/self-hosted service.
   - Related: `NTH-MS-005`, `NTH-REQ-006`
4. `NTH-TD-007` `[backlog]`: Design the Paseo-like release and packaging pipeline for New Thoth.
   - Scope: tag-triggered GitHub Actions, desktop installer builds for macOS/Linux/Windows, Android APK builds through Expo/EAS, GitHub Release upload behavior, web/app deploy target, relay deploy target, signing/secrets requirements and iOS TestFlight/App Store distribution policy.
   - Related: `NTH-MS-006`, `NTH-REQ-010`, `NTH-CD-011`

## Ready

1. `NTH-TD-002` `[ready]`: Design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle without reintroducing old plugin runtime compatibility.
   - Scope: include a stable Thoth I human dogfood entry whose development build uses the same UI/UX as the releasable product UI; agents validate code through standard repository tests and gates.
   - Related: `NTH-MS-002`, `NTH-MS-003`, `NTH-REQ-001`, `NTH-REQ-002`, `NTH-REQ-017`
2. `NTH-TD-010` `[ready]`: Run remaining dependency and compile triage on the non-foundation promoted source substrate.
   - Scope: resolve package-lock/dependency inconsistencies, remove or quarantine remaining broad-source voice references, decide first buildable package order, and record exact compile blockers without claiming runtime readiness.
   - Related: `NTH-MS-008`, `NTH-REQ-011`, `NTH-REQ-015`

## Doing

None.

## Blocked

None.

## Done

1. `NTH-TD-001` `[done]`: Reset the active working tree from old plugin runtime to New Thoth monorepo skeleton.
   - Related: `NTH-MS-001`
   - Verification: See `NTH-EV-001` after reset checks.
2. `NTH-TD-008` `[done]`: Adopt AGPL policy and import upstream implementation seed material into ignored raw cache plus tracked `_paseo/` seed directories.
   - Related: `NTH-MS-007`, `NTH-REQ-015`, `NTH-CD-017`
   - Verification: See `NTH-EV-002`.
3. `NTH-TD-009` `[done]`: Promote tracked `_paseo` implementation seeds into formal package source trees and delete `_paseo`.
   - Related: `NTH-MS-008`, `NTH-CD-018`
   - Verification: See `NTH-EV-003`.
4. `NTH-TD-005` `[done]`: Run an OpenTUI spike to decide Node FFI vs Bun runtime for `packages/tui`.
   - Result: Current reproducible renderer smoke path uses pinned `node-linux-x64@26.4.0` with `--experimental-ffi` through the root `smoke:tui:renderer` script. The locked repository developer toolchain remains Node `24.14.0`; Bun was not selected because the npm `bun` package requires postinstall under the current install policy and `@oven/bun-linux-x64` did not expose a `bun` executable through `npm exec`.
   - Related: `NTH-MS-005`, `NTH-REQ-007`
   - Verification: See `NTH-EV-011`.

## Verified

1. `NTH-TD-011` `[verified]`: Add first-day development infrastructure for long-running agent development.
   - Scope: root validation scripts, foundation build/typecheck/test gate, `oxfmt`/`oxlint`, stable npm install policy, package AGENTS contracts, docs, local Android Debug APK packaging, iOS Linux-safe scripts and `.agent-os` bookkeeping.
   - Related: `NTH-MS-009`, `NTH-CD-019`, `NTH-REQ-016`
   - Verification: See `NTH-EV-004`.
2. `NTH-TD-012` `[verified]`: Harden relay v3 security locally and provide a real web preview build.
   - Scope: v3-only relay protocol, subprotocol token transport, room registration hashes, pairing/device token path, strict origin and parameter validation, seeles relay/app defaults, local Code4Agent mirror export script, web export and local static serve.
   - Related: `NTH-MS-010`, `NTH-CD-021`
   - Verification: See `NTH-EV-005`.
3. `NTH-TD-014` `[verified]`: Isolate Thoth runtime from the local Paseo daemon and prove daemon, relay, web app, desktop app, Android app and Codex provider smoke can run side by side.
   - Scope: Thoth direct daemon defaults to `127.0.0.1:6688`; local Paseo/legacy `127.0.0.1:6767` remains untouched; real web review serves at `8082 -> 8148`; independent `SeeleAI/Thoth-Relay` deploys `relay.test.thoth.seeles.ai`; Linux AppImage and Android Debug APK are produced; Codex provider smoke runs through Thoth paths.
   - Related: `NTH-MS-010`, `NTH-MS-011`, `NTH-CD-022`
   - Verification: See `NTH-EV-006`.

## Abandoned

1. `NTH-TD-013` `[abandoned]`: Deploy Thoth relay preview through Code4Agent feature workflow and validate a hosted `.seele.chat` relay URL.
   - Reason: Code4Agent active `protected-paths` push ruleset restricted `.github/**/*` and `**/*/wrangler.jsonc`; the user then explicitly moved relay deployment authority to a new independent repository. The working test relay is now `SeeleAI/Thoth-Relay` at `relay.test.thoth.seeles.ai`.
   - Historical evidence: See `NTH-EV-005` and `NTH-EXP-005`.
   - Related: `NTH-MS-010`, `NTH-CD-021`, `NTH-CD-022`
