# Thoth

Thoth is being rebuilt as a local-first task control plane for AI work.

The archived Claude Code / Codex plugin runtime has been archived and is no longer maintained on this branch. This repository now contains the Thoth design authority and promoted TypeScript / Node implementation substrate. There is no runnable CLI, daemon, TUI, desktop app, mobile app, relay, or harness driver in the current checkout yet.

## Current Status

- Current branch focus: Thoth reset and MVP architecture.
- Current implementation: promoted upstream-derived implementation substrate under the formal `packages/*` source trees, expected to be temporarily broken.
- Current license: `AGPL-3.0-or-later`.
- Copyright holder: `SeeleAI`.
- Current public surface: documentation, package boundaries, and non-runnable promoted source substrate only.
- Archived plugin release: <https://github.com/SeeleAI/Thoth/releases/tag/thoth-plugin-final-archive>
- Archived plugin branch: `archive/main-20260627`

## What Thoth Is For

Thoth is designed to reduce the user’s cognitive burden and entry barrier. The user should be able to describe intent naturally; Thoth should clarify only the few decisions that matter, register durable tasks when needed, run asynchronous loops, review results adversarially, and report with evidence.

The core product direction is:

1. One Thoth, not a visible agent dashboard.
2. UI shells are replaceable; authority belongs to Thoth.
3. Tasks are recoverable, reviewable, asynchronous loops.
4. Success is based on acceptance and evidence, not executor self-report.
5. Harnesses such as Claude Code, Codex, ACP-compatible tools, and future providers are adapters, not the source of truth.

## Repository Shape

```text
packages/
  protocol/   shared protocol and event contracts
  client/     shared client SDK and transports
  core/       pure domain model and lifecycle rules
  daemon/     local authority server and scheduler
  drivers/    harness adapters
  tui/        OpenTUI workspace control surface
  app/        shared desktop/mobile app surface
  desktop/    Electron wrapper and daemon lifecycle
  relay/      E2EE WebSocket relay
  cli/        scriptable advanced client
```

The formal package source trees now contain promoted implementation substrate. This is intentionally not a working product yet: imports, scripts, dependency wiring and runtime behavior may be broken until the dependency and compile triage milestone records passing evidence.

## Design Authority

Start here:

- [Core Principles](.agent-os/designs/最核心的设计理念.md)
- [High-Level Design](.agent-os/designs/thoth-high-level-design.md)
- [MVP User Journey](.agent-os/designs/thoth-mvp-user-journey.md)
- [Engineering Architecture](.agent-os/designs/thoth-engineering-architecture.md)
- [Prompt Contract Seeds](.agent-os/designs/thoth-prompt-contract-seeds.md)

The historical long-form migration note remains available at `.agent-os/designs/thoth-migration-architecture-20260625.md` for historical traceability.

## Development Note

This checkout is not a working product. Do not install it as the archived plugin runtime. Do not expect `thoth`, `/thoth:*`, or `$thoth` commands to exist from this branch.

Future implementation should follow `.agent-os/project-index.md`, `.agent-os/todo.md`, and the canonical design documents above.

See [`NOTICE`](NOTICE) and [`.agent-os/upstream-transplant.md`](.agent-os/upstream-transplant.md) for license and upstream seed provenance.
