# AGENTS.md — packages/cli

This package owns command-line access to Thoth.

## Rules

1. CLI is a client shell over daemon/protocol authority; it does not own task truth.
2. Keep command output machine-readable when a script or agent may consume it.
3. Human-facing output should be direct and concise; avoid mechanical receipts that hide the cause.
4. Do not start/stop daemons destructively without explicit user intent.
5. CLI tests that need daemon state must isolate local homes and ports.

## Commands

This package is outside the first foundation gate. Run targeted CLI tests only when changing CLI behavior.
