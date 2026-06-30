# AGENTS.md — packages/daemon

This package owns the local Thoth authority runtime substrate: daemon process lifecycle, workspace/session orchestration, persistence, WebSocket sessions and provider process coordination.

## Rules

1. Thoth daemon is not a hidden LLM client. All AI execution must go through configured provider sessions or harness runtimes.
2. Provider session handles, permissions, model settings and raw streams are execution evidence/resume metadata, not task authority.
3. Do not restart or kill a user daemon unless the task explicitly requires it and the impact is stated.
4. Do not assume a timeout means restart; inspect logs, process state and protocol state first.
5. Keep Clarify read-only: no workspace mutation, install, commit, push or delete during clarify sessions.
6. Real provider tests must stay isolated with `*.real.e2e.test.ts` or equivalent explicit gates.
7. Do not reintroduce voice/audio/speech/dictation runtime.

## Commands

This package is expected-broken outside the first foundation gate. Use narrow tests while migrating, and do not claim daemon readiness until a dedicated daemon milestone records evidence.
