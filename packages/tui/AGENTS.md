# AGENTS.md — packages/tui

This package will contain the Thoth terminal UI shell.

## Rules

1. TUI must use OpenTUI.
2. Do not use Textual or revive the archived Python/plugin TUI.
3. TUI is a shell over the same protocol/authority as app, desktop and CLI.
4. Do not add product-only state that bypasses daemon/core authority.
5. Keep Node/Bun runtime decisions in the TUI spike TODO until explicitly locked.

## Commands

This package now has a first real OpenTUI implementation slice: shared surface modeling, a guarded renderer factory and a renderer smoke path. Do not add fake renderer, fake backend, fake daemon state, debug-only UI or scripts that pretend native TUI behavior passed without OpenTUI evidence.

Allowed current package scripts are build/typecheck/test for the real TypeScript slice. Native renderer and navigation smokes are exposed through root scripts so they can use the pinned Node FFI runtime path without changing the repository's locked Node 24 developer toolchain.
