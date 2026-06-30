# Run Log

## 2026-06-28 [New Thoth repo reset]

- Worked on: `NTH-OBJ-001`, `NTH-MS-001`, `NTH-TD-001`
- State changes: Reset the active branch toward New Thoth by removing the old Python / Claude-Codex plugin runtime from the active working tree and replacing the public entrypoints with New Thoth documentation and monorepo skeleton metadata.
- State changes: Rewrote project recovery documents around New Thoth IDs and current truth. Old plugin history is now referenced through release `thoth-plugin-final-archive` and branch `archive/main-20260627`.
- State changes: Added the prompt seed extraction document so old prompt lessons survive as contracts rather than legacy Python code.
- Evidence produced: Old runtime path check confirmed `thoth`, `scripts`, `templates`, `tests`, `commands`, `plugins`, `.claude-plugin`, `.codex-plugin`, `.agents`, `bin`, `pyproject.toml`, `.pytest_cache`, `.tmp_pytest` and `research.db` are gone from the repo root. Package metadata check reported `package metadata ok 11`; package directory count reported `10`; design document check reported `design docs ok`; `CLAUDE.md` symlink check reported `CLAUDE symlink ok`; asset check confirmed only `thoth-icon.svg` and `thoth.png` remain; `npm install --package-lock-only --ignore-scripts` completed with `found 0 vulnerabilities`; `git diff --check` passed. Old `.tmp_pytest` cleanup hit NFS unlink stalls; remaining untracked residue was moved under ignored `.agent-os/.trash/tmp_pytest-nfs-stale-20260628` so the repo root no longer exposes the old test-cache path.
- Next likely action: `NTH-TD-002` - design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle.

## 2026-06-29 [AGENTS engineering behavior integration]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`
- State changes: Integrated the engineering behavior rules from `multica-ai/andrej-karpathy-skills` `CLAUDE.md` into root `AGENTS.md` as New Thoth scoped guidance: Think Before Coding, Simplicity First, Surgical Changes and Goal-Driven Execution.
- Evidence produced: `git diff --check` passed. Targeted scan confirmed `AGENTS.md` now contains `通用工程行为准则`, `Think Before Coding`, `Simplicity First`, `Surgical Changes`, `Goal-Driven Execution` and the `multica-ai/andrej-karpathy-skills` source note.
- Next likely action: `NTH-TD-002` - design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle.

## 2026-06-29 [Release packaging decision recorded]

- Worked on: `NTH-OBJ-001`, `NTH-WS-005`
- State changes: Recorded `NTH-CD-011`, `NTH-REQ-010`, `NTH-MS-006` and `NTH-TD-007` for a future Paseo-like release and packaging pipeline.
- Decision detail: The future pipeline should use explicit release tags or manual GitHub Actions dispatch, not ordinary branch pushes. Desktop packages should target macOS, Linux and Windows installer artifacts. Android APK release builds should use Expo/EAS or an equivalent path and upload installable artifacts to GitHub Releases. Web/app and relay deployments should be separately explicit. iOS distribution should be handled through TestFlight/App Store/EAS submit or another Apple-approved path rather than assuming GitHub Release IPA self-install.
- Next likely action: `NTH-TD-002` - design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle.

## 2026-06-29 [Provider execution boundary recorded]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-004`
- State changes: Recorded `NTH-CD-012` and `NTH-REQ-011`: Thoth is a control plane, not a harness tool or hidden LLM API wrapper.
- Decision detail: All AI and agent execution must come from configured providers through ACP adapters, harness runtimes, app-server sessions, official harness SDK/control surfaces or local harness CLIs. Thoth owns process flow, routing judgment, prompt contracts, task authority, frozen acceptance, evidence and session records. Thoth core/daemon must not privately call general model inference APIs as a substitute for provider sessions.
- Next likely action: `NTH-TD-002` - design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle.

## 2026-06-29 [Provider-backed routing boundary recorded]

