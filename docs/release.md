# Release

New Thoth currently has no authorized release flow from this branch.

## Manual Authorization Rule

Previewing release contents is not permission to publish.

The agent must wait for explicit user authorization before any of the following:

- push
- tag creation
- GitHub Release mutation
- npm publish
- desktop installer upload
- Cloudflare deploy
- EAS cloud build
- App Store or Play Store submission

## Current State

The main Thoth repository still has no authorized production release flow from this branch.

Allowed local outputs:

- local foundation gate
- local Android Debug APK
- local Linux AppImage
- local packaging receipts under ignored artifact paths
- docs and `.agent-os` evidence

The test relay is deployed from independent repository `SeeleAI/Thoth-Relay` to
`relay.test.thoth.seeles.ai`. That test deploy is not a production release and does not authorize
production `relay.thoth.seeles.ai`, production `app.thoth.seeles.ai`, app store submission, npm
publish, desktop installer upload, Thoth main repo push or release tagging.

## Future Release Blueprint

When runnable surfaces exist, the release pipeline should be explicit and tag/manual driven:

1. Local preparation: format, lint, foundation/full relevant gates, release notes preview.
2. User approval: explicit go-ahead.
3. Version/tag: one intentional release commit and tag.
4. Desktop: Electron Builder artifacts for macOS/Linux/Windows.
5. Android: APK/AAB through local or EAS-backed flow.
6. iOS: TestFlight/App Store/EAS submit or another Apple-approved path.
7. Relay/web: explicit deploy jobs, never implied by ordinary development checks.

No ordinary branch push should publish production artifacts.
