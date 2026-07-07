# Testing

Tests prove behavior, not implementation shape. The default gate for Thoth development is the foundation gate.

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

The smoke must prove the reserved local legacy daemon remains on `127.0.0.1:6767` and the Thoth daemon is on `127.0.0.1:6688`. A passing foundation gate does not replace this isolation smoke for runtime endpoint changes.

## Loop-2 Runtime Tool Bridge Real-Provider Runbook

Use this opt-in runbook when validating Workspace Secretary Loop-2 against the real Codex provider and
the public web test app. It is not part of `check:foundation`.

1. Build and serve the current web export, keep Thoth daemon on `127.0.0.1:6688`, and confirm
   `http://127.0.0.1:8082/` plus `http://180.76.242.105:8148/` return 200. Do not touch
   `127.0.0.1:6767`.
2. Create a throwaway git workspace under `/tmp`, register it through the daemon, open the public app
   from `/open-project`, enter that workspace and click `New Agent`.
3. Quick+none smoke:
   - Set `Provider=Codex`, `Mode=Quick`, `Clarify=None`.
   - Send `hi`.
   - Verify ordinary provider/AgentTimeline streaming, no Clarify card, no packet/schema/skill/tool
     internals and no Thoth semantic runtime tools.
4. Quick+Dive smoke:
   - Set `Provider=Codex`, `Mode=Quick`, `Clarify=Dive`.
   - Send `实现一个高性能快速排序`.
   - Verify the Codex app-server path uses `dynamicTools` / `item/tool/call`, not assistant JSON,
     native `outputSchema` packets or `submit_clarify_packet`.
   - For each Clarify card, choose the first option for every question and submit. The card must be
     atomic, paginated, validated and user-facing; raw packet/schema/skill/MCP/dynamic tool text must
     not appear.
   - Accept the compact Task Card with the first Quick action, accept the Pyramid Plan Card with the
     first foreground execution action, and verify same-session `quick_exec` shows provider
     AgentTimeline rows such as Shell/Edit rather than spinner-only output.
5. Loop+Dive smoke:
   - Set `Mode=Loop`, `Clarify=Dive`.
   - Use the same first-option Clarify policy.
   - Accept Task Card and Pyramid Plan Card with the first Loop/register action.
   - Verify the final state is durable `registered_pending`, with no fake running/review/evidence.
6. Recovery smoke:
   - Reopen the workspace and confirm the secretary topic restores cards and execution/registration
     timeline.
   - Open the Background Tasks entry and confirm the `registered_pending` list/detail is visible.
   - Check a mobile viewport or deep link and confirm it restores the registered task rather than
     falling back to Open Project.
7. Capture desktop/mobile screenshots, Playwright trace/video, WebSocket/tool-call summary, daemon log
   snippets, generated files if Quick exec ran, and a JSON report. Open key screenshots with
   `view_image` before marking acceptance.
8. Current Loop-2 acceptance evidence lives under
   `docs/ui-review-captures/loop2-runtime-tool-bridge/`:
   - Quick+none: `1783414416734-quick-none-report.json`.
   - Quick+Dive: `1783416763028-report.json`.
   - Loop+Dive registered_pending: `1783415185110-report.json`.
   - Background Tasks recovery: `1783415406577-background-tasks-success-report.json`.
   - Mobile recovery: `1783416247271-mobile-loop-recovery-success-report.json`.
   - Independent review: `independent-ui-mental-model-review.md`.

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
