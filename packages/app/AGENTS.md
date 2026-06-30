# AGENTS.md — packages/app

This package owns the Expo/React Native mobile and web shell for Thoth.

## Rules

1. UI is a shell. It displays daemon/protocol authority and should not become task truth.
2. Generated native folders `android/` and `ios/` are ignored outputs; never stage them.
3. Do not add voice/audio/speech/dictation permissions, dependencies or UI.
4. Prefer cross-platform React Native code by default. Gate DOM/native/Electron behavior only when necessary.
5. Use explicit platform helpers instead of ad hoc platform guesses once helpers exist.
6. Keep mobile offline behavior honest: cached read-only state is not authority for new tasks or approvals.
7. Test UI behavior in the app package; keep shared protocol/client behavior in their packages.

## Commands

Run from repo root:

```bash
npm run package:android:debug-apk
npm run package:ios:prebuild
```

Android/iOS native outputs are local artifacts only unless a future release task explicitly changes that.
