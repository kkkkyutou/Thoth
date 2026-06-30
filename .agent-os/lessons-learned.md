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