- Worked on: `NTH-OBJ-001`, `NTH-WS-003`, `NTH-WS-004`
- State changes: Recorded `NTH-CD-013` and `NTH-REQ-012`: zero-shot semantic routing, workspace intent resolution, clarification strategy and loop strategy must not be local deterministic heuristics.
- Decision detail: Desktop composer should expose explicit Thoth-level controls for `quick` and `loop`, plus clarification strength and loop strength. Local code may honor explicit controls, validate schemas, enforce permissions, gather mechanical evidence and maintain authority state. Any intelligent recommendation, ambiguity resolution, route upgrade/downgrade or context judgment must run inside a provider-backed session.

## 2026-06-29 [Chatbox control levels recorded]

- Worked on: `NTH-OBJ-001`, `NTH-WS-003`
- State changes: Recorded `NTH-CD-014` and `NTH-REQ-013`: chatbox controls are `+`, Provider, Mode, Clarify and Loop.
- Decision detail: `+` supports only images and files under `10MB` in MVP. Scope is handled through `@`, not a separate button. Provider contains provider/model/runtime settings including model id, thinking strength, permission mode and fast mode. Mode is `Quick` or `Loop`. Clarify is `auto`, `no-ask`, `light`, `balance`, `deep` and applies to both modes. Loop is `auto`, `no-loop`, `light`, `balanced`, `endless`; it applies only to `Loop`, with `endless` shown red/high-cost/manual-stop.
- Next likely action: `NTH-TD-002` - design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle.

## 2026-06-29 [Business flow canonical docs updated]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-WS-004`
- State changes: Recorded `NTH-CD-015` and `NTH-REQ-014`, then updated the three canonical design documents: `.agent-os/designs/new-thoth-high-level-design.md`, `.agent-os/designs/new-thoth-mvp-user-journey.md` and `.agent-os/designs/new-thoth-engineering-architecture.md`.
- Decision detail: All provider-visible output should stream through Thoth in real time. `Quick + Don't Bother Me` is a provider passthrough path. `Loop` uses read-only Clarify, frozen contract, one PlanExec provider session with provider-native plan mode when available, and independent Review. PlanExec provider clarification questions after freeze are auto-answered from the contract or first recommended option; provider permission requests still obey permission policy.
- Evidence produced: Targeted term scan found no remaining `no-ask`, `no_ask`, `no-loop`, `no_loop`, `endless`, `Plan -> Execute`, `Plan/Execute`, `write Execute`, `Execute role` or `Plan role` in the three canonical design documents. `git diff --check` passed for the updated canonical design documents.
- Next likely action: `NTH-TD-002` - design the first implementation slice around provider streaming, quick passthrough, read-only Clarify, PlanExec, Review and authority persistence.

## 2026-06-30 [Clarify card validation runtime recorded]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-WS-004`
- State changes: Recorded `NTH-CD-016` and updated `.agent-os/designs/new-thoth-engineering-architecture.md` with Clarify decision-tree runtime, two-channel provider streaming, card candidate validation, hidden format repair and frontend/daemon validation boundaries.
- Decision detail: Clarify must behave as a decision-tree walk rather than a questionnaire. Provider text streams to users in real time, but structured clarification cards render only after validation. Invalid card candidates, schema diagnostics and repair prompts stay hidden from users; the daemon sends concise repair feedback back into the same provider session and asks it to regenerate the same card for the same tree node.
- Evidence produced: Targeted scan confirmed the engineering architecture document now contains `Clarify Decision-Tree Runtime`, `Clarify Streaming And Card Validation`, `Invalid card repair` and `Timeline event split`. `git diff --check` passed after the documentation update.
- Next likely action: `NTH-TD-002` - design the first implementation slice around provider streaming, Clarify card validation, read-only provider sessions, authority persistence and task lifecycle.

## 2026-06-30 [AGPL policy and upstream seed import completed]

