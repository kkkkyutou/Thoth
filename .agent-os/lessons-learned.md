# Lessons Learned

## `NTH-EXP-001` Do Not Carry Archived Plugin Runtime Forward

Motivation:

The archived plugin implementation accumulated Python runtime, generated Claude/Codex surfaces, dashboard templates, Textual TUI, selftests and release machinery. It was valuable as a historical experiment but no longer matched the Thoth product direction.

Observed result:

Keeping archived runtime code in the active working tree would make future agents treat archived plugin compatibility as current truth and would compete with the TypeScript / Node authority runtime design.

Conclusion:

Archived plugin source should be recovered from the archive release or archive branch when needed. It should not remain in the active Thoth skeleton.

Retry condition:

Only revisit archived plugin code as reference material for a specific prompt, evidence, privacy, or loop design decision. Do not port it wholesale.

## `NTH-EXP-002` Prompt Assets Should Be Contracts, Not Legacy Code

Motivation:

Old `prompt_specs.py` contained useful hard stops and evidence-first phase lessons, but it was embedded in obsolete Python command projection machinery.

Observed result:

Retaining that file would preserve too much old runtime surface. Deleting it without extraction would lose hard-won prompt lessons.

Conclusion:

Extract prompt value into `.agent-os/designs/thoth-prompt-contract-seeds.md` as structured contract seeds.

Retry condition:

When implementing Router, Clarify, Plan, Execute or Review prompts, use the seed document and current product principles instead of importing archived Python code.

## `NTH-EXP-003` Keep Install Side Effects Out Of First-Day Setup

Motivation:

The first-day infrastructure must let future agents run `npm install` reliably before doing any real feature work.

Observed result:

Plain `npm install` initially hung inside the optional native `dtrace-provider@0.8.8` lifecycle path pulled by `eas-cli -> @expo/logger -> bunyan`. The package was not required for local Android Debug APK packaging or Linux-safe iOS scripts in this round.

Conclusion:

Do not make npm install lifecycle scripts part of required setup. Root `.npmrc` sets `ignore-scripts=true`, `audit=false` and `fund=false`, and local native/toolchain work is owned by explicit root scripts. The unused local `eas-cli` devDependency was removed; future EAS release automation should be introduced deliberately in the release pipeline milestone.

Retry condition:

Only reintroduce EAS tooling when `NTH-MS-006` release automation is actively implemented, and isolate its install/build behavior so `npm install` remains stable.

## `NTH-EXP-004` Java And Gradle Need Explicit Proxy Mapping

Motivation:

Android Debug APK packaging must work on the current Linux host using the project-local toolchain under `.dev/`.

Observed result:

Shell `http_proxy`/`https_proxy` helped `curl` and npm, but the Gradle wrapper did not automatically use those variables. The first Gradle distribution download failed with a 10 second connect timeout until the packaging script mapped proxy variables into `GRADLE_OPTS`.

Conclusion:

Android packaging scripts should translate proxy environment variables into Java system properties for Gradle and keep `GRADLE_USER_HOME` under `.dev/gradle`.

Retry condition:

If future Android packaging fails on dependency downloads, first check `.dev/gradle`, proxy env, Gradle JVM options and partially downloaded Maven metadata before changing app code.

## `NTH-EXP-005` Do Not Force Relay Deployment Through A Protected Monorepo

Motivation:

The first hosted relay plan tried to mirror Thoth relay code into Code4Agent because that repository already had Cloudflare deployment conventions.

Observed result:

Code4Agent active protected-path rules blocked the required `wrangler.jsonc` and workflow changes for the available write actor. The blocked path created coordination overhead without improving relay source authority.

Conclusion:

The test relay deployment authority is now independent repository `SeeleAI/Thoth-Relay`. Thoth remains the product/source integration authority, while the relay repository owns Cloudflare Worker deploy configuration and test deployment to `relay.test.thoth.seeles.ai`.

Retry condition:

Only revisit Code4Agent if repository governance explicitly changes or the company chooses to centralize deploy infrastructure again. Do not treat the old Code4Agent mirror path as an active blocker.

## `NTH-EXP-006` Runtime Isolation Must Be A First-Class Default

Motivation:

Thoth was promoted from a codebase with local daemon conventions that overlapped with an existing Paseo daemon on the user's machine.

Observed result:

