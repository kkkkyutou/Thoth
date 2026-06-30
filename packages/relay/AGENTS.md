# AGENTS.md — packages/relay

This package owns the zero-knowledge E2EE WebSocket relay substrate.

## Rules

1. Relay only forwards ciphertext and connection metadata needed to bridge peers.
2. Do not store task truth, message content, provider output or offline queues in relay.
3. Keep crypto tests deterministic and local.
4. Cloudflare deploys require explicit user authorization; local validation is not deployment.
5. Do not import daemon/app task authority into relay.

## Commands

Run from repo root:

```bash
npm run build:relay
npm run typecheck:relay
npm run test:relay
```

Foundation work must keep this package green.
