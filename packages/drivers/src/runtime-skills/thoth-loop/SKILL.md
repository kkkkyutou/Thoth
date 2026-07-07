---
name: thoth.loop
description: Reserved hidden Thoth runtime skill artifact for future PlanExec, Review, retry, and evidence behavior. Do not invoke until the Thoth loop runtime is implemented by later MVP loop goals.
user-invocable: false
x-thoth-runtime: hidden
x-thoth-required: true
x-thoth-scope: provider-session
x-thoth-status: reserved
---

# thoth.loop

This is the reserved standard Skill artifact location for the future Thoth loop runtime.

Do not invoke this skill for live execution yet. `thoth.loop` execution, Review, retry, evidence, permission, and task-completion behavior remain unfinished until the dedicated Loop Execution and Review Agent Harness work.

The artifact exists so Thoth-owned runtime skills use the same internal, session-scoped Skill bundle model. It must not be installed into user global provider skill directories.