If Thoth silently falls back to `localhost:6767`, it can confuse the app, desktop smoke, CLI status and provider sessions by talking to Paseo instead of Thoth.

Conclusion:

Thoth direct daemon default is `127.0.0.1:6688`, with isolated dev state under `.dev/thoth-runtime/`. `127.0.0.1:6767` is reserved for the local Paseo/legacy daemon and should appear only in tests, historical examples or explicit guards proving Thoth avoids it.

Retry condition:

If future app/CLI/desktop behavior unexpectedly connects to the wrong daemon, first run `npm run smoke:isolation`, inspect endpoint fallback code, and check for newly introduced `6767` defaults before debugging provider behavior.

## `NTH-EXP-010` Clarify Golden Fixtures Must Preserve Semantic Provenance, Not Just Schema

Motivation:

`NTH-TD-015` required independent `codex exec` judge review because packet validity and local eval
can miss secretary-behavior problems.

Observed result:

Two independent judge runs failed before final acceptance even though deterministic schema evals
passed. The judge caught that a `you decide` Task Card had lost the original target, a note-only
answer fixture looked like repeated Clarify, a Task Card transcript lacked the initial user goal, a
cleanup branch could be read as a partial-scope downgrade, and a Goal Card fixture mixed an unrelated
approved CEO Task Card with a settings-page transcript.

Conclusion:

Clarify golden data must be semantically coherent end to end: original user goal -> Clarify transcript
-> Task Card -> approved CEO Task Card -> Goal Card split. The presence of provenance fields is not
enough; their contents must match and constrain the generated card. Independent judge failures should
change fixtures, prompt contract or rubric before acceptance.

Retry condition:

When future Clarify/Task/Goal golden cases are added, run `npm run judge:clarify:golden` and treat
semantic drift, repeated questions, hidden target replacement and unrelated provenance as blocking
failures even if TypeScript tests pass.

## `NTH-EXP-011` Internal Runtime Skills Must Stay Session-Scoped

Motivation:

The first Loop-1 Clarify harness put most behavior in TypeScript prompt constants and per-round
compact prompts. That was too easy to make Codex-specific and too easy to leak into every provider
turn.

Observed result:

The revised Loop-1 acceptance required `thoth.clarify` and `thoth.loop` to be standard Skill
artifacts with `SKILL.md` as canonical source, while also forbidding writes to user global provider
skill homes. A fake clean provider home plus independent user-simulation judge proved Thoth can
mount `thoth.clarify` under a Thoth-owned provider session skill home without writing
`~/.codex/skills`, `~/.claude/skills` or `~/.agents/skills`. It also proved ordinary same-state
packets can stay compact and avoid repeating the Skill body.

Conclusion:

Internal runtime skills are source-visible and reviewable, but their runtime visibility is scoped to
Thoth-owned provider sessions. `SKILL.md` owns semantic rules; TypeScript owns load/validate/hash/mount
mechanics, mechanical transition checks and fallback rendering. Normal same-state packets should
carry runtime data only. State transitions and repair may carry `skill_ref` / digest markers, but
must not copy the rules.

Retry condition:

If a future provider integration seems to require global skill installation, treat it as a blocker or
use a Thoth-owned isolated provider/session home. Do not write internal `thoth.*` runtime skills into
the user's global provider skill dirs. If packet repair starts changing goals, transcripts or
approved cards, re-run `npm run eval:clarify`, `npm run judge:clarify:golden` and
`npm run judge:clarify:user-simulation` before accepting the change.

## `NTH-EXP-007` Web Scorecard Settings Paths Must Respect Responsive Layout

Motivation:

The Web scorecard smoke needs to stress rapid Home, Workspace, Settings and composer transitions
without confusing responsive navigation differences with product regressions.

Observed result:

Early Web scorecard attempts treated the Settings sidebar/back path as identical on desktop and
mobile. On narrow viewports the real app uses the menu drawer and can stay on the Settings host root
route instead of the desktop General sub-route. The test then waited for desktop-only visible
controls and hit global timeouts even though the app surface was not blank.

Conclusion:

Scorecard helpers should enter Settings through the real visible control for the current viewport,
accept both Settings root and General sub-route when the app allows either, and run deep
Settings-to-Workspace back loops from desktop width unless the mobile-specific back path is the
behavior being tested.

Retry condition:

If a future Web scorecard run times out around Settings navigation, first check viewport, drawer
state, visible route controls and current URL before treating it as a product UI regression.

