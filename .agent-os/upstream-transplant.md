# Upstream Transplant Ledger

本文件记录 New Thoth 当前 implementation seed 的来源、边界和预期状态。它是迁移账本，不是产品设计文档。

## Current Import

1. Upstream project: Paseo
2. Upstream repository: `https://github.com/getpaseo/paseo`
3. Upstream branch: `main`
4. Actual upstream HEAD used: `5fc53c576ef0d4dee55455ccc95660703f71b892`
5. Verification command: `git ls-remote https://github.com/getpaseo/paseo.git refs/heads/main`
6. Source acquisition method: GitHub archive tarball fallback for the exact commit above.
7. Clone/cache time: `2026-06-30`
8. Upstream license: `AGPL-3.0`
9. Thoth active license after import: `AGPL-3.0-or-later`

## Raw Cache Policy

1. Local raw cache path: `.agent-os/upstreams/paseo/`
2. The raw cache is ignored by git through `.gitignore`.
3. The raw cache preserves upstream layout after applying the explicit exclusion policy below.
4. The raw cache is not project authority and must not be staged or committed.
5. The dirty local checkout under `/mnt/cfs/5vr0p6/yzy/harness/paseo` is intentionally not used.

## Exclusion Policy

Excluded from raw cache and tracked seed:

1. Any path matching `audio`, `speech`, `voice` or `dictation`.
2. Audio/media files: `*.wav`, `*.webm`, `*.mp3`, `*.m4a`, `*.ogg`.
3. `.git`, `node_modules`, `dist`, `build`, `.expo`, `.next`, `.wrangler`, `coverage`, caches, logs, environment files, tokens, private keys and generated secrets.

Voice-related upstream features are not part of the current Thoth MVP line.

## Tracked Seed Map

The tracked seed is expected to be non-runnable and temporarily broken until future migration tasks digest it.

1. `packages/protocol/_paseo/`
   - Source: upstream `packages/protocol`
   - Purpose: protocol messages, fixtures, tests and package metadata reference.
2. `packages/client/_paseo/`
   - Source: upstream `packages/client`
   - Purpose: daemon client, WebSocket transport and relay E2EE client reference.
3. `packages/relay/_paseo/`
   - Source: upstream `packages/relay`
   - Purpose: Cloudflare Worker relay and WebSocket relay reference.
4. `packages/cli/_paseo/`
   - Source: upstream `packages/cli`
   - Purpose: CLI command shape and tests reference.
5. `packages/app/_paseo/app/`
   - Source: upstream `packages/app`
   - Purpose: shared app shell, UI state and client surface reference.
6. `packages/app/_paseo/highlight/`
   - Source: upstream `packages/highlight`
   - Purpose: UI highlighting/reference surface because Thoth has no independent highlight package.
7. `packages/desktop/_paseo/`
   - Source: upstream `packages/desktop`
   - Purpose: Electron shell, builder config and desktop lifecycle reference.
8. `packages/drivers/_paseo/agent/`
   - Source: upstream `packages/server/src/server/agent`
   - Purpose: provider registry, Claude, Codex app-server, ACP, OpenCode, session, history, permission and question handling reference.
9. `packages/daemon/_paseo/server/`
   - Source: upstream `packages/server`
   - Purpose: daemon/server shell, WebSocket, managed process, workspace, worktree, persistence and session runtime reference.
   - Note: `src/server/agent` is excluded here because it is copied to `packages/drivers/_paseo/agent/`.
10. `packages/core/_paseo/server-core/`
    - Source: selected upstream `packages/server/src` non-provider helper areas when clearly reusable.
    - Purpose: storage/projection/context/runtime utility references that may later move into `core` or remain daemon-owned.
    - Note: ambiguous server material should stay in daemon seed until a later boundary split.

## Rename Policy

1. Raw cache keeps upstream text and names.
2. Tracked seed uses aggressive semantic renaming where practical:
   - `@getpaseo` -> `@thoth`
   - `getpaseo` -> `thoth`
   - `PASEO` -> `THOTH`
   - `Paseo` -> `Thoth`
   - `paseo` -> `thoth`
3. Provenance files may still mention the upstream project name when needed for license and source attribution.

## Expected Broken State

1. `_paseo/` imports may point at packages or files that do not exist in the New Thoth monorepo yet.
2. `_paseo/` tests may not run.
3. `_paseo/` package metadata may reference scripts or dependencies that are not merged into the root workspace.
4. This is intentional. Seed directories are raw implementation substrate for future migration, not a completed product feature.

## Follow-Up

1. Create a migration TODO per seed area before moving code from `_paseo/` into formal `src/`.
2. Do not make root scripts or dependencies match upstream wholesale.
3. Keep Thoth as a control plane: no direct hidden LLM API calls outside configured harness/provider sessions.
