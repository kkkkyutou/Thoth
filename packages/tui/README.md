# @thoth/tui

Terminal UI package for Thoth.

Fixed decision:

1. The TUI must use OpenTUI.
2. The TUI is a single-workspace control surface.
3. The TUI must use the shared client/protocol path and must not write authority directly.

Deferred decision:

1. Node FFI vs Bun runtime remains intentionally undecided until the first OpenTUI spike.

Current status:

1. The package now contains the first non-rendering OpenTUI shell slice.
2. `src/surface.ts` derives the Home, Workspace, Task / Loop, Provider, Connections, Evidence / Review and Settings slots from shared daemon/client shapes.
3. `src/runtime.ts` reports whether native OpenTUI renderer creation is available for the current runtime.
4. `src/opentui-renderer.ts` is the guarded native renderer factory. On the locked Node `24.14.0` toolchain it must fail before creating a renderer, because OpenTUI native renderer creation needs Bun or Node `26.3.0+` with experimental FFI.

This is not a complete TUI app yet. It does not create task authority, does not bypass daemon/core state, and does not claim a native TUI smoke is available on the current Node toolchain.
