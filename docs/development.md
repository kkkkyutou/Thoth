# Development

This document is the executable development guide for New Thoth. Product truth and decisions live in `.agent-os/`; this file explains how to work in the repository.

## Environment

- Node.js: `24.14.0`
- npm: `11.9.0`
- Package manager: npm workspaces
- Runtime direction: TypeScript / Node
- Local toolchain/artifact directory: `.dev/` (ignored)

Install dependencies:

```bash
npm install
```

Root `.npmrc` intentionally sets `ignore-scripts=true`, `audit=false` and `fund=false`.
This keeps first-day installs deterministic and prevents optional native lifecycle scripts from
blocking normal development setup. Native/toolchain work must be done through explicit root
scripts such as `package:android:debug-apk`, not through package install side effects.

Do not use pnpm/yarn in this repository unless a future decision changes the package manager.

## Current State

The repository contains promoted implementation substrate. It is not a runnable product yet.

The first development gate is the foundation set:

- `packages/app/highlight`
- `packages/relay`
- `packages/protocol`
- `packages/client`

The daemon, app, desktop, CLI and drivers may still contain broken imports or incomplete wiring. Do not delete promoted code simply because those broader packages are expected-broken.

## Standard Commands

Run commands through root npm scripts:

```bash
npm run validate:repo
npm run format:check
npm run lint:foundation
npm run build:foundation
npm run typecheck:foundation
npm run test:foundation
npm run check:foundation
```

Formatting and linting:

```bash
npm run format
npm run format:check
npm run lint
npm run lint:fix
```

Android packaging:

```bash
npm run doctor:android
npm run setup:android-toolchain
npm run package:android:debug-apk
```

iOS packaging:

```bash
npm run package:ios:prebuild
npm run package:ios:build
```

`package:ios:build` requires macOS with Xcode.

## Command Discipline

Use root npm scripts as the public command surface. Do not make routine changes by directly invoking `npx oxfmt`, `npx oxlint`, `npx vitest` or `npx tsc`. Direct tool calls are only for debugging a root script failure, and the final report must say so.

## Generated And Local Files

Never stage:

- `.dev/`
- `.agent-os/upstreams/`
- `.agent-os/artifacts/`
- `packages/app/android/`
- `packages/app/ios/`
- `node_modules/`
- build outputs such as `dist/`, `build/`, `.expo/`, `.wrangler/`

Generated Android/iOS native folders are local packaging outputs, not source authority.
