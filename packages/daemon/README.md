# @thoth/daemon

Local authority daemon package for Thoth.

This package now contains promoted upstream-derived server implementation material. It is intentionally expected to be temporarily broken while the Thoth authority model, provider drivers, task lifecycle and app protocol are reconciled.

Current boundaries:

1. This package is the formal `@thoth/daemon` package, not the upstream server package identity.
2. Realtime microphone features are not part of the current MVP line.
3. The daemon must remain a Thoth control-plane runtime and must not become a hidden direct LLM API wrapper.
4. Provider execution must flow through configured harness/provider sessions, ACP adapters, app-server sessions, official harness SDK/control surfaces or local harness CLIs.

Do not treat this package as runnable until the dependency and compile triage milestone records passing evidence.
