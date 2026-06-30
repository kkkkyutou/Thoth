# AGENTS.md — packages/drivers

This package owns harness/provider adapters: Claude Code, Codex, ACP-compatible tools and future harness runtimes.

## Rules

1. Drivers translate Thoth requests into provider sessions. They do not decide task authority, acceptance or product truth.
2. Do not call general model APIs directly as a shortcut around provider/harness control surfaces.
3. Keep provider capability contracts explicit: permissions, streaming, resume, plan mode, structured questions and tool calls.
4. Real provider tests are opt-in and never part of foundation gate.
5. Preserve raw provider output as evidence, but pass structured handoff packets through Thoth validation.
6. Do not copy Multica source code into this package.

## Commands

This package is expected-broken until the provider-driver milestone. Run only targeted tests tied to the adapter being migrated.
