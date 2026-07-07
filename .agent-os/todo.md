# TODO

## Backlog

1. `NTH-TD-018` `[backlog]`: Loop Goal 4, frontend Task / Pyramid Plan Approval Experience.
   - Goal: Render Task Card and Pyramid Plan Card as clear, lightweight secretary-prepared approval artifacts that users can approve, modify, cancel or keep in Quick without understanding schemas.
   - Constraints: Cards stay compact; Pyramid Plan Card shows target / stages / subgoals / acceptance evidence, not execution steps; edits return to agent harness; confirmation returns to Workspace Secretary and Quick remains available.
   - Acceptance: Task Card supports register, keep Quick, modify and cancel; modified Task Card regenerates through agent harness; Pyramid Plan Card supports confirm, modify and cancel; confirmation shows Registered Card/background link; E2E covers card modify/cancel/confirm and return to Quick.
   - Depends on: `NTH-TD-017`
   - Related: `NTH-MS-015`, `NTH-CD-027`, `NTH-CD-030`
2. `NTH-TD-019` `[backlog]`: Loop Goal 5, backend Loop Execution and Review Agent Harness.
   - Goal: Implement `thoth.loop` harness so PlanExec and Review provider sessions execute from frozen contracts, request permissions, produce evidence, self-advance, receive independent review and generate non-repeating retry guidance.
   - Constraints: PlanExec advances only current goal; high-risk actions require permission; Review is independent and cannot modify workspace; Review judges evidence against acceptance; retry must change strategy.
   - Acceptance: `thoth.loop` prompt contract and PlanExec/Review/retry rubrics exist; harness covers single-goal success, current-goal isolation, permission request, frozen-contract defaulting, Review pass/fail, retry strategy change, Review no-modify boundary, task blocked and task done evidence summary; Loop golden data and independent `codex exec` judge evidence prove PlanExec/Review/retry behavior follows frozen contract, acceptance evidence and non-repeating strategy instead of mechanically running commands.
   - Depends on: `NTH-TD-018`
   - Related: `NTH-MS-016`, `NTH-CD-027`, `NTH-CD-030`, `NTH-CD-031`
3. `NTH-TD-020` `[backlog]`: Loop Goal 6, frontend loop/task dogfood mapping on the Paseo app surface.
   - Goal: Integrate Clarify, Contract, Loop and Review harness outputs into a user-visible MVP dogfood loop using the restored Paseo session/workspace/task/detail view system as the frontend substrate.
   - Constraints: Do not create a separate Background Tasks toy main view; default display is CEO-readable; permission requests emphasize risk and decision; done shows evidence summary; blocked explains the user's next decision; no token/credential/`6767` leakage; TUI is out of this APP MVP loop.
   - Acceptance: Dogfood smoke covers Settings capability state, session/workspace Clarify, Task Card approval, Pyramid Plan Card approval, registered task surfaced in the restored task/detail system, running current goal, stream expansion, permission handling, Review status, retry round, passed goal, done/blocked state and no internal packet/skill/provider-role exposure.
   - Depends on: `NTH-TD-019`
   - Related: `NTH-MS-017`, `NTH-CD-027`, `NTH-CD-030`
4. `NTH-TD-003` `[backlog]`: Write the first SQLite authority schema and migration policy.
   - Related: `NTH-MS-002`, `NTH-REQ-002`, `NTH-REQ-004`
5. `NTH-TD-004` `[backlog]`: Design the first Claude Code, Codex and ACP driver capability contract.
   - Related: `NTH-MS-004`, `NTH-REQ-005`
6. `NTH-TD-006` `[backlog]`: Design E2EE relay deployment path for Cloudflare prototype and seeles.ai hosted/self-hosted service.
   - Related: `NTH-MS-005`, `NTH-REQ-006`
7. `NTH-TD-007` `[backlog]`: Design the Paseo-like release and packaging pipeline for Thoth.
   - Scope: tag-triggered GitHub Actions, desktop installer builds for macOS/Linux/Windows, Android APK builds through Expo/EAS, GitHub Release upload behavior, web/app deploy target, relay deploy target, signing/secrets requirements and iOS TestFlight/App Store distribution policy.
   - Related: `NTH-MS-006`, `NTH-REQ-010`, `NTH-CD-011`

## Ready