## `NTH-EXP-008` UI Shell Evidence Does Not Prove Thoth Product Direction

Motivation:

The Web/Desktop/OpenTUI scorecard work produced real screenshots, route smokes and terminal frames,
but it kept optimizing the promoted Paseo-derived shell shape.

Observed result:

The user review on 2026-07-03 found the APP direction still too close to a Paseo skin: workspace,
session, provider and settings surfaces existed, but the fundamental interaction model did not
start from the Thoth user journey. The missing product center is the workspace secretary
session, hidden built-in clarify/loop runtime skills, compact state-code packets, two explicit Loop
registration confirmations and a separate Background Tasks view.

Conclusion:

Do not continue polishing the old scorecard shell as the primary APP direction. Treat it as
engineering evidence that the substrate can render, not as product acceptance. New APP work must
start from `.agent-os/designs/thoth-app-runtime-contract.md` and
`packages/protocol/src/thoth-runtime-contract.ts`.

Retry condition:

Only revisit the old scorecard shell to harvest reusable components, screenshots or smoke harness
techniques. Do not preserve its information architecture unless a future user decision explicitly
reopens the APP model.

## `NTH-EXP-009` GitHub Push Must Use Project-Local Authority

Motivation:

Thoth keeps GitHub CLI state under ignored `.dev/gh` through `npm run gh -- ...` so repository
automation does not depend on or mutate global `~/.config/gh`. Git pushes must obey the same
authority boundary.

Observed result:

On 2026-07-03, after renaming `agent/dev/ui` to `agent/dev/mvp`, the first `git push -u origin
agent/dev/mvp` failed with GitHub `403` because Git used a stale global or URL-specific credential
identity. The project-local `.dev/gh` login had repository push permission, verified by `npm run gh
-- api repos/SeeleAI/Thoth --jq '{full_name,private,permissions}'`, but plain `git push` still
ignored that authority until the credential helper path was made explicit.

Conclusion:

Do not trust plain `git push` on this host when pushing `SeeleAI/Thoth`. Before pushing, verify the
effective GitHub identity and permission through the project wrapper, then verify Git's effective
credential source. If `git credential fill` resolves to the wrong username, clear the URL-specific
GitHub helper for the push command and use the project-local credential store/token path instead.
Never print the token, never write it into tracked files, and never change global GitHub auth to fix
a repository-local push.

Retry condition:

If a future push fails with `Permission to SeeleAI/Thoth.git denied to ...` for an unexpected user,
first run `npm run gh -- auth status`, `npm run gh -- api user --jq .login`, and a repository
permission check through `npm run gh -- api repos/SeeleAI/Thoth`. Then inspect `git config
--show-origin --get-all credential.helper` and URL-specific `credential.https://github.com.helper`
entries before retrying. Do not retry blindly with the same plain `git push`.

## `NTH-EXP-011` Clarify Strength Must Be Judged As Behavior, Not As A Field

Motivation:

The 2026-07-04 Loop-1 revision added `none` / `light` / `balanced` / `dive`, assumption owners,
decision-tree frontier refs and multi-question `C_ASK` cards. A schema-only implementation could
have accepted the fields while leaving the agent behavior unchanged.

Observed result:

The deterministic eval had to compare the same Three.js PathTracing prompt across all four strength
levels: `none` stays direct, `light` asks only the core target-grade fork, `balanced` adds acceptance
and ownership leaves, and `dive` walks target, acceptance, risk and discoverable/agent-owned
assumptions without asking implementation trivia. The judge prompt also needed to inspect hidden
`content.meta` and assumption owner handling; otherwise `dive` could drift into a field questionnaire.

Conclusion:

Future Clarify changes must prove strength through behavior differences, not through packet fields
alone. `dive` is not permission to ask every detail; it still filters `agent_can_decide`,
`agent_can_discover` and `standard_answer/common_sense` assumptions. Normal turns should carry
controls and refs compactly, but must not repeat `SKILL.md` rules.

Retry condition:

When changing `thoth.clarify` strength, question cards, assumption owners or output meta, rerun
`npm run eval:clarify`, `npm run judge:clarify:golden` and
`npm run judge:clarify:user-simulation`. If a judge flags unchanged behavior across strengths,
field-questionnaire drift, discoverable facts pushed to the user or target downgrade, fix
`SKILL.md` / fixtures / packet invocation before accepting the revision.

