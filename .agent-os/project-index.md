# Project Index

## Current Truth

1. Objective: `NTH-OBJ-001`
2. Top next action: `NTH-TD-002`
3. Active workstreams: `NTH-WS-001`, `NTH-WS-002`, `NTH-WS-003`, `NTH-WS-004`, `NTH-WS-005`, `NTH-WS-006`
4. Active blockers: None
5. Current branch: `agent/dev/ui`
6. Current implementation state: promoted upstream-derived implementation substrate in formal `packages/*` source trees with first-day foundation infrastructure; Thoth/Paseo parallel runtime isolation is verified with Thoth daemon on `127.0.0.1:6688`, local Paseo daemon preserved on `127.0.0.1:6767`, real web review on `8082 -> 8148`, independent test relay deployment at `relay.test.thoth.seeles.ai`, Linux AppImage, Android Debug APK and Codex provider smoke. The latest web workspace white-screen regression is fixed, the Web/Desktop app now has first Workspace composer/task/evidence UI slots, and `packages/tui` now has a first OpenTUI render layer plus reproducible Node `26.4.0` FFI renderer smoke. New Thoth product behavior is still not implemented.

## Objective Summary

`NTH-OBJ-001`: Build New Thoth as a local-first AI task control plane that reduces user cognitive burden and entry barrier, compiles vague intent into clear tasks, runs recoverable asynchronous loops, verifies results with evidence, and remains host-neutral across future harness tools.

## Active Workstreams

1. `NTH-WS-001` `[active]`: Preserve New Thoth product authority and decision boundaries.
2. `NTH-WS-002` `[active]`: Establish the TypeScript / Node monorepo skeleton.
3. `NTH-WS-003` `[active]`: Design the clarify-to-task and aggressive loop runtime before implementation.
4. `NTH-WS-004` `[active]`: Keep harness, relay, mobile, desktop, TUI and ACP references current enough for implementation.
5. `NTH-WS-005` `[active]`: Maintain packaging and release infrastructure without publishing.
6. `NTH-WS-006` `[active]`: Preserve upstream provenance while converting imported material into New Thoth formal source.

## Top Next Action

`NTH-TD-002` `[ready]`: Design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle without reintroducing old plugin runtime compatibility.

## Active Blockers

None.

## Recent Important Changes

