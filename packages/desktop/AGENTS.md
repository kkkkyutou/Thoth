# AGENTS.md — packages/desktop

This package owns the Electron desktop wrapper and desktop packaging substrate.

## Rules

1. Desktop is a shell around the app and local daemon. It does not own task authority.
2. Be careful with daemon lifecycle: stopping/restarting may kill active work.
3. Signing, notarization and release upload require explicit user authorization.
4. Keep generated release artifacts out of git.
5. Prefer shared protocol/client surfaces over desktop-only protocol forks.

## Commands

Desktop packaging is not part of the first foundation gate. Use local packaging docs before touching build/release behavior.