## `NTH-EXP-012` Loop-2 Web E2E Must Prefer Static Export Over Raw Metro Dev Server

Motivation:

The Loop-2 Workspace Secretary e2e initially loaded the app through the existing Metro dev-server
path. The browser stayed white and emitted `Cannot use 'import.meta' outside a module` before the
new shell could render.

Observed result:

`npm run build:web` succeeded and `packages/app/dist/index.html` marked the Expo bundle script as
`type="module"`. The generated bundle still contains `import.meta.env` from Zustand devtools, which
is acceptable for the static export module script. The raw Metro dev-server path served the same
kind of bundle without the post-export module-script fix, so it failed before React mounted.

Conclusion:

For current Web review and Loop-2 scorecard evidence, use the documented static export path:
`npm run build:web`, `npm run serve:web` or `npm run smoke:web:ui-scorecard`. Do not treat raw Metro
dev-server e2e failure as proof that the Workspace Secretary shell is broken unless the static
export path also fails.

Retry condition:

If future app e2e regresses with `import.meta` on a blank page, first check whether the test is using
Metro or static export. Then inspect `packages/app/dist/index.html` for `type="module"` and search
`packages/app/dist/_expo/static/js` for `import.meta` before changing app code.

## `NTH-EXP-013` Loop-2 APP Authority Must Not Drift Back Into Fixtures Or App-Local Relay Models

Motivation:

Loop-2 started with a development fixture APP slice so the Workspace Secretary / Clarify product
shape could be reviewed quickly. That was useful for UI exploration, but it was not enough for final
acceptance because the Loop-2 contract requires typed clean UI model authority from
protocol/client/daemon and real `relay.test.thoth.seeles.ai` validation without fake connected
states.

Observed result:

The final Loop-2 pass moved the active path to `workspace_secretary.snapshot/send/answer/topic.create`
RPCs and daemon-owned clean UI model state. The daemon now probes the real relay health endpoint and
emits `settings.relay` in the clean UI model before schema verification. A first independent review
flagged app-local relay model overwrite as a narrow boundary caveat; the final implementation
removed that production path, and `packages/app/src/thoth-app/clean-ui-model.ts` no longer exports a
relay model factory.

Conclusion:

Future APP work may use explicit test doubles inside tests, but production surfaces must not create
Clarify cards, relay status, Task Cards or Goal Cards from app-local fixtures, assistant text,
markdown JSON or raw packets. Settings relay status belongs to daemon clean UI authority. If a helper
can make the app look like it owns authority, either move it into daemon/protocol or keep it private
to tests.

Retry condition:

If a future UI task reintroduces development fixtures, app-local relay probing, fake connected relay
states, local Task/Goal Card factories or assistant-text parsing, rerun the Loop-2 anti-residual scan
and independent UI mental-model review before accepting the change. Any user-visible fallback to
Paseo semantics, request-user-input framing or fake relay evidence should block acceptance.

## `NTH-EXP-014` Electron Desktop Loop-2 Smoke Should Load Static Export

Motivation:

After Loop-2 web and mobile screenshots passed, a manual `view_image` re-check found that
`/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/desktop-scorecard/` still contained historical pre-Loop-2 One Thoth /
New Agent screenshots. The desktop scorecard script was still navigating old `/open-project`,
workspace and settings routes instead of the current three-view Workspace Secretary root.

Observed result:

Updating the script to target the Loop-2 root exposed another local smoke trap: dev Electron tried to
load `EXPO_DEV_URL` over local HTTP and timed out under the container/Xvfb/proxy environment even
though Node could reach the static server. The reliable path was to let the dev Electron shell load
the same static export that packaged desktop uses through the existing `thoth://app/` protocol. The
new `THOTH_DESKTOP_LOAD_STATIC_EXPORT=1` switch enables that path for desktop scorecard runs.

Conclusion:

For Loop-2 desktop app visual evidence, do not reuse the old `desktop-scorecard` screenshots and do
not depend on dev Electron reaching `EXPO_DEV_URL` over localhost HTTP. Use
`npm run smoke:desktop:ui-scorecard`, which builds the web export, builds desktop main, loads the
static export inside Electron and captures the current `desktop-app-*` screenshots under
`/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/`.

Retry condition:

