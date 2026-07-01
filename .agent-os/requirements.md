# Requirements

## Objective

`NTH-OBJ-001`: New Thoth must become a host-neutral task control plane for AI work. It should behave like a reliable private secretary for a high-authority user: remember context, understand vague intent, ask only the important golden questions, register durable tasks when needed, run asynchronous loops, and report results with evidence.

## Goals

1. `NTH-REQ-001`: Reduce user cognitive burden and entry barrier as the first design principle.
2. `NTH-REQ-002`: Compile natural-language intent into clear task contracts with goal, non-goals, constraints, assumptions, risks and acceptance.
3. `NTH-REQ-003`: Treat `Loop` tasks as recoverable, reviewable, long-running loops rather than one-off agent runs.
4. `NTH-REQ-004`: Make success depend on frozen acceptance and evidence, not executor self-report.
5. `NTH-REQ-005`: Keep Thoth host-neutral across Claude Code, Codex, ACP-compatible tools and future harnesses.
6. `NTH-REQ-006`: Keep UI shells thin. TUI, desktop app, mobile app and CLI must see the same authority.
7. `NTH-REQ-007`: Use OpenTUI for the TUI shell.
8. `NTH-REQ-008`: Use a TypeScript / Node monorepo for the new runtime. The new core must not use Python as the main product runtime.
9. `NTH-REQ-009`: Preserve old plugin history through archive release and archive branch, not through legacy code in the active working tree.
10. `NTH-REQ-010`: After runnable surfaces exist, provide a Paseo-like release and packaging pipeline based on explicit release tags and GitHub Actions. It should produce desktop installers, Android APK artifacts and deployable web/relay surfaces, while treating iOS distribution as a TestFlight/App Store/EAS submit path rather than ordinary IPA self-install.
11. `NTH-REQ-011`: Keep Thoth as a control plane, not a harness or direct LLM client. All AI execution must occur through configured provider sessions via ACP, harness runtime, app-server, official harness SDK/control surface or local harness CLI.
12. `NTH-REQ-012`: Keep semantic routing provider-backed or user-selected. The product exposes explicit controls for `Quick` versus `Loop`, clarification strength and loop strength, but Thoth core/daemon must not classify natural-language intent with local heuristic rules.
13. `NTH-REQ-013`: Use the locked chatbox composer controls: `+`, Provider, Mode, Clarify and Loop. Provider owns model/runtime/permission/fast settings; Clarify has five levels: `auto`, `Don't Bother Me`, `light`, `Balanced`, `deep`; Loop has five levels: `auto`, `One Plan, One Do`, `light`, `balanced`, `Run Until Stopped`; `Run Until Stopped` must be visually high-risk, high-cost and manually stopped.
14. `NTH-REQ-014`: Use provider-native sessions for the business flow. `Quick + Don't Bother Me` is a provider passthrough path. `Loop` uses read-only Clarify, frozen contract, one PlanExec provider session with provider-native plan mode when available, and independent Review. Visible provider output must stream to clients in real time. PlanExec clarification questions after contract freeze are auto-answered from the frozen contract or first recommended option, while provider permission requests still obey permission policy.
15. `NTH-REQ-015`: Use `AGPL-3.0-or-later` for New Thoth and allow upstream-derived implementation seed material only when provenance, license, commit SHA, exclusion policy and expected broken state are recorded. Multica source code must not be copied into this repository.
16. `NTH-REQ-016`: Maintain first-day development infrastructure before feature work: stable npm install, root-script validation gates, foundation build/typecheck/test coverage, local Android Debug APK packaging, Linux-safe iOS script behavior, package-level agent contracts and executable development/testing/packaging/release docs.
17. `NTH-REQ-017`: Provide a stable human dogfood entry for Thoth I whose UI and experience match the current releasable full UI. Development mode may change runtime wiring, logs, local daemon targets or provider configuration, but it must not change the user-facing flow, layout, copy, states or task experience into a separate debug product.

## Acceptance Criteria

