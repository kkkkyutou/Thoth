# AGENTS.md — packages/client

This package owns the daemon/relay client SDK and transport facade. It does not own task authority or product decisions.

## Rules

1. Import protocol types from `@thoth/protocol`; do not duplicate wire shapes.
2. Keep transport code deterministic and testable with in-memory or fake transports.
3. Do not import daemon internals, provider drivers, React Native, Electron or UI code.
4. Do not persist task truth here. Client state is a view of daemon authority.
5. Keep relay E2EE behavior ciphertext-only; do not introduce cloud truth or offline queue semantics.
6. Tests should cover user/API-visible client behavior and transport edge cases.

## Commands

Run from repo root:

```bash
npm run build:client
npm run typecheck:client
npm run test:client
```

Build `relay` and `protocol` before diagnosing client cross-package declaration failures.