If a future desktop scorecard fails with a blank Electron target, `net::ERR_CONNECTION_TIMED_OUT`,
old `One Thoth` / `New Agent` screenshots or missing `desktop-app-*` captures, first verify the
smoke is using `THOTH_DESKTOP_LOAD_STATIC_EXPORT=1` and the Loop-2 root selectors before changing
Workspace Secretary UI code.

## `NTH-EXP-015` Composer Dropdowns Must Overlay Instead Of Reflowing Mobile Controls

Motivation:

The Workspace Secretary composer now keeps Mode, Clarify strength and Loop strength as collapsed
bottom controls. The first implementation rendered the opened menu as ordinary layout between the
input and bottom control strip.

Observed result:

Desktop looked acceptable, but the mobile Loop menu pushed the bottom control strip downward so the
Loop trigger that opened the menu was no longer visible in `mobile-composer-loop-menu.png`. This
violated the "bottom controls, folded, decluttered" UX intent even though the e2e still passed.

Conclusion:

Composer dropdowns should be upward overlays anchored to the composer, not normal layout that
changes the bottom strip height. The input row, send button and Mode / Clarify / Loop triggers must
remain spatially stable while a menu is open. Manual `view_image` review is required for both
collapsed and open states on mobile.

Retry condition:

When changing Workspace Secretary composer controls, rerun the Loop-2 scorecard with dropdown-open
screenshots and inspect `desktop-composer-clarify-menu.png` plus
`mobile-composer-loop-menu.png`. If a menu hides the trigger row, overlaps the input, resembles a
questionnaire/permission prompt or makes the composer feel like an agent manager dashboard, fix the
layout before accepting the change.

## `NTH-EXP-016` Provider-Backed Streaming Evidence Must Distinguish Safe Progress From Token Text

Motivation:

The reopened Loop-2 acceptance required provider-backed streaming-first Workspace Secretary output
and atomic Clarify cards. Codex native `outputSchema` is the safest structured bridge for this slice,
but it does not always expose safe token-level prose deltas that can be shown before the final packet
is validated.

Observed result:

The final Loop-2 evidence proved clean live provider progress events, final real-provider replies and
daemon-supported `secretary_reply_delta` for safe non-structured text. It did not require exposing
raw assistant deltas, partial JSON, packet fragments or unvalidated card content. An early public
visual check also captured the app before the host probe finished, briefly showing a host-unavailable
state even though the public same-origin daemon and WebSocket proxy later became healthy.

Conclusion:

For provider-backed UI verification, distinguish three cases: safe clean progress events can stream
immediately; safe non-structured direct reply text may stream as `secretary_reply_delta`; structured
`C_ASK` / Task / Goal cards must wait for complete provider output plus daemon validation and then
render atomically. Public web screenshot checks should wait for the Workspace Secretary ready state
rather than judging the first host-probe frame.

Retry condition:

If future Loop-2 or Loop-3 UI evidence seems non-streaming, first inspect whether the provider bridge
is native `outputSchema` and whether clean progress events are present. Do not add assistant
markdown/code-fence parsing, raw delta display or local card fallback to manufacture token-level
streaming. If a public screenshot shows host unavailable, wait for the ready status and confirm the
current bundle plus `__THOTH_INITIAL_DAEMON_CONNECTION__` before changing runtime code.

## `NTH-EXP-017` Dynamic Tool Catalog Creation Is Earlier Than Provider Session Registration

Observed on `2026-07-11` during the real Codex Loop fixture:

1. The Clarify -> Task continuation did start and `thoth_submit_task_card` was called. It did not hang in app-server replacement handling.
2. The Task tool then failed its required independent convergence audit because its catalog had captured `agentManager.getAgent(callerAgentId)` while `AgentManager.buildLaunchContext()` ran before `registerSession()`.
3. The result looked like a loading timeout because the provider correctly received the audit-unavailable tool result and ended its turn, while the Secretary continued waiting for a Task Card that was never created.

Conclusion:

Catalog registration may use the launch config, but handlers that need a live provider caller must resolve it at invocation time. Real-provider fixtures must emit enough trace to distinguish a missing `turn/start` from a successful tool call that returned an authority error.

Retry condition:

When adding an audit, child session or caller-scoped tool, test both catalog creation before caller registration and execution after caller registration. For real transport tests, inject literal tool arguments into every newly-created PlanExec/Review session; otherwise a new provider session will improvise equivalent prose and accidentally turn a flow test into an intelligence test.
