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
4. Quick+Balanced / Quick+Dive strength smoke:
   - Set `Provider=Codex`, `Mode=Quick`.
   - Run all four prompt/strength combinations when closing Loop-2 evidence:
     - `Clarify=Balanced`, prompt `实现一个高性能快速排序`.
     - `Clarify=Dive`, prompt `实现一个高性能快速排序`.
     - `Clarify=Balanced`, prompt `帮我实现一个实时 PathTracing 系统`.
     - `Clarify=Dive`, prompt `帮我实现一个实时 PathTracing 系统`.
   - Verify the Codex app-server path uses `dynamicTools` / `item/tool/call`, not assistant JSON,
     native `outputSchema` packets or `submit_clarify_packet`.
   - Verify the Clarify tool badge label is user-facing, for example `需求拆解`, and the badge body is
     the model-submitted `public_badge_summary`, not `decision_it_changes` or a neutral spinner line.
   - Verify the visible round labels are `Clarify 1`, `Clarify 2`, ... and each card normally contains
     3 high-value questions, with 2-4 allowed only when the material frontier justifies it.
   - Verify `Balanced` normally produces 5-10 Clarify cards and `Dive` normally produces 10-20
     Clarify cards for nontrivial implementation requests. A Task Card below the soft minimum is
     acceptable only if daemon/tool evidence records a `below_soft_target_rationale` convergence
     review grounded in a `ready_for_task` frontier ledger.
   - For each Clarify card, choose the first option for every question and submit. The card must be
     atomic, paginated, validated and user-facing; raw packet/schema/skill/MCP/dynamic tool text must
     not appear.
   - While a Clarify / Task / Pyramid decision is pending, verify the turn does not render a completed
     footer, `Worked for ...` footer, idle/ready completion state or spinner-only dead air. The open
     card is the active pending decision.
   - After submitting a Clarify card, verify it immediately folds into a readonly submitted summary,
     the matching Thoth authority tool-call badge completes by call id, and the same topic continues
     to stream the next provider timeline segment.
   - Accept the compact Task Card with the first Quick action, accept the Pyramid Plan Card with the
     first foreground execution action, and verify same-session `quick_exec` shows provider
     AgentTimeline rows such as Shell/Edit rather than spinner-only output.
5. Loop+Dive smoke:
   - Set `Mode=Loop`, `Clarify=Balanced` or `Clarify=Dive` depending on the evidence target.
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
   `/mnt/cfs/5vr0p6/yzy/thoth-ui-review-captures/loop2-runtime-tool-bridge/`:
   - Quick+none: `1783414416734-quick-none-report.json`.
   - Quick+Dive: `1783416763028-report.json`.
   - Loop+Dive registered_pending: `1783415185110-report.json`.
   - Background Tasks recovery: `1783415406577-background-tasks-success-report.json`.
   - Mobile recovery: `1783416247271-mobile-loop-recovery-success-report.json`.
   - Independent review: `independent-ui-mental-model-review.md`.
   - Frontier-ledger repair revalidation:
     - Local Quick+Balanced sorting: `1783447093160-report.json` (5 Clarify cards,
       `quicksort.py`, `test_quicksort.py`).
     - Public Quick+Balanced sorting: `1783447426182-report.json` (5 Clarify cards, C++ source and
       test files).
     - Local Quick+Dive sorting: `1783447971613-report.json` (12 Clarify cards, C++ header, tests,
       benchmark and Makefile).
     - Local Quick+Balanced PathTracing: `1783449102697-report.json` (5 Clarify cards,
       `index.html`, `src/main.js`, `src/styles.css`).
     - Local Loop+Balanced registered_pending: `1783449979213-report.json`.
   - Remaining regression evidence:
     - Local Quick+Dive PathTracing `1783449724169-report.json` reached 10 Clarify cards but produced
       incomplete quick_exec output (`index.html` references missing `src/main.js`).
     - Mobile screenshot `1783450162819-mobile-registered-pending.png` opens the registered-pending
       workspace but shows an empty `New Agent` tab instead of restored registered-task history.
   - Status note: the frontier-ledger repair is partially revalidated, but `NTH-EV-029` must stay
     reopened until mobile recovery and the complex Dive quick_exec residual are fixed or explicitly
     descoped.

## Loop Background Real-Provider Runbook

Use this opt-in runbook when validating `NTH-CD-045` / `NTH-EV-030`. It is not part of
`check:foundation`, and it must use throwaway `/tmp` workspaces. Do not put screenshots, traces,
videos or JSON reports under `docs/` or any tracked repo directory; use
`/mnt/cfs/5vr0p6/yzy/thoth-ui-review-captures/`.

