# Lessons Learned

## `NTH-EXP-001` Do Not Carry Old Plugin Runtime Forward

Motivation:

The old Thoth plugin implementation accumulated Python runtime, generated Claude/Codex surfaces, dashboard templates, Textual TUI, selftests and release machinery. It was valuable as a historical experiment but no longer matched the New Thoth product direction.

Observed result:

Keeping old runtime code in the active working tree would make future agents treat old plugin compatibility as current truth and would compete with the TypeScript / Node authority runtime design.

Conclusion:

Old plugin source should be recovered from the archive release or archive branch when needed. It should not remain in the active New Thoth skeleton.

Retry condition:

Only revisit old plugin code as reference material for a specific prompt, evidence, privacy, or loop design decision. Do not port it wholesale.

## `NTH-EXP-002` Prompt Assets Should Be Contracts, Not Legacy Code

Motivation:

Old `prompt_specs.py` contained useful hard stops and evidence-first phase lessons, but it was embedded in obsolete Python command projection machinery.

Observed result:

Retaining that file would preserve too much old runtime surface. Deleting it without extraction would lose hard-won prompt lessons.

Conclusion:

Extract prompt value into `.agent-os/designs/new-thoth-prompt-contract-seeds.md` as structured contract seeds.

Retry condition:

When implementing Router, Clarify, Plan, Execute or Review prompts, use the seed document and current product principles instead of importing old Python code.

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

Code4Agent active protected-path rules blocked the required `wrangler.jsonc` and workflow changes for Royalvice. The blocked path created coordination overhead without improving relay source authority.

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