1. `NTH-CD-001`: User decided New Thoth will not continue old plugin compatibility. The old plugin line is archived at release `thoth-plugin-final-archive` and branch `archive/main-20260627`.
2. `NTH-CD-002`: User approved a full repo reset on `port/from-old-thoth-plugin`: delete old Python/plugin runtime, keep only design authority and a TypeScript / Node monorepo skeleton.
3. `NTH-CD-003`: User initially selected `GPL-3.0-only`, `npm workspaces`, package namespace `@thoth/*`, and OpenTUI as the fixed TUI framework; the license portion is superseded by `NTH-CD-017`.
4. `NTH-CD-004`: User selected docs-only prompt seed extraction. Old prompt assets are summarized in `.agent-os/designs/new-thoth-prompt-contract-seeds.md`, not retained as Python code.
5. `NTH-CD-012`: User clarified that Thoth is not a harness tool or hidden LLM API wrapper. All AI and agent execution must come from configured provider sessions through ACP, harness runtime, app-server, official harness SDK/control surface or local harness CLI.
6. `NTH-CD-013`: User clarified that zero-shot semantic routing cannot be local deterministic logic. Task mode should be explicit in the composer or judged by a provider-backed session; local code can only enforce explicit controls and mechanical authority checks.
7. `NTH-CD-014`: User locked the chatbox controls as `+`, Provider, Mode, Clarify and Loop.
8. `NTH-CD-015`: User updated the business flow: `Quick + Don't Bother Me` is provider passthrough; `Loop` is read-only Clarify -> frozen contract -> one PlanExec provider session using provider-native plan mode when available -> independent Review. PlanExec clarification questions after freeze are auto-answered from the contract or first recommendation, but permission requests still follow permission policy. User-facing labels are `Don't Bother Me`, `One Plan, One Do` and `Run Until Stopped`.
9. `NTH-CD-017`: User selected AGPL for New Thoth, upstream implementation seed import from the latest GitHub source, no Multica source copy, ignored raw cache under `.agent-os/upstreams/`, tracked broken `_paseo/` seeds and no voice/audio/speech/dictation material.
10. `NTH-EV-002`: AGPL and upstream seed import verification passed for metadata, ignored raw cache, seed directories, path exclusions, large-file hygiene, secret-like scan, package-lock refresh and `git diff --check`.
11. `NTH-CD-018`: User approved promoting all tracked `_paseo` implementation seeds into formal package source trees, deleting `_paseo`, preserving the 10 package boundary, keeping `packages/app/highlight` nested, refreshing the lockfile, and accepting expected broken compile.
12. `NTH-EV-003`: `_paseo` promotion verification passed for structure, metadata, lockfile refresh, ignored raw cache, package/config voice-residue scan, generated/cache scan, package-boundary scan, secret-like scan and `git diff --check`.
13. `NTH-CD-019`: First-day development infrastructure is locked: Node `24.14.0`, npm `11.9.0`, root-script gates, `oxfmt`/`oxlint`, foundation packages, stable install policy, local Android Debug APK, Linux-safe iOS scripts, package AGENTS contracts and no push/publish/GitHub Actions in this round.
14. `NTH-EV-004`: First-day development infrastructure verification passed: `npm install`, `npm run check:foundation`, Android doctor/toolchain/APK, iOS Linux behavior, AGENTS symlink coverage, generated path hygiene and `git diff --check`.
15. `NTH-CD-020`: Thoth I dev UI must be the same user experience as the current releasable full UI. Humans use it for dogfood/review; agents use standard repository tests and gates for code validation.
16. `NTH-CD-021`: Relay is v3-only with daemon-first room registration and role-scoped subprotocol tokens; local web preview and 200-client local relay load test passed, while the earlier Code4Agent mirror deployment path was blocked by protected paths.
17. `NTH-CD-022`: Runtime isolation is locked and verified: Thoth uses `127.0.0.1:6688`, local Paseo/legacy keeps `127.0.0.1:6767`, human web review uses `8082 -> 8148`, relay test service is deployed from independent `SeeleAI/Thoth-Relay`, and local desktop/mobile artifacts are produced without becoming releases.
18. `NTH-EV-006`: Thoth/Paseo isolation verification passed for daemon ports, web smoke, relay health/action/load test, Codex provider smoke, desktop AppImage smoke, Android Debug APK permission/package identity, foundation gate and git hygiene.
19. `NTH-EV-007`: Web workspace white-screen regression is fixed. Workspace navigation and `hi` submission no longer crash the browser; the route now surfaces the expected current `Select model` validation.
20. `NTH-CD-024`: Thoth UI icon system is locked to the final single-version `05-arcade-inventory` set under `packages/app/assets/icons/arcade-inventory/`.
21. `NTH-CD-025`: UI development branch is renamed from `port/from-old-thoth-plugin` to `agent/dev/ui` before pushing the current UI shell/icon/runtime work.
22. `NTH-EV-008`: One Thoth Web/Desktop shared shell slice passed for the current scope. The real open-project entry now uses the locked transparent arcade-inventory PNG icon set, presents One Thoth / task control plane product language, shows honest workspace/provider/relay/review states, and preserves existing Add project, Import session, Provider setup and Pair device flows. This does not complete OpenTUI or the full task/Clarify/Loop UI productization goal.
23. `NTH-EV-009`: Workspace composer/task surface slice passed for the current scope. The web bundle now contains fixed Thoth-level composer controls for `+`, Provider, Mode, Clarify and Loop, honest preview/needs-provider states, Workspace active-task/contract/evidence slots and the MVP `10MB` attachment limit. This does not implement provider-backed Router, Clarify runtime, contract freeze, PlanExec, Review or OpenTUI.
24. `NTH-EV-010`: OpenTUI shell surface foundation passed for the current scope. `packages/tui` now derives Home, Workspace, Task / Loop, Providers, Connections, Evidence / Review and Settings / About slots from shared client/protocol shapes, has a guarded `@opentui/core` renderer factory, and truthfully reports the locked Node `24.14.0` runtime as unable to create the native renderer without Node `26.3.0+` plus experimental FFI or a future Bun decision. This does not complete the interactive native TUI app or the Node FFI vs Bun runtime spike.
25. `NTH-EV-011`: OpenTUI renderer smoke now has a reproducible root-script path. `npm run smoke:tui:renderer` builds `@thoth/tui`, runs `@opentui/core/testing` under pinned `node-linux-x64@26.4.0 --experimental-ffi`, renders the One Thoth TUI surface, captures a character frame and verifies the Home/Workspace/Task/Providers/Connections/Evidence/Settings/composer/authority text. Narrow `72x34`, default `96x34` and wide `132x34` smoke runs passed. This does not complete the interactive CLI workspace TUI or daemon-connected TUI flow.

## Read Next

1. [requirements.md](requirements.md)
2. [architecture-milestones.md](architecture-milestones.md)
3. [todo.md](todo.md)
4. [run-log.md](run-log.md)
5. [designs/最核心的设计理念.md](designs/最核心的设计理念.md)