- Worked on: `NTH-OBJ-001`, `NTH-WS-006`, `NTH-MS-007`, `NTH-TD-008`
- State changes: Recorded `NTH-CD-017`, `NTH-REQ-015`, `NTH-MS-007`, `NTH-TD-008`, `NTH-TD-009` and `NTH-EV-002` for the AGPL license switch, upstream implementation seed import and next seed digestion step.
- State changes: Added `.agent-os/upstreams/` to `.gitignore`, created local raw cache under `.agent-os/upstreams/paseo/`, replaced root `LICENSE` with AGPL v3 text, changed package metadata license fields to `AGPL-3.0-or-later`, added `NOTICE`, and added `.agent-os/upstream-transplant.md`.
- State changes: Copied non-runnable tracked seed material into `packages/protocol/_paseo`, `packages/client/_paseo`, `packages/relay/_paseo`, `packages/cli/_paseo`, `packages/app/_paseo`, `packages/desktop/_paseo`, `packages/drivers/_paseo`, `packages/daemon/_paseo` and `packages/core/_paseo`.
- Evidence produced: Remote upstream `main` was verified through `git ls-remote` with proxy as `5fc53c576ef0d4dee55455ccc95660703f71b892`. Raw cache was created from the exact GitHub archive tarball after direct clone/index-pack was unreliable. Voice/audio/speech/dictation/TTS/STT/PCM/WAV path exclusion checks returned no matches in raw cache or tracked seed after cleanup. Seed content naming scan found no upstream product naming matches. Root metadata check reported `packages=10` and `workspaces=packages/*`; all package JSON parse check reported `count=19`; large file check found no seed files over `5MB`; refined secret-like scan returned no real-looking tokens or private-key blocks; `npm install --package-lock-only --ignore-scripts` completed with `found 0 vulnerabilities`; `git diff --check` passed.
- Next likely action: `NTH-TD-009` - digest imported `_paseo/` seeds into the first real New Thoth implementation migration map before moving any code into formal `src`.

## 2026-06-30 [Implementation seeds promoted to formal source]

- Worked on: `NTH-OBJ-001`, `NTH-WS-006`, `NTH-MS-008`, `NTH-TD-009`
- State changes: Promoted tracked `_paseo` implementation seed material into formal package source trees and deleted tracked `_paseo` directories.
- State changes: Preserved the formal Thoth package boundary and identity: root workspace boundary remains `packages/*`; the 10 formal packages remain `@thoth/app`, `@thoth/cli`, `@thoth/client`, `@thoth/core`, `@thoth/daemon`, `@thoth/desktop`, `@thoth/drivers`, `@thoth/protocol`, `@thoth/relay` and `@thoth/tui`; `packages/app/highlight` remains nested and no `packages/highlight` workspace was created.
- State changes: Kept `packages/tui` skeleton-only. Removed obvious package/config/script-level voice/audio/speech/dictation residue while recording broad promoted-source references as expected-broken material for dependency and compile triage.
- State changes: Recorded `NTH-CD-018`, marked `NTH-MS-008` and `NTH-TD-009` done, added `NTH-TD-010` as the next dependency and compile triage item, and recorded `NTH-EV-003`.
- Evidence produced: `_paseo` path count reported `0`; formal package list reported exactly 10 package directories; `packages/highlight` absence check passed; `packages/tui` skeleton file check passed; package identity check reported `formal package identity ok`; JSON parse check reported `json ok 12`; `npm install --package-lock-only --ignore-scripts` completed with `up to date, audited 2189 packages in 10s` and reported 40 vulnerabilities for later triage; raw cache ignore check reported `.gitignore:25:.agent-os/upstreams/`; generated/cache path scan returned no package paths; path-level voice/audio/speech/dictation scan returned no package paths; package/config/script voice-residue scan returned no matches; `@thoth/server` scan returned no matches; large-file scan found no package files over `5MB`; secret-like scan found no real-looking tokens or private-key blocks; `git diff --check` passed.
- Next likely action: `NTH-TD-010` - run dependency and compile triage on the promoted source substrate without changing New Thoth product goals.
