# Project Index

## Current Truth

1. Objective: `NTH-OBJ-001`
2. Top next action: `NTH-TD-010`
3. Active workstreams: `NTH-WS-001`, `NTH-WS-002`, `NTH-WS-003`, `NTH-WS-004`, `NTH-WS-006`
4. Active blockers: None
5. Current branch: `port/from-old-thoth-plugin`
6. Current implementation state: promoted upstream-derived implementation substrate in formal `packages/*` source trees; expected broken and not runnable

## Objective Summary

`NTH-OBJ-001`: Build New Thoth as a local-first AI task control plane that reduces user cognitive burden and entry barrier, compiles vague intent into clear tasks, runs recoverable asynchronous loops, verifies results with evidence, and remains host-neutral across future harness tools.

## Active Workstreams

1. `NTH-WS-001` `[active]`: Preserve New Thoth product authority and decision boundaries.
2. `NTH-WS-002` `[active]`: Establish the TypeScript / Node monorepo skeleton.
3. `NTH-WS-003` `[active]`: Design the clarify-to-task and aggressive loop runtime before implementation.
4. `NTH-WS-004` `[active]`: Keep harness, relay, mobile, desktop, TUI and ACP references current enough for implementation.
5. `NTH-WS-006` `[active]`: Preserve upstream provenance while converting imported material into New Thoth formal source.

## Top Next Action

`NTH-TD-010` `[ready]`: Run dependency and compile triage on the promoted source substrate without changing New Thoth product goals.

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

## Read Next

1. [requirements.md](requirements.md)
2. [architecture-milestones.md](architecture-milestones.md)
3. [todo.md](todo.md)
4. [run-log.md](run-log.md)
5. [designs/最核心的设计理念.md](designs/最核心的设计理念.md)
