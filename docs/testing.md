# Testing

Tests prove behavior, not implementation shape. The default gate for New Thoth development is the foundation gate.

## Foundation Gate

Foundation packages:

- `packages/app/highlight`
- `packages/relay`
- `packages/protocol`
- `packages/client`

Run:

```bash
npm run check:foundation
```

This expands to repository validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests.

If this gate fails, fix it before starting or continuing product feature work.

## Narrow Iteration

Use narrow checks while iterating:

```bash
npm run test:protocol
npm run test:client
npm run test:relay
npm run test:highlight
npm run typecheck:protocol
npm run typecheck:client
```

Do not run broad daemon/app/desktop/CLI suites by default. They are expected to remain partially broken until their dedicated migration milestones.

## Runtime Isolation Smoke

When touching daemon, CLI host resolution, app host bootstrap, desktop daemon lifecycle, relay pairing or packaging paths, run:

```bash
npm run smoke:isolation
```

The smoke must prove the local Paseo/legacy daemon remains on `127.0.0.1:6767` and the Thoth daemon is on `127.0.0.1:6688`. A passing foundation gate does not replace this isolation smoke for runtime endpoint changes.

## Test Suffixes

- `*.test.ts(x)`: deterministic unit tests.
- `*.posix.test.ts`: POSIX-only unit tests.
- `*.browser.test.ts`: browser-backed app tests.
- `*.e2e.test.ts`: local end-to-end tests against real local services.
- `*.real.e2e.test.ts`: tests that hit real providers or external services.
- `*.local.e2e.test.ts`: tests that require local-only resources.

Real provider tests are opt-in. They must never be part of `check:foundation`.

## Rules

1. Prefer deterministic assertions over weak assertions.
2. No conditional assertions in tests.
3. Do not delete flaky tests; fix the variance source.
4. Do not add fake auth checks for providers.
5. Boundary JSON and protocol messages should be schema-validated.
6. Do not claim a check passed unless the command was actually run in the current work session.
