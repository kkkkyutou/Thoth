# AGENTS.md — packages/tui

This package will contain the Thoth terminal UI shell.

## Rules

1. TUI must use OpenTUI.
2. Do not use Textual or revive the old Python/plugin TUI.
3. TUI is a shell over the same protocol/authority as app, desktop and CLI.
4. Do not add product-only state that bypasses daemon/core authority.
5. Keep Node/Bun runtime decisions in the TUI spike TODO until explicitly locked.

## Commands

This package is skeleton-only. Do not add fake build/test scripts before a real OpenTUI implementation slice exists.