1. Build and serve the current web export:
   - `npm run build:web`
   - serve on local `http://127.0.0.1:8082/`
   - confirm public `http://180.76.242.105:8148/` maps to the same build
   - keep Thoth daemon on `127.0.0.1:6688`
   - do not touch legacy Paseo `127.0.0.1:6767`
2. Create a throwaway git workspace under `/tmp`, register it through the daemon and open it in the
   app.
3. Set `Provider=Codex`, `Mode=Loop`, `Clarify=Balanced` or `Dive`, and choose a Loop strength:
   - `Single` first, to verify the `maxFailedReviews=1` budget path
   - `Light` next, to verify retry budget without exhausting immediately
4. Send a real implementation prompt, for example `实现一个高性能快速排序`.
5. Complete Clarify by answering every question; accept the Task Card; accept the Goals Card with the
   Loop/register action.
6. Verify the secretary timeline does not stop at legacy `registered_pending`. It should hand off to a
   durable background Loop task.
7. Open Background Tasks:
   - the task appears in the list
   - task detail is clickable
   - linear goals appear in the Goals Card order
   - the current goal shows a spinner
   - inactive queued goals are grey
   - passed/blocked/stopped goals show stable status
8. Open the current goal:
   - PlanExec and Review phase tabs are visible
   - the active phase defaults selected and shows spinner plus current round
   - selecting a phase embeds that provider agent's AgentTimeline
   - Shell/Edit/Read/Write/Search/Fetch/Thinking/permission/error timeline rows stream as they happen
9. Verify Loop semantics:
   - Review pass advances to the next goal without consuming failed-review budget
   - Review fail consumes exactly one failed-review budget and retries the same goal
   - PlanExec failure/cancel/permission denial does not consume failed-review budget
   - Single blocks after one failed Review
   - Light allows up to five failed Reviews
10. Verify controls:
    - Pause cancels the current phase and leaves the task paused, not blocked
    - Resume restarts the current phase
    - Stop cancels the current phase and enters stopped terminal state
11. Verify recovery:
    - reload browser
    - reconnect websocket
    - restart daemon only in a controlled local test; running phases must reload as `interrupted`
      and Resume must restart the current phase
12. Capture desktop/mobile screenshots, Playwright trace/video, WebSocket/tool-call summary, daemon log
    excerpts and generated workspace evidence under
    `/mnt/cfs/5vr0p6/yzy/thoth-ui-review-captures/loop-background-YYYYMMDD/`.
13. Open key screenshots with `view_image` before marking acceptance:
    - Loop controls and selected strength
    - Goals Card
    - Background Tasks list
    - task detail with goals
    - current goal spinner
    - PlanExec phase timeline
    - Review phase timeline
    - pause/resume/stop states
    - recovery after refresh/reconnect

Current `NTH-EV-030` acceptance evidence:

- Local `8082` Loop+Single / Clarify Balanced report:
  `/mnt/cfs/5vr0p6/yzy/thoth-ui-review-captures/loop-background-2026-07-09T02-22-03-920Z/1783563943719-report.json`.
- Public `8148` Loop+Single / Clarify Balanced report:
  `/mnt/cfs/5vr0p6/yzy/thoth-ui-review-captures/loop-background-2026-07-09T02-32-23-648Z/1783564545908-report.json`.
- Post-run task/timeline summary:
  `/mnt/cfs/5vr0p6/yzy/thoth-ui-review-captures/loop-background-2026-07-09T02-32-23-648Z/1783565728941-post-run-summary.json`.
- Key screenshots inspected with `view_image`:
  `1783564538646-background-task-list-detail.png`,
  `1783564545842-background-task-planexec-timeline.png`,
  `1783564677308-background-task-planexec-timeline-live.png`,
  `1783564802354-background-task-planexec-timeline-wheel-bottom.png`, and
  `1783564867436-background-task-planexec-timeline-all-scroll-bottom.png` under the public evidence
  directory above.
- Scope note: this evidence verifies the first real Codex Loop+Single local/public path, including
  dynamicTools, Task/Goals approvals, durable background task registration, Background Tasks detail,
  linear goal advancement, independent Review, Single failed-review budget behavior and phase
  AgentTimeline events. Loop+Light, complete all-goals-to-`done` and restart recovery remain
  `NTH-TD-021` hardening work.

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
