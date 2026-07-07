# AGENTS.md — packages/core

This package is reserved for headless Thoth domain logic: authority types, task lifecycle policy, memory/context packets and deterministic runtime helpers.

## Rules

1. No React, React Native, DOM, Electron, provider SDKs or daemon process globals.
2. No direct LLM/API calls. Intelligent work must happen through provider sessions outside core.
3. Keep domain policy explicit and testable with pure inputs/outputs.
4. Validate boundary inputs before they enter core; trust typed values internally.
5. Do not add compatibility layers or adapters until at least two real callers require them.
6. If a concept becomes user/task authority, document it in `.agent-os` and protocol before making it durable.

## Commands

This package is not part of the first foundation gate yet. Add scripts only when a concrete core implementation slice lands.
