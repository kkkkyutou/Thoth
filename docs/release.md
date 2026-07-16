# Release

Thoth has one explicitly authorized MVP beta release flow. This document records that narrow
authorization; it does not authorize npm publishing, app-store submission, production relay deploys
or changes to `main`.

## Manual Authorization Rule

Previewing release contents is not permission to publish. The user explicitly authorized the
`v0.0.0-mvp-beta` flow on `2026-07-16`, including the two branch pushes, GitHub Actions execution,
tag replacement and GitHub Release mutation described below.

The agent must wait for explicit user authorization before any of the following:

- push
- tag creation
- GitHub Release mutation
- npm publish
- desktop installer upload
- Cloudflare deploy
- EAS cloud build
- App Store or Play Store submission

## MVP Beta Authority

- Version: `0.0.0-mvp-beta`
- Tag: `v0.0.0-mvp-beta`
- Development branch: `agent/dev/mvp`
- Release automation branch: `release/mvp-actions`
- Release: <https://github.com/SeeleAI/Thoth/releases/tag/v0.0.0-mvp-beta>
- Trigger: every push to `release/mvp-actions`
- Publication: GitHub Release only; all npm workspace packages remain private
- Default hosted transport: Relay v3 TLS at `relay.test.thoth.seeles.ai:443`

The workflow builds and validates all native artifacts before touching the existing MVP Release. Its
publish job checks that the branch HEAD still matches the workflow SHA, deletes only the prior MVP
Release/tag, creates a draft prerelease on the current commit, uploads the complete artifact set,
compares the exact asset-name manifest and then makes it public. A failed build leaves the previous
MVP Release intact. Historical releases such as `thoth-plugin-final-archive` are never removed.

Until the user chooses a new version, updates replace this same Release and tag. They do not create
additional MVP beta releases.

## Artifact Policy

The release contains unsigned/ad-hoc macOS and Windows desktop packages, Linux desktop packages, a
dedicated-key signed Android APK, updater manifests, source-commit metadata, checksums and the server
CLI tgz. It does not contain an iOS package.

The server CLI is installed directly from GitHub and is not uploaded to npm:

```bash
npm install -g https://github.com/SeeleAI/Thoth/releases/download/v0.0.0-mvp-beta/thoth-server-cli-0.0.0-mvp-beta.tgz
```

## Credentials And GitHub Operations

All repository GitHub operations use the Royalvice repository-local configuration:

```bash
THOTH_GH_CONFIG_DIR=.dev/gh-royalvice npm run gh -- auth status --hostname github.com
THOTH_GH_CONFIG_DIR=.dev/gh-royalvice npm run gh -- api user
```

Do not use global `~/.config/gh`, place credentials in command arguments, commit signing material or
reuse a credential exposed in chat. Android keystore material stays in ignored
`.dev/release-keys/` and repository Actions secrets. Workflow build jobs have `contents: read`; only
the final publish job has `contents: write` through its automatic `GITHUB_TOKEN`.

## Branch Safety

The user authorized a guarded `--force-with-lease` update of `agent/dev/mvp` only against the
previously audited remote SHA, followed by a normal push of `release/mvp-actions`. `main` must not be
merged, pushed, rebased or retagged by this flow. If the audited remote branch SHA changes before
push, stop and inspect the concurrent update rather than overriding it.

The independent `SeeleAI/Thoth-Relay` deployment and any future production relay/web deployment are
outside this release authorization.