1. `NTH-AC-001`: The active working tree no longer contains old Python runtime, plugin projection, dashboard template, Textual TUI or old tests.
2. `NTH-AC-002`: The active working tree contains exactly the 10 approved package skeletons under `packages/`.
3. `NTH-AC-003`: Root and package metadata use `AGPL-3.0-or-later`, package version `0.0.0`, and `npm workspaces`.
4. `NTH-AC-004`: The recovery path from `AGENTS.md` to `.agent-os/project-index.md` to `.agent-os/todo.md` can explain the current New Thoth state without the chat transcript.
5. `NTH-AC-005`: The canonical design set is present under `.agent-os/designs/`.
6. `NTH-AC-006`: The old plugin archive release and branch are documented for traceability.
7. `NTH-AC-007`: No document claims the current checkout provides a runnable Thoth product.
8. `NTH-AC-008`: `npm run check:foundation` passes through repo validation, formatting, foundation lint, foundation build, foundation typecheck and foundation tests.
9. `NTH-AC-009`: `npm run package:android:debug-apk` produces a real local Debug APK and records its absolute path, sha256 and byte size without committing the APK or generated native project.
10. `NTH-AC-010`: Root plus all 10 packages have local `AGENTS.md` files, and every `CLAUDE.md` is a symlink to the matching `AGENTS.md`.
11. `NTH-AC-011`: Once the Thoth I dev entry exists, human review enters the same UI component tree, routes, composer controls, task cards, stream states and report surfaces that a releasable build uses; debug overlays or logs may exist only as non-primary developer aids.

## Hard Constraints

1. Do not push unless explicitly requested.
2. Do not touch `main`, archive branches, release tags, GitHub release assets or marketplace installs in this reset.
3. Do not reintroduce old plugin runtime compatibility.
4. Do not add fake build/test/typecheck scripts before implementation exists.
5. Do not add a new package outside the approved 10 packages without a tracked decision.
6. Do not expose internal multi-agent/team/squad concepts to the user-facing product model.
7. Do not call general OpenAI, Anthropic or other model inference APIs directly from Thoth core/daemon as a substitute for a harness/provider session.
8. Do not let provider-native session handles, permissions or model settings become task authority; Thoth records them as execution evidence and resume metadata only.
9. Do not implement a local zero-shot semantic classifier for route, workspace intent, clarification strategy or loop strategy.
10. Local code may only honor explicit user controls, validate schemas, enforce permissions, gather mechanical evidence and maintain authority state.
11. Do not let Clarify mutate workspace files, install dependencies, commit, push, delete or rewrite workspace content.
12. Do not split Plan and Execute into separate Thoth role sessions in MVP; they are one PlanExec provider session.
13. Do not auto-approve provider permission requests merely because PlanExec provider questions are auto-answered after contract freeze.
14. Do not copy Multica source code into the New Thoth repository.
15. Do not stage or commit `.agent-os/upstreams/` raw upstream cache.
16. Do not delete tracked `_paseo/` implementation seed material merely because imports, types or tests are temporarily broken.
17. Do not include voice, audio, speech or dictation upstream material in the current MVP implementation seed.
18. Do not rely on npm install lifecycle scripts for required toolchain setup; use explicit root scripts for native packaging/toolchain work.
19. Do not stage or commit `.dev/`, `.agent-os/artifacts/`, generated Android/iOS native folders or APK artifacts.
20. Do not create a separate mock, reduced, debug-only or agent-facing UI as the primary Thoth I review surface.
21. Do not use manual UI exploration as the ordinary agent validation gate; agents should use repository tests, typechecks, builds and explicit smoke commands.

## Non-Goals

1. Implementing daemon, SQLite authority, drivers, TUI, desktop app, mobile app, relay or CLI.
2. Producing runnable MVP behavior.
3. Porting old plugin commands.
4. Preserving old 0.4.x changelog as the active product history.
5. Maintaining the old Python package for compatibility.
6. Creating GitHub Actions, pushing commits, publishing packages, uploading releases, running EAS cloud builds or producing a real iOS build on Linux.
7. Building a second development-only product surface that behaves differently from the releasable Thoth UI.