1. `NTH-TD-002` `[ready]`: Umbrella MVP implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle without reintroducing archived plugin runtime compatibility.
   - Scope: include a stable Thoth I human dogfood entry whose development build uses the same UI/UX as the releasable product UI; agents validate code through standard repository tests and gates.
   - Operational decomposition: execute `NTH-TD-015` through `NTH-TD-020` in order instead of treating this as one large loop.
   - Related: `NTH-MS-002`, `NTH-MS-003`, `NTH-REQ-001`, `NTH-REQ-002`, `NTH-REQ-017`
2. `NTH-TD-017` `[ready]`: Loop Goal 3, backend Task Contract Compiler and Approval Harness.
   - Goal: Compile converged Clarify output into CEO-readable Task Card and Pyramid Plan Card authority without turning either into a hidden implementation plan.
   - Unblocked by: `NTH-EV-029` verified the restored Paseo surface, Codex runtime-tool Clarify bridge, AgentTimeline cards, Quick+none bare stream, Quick+Dive same-session quick_exec and Loop registered_pending path.
   - Related: `NTH-MS-014`, `NTH-CD-027`, `NTH-CD-030`, `NTH-CD-041`, `NTH-CD-042`, `NTH-CD-043`
3. `NTH-TD-010` `[ready]`: Run remaining dependency and compile triage on the non-foundation promoted source substrate.
   - Scope: resolve package-lock/dependency inconsistencies, remove or quarantine remaining broad-source voice references, decide first buildable package order, and record exact compile blockers without claiming runtime readiness.
   - Related: `NTH-MS-008`, `NTH-REQ-011`, `NTH-REQ-015`

## Doing

None.

## Blocked

None.

## Done

1. `NTH-TD-001` `[done]`: Reset the active working tree from archived plugin runtime to Thoth monorepo skeleton.
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
4. `NTH-TD-015` `[verified]`: Loop Goal 1, backend Clarify Agent Harness and Convergence Contract.
   - Scope: Implemented standard `thoth.clarify` `SKILL.md` artifact as canonical source, reserved
     `thoth.loop` `SKILL.md`, session-scoped runtime skill mount/no-global-install contract,
     compact normal/transition/repair input packets with controls/effective clarify strength,
     mechanical transition table, `C_ASK` multi-question card plus internal meta schemas,
     answer/provenance schemas, 21-case golden dataset including `none` / `light` / `balanced` /
     `dive` behavior differences, deterministic eval harness, independent `codex exec` golden judge
     and independent `codex exec` user simulation judge.
   - Related: `NTH-MS-012`, `NTH-CD-027`, `NTH-CD-028`, `NTH-CD-030`, `NTH-CD-031`,
     `NTH-CD-032`, `NTH-CD-033`, `NTH-CD-034`, `NTH-CD-035`
   - Verification: See `NTH-EV-025`.
5. `NTH-TD-016` `[verified]`: Loop Goal 2, Runtime Tool Bridge + AgentTimeline Workspace Secretary Clarify Experience.
   - Scope: Restored the Paseo production app surface as the main path, connected Provider / Clarify / Mode controls, implemented Codex app-server `dynamicTools` semantic Thoth runtime tools for Clarify / Task / Pyramid / blocked, persisted pending authority decisions, rendered Clarify / Task / Pyramid / registered-task cards inside AgentTimeline, preserved Quick+none as bare provider stream, continued Quick approvals into same-session `quick_exec`, and registered Loop approvals as durable `registered_pending` without fake PlanExec / Review.
   - Related: `NTH-MS-013`, `NTH-CD-039`, `NTH-CD-040`, `NTH-CD-041`, `NTH-CD-042`, `NTH-CD-043`
   - Verification: See `NTH-EV-029`.

## Abandoned

1. `NTH-TD-013` `[abandoned]`: Deploy Thoth relay preview through Code4Agent feature workflow and validate a hosted `.seele.chat` relay URL.
   - Reason: Code4Agent active `protected-paths` push ruleset restricted `.github/**/*` and `**/*/wrangler.jsonc`; the user then explicitly moved relay deployment authority to a new independent repository. The working test relay is now `SeeleAI/Thoth-Relay` at `relay.test.thoth.seeles.ai`.
   - Historical evidence: See `NTH-EV-005` and `NTH-EXP-005`.
   - Related: `NTH-MS-010`, `NTH-CD-021`, `NTH-CD-022`
