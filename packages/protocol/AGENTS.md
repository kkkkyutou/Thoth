# AGENTS.md — packages/protocol

This package owns Thoth wire schemas, shared protocol types, binary frame codecs and compatibility contracts.

## Rules

1. Treat this package as the source of truth for daemon/client/app/CLI messages.
2. Prefer Zod schemas at boundaries and derive TypeScript types from schemas when practical.
3. Keep protocol changes backward parseable: new fields are optional/defaulted; removed fields remain accepted until a deliberate compatibility cleanup.
4. Do not import daemon, app, desktop, drivers, CLI or UI code.
5. Do not call providers, filesystem workspace mutation, local LLM APIs or platform APIs here.
6. Tests are collocated `*.test.ts` and must assert parse/compat behavior, not internal structure.

## Commands

Run from repo root:

```bash
npm run build:protocol
npm run typecheck:protocol
npm run test:protocol
```

Foundation work must keep this package green.
