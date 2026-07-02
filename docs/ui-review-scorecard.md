# New Thoth UI Review Scorecard

Status: working scorecard, not final acceptance
Last updated: 2026-07-02

This document is the durable UI review ledger for the New Thoth multi-endpoint product surface.
It must not be used to claim final UI acceptance until Web, Desktop and OpenTUI all have current
rendered evidence, stress evidence and score evidence that meet the final threshold.

## Acceptance Threshold

Final pass requires:

1. Web/Desktop/OpenTUI all cover the final product surface: Home / One Thoth, Workspace, Task /
   Loop, Providers, Connections / Devices / Relay, Evidence / Review and Settings / About.
2. No endpoint relies on mock/debug-only UI as the primary dogfood surface.
3. Unimplemented backend behavior is labelled honestly as preview, unavailable, needs provider,
   needs workspace or needs pairing.
4. Web and Desktop pass current Playwright or packaged/dev smoke coverage for open-project,
   workspace, `hi`, fresh relay, expired relay, settings/onboarding and rapid navigation stress.
5. OpenTUI passes CLI workspace, recovery, workspace registration, provider readiness, device
   pairing, narrow/wide terminal and PTY stress coverage.
6. Evidence includes current screenshots or terminal frame captures for key states.
7. Comprehensive score is greater than `90`, and OpenTUI score is at least `88`.

## Dimensions

Each endpoint is scored on 10 dimensions, 10 points each:

1. Visual consistency
2. Information architecture
3. Light game-like taste
4. Cute but not childish
5. Work efficiency
6. Onboarding
7. State and error recovery
8. Cross viewport / terminal resilience
9. Thoth recognition
10. Paseo removal and endpoint consistency

## Current Working Scores

These are current working scores, not final acceptance scores. They intentionally include
penalties for missing current screenshots, missing stress artifacts and unfinished backend slots.

| Endpoint | Score | Status      | Current evidence                                                                                                          | Main gaps                                                                                                                                   |
| -------- | ----: | ----------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Web      |    72 | In progress | `NTH-EV-008`, `NTH-EV-009`, prior web build and relay timeout smokes                                                      | Needs current screenshot set, Playwright UI stress, complete Home/Workspace/Task/Provider/Relay/Evidence/Settings audit, and score above 90 |
| Desktop  |    76 | In progress | Desktop wrapper/package substrate, `NTH-EV-006`, unsigned macOS zip evidence, Thoth semantic menu slice                   | Needs current packaged/dev smoke after menu change, screenshot set, Desktop menu visual/behavior smoke, and score above 90                  |
| OpenTUI  |    87 | In progress | `NTH-EV-010` through `NTH-EV-018`, `NTH-EV-020`, renderer/navigation/CLI/recovery/workspace/provider/device/stress smokes | Needs final scorecard terminal capture ledger, provider/model editing path or honest final unavailable state, and score at least 88         |
| Overall  |    78 | Failing     | Multi-endpoint slices exist, but final score evidence is incomplete                                                       | Needs full scorecard evidence and threshold pass                                                                                            |

## Evidence Ledger

### Web

Required final captures:

1. Home / One Thoth at desktop width.
2. Home / One Thoth at mobile width.
3. Workspace with composer controls: `+`, Provider, Mode, Clarify, Loop.
4. Workspace provider-missing `hi` path with honest error/no white screen.
5. Fresh relay pairing path.
6. Expired relay credential recovery path.
7. Settings / About and Providers / Connections routes.
8. Rapid route/settings/composer Playwright stress output.

Current status: incomplete in this scorecard. Earlier evidence exists in `.agent-os`, but final
scorecard screenshots and stress artifacts have not been refreshed in this document.

### Desktop

Required final captures:

1. Desktop Home / One Thoth.
2. Desktop Workspace.
3. Desktop Settings / About.
4. Desktop menu bar with Thoth semantic menus.
5. Desktop relay/provider/workspace recovery path.
6. Packaged or dev smoke output.

Current status: in progress. The desktop menu shell now has Thoth semantic top-level menus:
`Thoth`, `File`, `Workspace`, `Task`, `Provider`, `View`, `Window`, `Help`. Unfinished Workspace,
Task and Provider actions are disabled instead of pretending to work.

### OpenTUI

Required final captures:

1. Default `96x34` Home or Workspace frame.
2. Narrow `72x34` frame.
3. Wide terminal frame.
4. Recovery frame.
5. Workspace registration frame.
6. Provider readiness frame.
7. Device pairing frame.
8. PTY stress output for rapid route/focus/composer/action churn.

Current status: strong but still incomplete. Current evidence covers renderer, navigation, CLI
workspace, recovery, workspace registration, provider readiness, device pairing and a PTY-wrapped
CLI/OpenTUI stress run across `72x34`, `96x34` and `132x34`. The final scorecard terminal capture
ledger and provider/model editing path or final honest unavailable state are not yet complete.

## Current Slice Result

The 2026-07-02 OpenTUI PTY stress slice improves OpenTUI cross-terminal resilience evidence. The
new `npm run smoke:tui:pty-stress` root script builds the real TUI/CLI path, runs `thoth tui` under
a pseudo-terminal wrapper at `72x34`, `96x34` and `132x34`, churns route/focus/composer state,
refreshes daemon/provider state, creates a safe daemon pairing offer summary and rejects legacy
`6767`, raw relay offer/token and QR leakage. This is not a final UI pass because the full
Web/Desktop/OpenTUI scorecard evidence and threshold are still missing.
